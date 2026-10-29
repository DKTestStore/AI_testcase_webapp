/* AI TestCase Generator - single page app (vanilla JS, no build step). */
"use strict";

const S = {               // client state
  run: null,
  view: "input",
  inputMode: null,        // "jira" | "local"
  localText: "", localFile: null,
  cases: [],              // editable copy of run.test_cases
  localDirty: false,      // edits in Review table not yet saved to server
  defaultPrompt: null,
  busy: false,
  qtab: "upload", rtmFilter: "all", rtmSearch: "",
  payloadPreview: null,
};
const STEPS = ["input", "generate", "review", "qtest"];
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n === null || n === undefined || n === "") ? "—" : Number(n).toLocaleString();

// ------------------------------------------------------------------ API
async function api(path, opts = {}) {
  const o = { credentials: "same-origin", headers: {}, ...opts };
  if (o.body && typeof o.body !== "string") { o.body = JSON.stringify(o.body); o.headers["Content-Type"] = "application/json"; }
  const r = await fetch(path, o);
  let j = {};
  try { j = await r.json(); } catch { j = { ok: false, error: `HTTP ${r.status}` }; }
  if (r.status === 401) { window.location.href = "/welcome"; throw new Error(j.error || "Session expired"); }
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  if (j.run) S.run = j.run;
  return j;
}
function toast(msg, isErr = false) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (isErr ? " err" : ""); t.style.display = "block";
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = "none"), isErr ? 7000 : 3500);
}
async function guarded(btn, fn) {
  if (S.busy) return;
  S.busy = true; const old = btn ? btn.innerHTML : ""; if (btn) { btn.disabled = true; btn.innerHTML = "⏳ " + old; }
  try { await fn(); } catch (e) { toast(e.message, true); }
  finally { S.busy = false; if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = old; } }
}
function download(url) { const a = document.createElement("a"); a.href = url; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); }

// ------------------------------------------------------------------ navigation
function stepDone(s) { return !!(S.run && S.run.steps && S.run.steps[s]); }
function stepUnlocked(s) {
  const i = STEPS.indexOf(s);
  if (i <= 0) return true;
  return STEPS.slice(0, i).every((p) => stepDone(p));
}
function go(view) {
  if (STEPS.includes(view) && !stepUnlocked(view)) { toast("Complete the previous step first.", true); return; }
  if (S.view === "review" && view !== "review" && S.localDirty && !confirm("You have unsaved edits in the Review table. Leave without saving?")) return;
  if (S.view === "review" && view !== "review") S.localDirty = false;
  S.view = view; location.hash = view; render();
}
function renderNav() {
  $$("#nav a").forEach((a) => {
    const v = a.dataset.view;
    a.classList.toggle("a", v === S.view);
    a.classList.toggle("done", STEPS.includes(v) && stepDone(v));
    a.classList.toggle("locked", STEPS.includes(v) && !stepUnlocked(v));
  });
  const r = S.run || {};
  $("#runinfo").innerHTML = `Run <b>${esc(r.run_id || "")}</b><br>${r.story_id ? "Story " + esc(r.story_id) + "<br>" : ""}${(r.test_cases || []).length} test cases${r.dirty || S.localDirty ? '<br><span style="color:#f5c26b">● unsaved changes</span>' : ""}`;
}
function nextBar(cur, nextView, nextLabel, extraLeft = "") {
  const ok = stepDone(cur);
  return `<div class="footer-nav"><div>${extraLeft}</div>${nextView ? `<button class="btn" id="nextBtn" ${ok ? "" : "disabled"} title="${ok ? "" : "Complete this step first"}">${nextLabel} →</button>` : ""}</div>`;
}
function bindNext(nextView) { const b = $("#nextBtn"); if (b) b.onclick = () => go(nextView); }

function render() {
  renderNav();
  const v = $("#view");
  ({ setup: viewSetup, input: viewInput, generate: viewGenerate, review: viewReview, qtest: viewQtest, settings: viewSettings }[S.view] || viewInput)(v);
}


// ------------------------------------------------------------------ 0. SETUP CHECKLIST (Enh 02)
async function viewSetup(v) {
  v.innerHTML = `<h1>Setup checklist</h1><div class="sub">Check your configuration before starting a run.</div><div id="setupBody" class="sub">Loading…</div>`;
  let j; try { j = await api("/api/setup/status"); } catch (e) { $("#setupBody").innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  const it = j.items; const done = it.filter((x) => x.ok).length; const reqOk = it.filter((x) => x.required).every((x) => x.ok);
  const icon = { gemini_key: "🔑", gemini_model: "🤖", jira: "🧩", qtest: "🧪" };
  const pct = (done / it.length) * 100;
  $("#setupBody").outerHTML = `<div class="card setup-top"><div class="ring" style="background:conic-gradient(#4361ee ${pct}%,#e5e7eb 0)"><div><b>${done}/${it.length}</b><span>configured</span></div></div>
      <div><h3 style="margin:0 0 4px">Let's get you set up</h3><div class="sub" style="margin:0">Required items must be configured to generate. Optional items unlock Jira input and qTest upload.</div></div></div>
    <div class="setup-grid">${it.map((x) => `<div class="card setup-item ${x.ok ? "ok" : "no"}" data-key="${x.key}"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:22px">${icon[x.key] || "⚙"}</span><span class="tag ${x.required ? "req" : "opt"}">${x.required ? "Required" : "Optional"}</span></div>
      <div class="si-name">${esc(x.label)}</div><div class="sub" style="margin:2px 0 8px">${esc(x.hint)}</div>
      <div class="si-st">${x.ok ? "✔ Set" : "⚠ Not set"}</div><a href="#settings" class="si-link">Open Settings →</a></div>`).join("")}</div>
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <span>${reqOk ? "✔ All required items are configured — you can start now." : '<b style="color:#a36b00">⚠ Configure the required Gemini settings before generating.</b>'} <span class="sub" style="margin:0">(Jira and qTest are optional: use Local text input and Save &amp; Download Excel without them.)</span></span>
      <button class="btn" id="startRun">Start run ▸</button></div>`;
  $("#startRun").onclick = () => go("input");
}

// ------------------------------------------------------------------ 1. INPUT
function viewInput(v) {
  const r = S.run; if (!S.inputMode) S.inputMode = r.source || "jira";
  const jira = r.jira;
  const seg = `<div class="seg"><button data-m="jira" class="${S.inputMode === "jira" ? "a" : ""}">Jira Story</button><button data-m="local" class="${S.inputMode === "local" ? "a" : ""}">Local text</button></div>`;
  let body = "";
  if (S.inputMode === "jira") {
    body = `<div class="card">${seg}
      <label>Story ID</label><input id="storyId" placeholder="e.g. MTG-1427" value="${esc(r.source === "jira" ? r.story_id : "")}" style="width:240px">
      <button class="btn" id="fetchBtn">Fetch</button> ${jira ? `<span class="pill">Fetched ✓</span>` : ""}</div>`;
    if (jira) {
      const st = jira.usable ? `<span class="pill">${esc(jira.status)}</span>` : `<span class="pill r">${esc(jira.status)}</span>`;
      body += `<div class="card"><h3>${esc(jira.issue_key)} · ${esc(jira.summary)}</h3>
        <div style="margin-bottom:8px">${st} <span class="sub">${esc(jira.message)}</span></div>
        ${jira.brd_links && jira.brd_links.length ? `<div class="sub" style="margin-bottom:8px">BRD links: ${jira.brd_links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.slice(0, 70))}</a>`).join(", ")}</div>` : ""}
        ${jira.usable ? `<div class="row"><div><h3>Extracted ${jira.feature_source === "scenarios" ? "Scenarios" : jira.feature_source === "acceptance_criteria" ? "Acceptance Criteria" : "Description"}</h3>
           <div class="sub" style="margin:0 0 4px">Edit if needed — this is exactly what will be sent to the generator.</div>
           <textarea id="featureText" rows="14">${esc(r.feature_text)}</textarea>
           <div class="sub" style="margin:6px 0 0"><span id="ftCount"></span></div></div></div>`
          : `<div class="warn">${esc(jira.message)}<br><br>Switch to <b>Local text</b> and paste the requirements to continue.</div>`}
        <details style="margin-top:10px"><summary class="sub" style="cursor:pointer">Full Jira description</summary><pre class="ro">${esc(jira.description)}</pre></details></div>`;
    }
  } else {
    const text = S.localText || (r.source === "local" ? r.feature_text : "");
    S.localText = text;
    body = `<div class="card">${seg}<label>Story ID (optional, used for RTM / qTest module name)</label><input id="localStory" value="${esc(r.source === "local" ? r.story_id : "")}" placeholder="e.g. MTG-1427" style="width:240px"></div>
    <div class="row"><div style="flex:1.6"><div class="card"><label style="margin-top:0">Feature description</label>
      <textarea id="localText" rows="18" placeholder="Paste the user story and acceptance criteria here…">${esc(text)}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><span class="sub" style="margin:0" id="localCount"></span>
      <span><button class="btn g" id="clearBtn">Clear</button> <button class="btn" id="useBtn">Use this description</button></span></div></div></div>
    <div><div class="card drop" id="drop"><div style="font-size:26px">📄</div><b>Drag &amp; drop or Upload .txt</b><div class="sub" style="margin:4px 0 10px">Plain text, max 1 MB</div>
      <input type="file" id="fileIn" accept=".txt,.md,text/plain" class="hidden">
      <div id="fileInfo">${S.localFile ? fileInfoHtml(S.localFile) : (r.local_filename ? `<div class="sub">Last used: ${esc(r.local_filename)}</div>` : "")}</div></div>
      <div class="card"><h3>Will be sent to generator</h3><div id="preview"></div></div></div></div>`;
  }
  v.innerHTML = `<h1>Input Source</h1><div class="sub">${S.inputMode === "jira" ? "Fetch a Jira story and extract its acceptance criteria" : "Paste or upload a feature description"}</div>${body}${nextBar("input", "generate", "Continue to Generate")}`;
  $$(".seg button", v).forEach((b) => (b.onclick = () => { S.inputMode = b.dataset.m; render(); }));
  bindNext("generate");
  const nb = $("#nextBtn"); if (nb && S.inputMode === "local") { nb.disabled = false; nb.onclick = () => guarded(nb, async () => { await saveLocalIfChanged(); if (!stepDone("input")) throw new Error("Enter a feature description first."); go("generate"); }); }
  if (S.inputMode === "jira") {
    const f = () => guarded($("#fetchBtn"), async () => { await api("/api/input/jira", { method: "POST", body: { story_id: $("#storyId").value } }); toast("Story fetched"); render(); });
    $("#fetchBtn").onclick = f; $("#storyId").onkeydown = (e) => e.key === "Enter" && f();
    const ft = $("#featureText");
    if (ft) {
      const cnt = () => ($("#ftCount").textContent = `${ft.value.length.toLocaleString()} characters`); cnt();
      ft.oninput = cnt;
      ft.onchange = () => api("/api/input/feature_text", { method: "POST", body: { text: ft.value } }).then(() => { renderNav(); bindNextState(); }).catch((e) => toast(e.message, true));
    }
  } else {
    const ta = $("#localText");
    const upd = () => {
      S.localText = ta.value; const words = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
      $("#localCount").textContent = `${ta.value.length.toLocaleString()} characters · ${words.toLocaleString()} words`;
      const acs = (ta.value.match(/acceptance\s+criteria\s*0*\d+/gi) || []).length;
      const first = ta.value.split("\n").find((l) => l.trim()) || "";
      $("#preview").innerHTML = ta.value.trim() ? `<div><b>First line:</b> ${esc(first.slice(0, 90))}</div><div><b>Acceptance criteria detected:</b> ${acs || "—"}</div><div><b>Source:</b> Local text${S.localFile ? " (upload: " + esc(S.localFile.name) + ")" : ""}</div>
        <div style="margin-top:8px">${S.run.source === "local" && S.run.feature_text === ta.value.trim() ? '<span class="pill">Ready ✓</span>' : '<span class="pill y">Click “Use this description”</span>'}</div>` : '<span class="muted">Nothing entered yet.</span>';
    };
    ta.oninput = upd; upd();
    ta.onchange = () => { if (ta.value.trim()) saveLocalIfChanged().then(() => { upd(); renderNav(); bindNextState(); }).catch((e) => toast(e.message, true)); };
    $("#clearBtn").onclick = () => { ta.value = ""; S.localFile = null; $("#fileInfo").innerHTML = ""; upd(); };
    $("#useBtn").onclick = () => guarded($("#useBtn"), async () => {
      await api("/api/input/local", { method: "POST", body: { text: ta.value, filename: S.localFile ? S.localFile.name : "", story_id: $("#localStory").value } });
      toast("Description saved for generation"); render();
    });
    const drop = $("#drop"), fi = $("#fileIn");
    drop.onclick = (e) => { if (e.target.tagName !== "INPUT") fi.click(); };
    fi.onchange = () => fi.files[0] && loadTxt(fi.files[0]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); e.dataTransfer.files[0] && loadTxt(e.dataTransfer.files[0]); };
    function loadTxt(file) {
      if (file.size > 1024 * 1024) return toast("File is larger than 1 MB", true);
      if (!/\.(txt|md)$/i.test(file.name) && file.type && !file.type.startsWith("text/")) return toast("Please upload a .txt file", true);
      const rd = new FileReader();
      rd.onload = () => { ta.value = rd.result; S.localFile = { name: file.name, size: file.size, lines: String(rd.result).split("\n").length }; $("#fileInfo").innerHTML = fileInfoHtml(S.localFile); upd(); };
      rd.readAsText(file);
    }
  }
}
async function saveLocalIfChanged() {
  // Bug: editing the input after a run already has test cases was ignored unless "Use this description" was clicked.
  const ta = $("#localText"); if (!ta || !ta.value.trim()) return false;
  const story = $("#localStory") ? $("#localStory").value : "";
  if (S.run.source === "local" && S.run.feature_text === ta.value.trim() && (S.run.story_id || "") === story.trim()) return false;
  await api("/api/input/local", { method: "POST", body: { text: ta.value, filename: S.localFile ? S.localFile.name : "", story_id: story } });
  toast((S.run.test_cases || []).length ? "Input updated — click Generate to regenerate test cases" : "Description saved for generation");
  return true;
}
function fileInfoHtml(f) { return `<div style="background:#fff;border:1px solid #e3e7f0;border-radius:8px;padding:8px;text-align:left">✅ <b>${esc(f.name)}</b><div class="sub" style="margin:2px 0 0">${(f.size / 1024).toFixed(1)} KB · ${f.lines} lines · loaded</div></div>`; }
function bindNextState() { const b = $("#nextBtn"); if (b) b.disabled = !stepDone(S.view); }

// ------------------------------------------------------------------ 2. GENERATE
async function ensureDefaultPrompt() { if (S.defaultPrompt === null) { const j = await api("/api/prompt/default"); S.defaultPrompt = j; } return S.defaultPrompt; }
function viewGenerate(v) {
  const r = S.run; const custom = r.prompt_mode === "custom";
  const lbl = custom ? "Custom" : "Default";
  v.innerHTML = `<h1>Generate Test Cases</h1><div class="sub">${r.story_id ? "Story " + esc(r.story_id) + " · " : ""}${r.source === "jira" ? "Jira input" : "Local input"} · ${r.feature_text.length.toLocaleString()} characters of requirements loaded</div>
  <div class="row"><div style="flex:1.5"><div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
      <div><label style="margin-top:0">Prompt source</label><div class="seg" id="promptSeg"><button data-p="default" class="${custom ? "" : "a"}">Default prompt</button><button data-p="custom" class="${custom ? "a" : ""}">Custom prompt</button></div></div>
      <div><label style="margin-top:0">Model</label><select id="model">
        <option value="gemini" ${r.model === "gemini" ? "selected" : ""}>Gemini</option>
        <option value="codex" ${r.model === "codex" ? "selected" : ""}>Codex (OpenAI)</option>
        <option value="ollama" ${r.model === "ollama" ? "selected" : ""}>Ollama (local)</option></select></div></div>
    <div id="promptArea"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid #edf0f5;gap:10px;flex-wrap:wrap">
      <label class="sw" style="margin:0;text-transform:none;font-size:13px;color:#1e2433;font-weight:400"><input type="checkbox" id="runRev" ${r.run_reviewer ? "checked" : ""}><span class="t"></span>Also run AI Reviewer after generation</label>
      <button class="btn" id="genBtn" style="padding:11px 20px">✨ Generate with ${lbl} prompt</button></div>
    <div id="genStatus"></div>
  </div></div>
  <div style="flex:.8"><div class="card" id="tokenCard"><h3>Token Usage</h3><div class="sub">Loading…</div></div>
    ${(r.test_cases || []).length ? `<div class="note" style="margin:0 0 14px">ℹ This run already has ${(r.test_cases || []).length} test cases. Edit the Input and click Generate again to regenerate them.</div>` : ""}
    <div class="card"><h3>Run summary</h3><div class="sub" style="margin:0;line-height:1.8">Prompt: <b style="color:#1e2433">${lbl} prompt</b><br>Model: ${esc(r.model)}<br>AI Reviewer: ${r.run_reviewer ? '<b style="color:#12a150">On</b>' : "Off"}<br>Test cases: <b style="color:#1e2433">${(r.test_cases || []).length}</b></div></div></div></div>
  ${nextBar("generate", "review", "Continue to Review")}`;
  bindNext("review");
  $$("#promptSeg button").forEach((b) => (b.onclick = () => { saveCustomDraft(); S.run.prompt_mode = b.dataset.p; viewGenerate(v); }));
  $("#model").onchange = (e) => (S.run.model = e.target.value);
  $("#runRev").onchange = (e) => (S.run.run_reviewer = e.target.checked);
  renderPromptArea(custom);
  loadTokens();
  $("#genBtn").onclick = () => {
    const n = (S.run.test_cases || []).length;
    if (n && (S.localDirty || S.run.dirty) && !confirm(`Regenerate? This replaces the current ${n} test cases (including unsaved review edits).`)) return;
    genRun();
  };
  const genRun = () => guarded($("#genBtn"), async () => {
    saveCustomDraft();
    const st = $("#genStatus"); const t0 = Date.now();
    st.innerHTML = `<div style="margin-top:12px"><div class="bar ind"><div></div></div><div class="sub" style="margin:6px 0 0" id="elapsed">Generating… 0s</div></div>`;
    const timer = setInterval(() => { const e = $("#elapsed"); if (e) e.textContent = `Generating${S.run.run_reviewer ? " + reviewing" : ""}… ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
    try {
      const j = await api("/api/generate", { method: "POST", body: { model: $("#model").value, prompt_mode: S.run.prompt_mode, custom_prompt: S.run.custom_prompt, run_reviewer: $("#runRev").checked } });
      S.localDirty = false; S.cases = []; if (typeof RV !== "undefined") { RV.open.clear(); RV.sel.clear(); RV.page = 0; }
      let msg = `<div class="note">✅ Generated <b>${j.count}</b> test cases in ${Math.round((Date.now() - t0) / 1000)}s.${j.template_appended ? " (Required output template was appended to your custom prompt.)" : ""}</div>`;
      if (j.review) msg += j.review.error ? `<div class="warn">AI Reviewer failed: ${esc(j.review.error)}</div>` : `<div class="note">🤖 AI Reviewer produced ${j.review.test_cases.length} test cases — compare and apply them on the Review step.</div>`;
      viewGenerate(v); $("#genStatus").innerHTML = msg;
    } catch (e) { st.innerHTML = `<div class="error">${esc(e.message)}</div>`; throw e; }
    finally { clearInterval(timer); renderNav(); }
  });
}
function saveCustomDraft() { const ta = $("#customPrompt"); if (ta) S.run.custom_prompt = ta.value; }
async function renderPromptArea(custom) {
  const area = $("#promptArea");
  if (!custom) {
    area.innerHTML = `<div class="sub">Loading default prompt…</div>`;
    try {
      const d = await ensureDefaultPrompt();
      area.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px"><span style="font-weight:600">🔒 ${esc(d.filename)} <span class="sub" style="font-weight:400">(system default)</span></span><a href="#" id="viewPrompt" style="color:#4361ee;font-weight:600">View full ↗</a></div>
        <pre class="ro" id="defPre" style="max-height:220px">${esc(d.text)}</pre><div class="sub" style="margin:8px 0 0">Read-only. Switch to <b>Custom prompt</b> to edit.</div>`;
      $("#viewPrompt").onclick = (e) => { e.preventDefault(); const p = $("#defPre"); const full = p.style.maxHeight === "none"; p.style.maxHeight = full ? "220px" : "none"; e.target.textContent = full ? "View full ↗" : "Collapse ↙"; };
    } catch (e) { area.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
    return;
  }
  const tpls = JSON.parse(localStorage.getItem("atg_prompt_templates") || "{}");
  area.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px"><label style="margin:0">Your prompt</label>
    ${Object.keys(tpls).length ? `<select id="tplSel"><option value="">Load saved template…</option>${Object.keys(tpls).map((k) => `<option>${esc(k)}</option>`).join("")}</select>` : ""}</div>
    <textarea id="customPrompt" rows="12" class="mono" style="font-size:12px;margin-top:6px;border:1.5px solid #4361ee" placeholder="e.g. Focus on NEGATIVE and BOUNDARY tests for…">${esc(S.run.custom_prompt || "")}</textarea>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;flex-wrap:wrap"><span>
      <button class="btn g sm" id="loadFile">📂 Load from file</button> <button class="btn g sm" id="saveTpl">💾 Save as template</button> <button class="btn g sm" id="resetDef">↺ Reset to default</button>
      <input type="file" id="promptFile" accept=".md,.txt,text/plain" class="hidden"></span><span class="sub" style="margin:0" id="pCount"></span></div>
    <div class="note">ℹ Test cases will be generated using your custom prompt. If it doesn't contain the “Test Case ID:” output template, the default template is appended automatically so results can be parsed.</div>`;
  const ta = $("#customPrompt"); const cnt = () => ($("#pCount").textContent = `${ta.value.length.toLocaleString()} / 50,000 chars`); cnt();
  ta.oninput = () => { cnt(); S.run.custom_prompt = ta.value; };
  $("#loadFile").onclick = () => $("#promptFile").click();
  $("#promptFile").onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { ta.value = rd.result; ta.oninput(); }; rd.readAsText(f); };
  $("#saveTpl").onclick = () => { const n = prompt("Template name:"); if (!n) return; tpls[n] = ta.value; localStorage.setItem("atg_prompt_templates", JSON.stringify(tpls)); toast("Template saved in this browser"); renderPromptArea(true); };
  $("#resetDef").onclick = async () => { const d = await ensureDefaultPrompt(); ta.value = d.text; ta.oninput(); };
  const sel = $("#tplSel"); if (sel) sel.onchange = () => { if (sel.value) { ta.value = tpls[sel.value]; ta.oninput(); } };
}
async function loadTokens() {
  const c = $("#tokenCard"); if (!c) return;
  try {
    const j = await api("/api/usage"); const last = j.last || {}; const t = (j.usage && j.usage.today) || null;
    c.innerHTML = `<h3>Token Usage</h3>
      <div class="sub" style="margin:0 0 4px">Last run${last.model ? " · " + esc(last.model_name || last.model) : ""}</div>
      <div class="row"><div><div class="sub" style="margin:0">Total tokens</div><div class="big">${fmt(last.total_tokens)}</div></div>
      <div><div class="sub" style="margin:0">Input / Output</div><div class="big" style="font-size:18px">${fmt(last.input_tokens)} / ${fmt(last.output_tokens)}</div></div></div>
      <div style="border-top:1px solid #edf0f5;margin-top:12px;padding-top:10px"><div class="sub" style="margin:0 0 4px">Gemini today (reports/gemini_usage.json)</div>
      ${t ? `<div class="row"><div><div class="sub" style="margin:0">Requests</div><div class="big" style="font-size:18px">${fmt(t.requests_used)} <span class="sub">/ ${fmt(j.usage.daily_request_limit)}</span></div></div>
        <div><div class="sub" style="margin:0">Tokens</div><div class="big" style="font-size:18px">${fmt(t.tokens_used)}</div></div></div>
        <div class="bar" style="margin-top:8px"><div style="width:${Math.min(100, (t.tokens_used / j.usage.daily_token_limit) * 100).toFixed(1)}%"></div></div>
        <div class="sub" style="margin:4px 0 0">${fmt(t.tokens_left)} tokens left today</div>` : `<div class="muted">${j.usage && j.usage.available ? "No Gemini usage yet today." : "No usage file yet."}</div>`}</div>`;
  } catch (e) { c.innerHTML = `<h3>Token Usage</h3><div class="error">${esc(e.message)}</div>`; }
}

// ------------------------------------------------------------------ 3. REVIEW
/* viewReview / saveCases live in review.js (v6 Review UI) */
function reviewPanel(rv) {
  if (!rv) return "";
  if (rv.error) return `<div class="warn" style="margin:0 0 12px">AI Reviewer failed: ${esc(rv.error)}</div>`;
  const u = rv.usage || {};
  return `<div class="card" style="border-color:#c9d3ff;background:#f7f9ff"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <div><b>🤖 AI Reviewer result:</b> ${rv.test_cases.length} test cases (current table: ${S.cases.length})${u.total_tokens ? ` · ${fmt(u.total_tokens)} tokens` : ""}</div>
    <div><button class="btn g sm" id="showRev">View reviewer output</button> <button class="btn g sm" id="dismissRev">Dismiss</button> <button class="btn sm" id="applyRev" ${rv.test_cases.length ? "" : "disabled"}>Apply reviewed version</button></div></div>
    <pre id="revPre" class="hidden" style="margin-top:10px">${esc(rv.markdown)}</pre></div>`;
}
function bindReviewPanel(v) {
  const s = $("#showRev"); if (!s) return;
  s.onclick = () => $("#revPre").classList.toggle("hidden");
  $("#dismissRev").onclick = () => { S.run.review = null; $("#reviewPanel").innerHTML = ""; };
  $("#applyRev").onclick = () => guarded($("#applyRev"), async () => {
    if (S.localDirty && !confirm("Applying will replace your unsaved table edits. Continue?")) return;
    await api("/api/review/accept", { method: "POST" }); S.localDirty = false; toast("Reviewed version applied"); viewReview(v); renderNav();
  });
}

// ------------------------------------------------------------------ 4. QTEST
function viewQtest(v) {
  v.innerHTML = `<h1>qTest Upload</h1><div class="sub">Push reviewed test cases to qTest Manager and track traceability</div>
    <div class="tabs"><button data-tab="upload" class="${S.qtab === "upload" ? "a" : ""}">⬆ Upload</button><button data-tab="rtm" class="${S.qtab === "rtm" ? "a" : ""}">📊 Requirements Traceability (RTM)</button></div><div id="qbody"></div>`;
  $$(".tabs button", v).forEach((b) => (b.onclick = () => { S.qtab = b.dataset.tab; viewQtest(v); }));
  (S.qtab === "upload" ? qUpload : qRtm)($("#qbody"));
}
async function qUpload(el) {
  const r = S.run; let d = {};
  try { d = await api("/api/qtest/defaults"); } catch (e) { toast(e.message, true); }
  const up = r.upload;
  el.innerHTML = `${d.configured ? "" : '<div class="warn" style="margin:0 0 12px">qTest Base URL / Token are not configured. Add them in <a href="#settings">Settings</a>.</div>'}
  <div class="row"><div><div class="card">
    <label style="margin-top:0">Project ID</label><input id="qProject" value="${esc(up ? up.project_id : d.project_id || "")}" style="width:100%">
    <label>Requirement ID (to link test cases)</label><input id="qReq" value="${esc(up ? up.requirement_id : d.requirement_id || "")}" style="width:100%">
    <label>Module</label>
    <div class="seg" id="modSeg"><button data-m="new" class="a">Create new module</button><button data-m="existing">Use existing module ID</button></div>
    <div id="modNew"><label>New module name</label><input id="qModName" value="${esc(r.story_id || "")}" placeholder="e.g. MTG-1427" style="width:100%">
      <label>Parent Module ID</label><input id="qParent" value="${esc(d.parent_module_id || "")}" style="width:100%"></div>
    <div id="modExisting" class="hidden"><label>Existing Module ID</label><input id="qModId" style="width:100%" placeholder="numeric module id"></div>
    <div style="margin-top:14px"><button class="btn g" id="previewBtn">👁 Preview payload</button> <button class="btn" id="uploadBtn">⬆ Confirm Upload (${(r.test_cases || []).length})</button></div></div>
    <div class="card" id="resultCard">${uploadSummary(up)}</div></div>
    <div><div class="card"><h3>Payload Preview</h3><div id="payload">${S.payloadPreview ? payloadHtml(S.payloadPreview) : '<div class="muted">Click “Preview payload” to build the qTest JSON from the saved Excel (nothing is sent).</div>'}</div></div></div></div>
  ${nextBar("qtest", null, "")}`;
  let modMode = "new";
  $$("#modSeg button").forEach((b) => (b.onclick = () => { modMode = b.dataset.m; $$("#modSeg button").forEach((x) => x.classList.toggle("a", x === b)); $("#modNew").classList.toggle("hidden", modMode !== "new"); $("#modExisting").classList.toggle("hidden", modMode === "new"); }));
  $("#previewBtn").onclick = () => guarded($("#previewBtn"), async () => { const j = await api("/api/qtest/preview", { method: "POST", body: { module_id: modMode === "existing" ? $("#qModId").value : "" } }); S.payloadPreview = j; $("#payload").innerHTML = payloadHtml(j); renderNav(); });
  $("#uploadBtn").onclick = () => {
    const body = { project_id: $("#qProject").value, requirement_id: $("#qReq").value, parent_module_id: $("#qParent").value,
      module_id: modMode === "existing" ? $("#qModId").value : "", module_name: modMode === "new" ? $("#qModName").value : "" };
    if (modMode === "existing" && !/^\d+$/.test(body.module_id.trim())) return toast("Enter a numeric Module ID", true);
    modal(`<h1>Upload to qTest?</h1><div class="sub" style="margin:6px 0 14px">${(r.test_cases || []).length} test cases will be created in project <b>${esc(body.project_id || "(from .env)")}</b>${modMode === "new" ? ` under a new module <b>${esc(body.module_name || r.story_id || "AI Generated Test Cases")}</b>` : ` in module <b>${esc(body.module_id)}</b>`}${body.requirement_id ? ` and linked to requirement <b>${esc(body.requirement_id)}</b>` : ""}.</div>
      ${up ? '<div class="warn">This story was already uploaded in this run. Uploading again will create duplicates in qTest.</div>' : ""}
      <div style="text-align:right;margin-top:16px"><button class="btn g" id="mCancel">Cancel</button> <button class="btn" id="mOk">Upload</button></div>`);
    $("#mCancel").onclick = closeModal;
    $("#mOk").onclick = () => guarded($("#mOk"), async () => {
      closeModal(); $("#resultCard").innerHTML = `<h3>Uploading…</h3><div class="bar ind"><div></div></div>`;
      try { await api("/api/qtest/upload", { method: "POST", body }); toast("Upload finished"); }
      catch (e) { $("#resultCard").innerHTML = `<h3>Upload failed</h3><div class="error">${esc(e.message)}</div>`; throw e; }
      $("#resultCard").innerHTML = uploadSummary(S.run.upload); renderNav(); bindNextState();
    });
  };
}
function payloadHtml(j) {
  const p = j.payloads || []; const ids = (S.run.test_cases || []).map((t) => t.id);
  setTimeout(() => { const t = $("#plToggle"); if (t) t.onclick = () => { const all = $$("#plList details"); const open = !all.every((d) => d.open); all.forEach((d) => (d.open = open)); t.textContent = open ? "Collapse all" : "Expand all"; }; }, 0);
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 6px"><span class="sub" style="margin:0"><b>${p.length}</b> payloads · POST …/test-cases/ · showing all</span><button class="btn g sm" id="plToggle">Expand all</button></div>
    <div id="plList" class="pl-list">${p.map((x, i) => `<details ${i === 0 ? "open" : ""}><summary><b>#${i + 1}</b> ${esc(ids[i] || "")} · ${esc(x.name)} <span class="sub" style="margin:0">(${(x.test_steps || []).length} steps)</span></summary><pre>${esc(JSON.stringify(x, null, 2))}</pre></details>`).join("")}</div>`;
}
function uploadSummary(up) {
  if (!up) return `<h3>Results Summary</h3><div class="muted">Not uploaded yet.</div>`;
  const pct = up.total ? Math.round((up.created / up.total) * 100) : 0; const failed = up.items.filter((i) => i.status === "Failed");
  return `<h3>Results Summary</h3><div class="big" style="color:${failed.length ? "#a36b00" : "#12a150"}">${up.created} / ${up.total} created</div>
    <div class="bar" style="margin:8px 0"><div style="width:${pct}%;background:#12a150"></div></div>
    <div>Module: <b>${esc(up.module_name || "")}</b> (${esc(up.module_id)})${up.module_created ? ' <span class="pill b">new</span>' : ""}</div>
    <div style="margin-top:6px">Requirement link: ${up.link && up.link.ok ? `<span class="pill">Linked to ${esc(up.requirement_id)} ✓</span>` : `<span class="pill r">Not linked</span> <span class="sub">${esc((up.link && up.link.message) || "")}</span>`}</div>
    ${failed.map((f) => `<div style="margin-top:6px">${esc(f.tc_id)}: <span class="pill r">Failed</span> <span class="sub">${esc(f.error)}</span></div>`).join("")}
    <div style="margin-top:10px"><button class="btn g sm" onclick="S.qtab='rtm';render()">Open RTM →</button></div>`;
}
async function qRtm(el) {
  el.innerHTML = `<div class="sub">Loading RTM…</div>`;
  let j; try { j = await api("/api/qtest/rtm"); } catch (e) { el.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  const rows = j.rtm || [], acs = j.ac_list || [], up = j.upload; const r = S.run;
  const covered = new Set(rows.map((x) => x.ac_id).filter(Boolean));
  const cnt = (f) => rows.filter(f).length;
  const created = cnt((x) => x.upload_status === "Created"), failed = cnt((x) => x.upload_status === "Failed"), linked = cnt((x) => x.link_status === "Linked");
  const stat = (val, t, c = "#1e2433") => `<div class="card stat"><div class="sub">${t}</div><div class="big" style="color:${c}">${val}</div></div>`;
  const q = S.rtmSearch.toLowerCase();
  const filt = rows.filter((x) => ({ all: true, created: x.upload_status === "Created", failed: x.upload_status === "Failed", linked: x.link_status === "Linked", notlinked: x.link_status !== "Linked" }[S.rtmFilter]))
    .filter((x) => !q || [x.tc_id, x.name, x.ac_id, x.ac_title, x.qtest_pid, x.qtest_id].join(" ").toLowerCase().includes(q));
  const chip = (k, l, n) => `<span class="chip ${S.rtmFilter === k ? "a" : ""}" data-f="${k}">${l} (${n})</span>`;
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px">
      <div class="sub" style="margin:0">Story <b>${esc(r.story_id || "LOCAL")}</b>${r.jira ? " “" + esc(r.jira.summary) + "”" : ""} → qTest Requirement <b>${esc((up && up.requirement_id) || "—")}</b>${up ? " · Project " + esc(up.project_id) : ""}</div>
      <div><button class="btn g" id="retryBtn" ${failed ? "" : "disabled"}>↻ Retry failed (${failed})</button> <button class="btn s" id="rtmXls" ${rows.length ? "" : "disabled"}>⬇ Export RTM (Excel)</button></div></div>
    <div class="row" style="margin-bottom:14px">${stat(`${acs.filter((a) => covered.has(a.id)).length} / ${acs.length}`, "ACs covered", "#12a150")}${stat(rows.length, "Test cases")}${stat(created, "Uploaded", "#12a150")}${stat(failed, "Failed", failed ? "#d33" : "#1e2433")}${stat(`${linked} / ${rows.length}`, "Linked", "#4361ee")}</div>
    <div class="card" style="padding:12px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap"><input id="rtmQ" placeholder="🔍 Search TC ID, name, AC, qTest ID…" value="${esc(S.rtmSearch)}" style="width:320px">
      <span>${chip("all", "All", rows.length)}${chip("created", "Created", created)}${chip("failed", "Failed", failed)}${chip("linked", "Linked", linked)}${chip("notlinked", "Not linked", rows.length - linked)}</span></div>
    <div class="tablewrap"><table><thead><tr><th>Jira Story ID</th><th>Acceptance Criteria</th><th>Generated TC ID</th><th>Test Case Name</th><th>qTest TC ID</th><th>qTest Internal ID</th><th>Upload Status</th><th>Link Status</th><th>Module</th></tr></thead><tbody>
    ${filt.map((x) => `<tr><td>${esc(x.story_id)}</td><td><select data-tc="${esc(x.tc_id)}" style="max-width:220px;padding:4px">${acs.map((a) => `<option value="${esc(a.id)}" ${a.id === x.ac_id ? "selected" : ""}>${esc(a.id)} ${esc(a.title.slice(0, 40))}</option>`).join("")}</select></td>
      <td>${esc(x.tc_id)}</td><td>${esc(x.name)}</td><td>${x.qtest_pid ? `<b style="color:#4361ee">${esc(x.qtest_pid)}</b>` : "—"}</td><td>${esc(x.qtest_id) || "—"}</td>
      <td>${x.upload_status === "Created" ? '<span class="pill">Created</span>' : x.upload_status === "Failed" ? `<span class="pill r" title="${esc(x.error)}">Failed</span>` : '<span class="pill gr">Not uploaded</span>'}</td>
      <td>${x.link_status === "Linked" ? '<span class="pill">Linked</span>' : '<span class="pill r">Not linked</span>'}</td><td>${esc(x.module) || "—"}</td></tr>`).join("") || '<tr><td colspan="9" class="muted">No rows.</td></tr>'}
    </tbody></table></div><div class="sub" style="margin:12px 0 0">Showing ${filt.length} of ${rows.length}${up ? " · Last upload " + esc(up.uploaded_at) : ""} · AC mapping is a keyword-based suggestion — adjust it with the dropdowns.</div></div>`;
  $("#rtmQ").oninput = (e) => { S.rtmSearch = e.target.value; clearTimeout(qRtm._t); qRtm._t = setTimeout(() => qRtm(el).then(() => { const i = $("#rtmQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 250); };
  $$(".chip", el).forEach((c) => (c.onclick = () => { S.rtmFilter = c.dataset.f; qRtm(el); }));
  $$("select[data-tc]", el).forEach((s) => (s.onchange = () => api("/api/qtest/rtm/mapping", { method: "PUT", body: { tc_id: s.dataset.tc, ac_id: s.value } }).then(() => toast("Mapping updated")).catch((e) => toast(e.message, true))));
  $("#rtmXls").onclick = () => download("/api/qtest/rtm/excel");
  $("#retryBtn").onclick = () => guarded($("#retryBtn"), async () => { await api("/api/qtest/retry_failed", { method: "POST" }); toast("Retry finished"); qRtm(el); renderNav(); });
}

// ------------------------------------------------------------------ SETTINGS
async function viewSettings(v) {
  v.innerHTML = `<h1>Settings</h1><div class="sub">Stored server-side in <span class="mono">ai_test_generator/.env</span>. Secrets are never sent back to the browser in full — leave a secret blank to keep the current value.</div><div id="sbody">Loading…</div>`;
  let j; try { j = await api("/api/settings"); } catch (e) { $("#sbody").innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  const groups = {}; j.fields.forEach((f) => (groups[f.group] = groups[f.group] || []).push(f));
  $("#sbody").innerHTML = Object.entries(groups).map(([g, fs]) => `<div class="card"><h3>${esc(g)}</h3><div class="row" style="flex-wrap:wrap">${fs.map((f) => `<div style="min-width:280px">
      <label>${esc(f.label)} ${f.secret ? (f.is_set ? '<span class="pill">set</span>' : '<span class="pill r">not set</span>') : ""}</label>
      <input data-key="${f.key}" ${f.secret ? 'type="password" autocomplete="new-password"' : ""} placeholder="${f.secret ? esc(f.value || "not set") : ""}" value="${f.secret ? "" : esc(f.value)}" style="width:100%">
      ${f.secret && f.is_set ? `<button class="btn g sm" data-clear="${f.key}" style="margin-top:6px">Clear</button>` : ""}</div>`).join("")}</div></div>`).join("") +
    `<button class="btn" id="saveSettings">Save Settings</button>`;
  $("#saveSettings").onclick = () => guarded($("#saveSettings"), async () => {
    const values = {}; $$("[data-key]").forEach((i) => { if (i.type !== "password" || i.value.trim()) values[i.dataset.key] = i.value; });
    const r = await api("/api/settings", { method: "PUT", body: { values } }); toast(`Saved (${r.changed.length} changed)`); viewSettings(v);
  });
  $$("[data-clear]").forEach((b) => (b.onclick = () => guarded(b, async () => { if (!confirm(`Clear ${b.dataset.clear}?`)) return; await api(`/api/settings/${b.dataset.clear}`, { method: "DELETE" }); viewSettings(v); })));
}

// ------------------------------------------------------------------ modal / logout / new run
function modal(html) { $("#modal").innerHTML = html; $("#modalBg").classList.add("open"); }
function closeModal() { $("#modalBg").classList.remove("open"); }
function unsavedSummary() {
  const r = S.run || {}; const parts = [];
  if (S.localDirty) parts.push("unsaved edits in the Review table");
  if (r.dirty && (r.test_cases || []).length) parts.push(`${r.test_cases.length} test cases not yet saved to Excel`);
  if ((r.test_cases || []).length && !r.upload) parts.push("test cases not uploaded to qTest");
  return parts;
}
function logoutDialog() {
  $("#userMenu").classList.remove("open");
  const u = unsavedSummary();
  modal(`<h1>Log out?</h1><div class="sub" style="margin:6px 0 14px">You'll return to the Welcome page and this run's data will be cleared.</div>
    ${u.length ? `<div class="warn" style="margin-bottom:18px">⚠ You have ${u.map(esc).join(", ")}${S.run.story_id ? " for " + esc(S.run.story_id) : ""}. They will be lost if you log out.</div>` : ""}
    <div style="text-align:right"><button class="btn g" id="mCancel">Cancel</button> <button class="btn r" id="mOk">Log out</button></div>`);
  $("#mCancel").onclick = closeModal;
  $("#mOk").onclick = async () => { try { await api("/api/session/logout", { method: "POST" }); } catch {} S.localDirty = false; window.location.href = "/welcome"; };
}
function newRunDialog() {
  const u = unsavedSummary();
  modal(`<h1>Start a new run?</h1><div class="sub" style="margin:6px 0 14px">Input, generated test cases and upload results of the current run will be cleared (files already saved in reports/ are kept).</div>
    ${u.length ? `<div class="warn" style="margin-bottom:18px">⚠ You have ${u.map(esc).join(", ")}.</div>` : ""}
    <div style="text-align:right"><button class="btn g" id="mCancel">Cancel</button> <button class="btn" id="mOk">Start new run</button></div>`);
  $("#mCancel").onclick = closeModal;
  $("#mOk").onclick = () => guarded($("#mOk"), async () => { await api("/api/run/new", { method: "POST" }); Object.assign(S, { localDirty: false, cases: [], inputMode: null, localText: "", localFile: null, payloadPreview: null, qtab: "upload" }); closeModal(); go("input"); });
}

// ------------------------------------------------------------------ boot
window.addEventListener("beforeunload", (e) => { if (S.localDirty) { e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("click", (e) => { if (!e.target.closest("#userBtn") && !e.target.closest("#userMenu")) $("#userMenu").classList.remove("open"); });
$("#userBtn").onclick = () => $("#userMenu").classList.toggle("open");
$("#logoutItem").onclick = logoutDialog;
$("#newRunBtn").onclick = newRunDialog;
$$("#userMenu [data-go]").forEach((d) => (d.onclick = () => { $("#userMenu").classList.remove("open"); go(d.dataset.go); }));
$$("#nav a").forEach((a) => (a.onclick = () => go(a.dataset.view)));
$("#modalBg").onclick = (e) => { if (e.target.id === "modalBg") closeModal(); };
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (h && h !== S.view) go(h); });
(async function boot() {
  try { await api("/api/state"); } catch (e) { return; }
  const h = location.hash.slice(1);
  S.view = h && (STEPS.includes(h) ? stepUnlocked(h) : (h === "settings" || h === "setup")) ? h : "input";
  render();
})();
