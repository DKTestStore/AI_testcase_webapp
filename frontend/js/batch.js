/* Batch mode: a separate workspace with its own layout and state.
   The single run (S.run outside batch) is never modified here; Exit batch returns to it unchanged. */
"use strict";

const BS = { batch: null, single: null, running: false, stop: false, sel: null, selFor: null, add: null, jiraText: "",
             files: [], model: "gemini", expanded: new Set(), timer: null, prevView: "input" };
const B_VIEWS = { input: "b-items", generate: "b-gen", review: "b-review", qtest: "b-qtest" };
const B_SRC = { jira: ["b", "🧩 Jira"], local: ["gr", "📝 Local text"], excel: ["y", "📊 Excel"] };
const B_ID = /^[A-Z][A-Z0-9]+-\d+$/;

const bItems = () => (BS.batch ? BS.batch.items : []);
const bItem = (k) => bItems().find((i) => i.key === k);
const bHasCases = (i) => i.count > 0;
const bGenerates = (i) => i.source !== "excel" && i.fetch.status === "ok";
function bApply(j) { if (j && j.batch) BS.batch = j.batch; if (j && j.single) BS.single = j.single; return j; }
async function bApi(path, opts) { return bApply(await api(path, opts)); }
async function refreshBatch() { return bApi("/api/batch"); }

// ------------------------------------------------------------------ shell (sidebar / topbar), added and removed as a unit
function bShellOn() {
  if ($("#bNav")) return;
  const sb = $(".sb"); sb.classList.add("bm");
  const head = document.createElement("div"); head.className = "bm-head"; head.id = "bmHead";
  head.innerHTML = `<b>▦ BATCH MODE</b>Separate workspace · your single run is kept as-is<br><a id="bmBack">↩ Back to single run</a>`;
  $(".sb .logo").after(head);
  $("#nav").style.display = "none"; $("#runinfo").style.display = "none";
  const nav = document.createElement("nav"); nav.className = "nav"; nav.id = "bNav";
  nav.innerHTML = [["b-items", "1", "Batch items"], ["b-gen", "2", "Generate queue"], ["b-review", "3", "Review items"], ["b-qtest", "4", "qTest batch upload"]]
    .map(([v, n, t]) => `<a data-view="${v}"><span class="num">${n}</span>${t}<span class="bcnt"></span></a>`).join("")
    + `<div class="sep"></div><a data-view="history"><span class="num">🕘</span>Run history</a><a data-view="setup"><span class="num">✓</span>Setup checklist</a><a data-view="settings"><span class="num">⚙</span>Settings</a>`;
  $("#nav").after(nav);
  const ri = document.createElement("div"); ri.className = "runinfo"; ri.id = "bRunInfo"; $("#runinfo").after(ri);
  $$("#bNav a").forEach((a) => (a.onclick = () => go(a.dataset.view)));
  $("#bmBack").onclick = exitBatch;
  $("#newRunBtn").style.display = "none";
  const chip = document.createElement("span"); chip.className = "modechip"; chip.id = "bmChip"; chip.textContent = "▦ Batch mode";
  const nb = document.createElement("button"); nb.className = "btn g sm"; nb.id = "newBatchBtn"; nb.textContent = "＋ New batch"; nb.onclick = newBatchDialog;
  $("#newRunBtn").before(chip, nb);
}
function bShellOff() {
  ["#bmHead", "#bNav", "#bRunInfo", "#bmChip", "#newBatchBtn"].forEach((s) => { const e = $(s); if (e) e.remove(); });
  $(".sb").classList.remove("bm");
  $("#nav").style.display = ""; $("#runinfo").style.display = ""; $("#newRunBtn").style.display = "";
}
function bCounts() {
  const it = bItems(), wc = it.filter(bHasCases);
  return { n: it.length, gen: it.filter(bGenerates).length, cases: wc.length, ready: it.filter((i) => i.ready).length,
           queued: it.filter((i) => ["queued", "generating"].includes(i.gen.status)).length, up: it.filter((i) => i.uploaded > 0).length };
}
function bInfo() { const c = bCounts(); return `${c.n} item${c.n === 1 ? "" : "s"} · ${c.ready} of ${c.cases} ready`; }
function renderBatchNav() {
  if (!$("#bNav")) return;
  const c = bCounts(), cnt = { "b-items": c.n, "b-gen": c.gen, "b-review": c.cases, "b-qtest": c.ready };
  const done = { "b-items": bItems().some((i) => i.fetch.status === "ok"), "b-gen": c.gen > 0 && !c.queued && bItems().some((i) => i.gen.status === "done"),
                 "b-review": c.ready > 0, "b-qtest": c.up > 0 };
  $$("#bNav a").forEach((a) => {
    const v = a.dataset.view; a.classList.toggle("a", v === S.view); a.classList.toggle("done", !!done[v]);
    const b = a.querySelector(".bcnt"); if (b) b.textContent = cnt[v] || "";
  });
  const s = BS.single || {};
  $("#bRunInfo").innerHTML = `Batch <b>${esc(BS.batch.rid || "(not saved yet)")}</b><br>${esc(bInfo())}<br>Single run kept: <b>${esc(s.rid || (s.story_id ? s.story_id : "(empty)"))}</b>`;
}
function bBar() {
  return `<div class="bm-bar" id="bmBar">▦ <b>Batch mode</b> · ${esc(BS.batch.rid || "new batch")} · ${esc(bInfo())}<span class="sp"></span><button class="btn g sm" id="bmExit">↩ Exit batch — back to single run</button></div>`;
}

// ------------------------------------------------------------------ enter / exit / new / resume
async function enterBatch() {
  await bApi("/api/batch/enter", { method: "POST" });
  BS.prevView = S.view; S.mode = "batch"; bShellOn();
  S.view = "b-items"; location.hash = S.view; render();
}
async function exitBatch() {
  if (S.localDirty && !confirm("You have unsaved edits in this item. Leave batch mode without saving?")) return;
  BS.stop = true;
  await api("/api/batch/exit", { method: "POST" });   // returns the untouched single run -> S.run
  S.mode = "single"; S.localDirty = false; S.cases = []; bShellOff(); clearInterval(BS.timer);
  S.view = "input"; location.hash = "input"; render();
  if (window.refreshHistoryCount) refreshHistoryCount();
}
function newBatchDialog() {
  modal(`<h1>Start a new batch?</h1><div class="sub" style="margin:6px 0 14px">The current batch is kept in Run history as one entry and a fresh empty batch starts. Your single run is not affected.</div>
    ${BS.running ? '<div class="warn" style="margin-bottom:14px">⚠ Generation is running — it will be cancelled.</div>' : ""}
    <div style="text-align:right"><button class="btn g" id="mCancel">Cancel</button> <button class="btn" id="mOk">Start new batch</button></div>`);
  $("#mCancel").onclick = closeModal;
  $("#mOk").onclick = () => guarded($("#mOk"), async () => {
    if (BS.running) { BS.stop = true; await api("/api/batch/cancel_all", { method: "POST" }); }
    await bApi("/api/batch/new", { method: "POST" });
    Object.assign(BS, { sel: null, selFor: null, add: null, jiraText: "", files: [] }); S.localDirty = false; S.cases = [];
    closeModal(); go("b-items");
  });
}
async function resumeBatch(h) {
  S.mode = "batch"; await refreshBatch(); bShellOn();
  S.view = (h && (h.startsWith("b-") || ["history", "settings", "setup"].includes(h))) ? h : "b-items";
  if (S.view === "b-review" && !(BS.batch.active && bHasCases(bItem(BS.batch.active) || {}))) S.view = "b-items";
  location.hash = S.view; render();   // queued items wait for "▶ Generate N queued" (no surprise token use after a reload)
}
// Called by Run history after Open: switches the layout to match what the server opened.
function syncBatchMode(j, opts = {}) {
  if (j.mode === "batch") {
    BS.batch = j.batch; S.mode = "batch"; bShellOn(); Object.assign(BS, { sel: null, selFor: null });
    const first = opts.key ? bItem(opts.key) : bItems().find(bHasCases);
    (async () => {
      if (first) { await bApi("/api/batch/active", { method: "POST", body: { key: first.key } }); S.view = "b-review"; } else S.view = "b-items";
      location.hash = S.view; render();
    })().catch((e) => toast(e.message, true));
    return true;
  }
  if (S.mode === "batch") { S.mode = "single"; bShellOff(); }
  return false;
}
function batchGo(view) {
  if (S.view === "b-review" && view !== "b-review" && S.localDirty && !confirm("You have unsaved edits in the Review table. Leave without saving?")) return;
  if (S.view === "b-review" && view !== "b-review") S.localDirty = false;
  S.view = B_VIEWS[view] || view; location.hash = S.view; render();
}
function renderBatch() {
  if (!$("#bNav")) bShellOn();
  renderBatchNav();
  const v = $("#view");
  const page = { "b-items": bViewItems, "b-gen": bViewGen, "b-review": bViewReview, "b-qtest": bViewQtest }[S.view];
  if (page) return page(v);
  ({ history: (x) => viewHistory(x), setup: viewSetup, settings: viewSettings }[S.view] || bViewItems)(v);
  bInjectBar(v);
}
// Shared pages (history/setup/settings) get the batch bar once their content is rendered.
function bInjectBar(v) {
  const add = () => { if (S.mode === "batch" && !$("#bmBar", v)) { v.insertAdjacentHTML("afterbegin", bBar()); $("#bmExit").onclick = exitBatch; } };
  add(); setTimeout(add, 0); setTimeout(add, 400);
}
function bRefreshUI() {
  renderBatchNav();
  const bar = $("#bmBar"); if (bar) { bar.outerHTML = bBar(); $("#bmExit").onclick = exitBatch; }
  if (S.view === "b-gen" || S.view === "b-items") render();
  else if (S.view === "b-review") bRenderList();
  else if (S.view === "b-qtest" && !BS.uploading) render();
}
const srcPill = (i) => `<span class="pill ${B_SRC[i.source][0]}">${B_SRC[i.source][1]}</span>`;
const idCell = (i, sub) => `<span class="pill b">${esc(i.item_id)}</span>${i.ready ? '<span class="ready">✓ READY</span>' : ""}<div class="res" style="margin-top:3px">${esc(sub ?? i.title ?? "")}</div>`;
const rmBtn = (k) => `<button class="btn g sm b-rm" data-k="${k}" title="Remove from batch" style="color:#d33;border-color:#f3b4b4">✕</button>`;

// ------------------------------------------------------------------ 1. Batch items
function bAcLines(t) { return t.split(/\n/).map((l) => l.trim()).filter(Boolean); }
function bLocalText(story, acs) {
  const lines = bAcLines(acs);
  const norm = /acceptance\s+criteria\s*0*\d/i.test(acs) ? acs.trim()
    : lines.map((l, n) => `AC-${String(n + 1).padStart(2, "0")} ${l.replace(/^(?:AC\s*[-#]?\s*\d+|\d+)\s*[:.)\-–—]?\s*/i, "")}`).join("\n");
  return [story.trim(), norm ? "Acceptance Criteria\n" + norm : ""].filter(Boolean).join("\n\n");
}
function bJiraChips() {
  const seen = new Set(bItems().map((i) => i.item_id)), out = [];
  for (const raw of BS.jiraText.split(/[\s,;]+/).filter(Boolean)) {
    const id = raw.toUpperCase();
    if (!B_ID.test(id)) out.push({ id: raw, cls: "bad", note: "invalid" });
    else if (seen.has(id)) out.push({ id, cls: "dup", note: "duplicate" });
    else { seen.add(id); out.push({ id, cls: "", note: "" }); }
  }
  return out;
}
function bViewItems(v) {
  const it = bItems(), c = bCounts(), room = BS.batch.max - it.length;
  const failed = it.filter((i) => i.fetch.status === "failed");
  const imported = it.filter((i) => i.source === "excel").length;
  let form = "";
  if (BS.add === "jira") {
    form = `<div style="margin-top:12px"><label>Jira story IDs <span class="sub" style="margin:0;text-transform:none;letter-spacing:0">— comma, space or new line separated</span></label>
      <textarea id="bJira" rows="2" placeholder="e.g. CX-196, CX-201 MTG-1427">${esc(BS.jiraText)}</textarea>
      <div class="bt-chips" id="bChips"></div>
      <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px"><button class="btn g sm" id="bAddCancel">Cancel</button><button class="btn sm" id="bJiraAdd">＋ Add &amp; fetch</button></div></div>`;
  } else if (BS.add === "local") {
    form = `<div class="lform"><div><label>Story ID / title</label><input id="bLId" placeholder="ID (optional) — e.g. SHOP-88" style="width:100%"><input id="bLTitle" placeholder="Title" style="width:100%;margin-top:6px">
      <div class="sub" style="margin:6px 0 0;font-size:11.5px">No ID → gets <b>LOCAL-${String(it.filter((i) => /^LOCAL-\d+$/.test(i.item_id)).length + 1).padStart(3, "0")}</b> automatically</div></div>
      <div><label>Story text</label><textarea id="bLText" placeholder="As a … I want … so that …"></textarea></div>
      <div class="full"><label>Acceptance criteria <span class="sub" style="margin:0;text-transform:none;letter-spacing:0">— one per line or "Acceptance Criteria 01 – …"</span></label><textarea id="bLAc" style="min-height:70px"></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><span class="pill gr" id="bAcCnt">0 ACs detected</span><span><button class="btn g sm" id="bAddCancel">Cancel</button> <button class="btn sm" id="bLocalAdd">＋ Add to batch</button></span></div></div></div>`;
  } else if (BS.add === "excel") {
    form = `<div style="margin-top:12px"><input type="file" id="bXl" accept=".xlsx" multiple class="hidden"><button class="btn g sm" id="bXlPick">📂 Choose .xlsx files…</button> <span class="sub" style="margin:0">Each file becomes one item (Review only → qTest). Story ID is detected from the file name, e.g. <b>CX-205_testcases.xlsx</b>.</span> <button class="btn g sm" id="bAddCancel">Close</button></div>`;
  }
  const files = BS.files.length ? `<div class="files">${BS.files.map((f) => `<span class="file ${f.ok ? "" : "bad"}">📊 <b>${esc(f.name)}</b> · ${esc(f.msg)}</span>`).join("")}</div>` : "";
  const rows = it.map((i) => {
    let st, det, flow, act = "";
    if (i.source === "jira") {
      st = i.fetch.status === "ok" ? '<span class="st-dot ok"><i></i>Fetched</span>' : i.fetch.status === "failed" ? '<span class="st-dot er"><i></i>Not fetched</span>' : '<span class="st-dot run"><i></i>Fetching…</span>';
      det = i.fetch.status === "failed" ? esc(i.fetch.error) : i.fetch.status === "ok" ? `${i.ac_count} ACs` : "—";
      flow = i.fetch.status === "ok" ? '<span class="flow">Fetch → Generate → Review → qTest</span>' : '<span class="flow" style="opacity:.5">—</span>';
      act = i.fetch.status === "failed" ? `<button class="btn g sm b-retry" data-k="${i.key}">↻ Retry</button>` : i.fetch.status === "ok" ? `<button class="btn g sm b-view" data-k="${i.key}">👁 View ACs</button>` : "";
    } else if (i.source === "local") {
      st = '<span class="st-dot ok"><i></i>Ready (entered)</span>'; det = `${i.ac_count} ACs (parsed from text)`;
      flow = '<span class="flow">Generate → Review → qTest</span>'; act = `<button class="btn g sm b-view" data-k="${i.key}">👁 View</button>`;
    } else {
      st = '<span class="st-dot ok"><i></i>Imported</span>'; det = `${i.count} test cases · ${i.steps} steps${/^LOCAL-/.test(i.item_id) ? "" : " · story ID from file name"}`;
      flow = '<span class="flow rv">Review only → qTest <small>(skips Generate)</small></span>'; act = `<button class="btn g sm b-view" data-k="${i.key}">👁 Preview</button>`;
    }
    return `<tr class="${i.fetch.status === "failed" ? "fail" : ""}" data-k="${i.key}"><td>${srcPill(i)}</td><td>${idCell(i, i.source === "excel" ? i.filename : (i.title || "—"))}</td><td>${st}</td><td class="res">${det}</td><td>${flow}</td><td style="white-space:nowrap">${act} ${i.gen.status === "generating" ? "" : rmBtn(i.key)}</td></tr>`;
  }).join("");
  const toGen = it.filter((i) => bGenerates(i) && !["done"].includes(i.gen.status)).length;
  v.innerHTML = `<div class="bmv">${bBar()}<h1>Batch items <span class="batch-pill">Batch · ${it.length} item${it.length === 1 ? "" : "s"}</span></h1>
    <div class="sub">Mix sources in one batch — each item becomes its own run (own test cases, Excel and qTest module).</div>
    <div class="card"><div class="addbar"><button class="btn sm ${BS.add === "jira" ? "on" : "g"}" data-add="jira">🧩 ＋ Add Jira IDs</button><button class="btn sm ${BS.add === "local" ? "on" : "g"}" data-add="local">📝 ＋ Add local text story</button><button class="btn sm ${BS.add === "excel" ? "on" : "g"}" data-add="excel">📊 ＋ Upload Excel files</button><span class="sub" style="margin:0;align-self:center" id="bRoom">max ${BS.batch.max} items · ${room} left</span></div>${form}${files}</div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Batch items</h3><span class="sub" style="margin:0">${it.length - failed.length} ready · ${failed.length} failed · <b>${c.gen} will generate</b>, <b>${imported} review only</b></span></div>
    ${it.length ? `<table class="bt" id="bItems" style="margin-top:10px"><tr><th>Source</th><th>Item</th><th>Status</th><th>Details</th><th>What will run</th><th>Actions</th></tr>${rows}</table>` : '<div class="sub" style="margin:10px 0 0">No items yet — add Jira IDs, a local text story or Excel files above.</div>'}
    ${failed.length ? `<div class="bnote">⚠ ${failed.map((i) => esc(i.item_id)).join(", ")} could not be fetched — retry, remove it, or continue with the ${it.length - failed.length} ready item${it.length - failed.length === 1 ? "" : "s"} (it will be skipped).</div>` : ""}</div>
    <div class="footer-nav"><div></div><button class="btn" id="bToGen" ${it.length - failed.length ? "" : "disabled"}>Continue to Generate (${toGen} to generate · ${imported} imported) →</button></div></div>`;
  $("#bmExit").onclick = exitBatch;
  $$("[data-add]", v).forEach((b) => (b.onclick = () => { BS.add = BS.add === b.dataset.add ? null : b.dataset.add; render(); }));
  const cancel = $("#bAddCancel"); if (cancel) cancel.onclick = () => { BS.add = null; BS.files = []; render(); };
  if (BS.add === "jira") {
    const ta = $("#bJira");
    const chips = () => { $("#bChips").innerHTML = bJiraChips().map((c) => `<span class="bt-chip ${c.cls}">${esc(c.id)}${c.note ? ` <small>${c.note}</small>` : ""}</span>`).join(""); };
    ta.oninput = () => { BS.jiraText = ta.value; chips(); }; chips(); ta.focus();
    $("#bJiraAdd").onclick = () => guarded($("#bJiraAdd"), async () => {
      const ok = bJiraChips().filter((c) => !c.cls).map((c) => c.id);
      if (!ok.length) throw new Error("Enter at least one valid, new Jira ID (e.g. CX-196).");
      const j = await bApi("/api/batch/items", { method: "POST", body: { source: "jira", ids: ok } });
      if (j.errors && j.errors.length) toast(j.errors.join(" · "), true);
      BS.jiraText = ""; BS.add = null; render();
      for (const k of j.added) { try { await bApi(`/api/batch/items/${k}/fetch`, { method: "POST" }); } catch (e) { toast(e.message, true); } bRefreshUI(); }
    });
  } else if (BS.add === "local") {
    const upd = () => { const n = bAcLines($("#bLAc").value).length; $("#bAcCnt").textContent = `${n ? "✓ " : ""}${n} AC${n === 1 ? "" : "s"} detected`; $("#bAcCnt").className = "pill" + (n ? "" : " gr"); };
    $("#bLAc").oninput = upd;
    $("#bLocalAdd").onclick = () => guarded($("#bLocalAdd"), async () => {
      const text = bLocalText($("#bLText").value, $("#bLAc").value);
      if (!text.trim()) throw new Error("Enter the story text and/or acceptance criteria.");
      await bApi("/api/batch/items", { method: "POST", body: { source: "local", item_id: $("#bLId").value, title: $("#bLTitle").value, text } });
      toast("Added to batch"); BS.add = null; render();
    });
  } else if (BS.add === "excel") {
    $("#bXlPick").onclick = () => $("#bXl").click();
    $("#bXl").onchange = (e) => guarded($("#bXlPick"), async () => {
      for (const f of [...e.target.files]) {
        if (!/\.xlsx$/i.test(f.name)) { BS.files.push({ name: f.name, ok: false, msg: "✕ only .xlsx is supported" }); continue; }
        const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
        try {
          const j = await bApi("/api/batch/items", { method: "POST", body: { source: "excel", filename: f.name, data } });
          const n = bItem(j.added[0]); BS.files.push({ name: f.name, ok: true, msg: `${Math.max(1, Math.round(f.size / 1024))} KB · ✓ ${n.count} TCs · ID ${n.item_id}` });
        } catch (ex) { BS.files.push({ name: f.name, ok: false, msg: "✕ " + ex.message }); }
      }
      render();
    });
  }
  $$(".b-retry", v).forEach((b) => (b.onclick = () => guarded(b, async () => { await bApi(`/api/batch/items/${b.dataset.k}/fetch`, { method: "POST" }); render(); })));
  $$(".b-rm", v).forEach((b) => (b.onclick = () => guarded(b, async () => { const i = bItem(b.dataset.k); if (!confirm(`Remove ${i.item_id} from this batch?`)) return; await bApi(`/api/batch/items/${b.dataset.k}`, { method: "DELETE" }); render(); })));
  $$(".b-view", v).forEach((b) => (b.onclick = () => bPreviewItem(b.dataset.k)));
  $("#bToGen").onclick = () => { go("b-gen"); startQueue(); };
}
async function bPreviewItem(k) {
  const i = bItem(k);
  await bApi("/api/batch/active", { method: "POST", body: { key: k } });
  const r = S.run;
  const body = i.source === "excel"
    ? `<ol style="max-height:360px;overflow:auto">${(r.test_cases || []).map((t) => `<li><b>${esc(t.id)}</b> ${esc(t.name)}</li>`).join("")}</ol>`
    : `<pre class="ro" style="max-height:360px;overflow:auto;white-space:pre-wrap">${esc(r.feature_text)}</pre>`;
  modal(`<h1>${esc(i.item_id)} · ${esc(i.title || "")}</h1><div class="sub">${i.source === "excel" ? `${i.count} test cases from ${esc(i.filename)}` : `${i.ac_count} acceptance criteria — this text is sent to the generator`}</div>${body}<div style="text-align:right"><button class="btn" id="mOk">Close</button></div>`);
  $("#mOk").onclick = closeModal;
}

// ------------------------------------------------------------------ 2. Generate queue (sequential, driven here)
async function startQueue() {
  if (BS.running) return;
  BS.running = true; BS.stop = false; bTick();
  try {
    while (!BS.stop && S.mode === "batch") {
      const next = bItems().find((i) => i.gen.status === "queued" && bGenerates(i));
      if (!next) break;
      next.gen.status = "generating"; next.gen.t0 = Date.now(); bRefreshUI();
      try { await bApi(`/api/batch/items/${next.key}/generate`, { method: "POST", body: { model: BS.model, prompt_mode: "default" } }); }
      catch (e) { toast(e.message, true); await refreshBatch().catch(() => {}); }
      const done = bItem(next.key);
      if (done && done.gen.status === "done") toast(`${done.item_id}: ${done.count} test cases generated`);
      if (done && done.gen.status === "failed") toast(`${done.item_id}: ${done.gen.error}`, true);
      bRefreshUI();
    }
  } finally { BS.running = false; clearInterval(BS.timer); bRefreshUI(); }
}
function bTick() {
  clearInterval(BS.timer);
  BS.timer = setInterval(() => $$(".b-el").forEach((e) => { const i = bItem(e.dataset.k); if (i && i.gen.t0) e.textContent = Math.round((Date.now() - i.gen.t0) / 1000) + " s"; }), 1000);
}
function bViewGen(v) {
  const it = bItems(), gi = it.filter(bGenerates), imp = it.filter((i) => i.source === "excel");
  const done = gi.filter((i) => i.gen.status === "done").length, run = gi.filter((i) => i.gen.status === "generating").length;
  const queued = gi.filter((i) => i.gen.status === "queued").length, tokens = it.reduce((a, i) => a + (i.gen.tokens || 0), 0);
  const avail = it.filter(bHasCases);
  const ST = { done: ["ok", "Done"], generating: ["run", "Generating…"], queued: ["q", "Queued"], failed: ["er", "Failed"], cancelled: ["wn", "Cancelled"], skipped: ["wn", "Skipped"], waiting: ["q", "Waiting for fetch"] };
  const rows = it.map((i) => {
    let st, tc = "—", tok = "—", tm = "—", act = "";
    if (i.source === "excel") { st = `<span class="st-dot wn"><i></i>Skipped — imported ${i.count} TCs</span>`; tc = `${i.count} test cases`; tok = "0"; act = `<button class="btn g sm b-open" data-k="${i.key}">👁 Open in Review</button>`; }
    else if (i.fetch.status !== "ok") { st = `<span class="st-dot er"><i></i>Skipped — not fetched</span>`; act = i.source === "jira" ? `<button class="btn g sm b-refetch" data-k="${i.key}">↻ Retry fetch</button>` : ""; }
    else {
      const [cls, lab] = ST[i.gen.status] || ["q", i.gen.status];
      st = `<span class="st-dot ${cls}"><i></i>${lab}</span>${i.gen.status === "failed" ? `<div class="res" style="color:#d33">${esc(i.gen.error)}</div>` : ""}`;
      if (i.count) tc = `${i.count} test cases`;
      if (i.gen.status === "done") { tok = fmt(i.gen.tokens); tm = `${i.gen.secs} s`; }
      if (i.gen.status === "generating") { tok = "~"; tm = `<span class="b-el" data-k="${i.key}">${i.gen.t0 ? Math.round((Date.now() - i.gen.t0) / 1000) : 0} s</span>`; act = `<button class="btn g sm b-cancel" data-k="${i.key}">✕ Cancel</button>`; }
      else if (i.gen.status === "queued") act = `<button class="btn g sm b-skip" data-k="${i.key}">⤼ Skip</button>`;
      else if (["failed", "cancelled", "skipped"].includes(i.gen.status)) act = `<button class="btn g sm b-requeue" data-k="${i.key}">↻ Retry</button>`;
      if (i.count) act += ` <button class="btn g sm b-open" data-k="${i.key}">👁 Open in Review</button>`;
    }
    return `<tr class="${i.fetch.status !== "ok" || i.gen.status === "failed" ? "fail" : ""}" data-k="${i.key}"><td>${srcPill(i)}</td><td>${idCell(i, i.fetch.status !== "ok" ? "(fetch failed)" : i.title)}</td><td>${st}</td><td>${tc}</td><td>${tok}</td><td>${tm}</td><td style="white-space:nowrap">${act}</td></tr>`;
  }).join("");
  const pDone = gi.length ? done * 100 / gi.length : 0, pRun = gi.length ? run * 100 / gi.length : 0;
  v.innerHTML = `<div class="bmv">${bBar()}<h1>Generate Test Cases <span class="batch-pill">Batch · ${gi.length} to generate · ${imp.length} imported</span></h1>
    <div class="sub">Model <select id="bModel" style="padding:2px 6px"><option value="gemini">Gemini</option><option value="codex">Codex</option><option value="ollama">Ollama</option></select> · Default prompt · items generate one at a time · Excel items skip this step</div>
    <div class="card"><div class="ovp"><b>Overall</b><div class="obar"><i style="width:${pDone}%;background:#12a150"></i><i style="width:${pRun}%;background:#4361ee"></i></div>
      <span id="bOverall"><b>${done}</b> of ${gi.length} generated · ${run} running · ${imp.length} imported</span>
      ${BS.running || queued ? `<button class="btn g sm" id="bCancelAll" style="color:#d33;border-color:#f3b4b4">■ Cancel batch</button>` : ""}
      ${!BS.running && queued ? `<button class="btn sm" id="bStart">▶ Generate ${queued} queued</button>` : ""}</div>
      <div class="sub" style="margin:8px 0 0">Tokens so far: <b>${fmt(tokens)}</b></div></div>
    <div class="card"><table class="bt" id="bGenTbl"><tr><th>Source</th><th>Item</th><th>Status</th><th>Test cases</th><th>Tokens</th><th>Time</th><th>Actions</th></tr>${rows}</table>
    <div class="sub" style="margin:10px 0 0">Cancel stops the item that is running and the queue; finished and imported items are kept. Finished items can be reviewed while others generate.</div></div>
    <div class="footer-nav"><div class="sub" style="margin:0">${avail.length ? `${avail.map((i) => esc(i.item_id)).join(", ")} can be reviewed now.` : "Nothing to review yet."}</div><button class="btn" id="bToRv" ${avail.length ? "" : "disabled"}>Continue to Review (${avail.length} available) →</button></div></div>`;
  $("#bmExit").onclick = exitBatch;
  $("#bModel").value = BS.model; $("#bModel").onchange = (e) => (BS.model = e.target.value);
  const st = $("#bStart"); if (st) st.onclick = () => startQueue();
  const ca = $("#bCancelAll"); if (ca) ca.onclick = () => guarded(ca, async () => { BS.stop = true; await bApi("/api/batch/cancel_all", { method: "POST" }); toast("Batch generation cancelled"); render(); });
  $$(".b-cancel", v).forEach((b) => (b.onclick = () => guarded(b, async () => { await bApi(`/api/batch/items/${b.dataset.k}/cancel`, { method: "POST" }); render(); })));
  $$(".b-skip", v).forEach((b) => (b.onclick = () => guarded(b, async () => { await bApi(`/api/batch/items/${b.dataset.k}`, { method: "PATCH", body: { gen: "skipped" } }); render(); })));
  $$(".b-requeue", v).forEach((b) => (b.onclick = () => guarded(b, async () => { await bApi(`/api/batch/items/${b.dataset.k}`, { method: "PATCH", body: { gen: "queued" } }); render(); startQueue(); })));
  $$(".b-refetch", v).forEach((b) => (b.onclick = () => guarded(b, async () => { await bApi(`/api/batch/items/${b.dataset.k}/fetch`, { method: "POST" }); render(); startQueue(); })));
  $$(".b-open", v).forEach((b) => (b.onclick = () => bOpenItem(b.dataset.k)));
  $("#bToRv").onclick = () => bOpenItem((bItem(BS.batch.active) && bHasCases(bItem(BS.batch.active)) ? BS.batch.active : avail[0].key));
}

// ------------------------------------------------------------------ 3. Review items (reuses the single-mode review cards per item)
async function bOpenItem(k) {
  if (S.view === "b-review" && S.localDirty) { await saveCases(); toast("Changes saved"); }
  await bApi("/api/batch/active", { method: "POST", body: { key: k } });
  S.localDirty = false; S.cases = []; RV.open.clear(); RV.sel.clear(); Object.assign(RV, { q: "", status: "", prio: "", ac: "", page: 0 });
  S.view = "b-review"; location.hash = S.view; render(); window.scrollTo(0, 0);
}
function bRenderList() {
  const el = $("#btList"); if (!el) return;
  const it = bItems(), wc = it.filter(bHasCases), act = BS.batch.active;
  el.innerHTML = `<div class="bt-h"><span>Items</span><span>${it.filter((i) => i.ready).length} / ${wc.length} ready</span></div>` + it.map((i) => {
    const has = bHasCases(i), pct = i.count ? Math.round(i.reviewed * 100 / i.count) : 0, src = { jira: ["j", "🧩 Jira"], local: ["l", "📝 Local"], excel: ["x", "📊 Excel"] }[i.source];
    const sub = has ? `<span class="sub" style="margin:0;font-size:11.5px">Reviewed ${i.reviewed}/${i.count}</span><span class="mini"><i style="width:${pct}%"></i></span>`
      : i.fetch.status !== "ok" ? '<span class="st-dot er" style="font-size:11px"><i></i>Skipped</span>'
      : i.gen.status === "generating" ? '<span class="st-dot run" style="font-size:11px"><i></i>Generating…</span>'
      : `<span class="st-dot q" style="font-size:11px"><i></i>${esc(i.gen.status === "queued" ? "Queued" : i.gen.status === "failed" ? "Failed" : "No test cases")}</span>`;
    return `<div class="bt-item ${i.key === act ? "a" : ""} ${has ? "" : "dis"}" data-k="${i.key}"><span class="pill b">${esc(i.item_id)}</span><span class="srcb ${src[0]}">${src[1]}</span>${i.ready ? '<span class="ready">✓ READY</span>' : ""}<div class="t">${esc(i.source === "excel" ? i.filename : (i.title || (i.fetch.status !== "ok" ? "Not fetched" : "")))}</div>${sub}</div>`;
  }).join("") + `<div class="sub" style="margin:8px 6px 4px;font-size:11.5px">📊 Excel items open straight in Review (no Generate). Regenerate works for all sources.</div>`;
  $$(".bt-item", el).forEach((d) => { if (!d.classList.contains("dis") && d.dataset.k !== act) d.onclick = () => bOpenItem(d.dataset.k).catch((e) => toast(e.message, true)); });
  if (window.dupBatchRefresh) dupBatchRefresh();
  const f = $("#bRvFoot"); if (f) f.outerHTML = bRvFoot();
  bindRvFoot();
}
function bRvFoot() {
  const r = bItems().filter((i) => i.ready), prog = bItems().filter((i) => bHasCases(i) && !i.ready);
  return `<div class="footer-nav" id="bRvFoot"><div class="sub" style="margin:0">Ready: ${r.length ? r.map((i) => esc(i.item_id)).join(", ") : "none yet"}${prog.length ? " · " + prog.map((i) => esc(i.item_id)).join(", ") + " in progress" : ""}</div><button class="btn" id="bToQ" ${r.length ? "" : "disabled"}>Continue to qTest Upload (${r.length} ready) →</button></div>`;
}
function bindRvFoot() { const b = $("#bToQ"); if (b) b.onclick = () => guarded(b, async () => { if (S.localDirty) { await saveCases(); toast("Changes saved"); } go("b-qtest"); }); }
function bViewReview(v) {
  let it = bItem(BS.batch.active);
  if (!it || !bHasCases(it) || !S.run || S.run.run_id !== it.run_id) {
    const first = (it && bHasCases(it)) ? it : bItems().find(bHasCases);
    if (!first) { v.innerHTML = `<div class="bmv">${bBar()}<h1>Review Test Cases</h1><div class="card sub">No item has test cases yet — generate first or upload Excel files.</div></div>`; $("#bmExit").onclick = exitBatch; return; }
    bOpenItem(first.key).catch((e) => toast(e.message, true)); return;
  }
  const wc = bItems().filter(bHasCases), idx = wc.findIndex((i) => i.key === it.key);
  v.innerHTML = `<div class="bmv">${bBar()}<div class="bt-layout"><div class="bt-list" id="btList"></div><div id="bRv"></div></div>${bRvFoot()}</div>`;
  $("#bmExit").onclick = exitBatch;
  viewReview($("#bRv"));            // the exact single-mode review cards, scoped to this item's run
  const nf = $("#bRv .footer-nav"); if (nf) nf.remove();
  const h = $("#bRv h1");
  if (h) h.insertAdjacentHTML("beforeend", `<span class="ticket-pill" title="Ticket / Story ID">Ticket ${esc(it.item_id)}</span><span class="batch-pill">Item ${idx + 1} of ${wc.length}</span>`);
  const acts = $("#bRv .rv-actions");
  if (acts) {
    acts.insertAdjacentHTML("afterbegin", `<button class="btn g" id="bPrev" ${idx > 0 ? "" : "disabled"}>‹ Prev</button><button class="btn g" id="bNext" ${idx < wc.length - 1 ? "" : "disabled"}>Next ›</button>
      <button class="btn ${it.ready ? "g" : "s"}" id="bReady">${it.ready ? `↺ Unmark ${esc(it.item_id)} ready` : `✓ Mark ${esc(it.item_id)} ready`}</button>`);
    $("#bPrev").onclick = () => bOpenItem(wc[idx - 1].key).catch((e) => toast(e.message, true));
    $("#bNext").onclick = () => bOpenItem(wc[idx + 1].key).catch((e) => toast(e.message, true));
    $("#bReady").onclick = () => guarded($("#bReady"), async () => {
      if (S.localDirty) await saveCases();
      await bApi(`/api/batch/items/${it.key}`, { method: "PATCH", body: { ready: !it.ready } });
      toast(it.ready ? `${it.item_id} is no longer ready` : `${it.item_id} marked ready`); render();
    });
  }
  bRenderList();
}

// ------------------------------------------------------------------ 4. qTest batch upload
async function bViewQtest(v) {
  if (BS.selFor !== BS.batch.batch_id || !BS.sel) { BS.sel = new Set(bItems().filter((i) => i.ready && bHasCases(i)).map((i) => i.key)); BS.selFor = BS.batch.batch_id; }
  if (!BS.qd) { try { BS.qd = await api("/api/qtest/defaults"); } catch (e) { BS.qd = {}; } }
  if (!BS.qp) BS.qp = { project_id: BS.qd.project_id || "", parent_module_id: BS.qd.parent_module_id || "" };
  const it = bItems(), sel = it.filter((i) => BS.sel.has(i.key) && bHasCases(i));
  const rows = it.map((i) => {
    const has = bHasCases(i), q = i.qtest || {}, t = i.target || {};
    let target;
    if (!has) target = `<span class="res">${i.fetch.status !== "ok" ? "Skipped (not fetched)" : "No test cases yet"}</span>`;
    else if (i.source === "local") target = `<div class="need">Needs target: <input class="b-tgt" data-k="${i.key}" data-f="module_name" placeholder="New module name" value="${esc(t.module_name)}" style="width:150px"> or <input class="b-tgt" data-k="${i.key}" data-f="module_id" placeholder="Existing module ID" value="${esc(t.module_id)}" style="width:130px"> <input class="b-tgt" data-k="${i.key}" data-f="requirement_id" placeholder="Requirement ID (optional)" value="${esc(t.requirement_id)}" style="width:170px"></div>${t.module_name || t.module_id ? "" : '<div class="res" style="color:#a36b00">⚠ No Jira link — choose a module; requirement link is optional</div>'}`;
    else target = `<span class="res">New module “${esc(i.item_id)}”${BS.qp.parent_module_id ? " under " + esc(BS.qp.parent_module_id) : ""} · requirement <b>${q.requirement_id ? `auto: ${esc(i.item_id)} → ${esc(q.requirement_id)}` : `auto from ${i.source === "excel" ? "detected " : ""}ID ${esc(i.item_id)}`}</b></span>${q.message && !q.requirement_id ? `<div class="res" style="color:#a36b00">⚠ ${esc(q.message)}</div>` : ""}`;
    let res;
    if (!has) res = '<span class="st-dot q"><i></i>—</span>';
    else if (q.status === "uploading") res = '<span class="st-dot run"><i></i>Uploading…</span>';
    else if (q.status === "done") res = `<span class="st-dot ok"><i></i>Uploaded ${i.uploaded}/${i.upload_total}${q.requirement_id ? " · linked ✓" : ""}</span>`;
    else if (q.status === "partial") res = `<span class="st-dot wn"><i></i>Uploaded ${i.uploaded}/${i.upload_total}</span> <button class="btn g sm b-qretry" data-k="${i.key}">↻ Retry failed</button>`;
    else if (q.status === "failed") res = `<span class="st-dot er"><i></i>Failed</span><div class="res" style="color:#d33">${esc(q.error)}</div><button class="btn g sm b-qretry" data-k="${i.key}">↻ Retry</button>`;
    else res = i.ready ? '<span class="st-dot q"><i></i>Pending</span>' : `<span class="st-dot q"><i></i>Not ready (${i.reviewed}/${i.count} reviewed)</span>`;
    return `<tr class="${!has && i.fetch.status !== "ok" ? "fail" : ""}" data-k="${i.key}"><td><input type="checkbox" class="chk b-sel" data-k="${i.key}" ${BS.sel.has(i.key) && has ? "checked" : ""} ${has ? "" : "disabled"}></td><td>${srcPill(i)}</td><td>${idCell(i, "")}</td>
      <td>${has ? `${i.count} TCs · ${i.steps} steps<div><a class="tpl-link b-pl" data-k="${i.key}">👁 Preview payload</a></div>` : "—"}</td><td class="res">${target}</td><td>${res}</td></tr>`;
  }).join("");
  const nTc = sel.reduce((a, i) => a + i.count, 0);
  v.innerHTML = `<div class="bmv">${bBar()}<h1>qTest Upload <span class="batch-pill">Batch · ${sel.length} selected</span></h1>
    <div class="sub">Each item uploads to its own module. Jira and Excel items link to the requirement found from their story ID; local-text items need a target.</div>
    <div class="card"><div style="display:flex;gap:16px;flex-wrap:wrap;align-items:end"><div><label>Project ID</label><input id="bqProj" value="${esc(BS.qp.project_id)}" style="width:120px"></div><div><label>Parent module ID</label><input id="bqPar" value="${esc(BS.qp.parent_module_id)}" style="width:120px"></div><div><label>Module per item</label><select><option>Create new module named after the item ID</option></select></div></div>
    ${BS.qd.configured === false ? '<div class="warn" style="margin-top:10px">⚠ qTest is not configured (QTEST_BASE_URL / QTEST_TOKEN in Settings).</div>' : ""}</div>
    <div class="card"><table class="bt" id="bqTbl"><tr><th></th><th>Source</th><th>Item</th><th>Payload</th><th>Target</th><th>Result</th></tr>${rows}</table>
    <div style="display:flex;justify-content:space-between;margin-top:12px;align-items:center"><span class="sub" style="margin:0">Ready items are pre-selected. Local items need a module before upload.</span>
      <span><button class="btn" id="bqUp" ${sel.length && !BS.uploading ? "" : "disabled"}>⬆ Upload selected (${sel.length} item${sel.length === 1 ? "" : "s"} · ${nTc} TCs)</button> <button class="btn g" id="bqZip">⬇ Excel (zip)</button></span></div></div></div>`;
  $("#bmExit").onclick = exitBatch;
  $("#bqProj").onchange = (e) => (BS.qp.project_id = e.target.value.trim());
  $("#bqPar").onchange = (e) => (BS.qp.parent_module_id = e.target.value.trim());
  $$(".b-sel", v).forEach((c) => (c.onchange = () => { c.checked ? BS.sel.add(c.dataset.k) : BS.sel.delete(c.dataset.k); render(); }));
  $$(".b-tgt", v).forEach((inp) => (inp.onchange = () => bApi(`/api/batch/items/${inp.dataset.k}`, { method: "PATCH", body: { target: { [inp.dataset.f]: inp.value } } }).catch((e) => toast(e.message, true))));
  $$(".b-pl", v).forEach((a) => (a.onclick = () => bPayload(a.dataset.k).catch((e) => toast(e.message, true))));
  $$(".b-qretry", v).forEach((b) => (b.onclick = () => guarded(b, async () => { await bApi(`/api/batch/items/${b.dataset.k}/qtest/retry`, { method: "POST" }); bQtestToast(b.dataset.k); render(); })));
  $("#bqZip").onclick = () => download("/api/batch/excel.zip");
  $("#bqUp").onclick = () => guarded($("#bqUp"), async () => {
    const list = bItems().filter((i) => BS.sel.has(i.key) && bHasCases(i));
    const miss = list.filter((i) => i.source === "local" && !(i.target.module_name || i.target.module_id));
    if (miss.length) throw new Error(`Choose a module for ${miss.map((i) => i.item_id).join(", ")} first.`);
    BS.uploading = true;
    try {
      for (const i of list) {
        i.qtest = { status: "uploading" }; render();
        try { await bApi(`/api/batch/items/${i.key}/qtest`, { method: "POST", body: BS.qp }); bQtestToast(i.key); } catch (e) { toast(`${i.item_id}: ${e.message}`, true); await refreshBatch(); }
      }
    } finally { BS.uploading = false; render(); if (window.refreshHistoryCount) refreshHistoryCount(); }
  });
}
function bQtestToast(k) { const i = bItem(k), q = i.qtest || {}; if (q.status === "done") toast(`${i.item_id}: uploaded ${i.uploaded}/${i.upload_total}${q.message ? " · " + q.message : ""}`); else if (q.status) toast(`${i.item_id}: ${q.error || q.status}${q.message ? " · " + q.message : ""}`, true); }
async function bPayload(k) {
  const i = bItem(k);
  await bApi("/api/batch/active", { method: "POST", body: { key: k } });
  const j = await api("/api/qtest/preview", { method: "POST", body: { module_id: i.target.module_id || "" } });
  modal(`<h1>Payload preview · ${esc(i.item_id)}</h1><div class="sub">${j.count} test case payloads (first 3 shown)</div><pre class="ro" style="max-height:380px;overflow:auto">${esc(JSON.stringify(j.payloads.slice(0, 3), null, 2))}</pre><div style="text-align:right"><button class="btn" id="mOk">Close</button></div>`);
  $("#mOk").onclick = closeModal;
}
