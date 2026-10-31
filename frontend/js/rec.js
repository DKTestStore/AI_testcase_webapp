/* Record feature (additive). Record browser actions -> test cases, no AI.
   Hooks: wraps the global viewInput / viewReview functions; old behaviour is untouched unless
   the Record source is selected or the run came from a recording. */
"use strict";
const REC = { st: null, timer: null, sel: null, edit: null, sig: "", busy: false, draft: undefined, defaults: null, dragId: null };
const recMMSS = (s) => { s = Math.max(0, Math.floor(s || 0)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const REC_ACT = { navigate: ["Navigate", "nav"], type: ["Type", "type"], click: ["Click", "click"], select: ["Select", "sel"], check: ["Check", "click"], scroll: ["Scroll", "nav"], checkpoint: ["Checkpoint", "cp"], suggest: ["Suggested", "sug"], ignored: ["Skipped", "ign"] };
const REC_SETUP_KEY = "atg_rec_setup";
const recActive = () => REC.st && ["starting", "recording", "paused"].includes(REC.st.state);
function recSetupSaved() { try { return JSON.parse(localStorage.getItem(REC_SETUP_KEY) || "{}"); } catch { return {}; } }
function recFile(rid, name) { return `/api/rec/file/${encodeURIComponent(rid)}/${encodeURIComponent(name)}`; }
function recAgo(iso) { if (!iso) return ""; const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; }
function recWhen(iso) { try { return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " (IST)"; } catch { return iso || ""; } }

// ------------------------------------------------------------------ Input page hook
const _recOrigViewInput = viewInput;
viewInput = function (v) {
  if (!S.inputMode && S.run && S.run.source === "record") S.inputMode = "record";
  if (S.inputMode === "record") return recView(v);
  recStopPoll();
  _recOrigViewInput(v);
  recAddTab(v);
  recDraftCard(v);
};
function recAddTab(v) {
  const seg = $(".seg", v); if (!seg || $('button[data-m="record"]', seg)) return;
  const b = document.createElement("button"); b.dataset.m = "record"; b.className = "rec-tab"; b.title = "Record actions in a browser — no AI"; b.innerHTML = "⏺ Record";
  b.onclick = () => { S.inputMode = "record"; render(); };
  const local = $('button[data-m="local"]', seg); local ? local.after(b) : seg.appendChild(b);
}
function recSeg() {
  return `<div class="seg"><button data-m="jira">Jira Story</button><button data-m="local">Local text</button><button data-m="record" class="rec-tab a">⏺ Record</button><button data-m="excel">⬆ Upload test cases (Excel)</button><button data-m="batch" class="bm-tab" title="Open the separate Batch workspace (multiple stories)">▦ Batch mode</button></div>`;
}
function recBindSeg(v) {
  $$(".seg button", v).forEach((b) => (b.onclick = () => { if (b.dataset.m === "record") return; if (b.dataset.m === "batch") return guarded(b, enterBatch); S.inputMode = b.dataset.m; render(); }));
}
async function recDraftCard(v, into) {
  let j; try { j = await api("/api/rec/draft"); } catch { return; }
  const d = j.draft; REC.draft = d;
  const host = into || v; if (!d || !document.body.contains(host) || $("#recDraft", host)) return;
  const el = document.createElement("div"); el.className = "card rec-draft"; el.id = "recDraft";
  el.innerHTML = `<h3>⟲ Recover unsaved recording?</h3><div class="sub" style="margin:0 0 6px">An unfinished recording was autosaved (the tab was closed or the app restarted).</div>
    <div><b>${esc(d.name)}</b></div><div class="sub" style="margin:2px 0 10px">${d.steps} steps · ${d.checkpoints} checkpoint${d.checkpoints === 1 ? "" : "s"} · last saved ${esc(recWhen(d.saved_at))} · video ${d.video ? "partial" : d.video_wanted ? "not saved" : "off"}</div>
    <button class="btn" id="recResume">Resume recording</button> <button class="btn g" id="recDraftReview">Open in Review</button> <button class="btn g rec-danger" id="recDiscard">Discard</button>`;
  host.appendChild(el);
  $("#recResume").onclick = () => guarded($("#recResume"), async () => { REC.st = await api("/api/rec/draft/resume", { method: "POST" }); S.inputMode = "record"; S.view = "input"; render(); });
  $("#recDraftReview").onclick = () => guarded($("#recDraftReview"), async () => { await api("/api/rec/draft/review", { method: "POST" }); recToReview(); });
  $("#recDiscard").onclick = () => guarded($("#recDiscard"), async () => { if (!confirm("Discard the unsaved recording?")) return; await api("/api/rec/draft", { method: "DELETE" }); el.remove(); toast("Draft discarded"); });
}

// ------------------------------------------------------------------ Record view (setup or live recording)
async function recView(v) {
  v.innerHTML = `<h1>Input Source</h1><div class="sub">Record actions in a browser — each action becomes a test step (no AI)</div><div class="card">${recSeg()}</div><div id="recBody" class="sub">Loading…</div>`;
  recBindSeg(v);
  try { REC.st = await api("/api/rec/status"); } catch (e) { $("#recBody").innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  if (!REC.defaults) { try { REC.defaults = await api("/api/rec/defaults"); } catch { REC.defaults = { ignore: [] }; } }
  if (!document.body.contains(v) || S.inputMode !== "record") return;
  if (recActive() || (REC.st && ["stopped", "closed"].includes(REC.st.state))) return recLive(v);
  recSetup(v);
}
function recSetup(v) {
  recStopPoll();
  const p = recSetupSaved(); const d = (k, def) => (p[k] === undefined ? def : p[k]);
  let ign = d("ignore", REC.defaults.ignore || []); if (Array.isArray(ign)) ign = ign.join("\n");
  const opt = (arr, cur) => arr.map((x) => `<option ${x === cur ? "selected" : ""}>${x}</option>`).join("");
  $("#recBody").outerHTML = `<div class="card rec-setup" id="recSetup"><h3>Record a test</h3><div class="rec-grid">
    <div><label>Target URL *</label><input id="rUrl" placeholder="https://demo.example-shop.com/login" value="${esc(d("url", ""))}">
      <label>Test name *</label><input id="rName" placeholder="Verify user can log in and view a shipped order" value="${esc(d("name", ""))}">
      <label>Description</label><textarea id="rDesc" rows="2">${esc(d("description", ""))}</textarea>
      <label>Precondition</label><textarea id="rPre" rows="2">${esc(d("precondition", ""))}</textarea>
      <div class="rec-2"><div><label>Type</label><select id="rType">${opt(["Positive", "Negative", "Edge"], d("type", "Positive"))}</select></div>
        <div><label>Priority</label><select id="rPrio">${opt(["High", "Medium", "Low"], d("priority", "Medium"))}</select></div>
        <div><label>Story ID (optional)</label><input id="rStory" placeholder="e.g. MTG-1427" value="${esc(d("story_id", ""))}"></div></div></div>
    <div><label>Options</label>
      <label class="rec-chk"><input type="checkbox" id="rVideo" ${d("video", true) ? "checked" : ""}> Record screen video as evidence</label>
      <label class="rec-chk"><input type="checkbox" id="rMask" ${d("mask", true) ? "checked" : ""}> Mask password fields in steps</label>
      <label class="rec-chk"><input type="checkbox" id="rHover" ${d("ignore_hover", true) ? "checked" : ""}> Ignore hover / scroll events</label>
      <label>Test case split</label>
      <label class="rec-chk"><input type="radio" name="rSplit" value="checkpoint" ${d("split", "checkpoint") !== "single" ? "checked" : ""}> Split at each checkpoint <span class="muted">(default — one test case per checkpoint)</span></label>
      <label class="rec-chk"><input type="radio" name="rSplit" value="single" ${d("split", "checkpoint") === "single" ? "checked" : ""}> Keep as one test case</label>
      <label>Browser</label><select id="rBrowser"><option value="chromium">Chromium (recorder window)</option></select>
      <label>Ignore list <span class="muted">(CSS selectors — clicks inside are skipped: cookie banners, chat widgets)</span></label>
      <textarea id="rIgnore" rows="3" class="rec-mono">${esc(ign)}</textarea>
      <div class="rec-info">ℹ A separate recorder browser opens. Click, type, select and navigate as usual — each action becomes a step. Use <b>Add checkpoint</b> (or Ctrl+Shift+C) to record expected results.${REC.defaults.display === false ? "<br><b>No display detected — the recorder runs headless on the server.</b>" : ""}</div></div></div>
    <div style="margin-top:14px"><button class="btn r" id="rStart">⏺ Start recording</button> <button class="btn g" id="rCancel">Cancel</button></div></div><div id="recDraftHost"></div>
    <details class="card rec-store" id="recStore"><summary>🗄 Recording storage <span class="muted" id="rsSum">— loading…</span></summary>
      <div class="rec-storeb"><label>Keep last <input type="number" min="0" id="rsN" style="width:70px"> recordings</label><label>and/or last <input type="number" min="0" id="rsD" style="width:70px"> days</label>
      <span class="muted">0 = keep all (default) · 📌 pinned recordings are never deleted · cleanup runs when a new recording is saved</span>
      <button class="btn g sm" id="rsSave">Save</button></div></details>`;
  const v2 = $("#view");
  $("#rCancel").onclick = () => { S.inputMode = S.run.source && S.run.source !== "record" ? S.run.source : "jira"; render(); };
  $("#rStart").onclick = () => guarded($("#rStart"), async () => {
    const body = { url: $("#rUrl").value.trim(), name: $("#rName").value.trim(), description: $("#rDesc").value, precondition: $("#rPre").value,
      type: $("#rType").value, priority: $("#rPrio").value, story_id: $("#rStory").value.trim(), video: $("#rVideo").checked, mask: $("#rMask").checked,
      ignore_hover: $("#rHover").checked, split: ($$('input[name="rSplit"]').find((x) => x.checked) || {}).value, browser: $("#rBrowser").value,
      ignore: $("#rIgnore").value.split(/\n|,/).map((x) => x.trim()).filter(Boolean) };
    if (!body.url) throw new Error("Enter the target URL to record.");
    if (!body.name) throw new Error("Enter a test name.");
    localStorage.setItem(REC_SETUP_KEY, JSON.stringify(body));
    REC.st = await api("/api/rec/start", { method: "POST", body }); REC.sel = null; REC.sig = "";
    if (REC.st.error) toast(REC.st.error, true); else toast("Recorder window opened — start interacting with the site");
    render();
  });
  recDraftCard(v2, $("#recDraftHost"));
  recStorageUI();
}
async function recStorageUI() {
  let j; try { j = await api("/api/rec/storage"); } catch { return; }
  if (!$("#recStore")) return;
  const sum = () => `— ${j.keep_last || j.keep_days ? `keep ${j.keep_last ? "last " + j.keep_last : ""}${j.keep_last && j.keep_days ? " / " : ""}${j.keep_days ? j.keep_days + " days" : ""}` : "keep all"} · ${j.count} saved (${j.mb} MB) · ${j.pinned.length} pinned`;
  $("#rsSum").textContent = sum(); $("#rsN").value = j.keep_last; $("#rsD").value = j.keep_days;
  $("#rsSave").onclick = () => guarded($("#rsSave"), async () => { const r = await api("/api/rec/storage", { method: "PUT", body: { keep_last: $("#rsN").value, keep_days: $("#rsD").value } }); Object.assign(j, r); $("#rsSum").textContent = sum() + " · saved ✓"; });
}

function recLive(v) {
  const st = REC.st; let host = ""; try { host = new URL(st.setup.url).host; } catch { host = st.setup.url; }
  $("#recBody").outerHTML = `<div class="rec-live" id="recLive">
    <div class="rec-title"><div><h2>Recording…</h2><div class="sub" style="margin:0">${esc(st.setup.name)} · ${esc(host)}</div></div><span class="rec-pill" id="rPill">● REC</span></div>
    <div class="card rec-ctrl"><div class="rec-stat"><span>Elapsed</span><b id="rEl">00:00</b></div><div class="rec-stat"><span>Steps</span><b id="rN">0</b></div>
      <div class="rec-stat"><span>Video</span><i id="rVid"></i></div><div class="rec-stat"><span>Draft</span><i id="rSaved" class="rec-saved"></i></div>
      <span style="flex:1"></span>
      <button class="btn s" id="rCp">✔ Add checkpoint</button><button class="btn g" id="rPause">⏸ Pause</button><button class="btn g" id="rUndo" title="Undo last step (Ctrl+Z in the recorder window)">↶ Undo last step</button>
      <div style="text-align:right"><button class="btn r" id="rStop">⏹ Stop &amp; go to Review</button><div class="sub" style="margin:4px 0 0;font-size:11px">Test cases are created instantly from the steps — no AI</div></div></div>
    <div class="card rec-keys"><b>⌨ Hotkeys</b> <span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> Checkpoint</span><span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> Pause</span><span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> Stop &amp; Review</span><span><kbd>Ctrl</kbd>+<kbd>Z</kbd> Undo last step</span><span class="muted">(in the recorder window — a floating mini toolbar is shown there too)</span></div>
    <div id="rBanner"></div>
    <div class="rec-cols"><div class="card rec-log"><div class="rec-logh"><h3>Live step log</h3><span class="sub" style="margin:0">⋮⋮ drag to reorder</span></div><div id="rLog"></div>
        <button class="btn g sm" id="rDivEnd">✂ Start new test case here</button></div>
      <div class="rec-side" id="rSide"></div></div></div>`;
  $("#rCp").onclick = () => { REC.sel = null; REC.edit = "cp"; recSide(); const t = $("#rCpExp"); if (t) t.focus(); };
  $("#rPause").onclick = () => guarded($("#rPause"), async () => { REC.st = await api("/api/rec/cmd", { method: "POST", body: { cmd: REC.st.paused ? "resume" : "pause" } }); recPaint(true); });
  $("#rUndo").onclick = () => guarded($("#rUndo"), async () => { REC.st = await api("/api/rec/cmd", { method: "POST", body: { cmd: "undo" } }); recPaint(true); toast("Last step removed"); });
  $("#rStop").onclick = () => guarded($("#rStop"), recStop);
  $("#rDivEnd").onclick = () => recDivider(null);
  const log = $("#rLog"); log.onclick = recLogClick; recBindDrag(log);
  REC.edit = REC.edit || "cp"; REC.sig = "";
  recPaint(true); recSide(); recStartPoll();
}
async function recStop() {
  REC.busyStop = true; recStopPoll();
  try { await api("/api/rec/stop", { method: "POST" }); REC.st = null; REC.tab = "tc"; recToReview(); }
  finally { REC.busyStop = false; }
}
function recToReview() { const t = $("#toast"); if (t) t.style.display = "none"; S.localDirty = false; S.inputMode = "record"; S.view = "review"; location.hash = "review"; render(); }
function recStartPoll() { recStopPoll(); REC.timer = setInterval(recPoll, 1000); }
function recStopPoll() { if (REC.timer) clearInterval(REC.timer); REC.timer = null; }
async function recPoll() {
  if (!$("#recLive")) return recStopPoll();
  try { REC.st = await api("/api/rec/status"); } catch { return; }
  if (REC.st.state === "none") { recStopPoll(); return render(); }
  if (REC.st.state === "stopped" && !REC.busyStop) { return guarded(null, recStop); }   // stopped from the recorder window (toolbar / hotkey)
  recPaint(false);
}
function recPaint(force) {
  const st = REC.st; if (!st || !$("#recLive")) return;
  $("#rEl").textContent = recMMSS(st.elapsed);
  const acts = st.steps.filter((s) => !["suggest", "ignored", "divider"].includes(s.kind));
  $("#rN").textContent = acts.length;
  $("#rVid").innerHTML = st.setup.video ? (st.paused ? '<span class="rec-amber">● paused</span>' : '<span class="rec-red">● recording</span>') : '<span class="muted">off</span>';
  $("#rSaved").innerHTML = st.saved_at ? `☁ Draft saved ${recAgo(st.saved_at)}` : "";
  const pill = $("#rPill"); pill.textContent = st.paused ? "❚❚ PAUSED" : st.state === "closed" ? "■ WINDOW CLOSED" : "● REC"; pill.classList.toggle("p", !!st.paused);
  $("#rPause").innerHTML = st.paused ? "▶ Resume" : "⏸ Pause";
  $("#rBanner").innerHTML = st.state === "closed" ? `<div class="warn">The recorder window was closed. Click <b>Stop &amp; go to Review</b> to create the test cases, or Discard on the Input page later.</div>`
    : st.error ? `<div class="warn">${esc(st.error)}</div>` : st.headless ? `<div class="note">The recorder browser is running headless on the server (no display available).</div>` : "";
  const sig = JSON.stringify(st.steps) + st.paused;
  if (force || sig !== REC.sig) { REC.sig = sig; recRenderLog(); recSide(); }
}
function recStepHtml(s, i, num) {
  const [lab, cls] = REC_ACT[s.kind] || [s.kind, "nav"];
  const L = s.loc || {}; const sel = REC.sel === s.id ? "sel" : "";
  if (s.kind === "divider") return `<div class="rec-div" data-id="${s.id}" draggable="true">✂ New test case starts here${s.desc ? ` — “${esc(s.desc)}”` : ""} <button class="ib" data-a="del" title="Remove divider">✕</button></div>`;
  let desc = esc(s.kind === "checkpoint" ? "✔ Expected: " + (s.expected || "—") : s.desc);
  if (s.param && (s.kind === "type" || s.kind === "select")) desc = desc.replace(esc(`"${s.value}"`), `<span class="rec-param">{{${esc(s.param)}}}</span>`);
  else if (s.kind === "type" && s.value && !s.masked) desc = desc.replace(esc(`"${s.value}"`), `<span class="rec-val">${esc(s.value)}</span>`);
  const meta = [];
  if (s.merged > 1) meta.push(`<span class="rec-merged" title="#2 typing merged into one step">⌨ merged ${s.merged} keystrokes</span>`);
  if (s.param) meta.push(`<span class="rec-ok">✔ test data</span>`);
  if (s.masked) meta.push(`<span class="rec-mask">🔒 masked (${esc(s.masked)})</span>`);
  const locs = L.css ? `<div class="rec-loc" title="Locator kept for scripts">${esc(L.css)}${L.name ? ` · name from ${esc(L.source || "")}` : ""}</div>` : "";
  const errs = (s.errors || []).length ? `<div class="rec-errs">${s.errors.map((e) => `<span class="rec-err" title="${esc(e.text)}">⚠ ${esc(e.text.slice(0, 48))}</span>`).join("")}</div>` : "";
  const note = s.note ? `<div class="rec-note">💬 Note: ${esc(s.note)}</div>` : "";
  const thumb = s.shot ? `<img class="rec-thumb" loading="lazy" src="${recFile(REC.st.rid, s.shot)}" data-a="sel" alt="step ${num} screenshot">` : `<span class="rec-thumb none"></span>`;
  let acts;
  if (s.kind === "suggest") acts = `<button class="btn s sm" data-a="accept">✔ Accept</button><button class="ib" data-a="dismiss" title="Dismiss">✕</button>`;
  else if (s.kind === "ignored") acts = `<button class="btn g sm" data-a="keep">Keep</button><button class="ib" data-a="dismiss" title="Drop">✕</button>`;
  else acts = `<button class="ib" data-a="edit" title="Edit step">✎</button><button class="ib" data-a="note" title="Add note">💬</button>${["type", "select"].includes(s.kind) ? `<button class="ib" data-a="param" title="${s.param ? "Unmark test data" : "Mark value as test data → {{param}}"}">🏷</button>` : ""}<button class="ib" data-a="split" title="Start new test case after this step">✂</button><button class="ib" data-a="del" title="Delete step">🗑</button>`;
  return `<div class="rec-row k-${s.kind} ${sel} ${(s.errors || []).length ? "has-err" : ""}" data-id="${s.id}" draggable="${["suggest", "ignored"].includes(s.kind) ? "false" : "true"}">
    <span class="hdl">⋮⋮</span><span class="rec-num">${s.kind === "suggest" ? "✨" : num}</span><span><span class="rec-act ${cls}">${lab}</span></span>
    <div class="rec-desc" data-a="sel">${desc}${meta.length ? `<div>${meta.join(" ")}</div>` : ""}${locs}${errs}${note}</div>
    <div class="rec-exp">${esc(s.expected) || '<span class="muted">—</span>'}</div>${thumb}<span class="rec-t" data-a="sel">${recMMSS(s.t)}</span><span class="rec-acts">${acts}</span></div>`;
}
function recRenderLog() {
  const log = $("#rLog"); if (!log) return;
  let n = 0;
  const rows = REC.st.steps.map((s, i) => recStepHtml(s, i, ["suggest", "ignored", "divider"].includes(s.kind) ? "" : ++n)).join("");
  log.innerHTML = `<div class="rec-row rec-hd"><span></span><span>#</span><span>Action</span><span>Step</span><span>Expected</span><span>Shot</span><span>Time</span><span></span></div>${rows || '<div class="muted" style="padding:14px">Waiting for the first action in the recorder window…</div>'}`;
}
const recStep = (id) => REC.st.steps.find((s) => s.id === id);
async function recMut(path, method, body) { REC.st = await api(path, { method, body }); recPaint(true); }
function recLogClick(e) {
  const row = e.target.closest("[data-id]"); if (!row) return; const id = row.dataset.id; const s = recStep(id); const a = (e.target.closest("[data-a]") || {}).dataset?.a;
  if (!a) return;
  const run = (p) => guarded(null, p);
  if (a === "sel") { REC.sel = id; REC.edit = "view"; recRenderLog(); recSide(); }
  else if (a === "edit") { REC.sel = id; REC.edit = "edit"; recRenderLog(); recSide(); }
  else if (a === "note") { REC.sel = id; REC.edit = "note"; recRenderLog(); recSide(); const t = $("#rNote"); if (t) t.focus(); }
  else if (a === "del") run(() => recMut(`/api/rec/steps/${id}`, "DELETE"));
  else if (a === "accept") run(() => recMut(`/api/rec/suggest/${id}/accept`, "POST", {}));
  else if (a === "dismiss") run(() => recMut(`/api/rec/suggest/${id}/dismiss`, "POST", {}));
  else if (a === "keep") run(() => recMut(`/api/rec/suggest/${id}/keep`, "POST", {}));
  else if (a === "split") recDivider(id);
  else if (a === "param") {
    if (s.param) return run(() => recMut(`/api/rec/steps/${id}`, "PATCH", { param: "" }));
    const def = (s.name || "value").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "value";
    const nm = prompt("Parameter name for this value (used as {{name}} in steps and scripts):", def); if (!nm) return;
    run(() => recMut(`/api/rec/steps/${id}`, "PATCH", { param: nm }));
  }
}
function recDivider(after) {
  const nm = prompt("Name of the new test case (optional):", ""); if (nm === null) return;
  guarded(null, () => recMut("/api/rec/divider", "POST", { after, name: nm }));
}
function recBindDrag(log) {
  log.addEventListener("dragstart", (e) => { const r = e.target.closest("[data-id]"); if (!r) return; REC.dragId = r.dataset.id; r.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", REC.dragId); } catch {} });
  log.addEventListener("dragover", (e) => { if (!REC.dragId) return; e.preventDefault(); const r = e.target.closest("[data-id]"); $$(".rec-row.over,.rec-div.over", log).forEach((x) => x.classList.remove("over")); if (r) r.classList.add("over"); });
  log.addEventListener("dragend", () => { REC.dragId = null; $$(".drag,.over", log).forEach((x) => x.classList.remove("drag", "over")); });
  log.addEventListener("drop", (e) => {
    e.preventDefault(); const r = e.target.closest("[data-id]"); const from = REC.dragId; REC.dragId = null; if (!r || !from || r.dataset.id === from) return;
    const ids = REC.st.steps.map((s) => s.id).filter((x) => x !== from); ids.splice(ids.indexOf(r.dataset.id), 0, from);
    guarded(null, () => recMut("/api/rec/reorder", "POST", { ids }));
  });
}
function recSide() {
  const side = $("#rSide"); if (!side) return;
  // keep what the user is typing when the live log refreshes (poll) — restore values + focus after re-render
  const keep = {}; ["rCpExp", "rCpAs", "rEdDesc", "rEdExp", "rNote"].forEach((k) => { const e = document.getElementById(k); if (e) keep[k] = e.value; });
  const foc = document.activeElement && side.contains(document.activeElement) ? document.activeElement.id : "";
  const keepSel = REC._sideFor === (REC.edit + ":" + REC.sel);
  const st = REC.st; const s = REC.sel && recStep(REC.sel); let h = "";
  if (REC.edit === "cp" || !s) {
    const last = [...st.steps].reverse().find((x) => ["click", "type", "select", "check"].includes(x.kind));
    h += `<div class="card"><h3>Add checkpoint</h3><label>Expected result</label><textarea id="rCpExp" rows="3" placeholder='e.g. Order details show status "Shipped"'></textarea>
      <label>Assert on (optional)</label><select id="rCpAs"><option value="">Auto (heading / URL)</option>${st.cur.heading ? `<option value="heading">Heading — "${esc(st.cur.heading)}"</option>` : ""}<option value="url">Page URL — ${esc((st.cur.url || "").replace(/^https?:\/\/[^/]+/, ""))}</option>${last && last.loc && last.loc.css ? `<option value="text" data-css="${esc(last.loc.css)}" data-text="${esc(last.loc.text || last.value || "")}">Element text — ${esc(last.loc.css)}</option>` : ""}<option value="none">None (manual check)</option></select>
      <div style="margin-top:10px"><button class="btn s" id="rCpSave">Save checkpoint</button></div></div>`;
  }
  if (s && REC.edit !== "cp") {
    const num = st.steps.filter((x) => !["suggest", "ignored", "divider"].includes(x.kind)).indexOf(s) + 1;
    h += `<div class="card"><h3>${REC.edit === "note" ? "Step " + num + " note" : "Edit step " + (num || "")}</h3>
      <label>Step</label><input id="rEdDesc" value="${esc(s.desc)}"><label>Expected</label><input id="rEdExp" value="${esc(s.expected)}">
      <label>Note <span class="muted">(carries into Review as a step comment)</span></label><textarea id="rNote" rows="2" placeholder="e.g. Login takes ~3s on staging, wait for spinner">${esc(s.note || "")}</textarea>
      <div style="margin-top:8px"><button class="btn sm" id="rEdSave">Save</button> <button class="btn g sm" id="rEdClose">Close</button></div>
      ${s.loc && s.loc.css ? `<div class="sub" style="margin:8px 0 0">Element naming: label → aria-label → placeholder → visible text → id. Locator kept for scripts: <code>${esc(s.loc.css)}</code></div>` : ""}</div>`;
    if (s.shot) h += `<div class="card"><h3>Step ${num || ""} screenshot</h3><img class="rec-big" src="${recFile(st.rid, s.shot)}" alt="screenshot"><div class="sub" style="margin:4px 0 0">Clicked element highlighted · sensitive fields masked · captured ${recMMSS(s.t)}</div></div>`;
    if ((s.errors || []).length) h += `<div class="card"><h3>⚠ Errors at step ${num}</h3><pre class="rec-pre">${s.errors.map((e) => `${e.kind.toUpperCase()}  ${esc(e.text)}`).join("\n")}</pre><div class="sub" style="margin:4px 0 0">Attach to a test case as evidence from Review.</div></div>`;
  }
  const ps = Object.entries(st.params || {});
  h += `<div class="card"><h3>🏷 Test data</h3>${ps.length ? ps.map(([k, x]) => `<div class="rec-prow"><span class="rec-param">{{${esc(k)}}}</span><span>${x.masked ? "•••••••• <span class='muted'>(masked)</span>" : esc(x.value)}</span></div>`).join("") : '<div class="muted">Click 🏷 on a typed or selected value to turn it into a {{parameter}}.</div>'}
    <div class="sub" style="margin:6px 0 0">Parameters appear in Review steps and in exported scripts.</div></div>`;
  side.innerHTML = h;
  if (keepSel) Object.entries(keep).forEach(([k, val]) => { const e = document.getElementById(k); if (e && (e.tagName !== "SELECT" || [...e.options].some((o) => o.value === val))) e.value = val; });
  REC._sideFor = REC.edit + ":" + REC.sel;
  if (foc && keepSel) { const e = document.getElementById(foc); if (e) e.focus(); }
  const sv = $("#rCpSave");
  if (sv) sv.onclick = () => guarded(sv, async () => {
    const o = $("#rCpAs").selectedOptions[0];
    await recMut("/api/rec/cmd", "POST", { cmd: "checkpoint", expected: $("#rCpExp").value, assert: o.value === "none" ? "none" : o.value, css: o.dataset.css || "", text: o.dataset.text || "" });
    const t = $("#rCpExp"); if (t) t.value = ""; toast("Checkpoint added");
  });
  const es = $("#rEdSave");
  if (es) es.onclick = () => guarded(es, async () => { await recMut(`/api/rec/steps/${s.id}`, "PATCH", { desc: $("#rEdDesc").value, expected: $("#rEdExp").value, note: $("#rNote").value }); toast("Step saved"); });
  const ec = $("#rEdClose"); if (ec) ec.onclick = () => { REC.sel = null; REC.edit = "cp"; recRenderLog(); recSide(); };
}

// ------------------------------------------------------------------ Review hook (recorded runs only)
const _recOrigViewReview = viewReview;
viewReview = function (v) { _recOrigViewReview(v); recDecorateReview(v); };
const recRun = () => (S.run && S.run.source === "record" && S.run.recording) ? S.run.recording : null;
const recIsStep = (s) => !["suggest", "ignored", "divider"].includes(s.kind);
const recLabel = (s) => s.kind === "checkpoint" ? "✔ Expected: " + (s.expected || "—") : s.desc;
function recCounts(rc) {
  const st = rc.steps.filter(recIsStep); const cps = st.filter((s) => s.kind === "checkpoint").length;
  return { total: st.length, actions: st.length - cps, cps, errs: st.reduce((a, s) => a + (s.errors || []).length, 0), errSteps: st.filter((s) => (s.errors || []).length).length };
}
function recDecorateReview(v) {
  const rc = recRun(); v.classList.remove("rec-show-steps");
  if (!rc) return;
  const c = recCounts(rc);
  const h1 = $("h1", v); if (h1 && !$(".rec-hbadge", h1)) h1.insertAdjacentHTML("beforeend", ` <span class="rec-hbadge">⏺ Recorded</span>`);
  const cov = $("#covBar", v);
  if (cov && !$("#recBanner", v)) {
    cov.insertAdjacentHTML("beforebegin", `<div id="recBanner" class="rec-banner"><b>⏺ Created from recording</b><span>·</span><span>${c.actions} actions · ${c.cps} checkpoint${c.cps === 1 ? "" : "s"} = ${c.total} recorded steps</span><span>·</span><span>${recMMSS(rc.duration)}</span>${rc.video ? "<span>·</span><span>🎥 video</span>" : ""}${c.errs ? `<span>·</span><span class="rec-red">⚠ ${c.errs} error${c.errs === 1 ? "" : "s"}</span>` : ""}${(rc.version || 1) > 1 ? `<span>·</span><span>v${rc.version} (re-recorded)</span>` : ""}<span>·</span><span class="muted">No AI used</span></div>
      <div id="recTabs" class="rec-tabbar"><button data-t="tc">📋 Test cases <b>${S.cases.length}</b></button><button data-t="steps" title="${c.total} recorded steps = ${c.actions} actions + ${c.cps} checkpoints">⏺ Recorded steps <b>${c.total}</b>${c.errSteps ? `<i class="rec-ebadge" title="${c.errSteps} step(s) with console/network errors">${c.errSteps}</i>` : ""}</button></div>
      <div id="recStepsPane"></div>`);
    $$("#recTabs button", v).forEach((b) => (b.onclick = () => recTab(b.dataset.t)));
  }
  recTab(REC.tab || "tc", true);
  recTags();
}
function recTab(t, quiet) {
  REC.tab = t; const v = $("#view"); if (!$("#recTabs")) return;
  $$("#recTabs button").forEach((b) => b.classList.toggle("a", b.dataset.t === t));
  v.classList.toggle("rec-show-steps", t === "steps");
  if (t === "steps") recStepsPane(); else { const p = $("#recStepsPane"); if (p) p.innerHTML = ""; }
  if (!quiet) window.scrollTo(0, 0);
}
// Test cases tab: tiny thumbnail + ▶ mm:ss per step of recorded test cases
function recGroupFor(t) {
  const rc = recRun(); const g = rc.groups || [];
  let gi = (rc.case_names || []).indexOf(t.name); if (gi < 0) gi = (rc.case_ids || []).indexOf(t.id);
  return gi >= 0 ? g[gi] : null;
}
function recStepFor(t, si) {
  const rc = recRun(); const g = recGroupFor(t); if (!g) return null;
  const by = Object.fromEntries(rc.steps.map((s) => [s.id, s]));
  const step = t.steps[si]; const sids = g.sids || [];
  if (sids.length === t.steps.length) return { s: by[sids[si]], cp: (g.cps || [])[si] };
  const hit = sids.findIndex((id) => by[id] && step && (by[id].desc === step.description || recLabel(by[id]) === step.description));   // edited case: match by text
  return hit >= 0 ? { s: by[sids[hit]], cp: (g.cps || [])[hit] } : null;
}
function recTags() {
  const rc = recRun(); if (!rc) return;
  $$("#rvList .tc").forEach((el) => {
    const t = S.cases.find((c) => String(c._k) === el.dataset.k); if (!t || !recGroupFor(t)) return;
    el.classList.add("rec-tc");
    const title = $(".tc-title", el);
    if (title && !$(".rec-tag", title)) title.insertAdjacentHTML("afterbegin", `<span class="rec-tag" title="Created from a recording (no AI)">⏺ Recorded</span>`);
    const hd = $(".sr.lbl", el); if (hd && !$(".rec-svh", hd)) hd.lastElementChild.insertAdjacentHTML("beforebegin", `<span class="rec-svh">Shot · Video</span>`);
    $$(".sr[data-s]", el).forEach((row) => {
      if ($(".rec-sv", row)) return;
      const m = recStepFor(t, Number(row.dataset.s)); const s = m && m.s;
      if (m && m.cp) row.classList.add("rec-cprow");
      const ra = $(".ra", row);
      const html = s ? `<span class="rec-sv">${s.shot ? `<img class="rec-mini" loading="lazy" src="${recFile(rc.rid, s.shot)}" alt="" data-rsid="${s.id}">` : '<span class="rec-mini none"></span>'}${rc.video && !s.seg ? `<a class="rec-play" data-rsid="${s.id}" title="Open the video at this step">▶ ${recMMSS(s.vt)}</a>` : `<span class="muted">${recMMSS(s.t)}</span>`}</span>` : `<span class="rec-sv"></span>`;
      ra ? ra.insertAdjacentHTML("beforebegin", html) : row.insertAdjacentHTML("beforeend", html);
    });
  });
}
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("#rvList [data-rsid]"); if (!a || !recRun()) return;
  e.preventDefault(); e.stopPropagation(); REC.rsel = a.dataset.rsid; REC.rfilter = "all"; recTab("steps"); recJumpSel(true);
}, true);
new MutationObserver(() => {
  if (S.view !== "review" || !recRun()) return;
  recTags();
  const p = $("#rtExpPanel");   // Export ▾ dropdown: extra "Automation script…" item for recorded runs
  if (p && !$("#recScriptPi", p)) {
    const last = $$("[data-fmt]", p).pop();
    if (last) { last.insertAdjacentHTML("afterend", `<div class="pi rec-pi" id="recScriptPi" title="Playwright (Python / JS) or Selenium (Java) from the recorded locators">⟨/⟩ Automation script…<span style="flex:1"></span><span class="pill gr">Record</span></div>`); $("#recScriptPi", p).onclick = () => { closePop(); recScriptModal(); }; }
  }
}).observe(document.body, { childList: true, subtree: true });

// Recorded steps tab
function recStepsPane() {
  const rc = recRun(); const p = $("#recStepsPane"); if (!rc || !p) return;
  const c = recCounts(rc); const st = rc.steps.filter(recIsStep); const dur = Math.max(1, rc.duration || 1);
  const by = Object.fromEntries(st.map((s) => [s.id, s])); const f = REC.rfilter || "all";
  const vurl = rc.video ? recFile(rc.rid, rc.video) : "";
  const num = Object.fromEntries(st.map((s, i) => [s.id, i + 1]));
  const keep = (s) => f === "all" || (f === "cp" && s.kind === "checkpoint") || (f === "err" && (s.errors || []).length) || (f === "data" && s.param);
  const used = new Set(); const groups = (rc.groups || []).map((g, gi) => { const ids = g.ids.filter((id) => by[id]); ids.forEach((x) => used.add(x)); return { gi, name: (S.cases[gi] && (rc.case_names || [])[gi] === S.cases[gi].name ? S.cases[gi].name : g.name), id: (rc.case_ids || [])[gi] || `TC${String(gi + 1).padStart(3, "0")}`, ids }; });
  const rest = st.filter((s) => !used.has(s.id)).map((s) => s.id); if (rest.length) groups.push({ gi: -1, name: "Not in a test case", id: "—", ids: rest });
  const errs = st.filter((s) => (s.errors || []).length);
  const params = Object.entries(rc.params || {});
  const row = (s) => { const [lab, cls] = REC_ACT[s.kind] || [s.kind, "nav"]; let d = esc(recLabel(s)); if (s.param && s.value) d = d.replace(esc(`"${s.value}"`), `<span class="rec-param">{{${esc(s.param)}}}</span>`);
    return `<div class="rec-srow k-${s.kind} ${REC.rsel === s.id ? "sel" : ""} ${(s.errors || []).length ? "has-err" : ""}" data-sid="${s.id}"><span class="rec-num">${num[s.id]}</span><span><span class="rec-act ${cls}">${lab}</span></span>
      <div>${d}${(s.errors || []).length ? `<div class="rec-errs">${s.errors.map((e) => `<span class="rec-err" title="${esc(e.text)}">⚠ ${esc(e.text.slice(0, 44))}</span>`).join("")}</div>` : ""}${s.note ? `<div class="rec-note">💬 ${esc(s.note)}</div>` : ""}</div>
      ${s.shot ? `<a href="${recFile(rc.rid, s.shot)}" target="_blank" rel="noopener" title="Open screenshot"><img class="rec-thumb" loading="lazy" src="${recFile(rc.rid, s.shot)}" alt=""></a>` : '<span class="rec-thumb none"></span>'}
      <span class="rec-play">${rc.video && !s.seg ? "▶ " : ""}${recMMSS(rc.video && !s.seg ? s.vt : s.t)}</span></div>`; };
  const body = groups.map((g) => { const ids = g.ids.filter((id) => keep(by[id])); if (!ids.length) return ""; return `<div class="rec-sgh"><b>${esc(g.id)}</b> ${esc(g.name)}<span class="muted">${g.ids.length} step${g.ids.length === 1 ? "" : "s"}</span></div>${ids.map((id) => row(by[id])).join("")}`; }).join("") || '<div class="muted" style="padding:14px">No steps match this filter.</div>';
  p.innerHTML = `<div class="rec-sp"><div class="rec-spl">
      <div class="card rec-vcard">${rc.video ? `<video id="recVideo" src="${vurl}" controls preload="metadata"></video>
        <div class="rec-marks" id="recMarks">${st.filter((s) => !s.seg).map((s) => `<i class="${(s.errors || []).length ? "err" : ""} ${REC.rsel === s.id ? "sel" : ""}" style="left:${Math.min(99.3, ((s.vt || 0) / dur) * 100)}%" data-sid="${s.id}" title="Step ${num[s.id]}: ${esc(recLabel(s))} (${recMMSS(s.vt)})"></i>`).join("")}</div>
        <div class="rec-vleg"><span>Markers = steps · <b class="rec-red">red</b> = error · <b style="color:#f59e0b">orange</b> = selected</span><a href="${vurl}" download>⬇ Video</a></div>` : '<div class="muted" style="padding:10px">No video was recorded for this run.</div>'}
        <div class="rec-vbtns"><a class="btn g sm" id="recZip" href="/api/rec/zip">⬇ Download recording (.zip)</a><button class="btn g sm" id="recPin">📌 Pin</button></div></div>
      ${errs.length ? `<div class="card rec-ecard"><h3 class="rec-red">⚠ Errors (${c.errs})</h3>${errs.map((s) => `<div class="rec-erow" data-sid="${s.id}">${s.errors.map((e) => `<div><span class="rec-ek ${e.kind}">${e.kind === "network" ? "Network" : "Console"}</span> Step ${num[s.id]} · ${esc(e.text)}</div>`).join("")}<button class="btn g sm" data-ev="${s.id}">Attach to ${esc(groups.find((g) => g.ids.includes(s.id))?.id || "test case")} as evidence</button><span class="rec-evmsg" id="evm_${s.id}"></span></div>`).join("")}</div>` : ""}
      ${(rc.previous || []).length ? `<div class="card rec-ccard"><h3>🕘 Recording v${rc.version || (rc.previous.length + 1)}</h3><div class="sub" style="margin:0 0 6px">Re-recorded ${rc.previous.length} time${rc.previous.length === 1 ? "" : "s"}. Compare the steps with an earlier recording:</div>
        <select id="recCmpSel">${rc.previous.map((x, i) => `<option value="${esc(x.rid)}" ${i === rc.previous.length - 1 ? "selected" : ""}>v${i + 1} · ${esc(recWhen(x.created))}</option>`).reverse().join("")}</select> <button class="btn g sm" id="recCmpGo">Compare</button><div id="recCmpOut"></div></div>` : ""}
    </div><div class="rec-spr"><div class="rec-chips">${[["all", `All ${c.total}`], ["cp", `✔ Checkpoints ${c.cps}`], ["err", `⚠ Errors ${c.errSteps}`], ["data", `🏷 Test data ${params.length}`]].map(([k, l]) => `<button data-f="${k}" class="${f === k ? "a" : ""}">${l}</button>`).join("")}</div>
      <div class="card rec-slog"><div class="rec-srow rec-hd"><span>#</span><span>Action</span><span>Step</span><span>Shot</span><span>Time</span></div>${body}
      ${params.length ? `<div class="rec-tdata"><b>Test data</b> ${params.map(([k, x]) => `<span class="rec-param">{{${esc(k)}}}</span> ${x.masked ? "•••• <span class='muted'>(masked)</span>" : esc(x.value)}`).join(" · ")}</div>` : ""}</div></div></div>`;
  $$(".rec-chips button", p).forEach((b) => (b.onclick = () => { REC.rfilter = b.dataset.f; recStepsPane(); }));
  $$(".rec-srow[data-sid], #recMarks i, .rec-erow", p).forEach((el) => (el.onclick = (e) => { if (e.target.closest("a,button")) return; REC.rsel = el.dataset.sid; recJumpSel(el.tagName === "I" || el.classList.contains("rec-erow")); }));
  $$("[data-ev]", p).forEach((b) => (b.onclick = () => guarded(b, async () => { const j = await api("/api/rec/evidence", { method: "PATCH", body: { step: b.dataset.ev } }); S.localDirty = false; loadCasesFromRun(); renderList(); const m = $("#evm_" + b.dataset.ev); if (m) m.textContent = `✓ Added to ${j.case} description`; })));
  recPinBtn();
  const cg = $("#recCmpGo"); if (cg) cg.onclick = () => guarded(cg, async () => {
    const j = await api("/api/rec/compare?rid=" + encodeURIComponent($("#recCmpSel").value)); const sm = j.summary;
    $("#recCmpOut").innerHTML = `<div class="sub" style="margin:6px 0">${sm.same} same · <span class="rec-ok">${sm.added} added</span> · <span class="rec-red">${sm.removed} removed</span> · ${sm.changed} changed</div><div class="rec-diff">${j.rows.map((r) => `<div class="d-${r.op}">${r.op === "same" ? "  " : r.op === "added" ? "+ " : r.op === "removed" ? "− " : "~ "}${esc(r.op === "removed" ? r.old : r.op === "changed" ? r.old + " → " + r.new : r.new)}</div>`).join("")}</div>`;
  });
}
async function recPinBtn() {
  const rc = recRun(); const b = $("#recPin"); if (!b) return;
  let st; try { st = await api("/api/rec/storage"); } catch { return; }
  const draw = () => { const on = st.pinned.includes(rc.rid); b.textContent = on ? "📌 Pinned" : "📌 Pin"; b.classList.toggle("on", on); b.title = on ? "Pinned — never removed by storage retention (click to unpin)" : "Pin — never remove this recording by storage retention"; };
  draw(); b.onclick = () => guarded(b, async () => { st = await api("/api/rec/pin", { method: "POST", body: { rid: rc.rid, pinned: !st.pinned.includes(rc.rid) } }); draw(); });
}
function recJumpSel(scroll) {
  const rc = recRun(); const s = rc && rc.steps.find((x) => x.id === REC.rsel); if (!s) return;
  $$(".rec-srow.sel, #recMarks i.sel").forEach((x) => x.classList.remove("sel"));
  const r = $(`.rec-srow[data-sid="${s.id}"]`); if (r) { r.classList.add("sel"); if (scroll) r.scrollIntoView({ block: "center" }); }
  const m = $(`#recMarks i[data-sid="${s.id}"]`); if (m) m.classList.add("sel");
  const vid = $("#recVideo"); if (vid && !s.seg) { const go = () => { vid.currentTime = Number(s.vt) || 0; }; vid.readyState >= 1 ? go() : vid.addEventListener("loadedmetadata", go, { once: true }); }
}
function recScriptModal() {
  const old = $("#recScript"); if (old) old.remove();
  const m = document.createElement("div"); m.id = "recScript"; m.className = "rec-mbg";
  m.innerHTML = `<div class="rec-modal"><div class="rec-evh"><h3>Export as automation script</h3><button class="ib" id="rsX" title="Close">✕</button></div>
    <div class="rec-tabs"><button data-l="py" class="a">Playwright (Python)</button><button data-l="java">Selenium (Java)</button><button data-l="js">Playwright (JS)</button></div>
    <pre class="rec-code" id="rsCode">Loading…</pre>
    <div class="rec-mfoot"><label class="rec-chk"><input type="checkbox" id="rsAs" checked> Include checkpoints as assertions</label><label class="rec-chk"><input type="checkbox" id="rsPa" checked> Use {{test data}} as parameters</label>
      <span style="flex:1"></span><button class="btn g" id="rsCopy">📋 Copy</button><button class="btn" id="rsDl">⬇ Download</button></div>
    <div class="sub" style="margin:6px 0 0">Generated from recorded locators — no AI. Edits made in Review are not reflected in the script.</div></div>`;
  document.body.appendChild(m);
  let lang = "py", cur = null;
  const load = async () => { $("#rsCode").textContent = "Loading…"; try { cur = await api("/api/rec/script", { method: "POST", body: { lang, assertions: $("#rsAs").checked, params: $("#rsPa").checked } }); $("#rsCode").textContent = cur.script; $("#rsDl").textContent = "⬇ Download ." + cur.filename.split(".").pop(); $("#rsDl").title = cur.filename; } catch (e) { $("#rsCode").textContent = e.message; } };
  $$(".rec-tabs button", m).forEach((b) => (b.onclick = () => { $$(".rec-tabs button", m).forEach((x) => x.classList.toggle("a", x === b)); lang = b.dataset.l; load(); }));
  $("#rsAs").onchange = load; $("#rsPa").onchange = load;
  $("#rsX").onclick = () => m.remove(); m.onclick = (e) => { if (e.target === m) m.remove(); };
  $("#rsCopy").onclick = async () => { try { await navigator.clipboard.writeText(cur.script); } catch { const ta = document.createElement("textarea"); ta.value = cur.script; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } $("#rsCopy").textContent = "✓ Copied"; setTimeout(() => { const b = $("#rsCopy"); if (b) b.textContent = "📋 Copy"; }, 1800); };
  $("#rsDl").onclick = () => { if (!cur) return; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([cur.script], { type: "text/plain" })); a.download = cur.filename; document.body.appendChild(a); a.click(); a.remove(); };
  load();
}

// ------------------------------------------------------------------ Run history (recorded runs: 🎥 meta, zip, pin, "Recorded only")
const _recOrigViewHistory = viewHistory;
viewHistory = async function (v) { await _recOrigViewHistory(v); await recDecorateHistory(v); };
async function recDecorateHistory(v) {
  let j, st; try { j = await api("/api/history"); st = await api("/api/rec/storage"); } catch { return; }
  const recs = j.items.filter((e) => e.rec); const tbl = $("table.rh", v); if (!recs.length || !tbl || !document.body.contains(tbl)) return;
  if (!$("#recOnly", v)) tbl.insertAdjacentHTML("beforebegin", `<div class="rec-hf"><label class="rec-chk"><input type="checkbox" id="recOnly" ${REC.hOnly ? "checked" : ""}> 🎥 Recorded only <span class="muted">(${recs.length})</span></label></div>`);
  $$("tr[data-id]", tbl).forEach((tr) => {
    const e = j.items.find((x) => x.run_id === tr.dataset.id); if (!e || !e.rec || tr.classList.contains("rec-hrow")) return;
    tr.classList.add("rec-hrow"); const r = e.rec;
    const ttl = $(".ttl", tr); if (ttl) ttl.insertAdjacentHTML("afterend", `<div class="rec-hmeta">${r.video ? "🎥 " : "⏺ "}<span class="rec-url" title="${esc(r.url)}">${esc(r.url.replace(/^https?:\/\//, "").slice(0, 46))}</span> · ${recMMSS(r.duration)} · ${r.steps || 0} actions${r.checkpoints ? ` · ${r.checkpoints} cp` : ""}${r.errors ? ` · <span class="rec-red">⚠ ${r.errors} error${r.errors === 1 ? "" : "s"}</span>` : ""}${(r.version || 1) > 1 ? ` · v${r.version}` : ""}<div class="rec-hlinks"><a class="rec-hzip" href="/api/rec/zip?run_id=${encodeURIComponent(e.run_id)}" title="Download recording (video, screenshots, steps, scripts)">⬇ Zip</a> · <a class="rec-hpin ${st.pinned.includes(r.rid) ? "on" : ""}" title="Pin: never delete this recording by storage retention">📌 ${st.pinned.includes(r.rid) ? "Pinned" : "Pin"}</a></div></div>`);
    const src = tr.children[2] && $(".pill", tr.children[2]); if (src) src.textContent = "🎥 Recorded";
    const pin = $(".rec-hpin", tr);
    if (pin) pin.onclick = () => guarded(null, async () => { st = await api("/api/rec/pin", { method: "POST", body: { rid: r.rid, pinned: !st.pinned.includes(r.rid) } }); const on = st.pinned.includes(r.rid); pin.classList.toggle("on", on); pin.textContent = on ? "📌 Pinned" : "📌 Pin"; });
  });
  const apply = () => $$("tr", tbl).forEach((tr) => { if (tr.querySelector("th")) return; tr.style.display = REC.hOnly && !tr.classList.contains("rec-hrow") ? "none" : ""; });
  $("#recOnly", v).onchange = (e) => { REC.hOnly = e.target.checked; apply(); }; apply();
}
