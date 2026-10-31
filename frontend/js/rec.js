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
  const ign = d("ignore", (REC.defaults.ignore || []).join("\n"));
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
    <div style="margin-top:14px"><button class="btn r" id="rStart">⏺ Start recording</button> <button class="btn g" id="rCancel">Cancel</button></div></div><div id="recDraftHost"></div>`;
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
  try { const j = await api("/api/rec/stop", { method: "POST" }); toast(`Recording converted to ${j.count} test case${j.count === 1 ? "" : "s"} — no AI used`); REC.st = null; recToReview(); }
  finally { REC.busyStop = false; }
}
function recToReview() { S.localDirty = false; S.inputMode = "record"; S.view = "review"; location.hash = "review"; render(); }
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
  let desc = esc(s.desc);
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
function recDecorateReview(v) {
  const rc = recRun(); if (!rc) return;
  const acts = $(".rv-actions", v);
  if (acts && !$("#recScriptBtn", v)) { const b = document.createElement("button"); b.className = "btn g rec-scbtn"; b.id = "recScriptBtn"; b.innerHTML = "⟨/⟩ Export script"; b.title = "Export the recording as an automation script (Playwright Python / JS, Selenium Java)"; b.onclick = recScriptModal; acts.appendChild(b); }
  const cov = $("#covBar", v);
  if (cov && !$("#recBanner", v)) {
    const ban = document.createElement("div"); ban.id = "recBanner"; ban.className = "rec-banner";
    ban.innerHTML = `<b>⏺ Created from recording</b> — ${rc.n_steps} steps, ${rc.n_checkpoints} checkpoint${rc.n_checkpoints === 1 ? "" : "s"}, ${recMMSS(rc.duration)}${rc.video ? ", video saved" : ""}${rc.n_errors ? `, <span class="rec-red">${rc.n_errors} console/network error${rc.n_errors === 1 ? "" : "s"}</span>` : ""} · No AI used · Use Edit to adjust steps <button class="btn g sm" id="recEvBtn">🎥 Evidence</button>`;
    cov.before(ban);
    const panel = document.createElement("div"); panel.id = "recEvidence"; panel.className = "hidden"; ban.after(panel);
    $("#recEvBtn").onclick = () => recEvidence();
  }
  recTags();
}
function recTags() {
  const rc = recRun(); if (!rc) return;
  const ids = new Set(rc.case_ids || []), names = new Set(rc.case_names || []);
  $$("#rvList .tc").forEach((el) => {
    const t = S.cases.find((c) => String(c._k) === el.dataset.k); if (!t) return;
    const title = $(".tc-title", el); if (!title || $(".rec-tag", title)) return;
    if (!(names.has(t.name) || ids.has(t.id))) return;
    const ix = (rc.case_names || []).indexOf(t.name); const gi = ix >= 0 ? ix : (rc.case_ids || []).indexOf(t.id);
    const sp = document.createElement("span"); sp.className = "rec-tag"; sp.title = "Created from a recording (no AI)"; sp.textContent = "⏺ Recorded";
    title.prepend(sp);
    if (rc.video) { const a = document.createElement("a"); a.className = "rec-vlink"; a.textContent = "🎥 Video"; a.title = "Jump to this test case in the video"; a.onclick = (e) => { e.stopPropagation(); recEvidence(gi); }; sp.after(a); }
  });
}
new MutationObserver(() => { if (S.view === "review" && recRun()) recTags(); }).observe(document.getElementById("view"), { childList: true, subtree: true });

function recEvidence(groupIx) {
  const rc = recRun(); const p = $("#recEvidence"); if (!rc || !p) return;
  if (groupIx === undefined && !p.classList.contains("hidden")) { p.classList.add("hidden"); return; }
  p.classList.remove("hidden");
  const steps = rc.steps.filter((s) => !["suggest", "ignored", "divider"].includes(s.kind));
  const dur = Math.max(1, rc.duration || 1);
  const vsteps = steps.filter((s) => !s.seg);
  const vurl = rc.video ? recFile(rc.rid, rc.video) : "";
  const grp = (id) => (rc.groups || []).findIndex((g) => g.ids.includes(id));
  p.innerHTML = `<div class="card rec-ev"><div class="rec-evh"><h3>🎥 Recording evidence</h3><button class="ib" id="recEvX" title="Close">✕</button></div>
    ${rc.video ? `<div class="rec-video"><video id="recVideo" src="${vurl}" controls preload="metadata"></video>
      <div class="rec-marks" id="recMarks">${vsteps.map((s, i) => `<i class="${(s.errors || []).length ? "err" : ""}" style="left:${Math.min(99.5, ((s.vt || 0) / dur) * 100)}%" data-t="${s.vt || 0}" title="Step ${i + 1}: ${esc(s.desc)} (${recMMSS(s.vt)})"></i>`).join("")}</div>
      <div class="sub" style="margin:4px 0 0">Markers = steps (red = error). Click a marker or a step to jump. <a href="${vurl}" download>Download video</a></div></div>` : '<div class="muted">No video was recorded for this run.</div>'}
    <div class="rec-evlist">${steps.map((s, i) => `<div class="rec-evrow ${(s.errors || []).length ? "has-err" : ""}" data-t="${s.vt || 0}" data-g="${grp(s.id)}"><span class="rec-num">${i + 1}</span><span class="rec-act ${(REC_ACT[s.kind] || ["", "nav"])[1]}">${(REC_ACT[s.kind] || [s.kind])[0]}</span>
      <div><div>${esc(s.desc)}${s.note ? `<div class="rec-note">💬 ${esc(s.note)}</div>` : ""}</div>${(s.errors || []).map((e) => `<div class="rec-err">⚠ ${esc(e.kind)}: ${esc(e.text)}</div>`).join("")}${(s.errors || []).length ? `<button class="btn g sm" data-ev="${s.id}">Attach to test case as evidence</button>` : ""}</div>
      ${s.shot ? `<a href="${recFile(rc.rid, s.shot)}" target="_blank" rel="noopener"><img class="rec-thumb" loading="lazy" src="${recFile(rc.rid, s.shot)}" alt="screenshot"></a>` : '<span class="rec-thumb none"></span>'}<span class="rec-t">${recMMSS(s.vt)} ${rc.video && !s.seg ? "▶ jump" : ""}</span></div>`).join("")}</div>
    ${Object.keys(rc.params || {}).length ? `<div class="sub" style="margin:8px 0 0">Test data: ${Object.entries(rc.params).map(([k, x]) => `<span class="rec-param">{{${esc(k)}}}</span> = ${x.masked ? "(masked)" : esc(x.value)}`).join(" · ")}</div>` : ""}</div>`;
  const vid = $("#recVideo");
  const jump = (t) => { if (!vid) return; vid.currentTime = Number(t) || 0; vid.play && vid.play().catch(() => {}); };
  $("#recEvX").onclick = () => p.classList.add("hidden");
  $$("#recMarks i").forEach((m) => (m.onclick = () => jump(m.dataset.t)));
  $$(".rec-evrow", p).forEach((r) => (r.onclick = (e) => { if (e.target.closest("button,a")) return; jump(r.dataset.t); }));
  $$("[data-ev]", p).forEach((b) => (b.onclick = () => guarded(b, async () => { const j = await api("/api/rec/evidence", { method: "PATCH", body: { step: b.dataset.ev } }); S.localDirty = false; toast(`Errors attached to ${j.case} description`); render(); })));
  if (groupIx !== undefined && groupIx >= 0) { const g = rc.groups[groupIx]; const first = g && steps.find((s) => g.ids.includes(s.id)); if (first) { jump(first.vt); const r = $(`.rec-evrow[data-g="${groupIx}"]`, p); if (r) r.classList.add("sel"); } }
  p.scrollIntoView({ block: "nearest" });
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
  const load = async () => { $("#rsCode").textContent = "Loading…"; try { cur = await api("/api/rec/script", { method: "POST", body: { lang, assertions: $("#rsAs").checked, params: $("#rsPa").checked } }); $("#rsCode").textContent = cur.script; $("#rsDl").textContent = "⬇ Download " + cur.filename; } catch (e) { $("#rsCode").textContent = e.message; } };
  $$(".rec-tabs button", m).forEach((b) => (b.onclick = () => { $$(".rec-tabs button", m).forEach((x) => x.classList.toggle("a", x === b)); lang = b.dataset.l; load(); }));
  $("#rsAs").onchange = load; $("#rsPa").onchange = load;
  $("#rsX").onclick = () => m.remove(); m.onclick = (e) => { if (e.target === m) m.remove(); };
  $("#rsCopy").onclick = async () => { try { await navigator.clipboard.writeText(cur.script); } catch { const ta = document.createElement("textarea"); ta.value = cur.script; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } toast("Script copied to clipboard"); };
  $("#rsDl").onclick = () => { if (!cur) return; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([cur.script], { type: "text/plain" })); a.download = cur.filename; document.body.appendChild(a); a.click(); a.remove(); };
  load();
}
