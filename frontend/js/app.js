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
async function go(view) {
  if (typeof view === "string" && view.startsWith("repo/case/")) { if (window.cpRoute) return window.cpRoute(view.slice(10)); view = "repo"; }
  if (S.mode === "batch") return batchGo(view);
  if (STEPS.includes(view) && !stepUnlocked(view)) { toast("Complete the previous step first.", true); return; }
  if (typeof autosaveFlush === "function" && typeof autosaveHasPending === "function" && autosaveHasPending()) {
    const r = await autosaveFlush({ reason: "navigate" });
    if (r === "cancel") return;
  }
  if (S.view === "review" && view !== "review" && S.localDirty && !confirm("You have unsaved edits in the Review table. Leave without saving?")) return;
  if (S.view === "review" && view !== "review") S.localDirty = false;
  if (typeof window.rqNavGuard === "function" && S.view === "requirements" && view !== "requirements") {
    if (window.rqNavGuard() === false) return;
  }
  if (typeof window.trNavGuard === "function" && (S.view === "repo" || String(S.view).startsWith("repo/")) && !(view === "repo" || String(view).startsWith("repo/"))) {
    if (window.trNavGuard() === false) return;
  }
  S.view = view; location.hash = view; render();
}
function renderNav() {
  $$("#nav a").forEach((a) => {
    const v = a.dataset.view;
    const reqViews = ["requirements", "projects", "trace"];
    a.classList.toggle("a", v === S.view || (v === "dashboard" && String(S.view).startsWith("dashboard/")) || (v === "tokens" && String(S.view).split("?")[0].startsWith("tokens")) || (v === "requirements" && reqViews.includes(S.view)));
    a.classList.toggle("done", STEPS.includes(v) && stepDone(v));
    a.classList.toggle("locked", STEPS.includes(v) && !stepUnlocked(v));
  });
  const r = S.run || {};
  const g = $('#nav a[data-view="generate"]'); if (g) { const sk = r.imported && !r.markdown; g.classList.toggle("skipped", !!sk); g.title = sk ? "Skipped — test cases were uploaded from Excel" : ""; }
  if (S.mode === "batch") { clearTimeout(renderNav._b); renderNav._b = setTimeout(() => S.mode === "batch" && refreshBatch().then(() => { if (S.mode === "batch") { renderBatchNav(); bRenderList(); } }).catch(() => {}), 150); return; }
  $("#runinfo").innerHTML = `Run <b>${esc(r.rid || "(not saved yet)")}</b><br>Story <b>${esc(r.story_id || "—")}</b><br>${(r.test_cases || []).length} test cases${r.imported && r.import_info ? '<br>📄 from ' + esc(r.import_info.filename) : ""}${r.dirty || S.localDirty ? '<br><span style="color:#f5c26b">● unsaved changes</span>' : ""}`;
}
function nextBar(cur, nextView, nextLabel, extraLeft = "") {
  const ok = stepDone(cur);
  return `<div class="footer-nav"><div>${extraLeft}</div>${nextView ? `<button class="btn" id="nextBtn" ${ok ? "" : "disabled"} title="${ok ? "" : "Complete this step first"}">${nextLabel} →</button>` : ""}</div>`;
}
function bindNext(nextView) { const b = $("#nextBtn"); if (b) b.onclick = () => go(nextView); }

// Ticket / Story ID pill next to the page title on every step page (hidden when unknown)
function ensureTicketPill() {
  if (!STEPS.includes(S.view)) return;
  const h = $("#view h1"); if (!h) return;
  const id = ((S.run || {}).story_id || "").trim();
  let p = h.querySelector(".ticket-pill");
  if (!id) { if (p) p.remove(); return; }
  if (!p) { p = document.createElement("span"); p.className = "ticket-pill"; h.appendChild(p); }
  const t = "Ticket " + id; if (p.textContent !== t) { p.textContent = t; p.title = "Ticket / Story ID"; }
}
new MutationObserver(() => ensureTicketPill()).observe(document.getElementById("view"), { childList: true, subtree: true });
function render() {
  if (S.mode === "batch") return renderBatch();
  renderNav();
  const v = $("#view");
  if (String(S.view).startsWith("dashboard")) return window.viewDashboard ? viewDashboard(v) : viewInput(v);
  if (S.view === "requirements" || S.view === "projects" || S.view === "trace") {
    if (S.view === "projects" && window.RQ) window.RQ.view = "projects";
    if (S.view === "trace" && window.RQ) window.RQ.view = "trace";
    if (S.view === "requirements" && window.RQ && window.RQ.view === "projects") window.RQ.view = "list";
    return window.viewRequirements ? viewRequirements(v) : viewInput(v);
  }
  const viewKey = String(S.view || "").split("?")[0].split("/")[0];
  ({ dashboard: (v) => viewDashboard(v), history: (v) => viewHistory(v), compare: (v) => viewCompare(v), tokens: (v) => viewTokens(v), prompts: (v) => viewPrompts(v), repo: (v) => viewRepo(v), runs: (v) => viewRuns(v), requirements: (v) => viewRequirements(v), projects: (v) => viewProjects(v), trace: (v) => viewTraceability(v), setup: viewSetup, input: viewInput, generate: viewGenerate, review: viewReview, qtest: viewQtest, settings: viewSettings }[viewKey] || viewInput)(v);
}


// ------------------------------------------------------------------ 0. SETUP CHECKLIST (Enh 02)
async function viewSetup(v) {
  v.innerHTML = `<h1>Setup checklist</h1><div class="sub">Check your configuration before starting a run.</div><div id="setupBody" class="sub">Loading…</div>`;
  let j; try { j = await api("/api/setup/status"); } catch (e) { $("#setupBody").innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  const it = j.items; const done = it.filter((x) => x.ok).length; const reqOk = it.filter((x) => x.required).every((x) => x.ok);
  const icon = { gemini_key: "🔑", gemini_model: "🤖", jira: "🧩", qtest: "🧪", default_prompt: "📝" };
  const pct = (done / it.length) * 100;
  $("#setupBody").outerHTML = `<div class="card setup-top"><div class="ring" style="background:conic-gradient(#4361ee ${pct}%,#e5e7eb 0)"><div><b>${done}/${it.length}</b><span>configured</span></div></div>
      <div><h3 style="margin:0 0 4px">Let's get you set up</h3><div class="sub" style="margin:0">Required items must be configured to generate. Optional items unlock Jira input and qTest upload.</div></div></div>
    <div class="setup-grid">${it.map((x) => `<div class="card setup-item ${x.ok ? "ok" : "no"}" data-key="${x.key}"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:22px">${icon[x.key] || "⚙"}</span><span class="tag ${x.required ? "req" : "opt"}">${x.required ? "Required" : "Optional"}</span></div>
      <div class="si-name">${esc(x.label)}</div><div class="sub" style="margin:2px 0 8px">${esc(x.hint)}</div>
      <div class="si-st">${x.ok ? "✔ Set" : "⚠ Not set"}</div><a href="${x.key === "default_prompt" ? "#prompts" : "#settings"}" class="si-link" ${x.key === "default_prompt" ? 'data-prompt="1"' : ""}>${esc(x.link || "Open Settings →")}</a></div>`).join("")}</div>
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <span>${reqOk ? "✔ All required items are configured — you can start now." : '<b style="color:#a36b00">⚠ Configure the required Gemini settings before generating.</b>'} <span class="sub" style="margin:0">(Jira and qTest are optional: use Local text input and Save &amp; Download Excel without them.)</span></span>
      <button class="btn" id="startRun">Start run ▸</button></div><div id="recentRuns"></div>`;
  $("#startRun").onclick = () => go("input");
  $$(".si-link[data-prompt]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); if (typeof PT !== "undefined") PT.edit = { id: "default" }; go("prompts"); }));
  if (window.renderRecentRuns) renderRecentRuns($("#recentRuns"));
}

// ------------------------------------------------------------------ 1. INPUT
function viewInput(v) {
  const r = S.run; if (!S.inputMode) S.inputMode = r.source || (r.imported ? "excel" : "jira");
  const jira = r.jira;
  const seg = `<div class="seg"><button data-m="jira" class="${S.inputMode === "jira" ? "a" : ""}">Jira Story</button><button data-m="local" class="${S.inputMode === "local" ? "a" : ""}">Local text</button><button data-m="excel" class="${S.inputMode === "excel" ? "a" : ""}">⬆ Upload test cases (Excel)</button><button data-m="batch" class="bm-tab" title="Open the separate Batch workspace (multiple stories)">▦ Batch mode</button></div>`;
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
  } else if (S.inputMode === "excel") {
    body = `<div class="card">${seg}<div class="sub" style="margin:10px 0 0">Already have test cases? Upload an .xlsx and go straight to <b>Review</b> — Generate is skipped. You can still continue to qTest Upload.</div>
      <label>Story ID (optional, used for RTM / qTest module name)</label><input id="xlStory" value="${esc(r.story_id || "")}" placeholder="e.g. MTG-1427" style="width:240px"></div>
      <div class="card" id="xlRoot"></div>`;
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
  v.innerHTML = `<h1>Input Source</h1><div class="sub">${S.inputMode === "jira" ? "Fetch a Jira story and extract its acceptance criteria" : S.inputMode === "excel" ? "Import existing test cases from Excel and skip generation" : "Paste or upload a feature description"}</div>${body}${S.inputMode === "excel" ? "" : nextBar("input", "generate", "Continue to Generate")}`;
  if (S.inputMode === "excel") {
    $$(".seg button", v).forEach((b) => (b.onclick = () => { if (b.dataset.m === "batch") return guarded(b, enterBatch); S.inputMode = b.dataset.m; render(); }));
    uploadUI($("#xlRoot"), { storyId: () => $("#xlStory").value, done: () => { S.view = "review"; location.hash = "review"; render(); } });
    return;
  }
  $$(".seg button", v).forEach((b) => (b.onclick = () => { if (b.dataset.m === "batch") return guarded(b, enterBatch); S.inputMode = b.dataset.m; render(); }));
  bindNext("generate");
  const nb = $("#nextBtn"); if (nb && S.inputMode === "local") { nb.disabled = false; nb.onclick = () => guarded(nb, async () => { await saveLocalIfChanged(); if (!stepDone("input")) throw new Error("Enter a feature description first."); go("generate"); }); }
  if (S.inputMode === "jira") {
    const f = () => guarded($("#fetchBtn"), async () => { await api("/api/input/jira", { method: "POST", body: { story_id: $("#storyId").value } }); toast("Story fetched"); render(); });
    $("#fetchBtn").onclick = f; $("#storyId").onkeydown = (e) => { if (e.key === "Enter") f(); };
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
async function ensureDefaultPrompt() { if (true) { const j = await api("/api/prompt/default"); S.defaultPrompt = j; } return S.defaultPrompt; }
function genSrc() {
  const r = S.run; if (r.prompt_mode === "custom") return "custom";
  if (r.prompt_src === "templates" || r.prompt_src === "default") return r.prompt_src;
  const ids = r.template_ids || []; return ids.length && !(ids.length === 1 && ids[0] === "default") ? "templates" : "default";
}
function genTplIds() { const ids = S.run.template_ids || []; return ids.length ? ids : ["default"]; }
function genLabel(src) {
  if (src === "custom") return { btn: "Custom prompt", sum: "Custom prompt" };
  if (src === "default") return { btn: "Default prompt", sum: "Default prompt" };
  const ids = genTplIds(); const nm = (i) => (typeof ptName === "function" ? ptName(i) : i);
  return ids.length > 1 ? { btn: `${ids.length} templates`, sum: `${ids.length} templates (${ids.map(nm).join(", ")})` } : { btn: `template “${nm(ids[0])}”`, sum: `Template: ${nm(ids[0])}` };
}
async function viewGenerate(v) {
  if (typeof ptLoad === "function" && !(PT && PT.d)) { try { await ptLoad(); } catch (e) { } }
  if (S.view !== "generate") return;
  const r = S.run; const src = genSrc(); const custom = src === "custom";
  const selModel = r.model || (typeof defaultProvider === "function" ? defaultProvider() : "gemini");
  const L = genLabel(src); const lbl = custom ? "Custom" : "Default";
  v.innerHTML = `<h1>Generate Test Cases</h1><div class="sub">${r.story_id ? "Story " + esc(r.story_id) + " · " : ""}${r.source === "jira" ? "Jira input" : "Local input"} · ${r.feature_text.length.toLocaleString()} characters of requirements loaded</div>
  <div class="row"><div style="flex:1.5"><div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
      <div><label style="margin-top:0">Prompt source</label><div class="seg" id="promptSeg"><button data-p="default" class="${src === "default" ? "a" : ""}">Default prompt</button><button data-p="templates" class="${src === "templates" ? "a" : ""}">Templates</button><button data-p="custom" class="${custom ? "a" : ""}">Custom prompt</button></div></div>
      <div><label style="margin-top:0">Provider</label><select id="model">
        <option value="gemini" ${selModel === "gemini" ? "selected" : ""}>Gemini</option>
        <option value="grok" ${selModel === "grok" ? "selected" : ""}>Grok</option>
        <option value="groq" ${selModel === "groq" ? "selected" : ""}>Groq</option>
        <option value="claude" ${selModel === "claude" ? "selected" : ""}>Claude</option>
        <option value="openai" ${selModel === "openai" ? "selected" : ""}>OpenAI</option>
        <option value="codex" ${selModel === "codex" ? "selected" : ""}>Codex (OpenAI)</option>
        <option value="ollama" ${selModel === "ollama" ? "selected" : ""}>Ollama (local)</option></select></div>
      <div><label style="margin-top:0">Model</label><select id="genModel">${typeof tcModelOpts === "function" ? tcModelOpts(selModel, r.model_name || "") : `<option value="">${esc(r.model_name || "Settings / env default")}</option>`}</select></div></div>
    <div id="genEst"></div>
    <div id="promptArea"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid #edf0f5;gap:10px;flex-wrap:wrap">
      <label class="sw" style="margin:0;text-transform:none;font-size:13px;color:#1e2433;font-weight:400"><input type="checkbox" id="runRev" ${r.run_reviewer ? "checked" : ""}><span class="t"></span>Also run AI Reviewer after generation</label>
      <button class="btn" id="genBtn" style="padding:11px 20px">✨ Generate with ${esc(L.btn)}</button></div>
    <div id="genStatus"></div>
  </div></div>
  <div style="flex:.8"><div class="card" id="tokenCard"><h3>Token Usage</h3><div class="sub">Loading…</div></div>
    ${(r.test_cases || []).length ? `<div class="note" style="margin:0 0 14px">ℹ This run already has ${(r.test_cases || []).length} test cases. Edit the Input and click Generate again to regenerate them.</div>` : ""}
    <div class="card"><h3>Run summary</h3><div class="sub" style="margin:0;line-height:1.8">Prompt: <b style="color:#1e2433" id="sumPrompt">${esc(L.sum)}</b><br>Model: ${esc(r.model ? r.model + (r.model_name ? " · " + r.model_name : "") : "Settings default (" + selModel + ")") }<br>AI Reviewer: ${r.run_reviewer ? '<b style="color:#12a150">On</b>' : "Off"}<br>Test cases: <b style="color:#1e2433">${(r.test_cases || []).length}</b></div></div></div></div>
  ${nextBar("generate", "review", "Continue to Review")}`;
  bindNext("review");
  $$("#promptSeg button").forEach((b) => (b.onclick = async () => {
    saveCustomDraft(); const p = b.dataset.p;
    S.run.prompt_mode = p === "custom" ? "custom" : "default";
    if (p !== "custom") {
      S.run.prompt_src = p;
      if (p === "templates" && !(S.run.template_ids || []).some((i) => i !== "default")) {
        const ts = (PT.d && PT.d.templates) || []; const pick = PT.d && PT.d.default_id !== "default" ? PT.d.default_id : (ts.find((t) => t.id !== "default") || {}).id;
        if (pick) S.run.template_ids = [pick];
      }
    }
    viewGenerate(v);
  }));
  $("#model").onchange = (e) => { S.run.model = e.target.value; const gm = $("#genModel"); if (gm && window.tcModelOpts) { gm.innerHTML = tcModelOpts(e.target.value, ""); } if (window._genEstRefresh) _genEstRefresh(); };
  if ($("#genModel")) $("#genModel").onchange = () => { S.run.model_name = $("#genModel").value; if (window._genEstRefresh) _genEstRefresh(); };
  if (window.bindLiveEstimate) {
    bindLiveEstimate({
      el: "#genEst", kind: "generate", compose: true, expected: 1800,
      provider: () => $("#model").value,
      model: () => ($("#genModel") && $("#genModel").value) || "",
      prompt_mode: () => (S.run && S.run.prompt_mode) || "default",
      custom_prompt: () => (S.run && S.run.custom_prompt) || "",
      template_ids: () => (typeof genSrc === "function" && genSrc() === "templates" && typeof genTplIds === "function") ? genTplIds() : undefined,
      run_reviewer: () => !!( $("#runRev") && $("#runRev").checked ),
    }).then((fn) => { window._genEstRefresh = fn; });
  }
  $("#runRev").onchange = (e) => { S.run.run_reviewer = e.target.checked; if (window._genEstRefresh) _genEstRefresh(); };
  renderPromptArea(custom, src);
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
    const timer = setInterval(() => { const e = $("#elapsed"); if (e) e.textContent = `Generating${$("#model") && $("#model").value === "ollama" ? " with Ollama (local), this can take a few minutes" : ""}${S.run.run_reviewer ? " + reviewing" : ""}… ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
    try {
      const j = await api("/api/generate", { method: "POST", body: { model: $("#model").value, model_name: ($("#genModel") && $("#genModel").value) || "", prompt_mode: S.run.prompt_mode, custom_prompt: S.run.custom_prompt, run_reviewer: $("#runRev").checked, template_ids: src === "templates" ? genTplIds() : ["default"] } });
      S.localDirty = false; S.cases = []; if (typeof RV !== "undefined") { RV.open.clear(); RV.sel.clear(); RV.page = 0; }
      let msg = `<div class="note">✅ Generated <b>${j.count}</b> test cases in ${Math.round((Date.now() - t0) / 1000)}s.${j.template_appended ? " (Required output template was appended to your custom prompt.)" : ""}</div>`;
      if (j.review) msg += j.review.error ? `<div class="warn">AI Reviewer failed: ${esc(j.review.error)}</div>` : `<div class="note">🤖 AI Reviewer produced ${j.review.test_cases.length} test cases — compare and apply them on the Review step.</div>`;
      await viewGenerate(v); const gs = $("#genStatus"); if (gs) gs.innerHTML = msg;
    } catch (e) { st.innerHTML = `<div class="error">${esc(e.message)}</div>`; throw e; }
    finally { clearInterval(timer); renderNav(); }
  });
}
function saveCustomDraft() { const ta = $("#customPrompt"); if (ta) S.run.custom_prompt = ta.value; }
async function renderTemplatesArea(area) {
  const ids = genTplIds();
  area.innerHTML = `<div style="margin:12px 0 6px"><label style="margin:0 0 4px">Prompt templates (one or more)</label><div id="genTplSel"></div>
    <div class="sub" style="margin:6px 0" id="genTplInfo">${ids.length > 1 ? `${ids.length} templates → the model is called ${ids.length}× and the results are merged (each case tagged with its template).` : ""}</div>
    <div style="display:flex;justify-content:flex-end"><a href="#prompts" id="genTplManage" style="color:#4361ee;font-weight:600">✎ Manage templates →</a></div></div>
    <div id="genTplPrev"><div class="sub">Loading template prompt…</div></div>`;
  $("#genTplManage").onclick = (e) => { e.preventDefault(); go("prompts"); };
  ptMulti($("#genTplSel"), ids, (n) => { S.run.template_ids = n; viewGenerate($("#view")); });
  try {
    await api("/api/templates/select", { method: "POST", body: { ids } });
    const j = await api("/api/templates/selection");
    const box = $("#genTplPrev"); if (!box || S.view !== "generate") return;
    const ps = j.prompts;
    box.innerHTML = (ps.length > 1 ? `<div class="seg" id="genTplTabs" style="margin:4px 0 6px">${ps.map((p, i) => `<button data-i="${i}" class="${i ? "" : "a"}">📝 ${esc(p.name)}</button>`).join("")}</div>` : `<div style="font-weight:600;margin:4px 0 6px">📝 ${esc(ps[0].name)} <span class="sub" style="font-weight:400">(filled with this run's input)</span></div>`)
      + `<div style="text-align:right;margin:0 0 4px"><a href="#" id="viewPrompt" style="color:#4361ee;font-weight:600">View full ↗</a></div><pre class="ro" id="tplPre" style="max-height:220px">${esc(ps[0].prompt)}</pre>
      <div class="sub" style="margin:8px 0 0">Read-only preview. Edit templates on the <b>Prompt templates</b> page.</div>`;
    $$("#genTplTabs button").forEach((b) => (b.onclick = () => { $$("#genTplTabs button").forEach((x) => x.classList.toggle("a", x === b)); $("#tplPre").textContent = ps[+b.dataset.i].prompt; }));
    $("#viewPrompt").onclick = (e) => { e.preventDefault(); const p = $("#tplPre"); const full = p.style.maxHeight === "none"; p.style.maxHeight = full ? "220px" : "none"; e.target.textContent = full ? "View full ↗" : "Collapse ↙"; };
  } catch (e) { const box = $("#genTplPrev"); if (box) box.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}
async function renderPromptArea(custom, src) {
  const area = $("#promptArea");
  if (src === "templates") return renderTemplatesArea(area);
  if (!custom) {
    area.innerHTML = `<div class="sub">Loading default prompt…</div>`;
    try {
      const d = await ensureDefaultPrompt();
      area.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px"><span style="font-weight:600">🔒 ${esc(d.filename)} <span class="sub" style="font-weight:400">(Default template${d.modified ? " · edited" : ""})</span></span><a href="#" id="viewPrompt" style="color:#4361ee;font-weight:600">View full ↗</a></div>
        <pre class="ro" id="defPre" style="max-height:220px">${esc(d.text)}</pre><div class="sub" style="margin:8px 0 0">Read-only. Switch to <b>Custom prompt</b> to edit, or edit the <a href="#prompts" id="editDefTpl" style="color:#4361ee">Default template</a>.</div>`;
      $("#editDefTpl").onclick = (e) => { e.preventDefault(); if (typeof PT !== "undefined") PT.edit = { id: "default" }; go("prompts"); };
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
  ta.oninput = () => { cnt(); S.run.custom_prompt = ta.value; clearTimeout(viewGenerate._est); viewGenerate._est = setTimeout(() => { if (window._genEstRefresh) _genEstRefresh(); }, 400); };
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
      <div style="border-top:1px solid #edf0f5;margin-top:12px;padding-top:10px"><div class="sub" style="margin:0 0 4px">Gemini local quota today (app tracker — not other providers)</div>
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
    <div><div class="card pl-card"><h3>Payload Preview</h3><div id="payload">${S.payloadPreview ? payloadHtml(S.payloadPreview) : '<div class="muted">Click “Preview payload” to build the qTest JSON from the saved Excel (nothing is sent).</div>'}</div></div></div></div>
  ${nextBar("qtest", null, "")}`;
  let modMode = "new";
  $$("#modSeg button").forEach((b) => (b.onclick = () => { modMode = b.dataset.m; $$("#modSeg button").forEach((x) => x.classList.toggle("a", x === b)); $("#modNew").classList.toggle("hidden", modMode !== "new"); $("#modExisting").classList.toggle("hidden", modMode === "new"); }));
  $("#previewBtn").onclick = () => guarded($("#previewBtn"), async () => { const j = await api("/api/qtest/preview", { method: "POST", body: { module_id: modMode === "existing" ? $("#qModId").value : "" } }); S.payloadPreview = j; PL.page = 0; $("#payload").innerHTML = payloadHtml(j); renderNav(); });
  $("#uploadBtn").onclick = () => (window.covBeforeUpload || ((f) => f()))(() => {
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
  });
}
function jsonHl(obj) {
  return esc(JSON.stringify(obj, null, 2)).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, lit, num) => str ? (colon ? `<span class="jk">${str}</span>${colon}` : `<span class="js">${str}</span>`) : lit ? `<span class="jl">${lit}</span>` : `<span class="jn">${num}</span>`);
}
const PL = { page: 0, size: 25 };
function payloadHtml(j) {
  const p = j.payloads || []; const ids = (S.run.test_cases || []).map((t) => t.id);
  const pages = Math.max(1, Math.ceil(p.length / PL.size)); if (PL.page >= pages) PL.page = pages - 1;
  const start = PL.page * PL.size; const slice = p.slice(start, start + PL.size);
  setTimeout(() => {
    const box = $("#payload"); if (!box) return;
    const t = $("#plToggle"); if (t) t.onclick = () => { const all = $$("#plList details"); const open = !all.every((d) => d.open); all.forEach((d) => (d.open = open)); t.textContent = open ? "Collapse all" : "Expand all"; };
    const c = $("#plCopy"); if (c) c.onclick = async () => { const txt = JSON.stringify(p, null, 2); try { await navigator.clipboard.writeText(txt); } catch { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } toast(`Copied all ${p.length} payloads as JSON`); };
    $$("[data-plp]", box).forEach((x) => (x.onclick = () => { PL.page = +x.dataset.plp; box.innerHTML = payloadHtml(j); $("#plList").scrollTop = 0; }));
  }, 0);
  const nums = []; for (let i = 0; i < pages; i++) nums.push(`<button class="btn g sm ${i === PL.page ? "pg-a" : ""}" data-plp="${i}">${i + 1}</button>`);
  const pager = p.length ? `<div class="rv-pager pl-pager"><span class="pg-info">Showing <b>${start + 1}–${Math.min(p.length, start + PL.size)}</b> of <b>${p.length}</b></span><span style="flex:1"></span>
    <button class="btn g sm" data-plp="${PL.page - 1}" ${PL.page ? "" : "disabled"}>‹ Prev</button>${nums.join("")}<button class="btn g sm" data-plp="${PL.page + 1}" ${PL.page < pages - 1 ? "" : "disabled"}>Next ›</button></div>` : "";
  return `<div class="pl-head"><span class="sub" style="margin:0"><b>${p.length}</b> payloads · POST …/test-cases/</span><span><button class="btn g sm" id="plCopy" title="Copies all ${p.length} payloads">📋 Copy JSON (all)</button> <button class="btn g sm" id="plToggle">Expand all</button></span></div>
    ${pager}<div id="plList" class="pl-list">${slice.map((x, k) => { const i = start + k; return `<details ${k === 0 ? "open" : ""}><summary><b>#${i + 1}</b> ${esc(ids[i] || "")} · ${esc(x.name)} <span class="sub" style="margin:0">(${(x.test_steps || []).length} steps)</span></summary><pre class="json">${jsonHl(x)}</pre></details>`; }).join("")}</div>`;
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
/* Tabbed Settings UI. All inputs stay in the DOM (hidden panes) so tab/provider
   switches never discard edits or wipe secret fields. Blank secrets are omitted
   on save (server keeps the existing key). Explicit Clear still DELETEs a key. */
const SET_AI = [
  { group: "Gemini", pid: "gemini", sub: "Cloud", note: null },
  { group: "Grok (xAI)", pid: "grok", sub: "Cloud", note: null },
  { group: "Groq", pid: "groq", sub: "Cloud · free tier", note: "groq" },
  { group: "Claude (Anthropic)", pid: "claude", sub: "Cloud", note: null },
  { group: "OpenAI", pid: "openai", sub: "Cloud · key shared", note: "openai" },
  { group: "Codex (OpenAI)", pid: "codex", sub: "Uses OpenAI key", note: "codex" },
  { group: "Ollama", pid: "ollama", sub: "Local", note: null },
];
const SET_INT = [
  { group: "Jira", lede: "Story fetch for the Input step" },
  { group: "qTest", lede: "Upload + RTM on the qTest step" },
  { group: "Zephyr Scale", lede: "Test case upload (coming soon)" },
];
const SET_PLACEHOLDERS = {
  ZEPHYR_BASE_URL: "https://api.zephyrscale.smartbear.com/v2/",
};
const SET_ST = { tab: "providers", provider: "Gemini", subtab: "connection", baseline: {}, prefs: { hist: "", dup: "" } };

function setFieldHtml(f) {
  const id = `sf_${f.key}`;
  const pill = f.secret ? (f.is_set ? ' <span class="pill">set</span>' : ' <span class="pill r">not set</span>') : "";
  const ph = f.secret ? esc(f.value || "not set") : esc(SET_PLACEHOLDERS[f.key] || "");
  const val = f.secret ? "" : esc(f.value);
  const clear = f.secret && f.is_set
    ? `<div class="clear-row"><button type="button" class="btn g sm" data-clear="${esc(f.key)}">Clear</button></div>` : "";
  const hint = f.secret
    ? `<div class="hint">Leave blank to keep the current value.</div>`
    : (f.key === "CODEX_MODEL"
      ? `<div class="hint">Optional. Falls back to OPENAI_MODEL, then the app’s legacy default.</div>` : "");
  return `<div class="set-field"><label for="${id}">${esc(f.label)}${pill}</label>
    <input id="${id}" data-key="${esc(f.key)}" data-secret="${f.secret ? "1" : "0"}" data-initial="${val}"
      ${f.secret ? 'type="password" autocomplete="new-password"' : 'type="text"'}
      placeholder="${ph}" value="${val}" style="width:100%">
    ${hint}${clear}</div>`;
}

function setGroupConfigured(fs) {
  return fs.some((f) => f.secret ? f.is_set : !!(f.value || "").trim());
}

function setCollectEnvValues() {
  const values = {};
  $$("#sbody [data-key]").forEach((i) => {
    if (i.type === "password") {
      if (i.value.trim()) values[i.dataset.key] = i.value;
    } else {
      values[i.dataset.key] = i.value;
    }
  });
  return values;
}

function setIsDirty() {
  let dirty = false;
  $$("#sbody [data-key]").forEach((i) => {
    if (i.dataset.secret === "1") {
      if (i.value.trim()) dirty = true;
    } else if ((i.value || "") !== (i.dataset.initial || "")) {
      dirty = true;
    }
  });
  const hl = $("#histLimit"), dt = $("#dupThr");
  if (hl && SET_ST.prefs.hist !== "" && hl.value !== SET_ST.prefs.hist) dirty = true;
  if (dt && SET_ST.prefs.dup !== "" && dt.value !== SET_ST.prefs.dup) dirty = true;
  return dirty;
}

function setUpdateDirty() {
  const el = $("#setDirty"); if (!el) return;
  if (setIsDirty()) { el.className = "dirty"; el.textContent = "● Unsaved changes"; }
  else { el.className = "clean"; el.textContent = "All changes saved"; }
}

function setShowTab(tab) {
  SET_ST.tab = tab;
  $$(".set-tabs button").forEach((b) => b.classList.toggle("a", b.dataset.tab === tab));
  $$(".set-pane").forEach((p) => p.classList.toggle("a", p.dataset.pane === tab));
}

function setShowProvider(name) {
  SET_ST.provider = name;
  $$(".set-pbtn").forEach((b) => {
    const on = b.dataset.provider === name;
    b.classList.toggle("a", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  $$(".set-prov").forEach((p) => p.classList.toggle("a", p.dataset.provider === name));
  setShowSubtab(SET_ST.subtab || "connection");
}
function setShowSubtab(sub) {
  SET_ST.subtab = sub || "connection";
  const pane = $$(".set-prov").find ? $$(".set-prov").filter((p) => p.classList.contains("a"))[0] : null;
  const host = document.querySelector(".set-prov.a") || pane;
  if (!host) return;
  $$(".set-subtabs button", host).forEach((b) => b.classList.toggle("a", b.dataset.sub === SET_ST.subtab));
  $$(".set-subpane", host).forEach((p) => {
    const on = p.dataset.sub === SET_ST.subtab;
    p.classList.toggle("a", on);
    p.hidden = !on;
  });
}

async function viewSettings(v) {
  v.innerHTML = `<h1>Settings</h1><div class="sub">API keys stay on the server (masked). Leave a secret blank to keep the current value. Stored in <span class="mono">ai_test_generator/.env</span>.</div><div id="sbody">Loading…</div>`;
  let j; try { j = await api("/api/settings"); } catch (e) { $("#sbody").innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  const groups = {}; j.fields.forEach((f) => (groups[f.group] = groups[f.group] || []).push(f));
  const aiNames = SET_AI.map((x) => x.group);
  if (!aiNames.includes(SET_ST.provider)) SET_ST.provider = aiNames[0];

  const plist = SET_AI.map((p) => {
    const fs = groups[p.group] || [];
    const ok = setGroupConfigured(fs);
    const pill = ok ? '<span class="pill">set</span>' : '<span class="pill r">not set</span>';
    const a = p.group === SET_ST.provider ? " a" : "";
    return `<button type="button" class="set-pbtn${a}" role="option" data-provider="${esc(p.group)}" aria-selected="${a ? "true" : "false"}">
      <span class="row1"><span class="nm">${esc(p.group)}</span>${pill}</span>
      <span class="sub">${esc(p.sub)}</span></button>`;
  }).join("");

  const details = SET_AI.map((p) => {
    const fs = groups[p.group] || [];
    const a = p.group === SET_ST.provider ? " a" : "";
    let lede = p.sub === "Local" ? "Runs on this machine via Ollama." : "Cloud provider.";
    let note = "";
    if (p.note === "openai") {
      lede = "Cloud provider · API key is also used by Codex (OpenAI).";
      note = `<div class="set-note"><b>Codex (OpenAI) note</b><br>Codex uses this same OpenAI API key. Set an optional Codex model ID under the <b>Codex (OpenAI)</b> provider in the list (falls back to OPENAI_MODEL, then the app’s legacy default).</div>`;
    } else if (p.note === "groq") {
      lede = "Cloud provider · fast hosted open models (Llama, etc.) via Groq’s OpenAI-compatible API.";
      note = `<div class="set-note"><b>Groq free tier</b><br>Free keys from console.groq.com have per-minute and per-day request/token limits. Rate-limited calls are retried up to 2 times; Model ID defaults to <span class="mono">llama-3.3-70b-versatile</span> when blank. Configure additional models and rates on the <b>Models</b> tab; set a daily cap on <b>Limits</b>.</div>`;
    } else if (p.note === "codex") {
      lede = "OpenAI family profile — uses the OpenAI API key (not a separate vendor). Not ChatGPT Plus / CLI subscription.";
      note = `<div class="set-note"><b>Shared key</b><br>API key is configured under <b>OpenAI</b>. Only the Codex model ID is set here.</div>`;
    }
    const sub = SET_ST.subtab || "connection";
    return `<div class="set-prov${a}" data-provider="${esc(p.group)}" data-pid="${esc(p.pid)}" ${a ? "" : 'hidden'}>
      <h2>${esc(p.group)}</h2><p class="lede">${lede}</p>
      <div class="set-subtabs" role="tablist" aria-label="Provider sections">
        <button type="button" data-sub="connection" class="${sub === "connection" ? "a" : ""}">Connection</button>
        <button type="button" data-sub="models" class="${sub === "models" ? "a" : ""}">Models</button>
        <button type="button" data-sub="limits" class="${sub === "limits" ? "a" : ""}">Limits</button>
      </div>
      <div class="set-subpane${sub === "connection" ? " a" : ""}" data-sub="connection" ${sub === "connection" ? "" : "hidden"}>
        ${fs.map(setFieldHtml).join("") || '<div class="sub">No fields for this provider.</div>'}
        ${note}
      </div>
      <div class="set-subpane${sub === "models" ? " a" : ""}" data-sub="models" ${sub === "models" ? "" : "hidden"}>
        <div class="tc-prov-models" data-pid="${esc(p.pid)}"></div>
      </div>
      <div class="set-subpane${sub === "limits" ? " a" : ""}" data-sub="limits" ${sub === "limits" ? "" : "hidden"}>
        <div class="tc-prov-limits" data-pid="${esc(p.pid)}"></div>
      </div>
    </div>`;
  }).join("");

  const intCards = SET_INT.map((g) => {
    const fs = groups[g.group] || [];
    const ok = setGroupConfigured(fs);
    const badge = ok ? '<span class="pill">configured</span>' : '<span class="pill r">not set</span>';
    const iid = "set-int-" + g.group.toLowerCase().replace(/\s+/g, "-");
    return `<div class="card" id="${esc(iid)}"><h2>${esc(g.group)} ${badge}</h2><div class="sub" style="margin:0 0 12px">${esc(g.lede)}</div>
      ${fs.map(setFieldHtml).join("")}</div>`;
  }).join("");

  // Any leftover groups (should be none) still rendered so fields are never dropped
  const known = new Set([...aiNames, ...SET_INT.map((g) => g.group)]);
  const extra = Object.keys(groups).filter((g) => !known.has(g));
  const extraHtml = extra.length
    ? `<div class="card" style="margin-top:14px"><h3>Other</h3>${extra.map((g) => `<h4>${esc(g)}</h4>${(groups[g] || []).map(setFieldHtml).join("")}`).join("")}</div>` : "";

  $("#sbody").innerHTML = `
    <div id="setErr" class="set-err" hidden></div>
    <div class="set-tabs" role="tablist" aria-label="Settings sections">
      <button type="button" role="tab" data-tab="providers" class="a" aria-selected="true">AI Providers</button>
      <button type="button" role="tab" data-tab="integrations" aria-selected="false">Integrations</button>
      <button type="button" role="tab" data-tab="preferences" aria-selected="false">Preferences</button>
    </div>
    <div class="set-pane a" data-pane="providers" role="tabpanel">
      <div class="set-ai">
        <div class="set-plist" role="listbox" aria-label="AI providers">${plist}</div>
        <div class="set-detail">${details}</div>
      </div>
    </div>
    <div class="set-pane" data-pane="integrations" role="tabpanel" hidden>
      <div class="set-int">${intCards}</div>${extraHtml}
    </div>
    <div class="set-pane" data-pane="preferences" role="tabpanel" hidden>
      <div class="card" id="histCard"><h3>🕘 Run history</h3>
        <label for="histLimit">Run history limit</label>
        <div class="row" style="align-items:center;gap:10px"><input id="histLimit" type="number" min="1" max="100" step="1" style="width:120px;flex:none"><button type="button" class="btn" id="saveHist" style="flex:none">Save limit</button><span class="sub" id="histHint" style="margin:0;flex:none"></span></div>
        <div class="sub" style="margin:8px 0 0">How many recent runs to keep on this browser (1–100, default 5). Lowering it removes only the oldest runs beyond the new limit; raising it keeps everything.</div></div>
      <div class="card" id="dupCard" style="margin-top:14px"><h3>≋ Duplicate detection</h3>
        <label for="dupThr">Similarity threshold (%)</label>
        <div class="row" style="align-items:center;gap:10px"><input id="dupThr" type="number" min="50" max="99" step="1" style="width:120px;flex:none"><button type="button" class="btn" id="saveDup" style="flex:none">Save threshold</button><span class="sub" id="dupHint" style="margin:0;flex:none"></span></div>
        <div class="sub" style="margin:8px 0 0">Test cases at or above this similarity are flagged as possible duplicates (50–99, default 80; 90%+ shown in red). Checked locally — no AI call.</div></div>
      <div class="card" id="asCard" style="margin-top:14px"><h3>💾 Auto Save</h3>
        <label class="row" style="align-items:center;gap:10px;font-weight:600"><input id="asToggle" type="checkbox" style="width:auto"> Enable Auto Save</label>
        <div class="sub" style="margin:8px 0 0">When on (the default), edits in the Review step, Requirements, and the Test Case Repo editor are saved automatically about 1.5 seconds after you stop typing. Manual Save buttons still work. Repo autosave updates the live case in place and does not create a new version on each tick — use Save draft / Save as Ready for that. Mid-typing invalid states (empty title, incomplete Jira key) are skipped until the form is valid.</div>
        <div class="sub" id="asHint" style="margin:8px 0 0"></div></div>
    </div>
    <div class="set-foot">
      <span id="setDirty" class="clean">All changes saved</span>
      <button type="button" class="btn" id="saveSettings">Save changes</button>
    </div>`;

  // Sync hidden attr with .a for a11y (provider panes)
  $$(".set-prov").forEach((p) => { if (!p.classList.contains("a")) p.hidden = true; else p.hidden = false; });
  $$(".set-pane").forEach((p) => { p.hidden = !p.classList.contains("a"); });
  if (window.voiceRenderSettings) voiceRenderSettings($('.set-pane[data-pane="preferences"]'));  // Voice input card (voice.js, browser-only prefs)
  if (window.helpRenderSettings) helpRenderSettings($('.set-pane[data-pane="preferences"]'));    // Help Assistant card (help.js, browser-only prefs)
  if (window.winmgrRenderSettings) winmgrRenderSettings($('.set-pane[data-pane="preferences"]')); // Floating windows card (winmgr.js)
  if (window.testdataRenderSettings) testdataRenderSettings($('.set-pane[data-pane="preferences"]')); // Default provider + Edge library
  if (window.tokenCalcRenderSettings) tokenCalcRenderSettings($('.set-pane[data-pane="preferences"]')); // Model registry + daily limits
  if (SET_ST.tab && SET_ST.tab !== "providers") {
    setShowTab(SET_ST.tab);
    $$(".set-tabs button").forEach((x) => x.setAttribute("aria-selected", x.dataset.tab === SET_ST.tab ? "true" : "false"));
    $$(".set-pane").forEach((p) => { p.hidden = !p.classList.contains("a"); });
  }
  if (SET_ST.jumpId) {
    const el = document.getElementById(SET_ST.jumpId);
    if (el) setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
    SET_ST.jumpId = "";
  }

  $$(".set-tabs button").forEach((b) => (b.onclick = () => {
    setShowTab(b.dataset.tab);
    $$(".set-tabs button").forEach((x) => x.setAttribute("aria-selected", x === b ? "true" : "false"));
    $$(".set-pane").forEach((p) => { p.hidden = !p.classList.contains("a"); });
    setUpdateDirty();
  }));
  $$(".set-pbtn").forEach((b) => (b.onclick = () => {
    setShowProvider(b.dataset.provider);
    $$(".set-prov").forEach((p) => { p.hidden = !p.classList.contains("a"); });
    setUpdateDirty();
  }));
  $$(".set-subtabs button").forEach((b) => (b.onclick = () => setShowSubtab(b.dataset.sub)));

  $("#sbody").addEventListener("input", (e) => { if (e.target && e.target.matches("[data-key], #histLimit, #dupThr")) setUpdateDirty(); });

  api("/api/settings/history_limit").then((h) => {
    const el = $("#histLimit"); if (!el) return;
    el.value = h.value; SET_ST.prefs.hist = String(h.value);
    $("#histHint").textContent = `Current: ${h.value}`;
    setUpdateDirty();
  }).catch((e) => { const box = $("#setErr"); if (box) { box.hidden = false; box.className = "error set-err"; box.textContent = e.message; } });
  $("#saveHist").onclick = () => guarded($("#saveHist"), async () => {
    const raw = $("#histLimit").value.trim();
    if (!/^\d+$/.test(raw) || +raw < 1 || +raw > 100) throw new Error("Run history limit must be a whole number between 1 and 100.");
    const r = await api("/api/settings/history_limit", { method: "PUT", body: { value: +raw } });
    SET_ST.prefs.hist = String(r.value);
    $("#histHint").textContent = `Current: ${r.value}`;
    toast(`Run history limit set to ${r.value}${r.pruned ? ` · removed ${r.pruned} oldest run${r.pruned > 1 ? "s" : ""}` : ""}`);
    if (window.refreshHistoryCount) refreshHistoryCount();
    setUpdateDirty();
  });
  api("/api/settings/dup_threshold").then((d) => {
    const el = $("#dupThr"); if (!el) return;
    el.value = d.value; SET_ST.prefs.dup = String(d.value);
    $("#dupHint").textContent = `Current: ${d.value}%`;
    setUpdateDirty();
  }).catch((e) => { const box = $("#setErr"); if (box) { box.hidden = false; box.className = "error set-err"; box.textContent = e.message; } });
  $("#saveDup").onclick = () => guarded($("#saveDup"), async () => {
    const raw = $("#dupThr").value.trim();
    if (!/^\d+$/.test(raw) || +raw < 50 || +raw > 99) throw new Error("Duplicate threshold must be a whole number between 50 and 99.");
    const r = await api("/api/settings/dup_threshold", { method: "PUT", body: { value: +raw } });
    DUP.threshold = r.value; DUP.res = null; SET_ST.prefs.dup = String(r.value);
    $("#dupHint").textContent = `Current: ${r.value}%`; toast(`Duplicate threshold set to ${r.value}%`);
    setUpdateDirty();
  });
  (async () => {
    const el = $("#asToggle"), hint = $("#asHint");
    if (!el) return;
    let on = true;
    try {
      const j = await api("/api/settings/prefs");
      if (j.prefs && Object.prototype.hasOwnProperty.call(j.prefs, "autosave")) on = !!j.prefs.autosave;
      window._prefs = Object.assign(window._prefs || {}, j.prefs || {});
    } catch (e) { if (window._prefs && Object.prototype.hasOwnProperty.call(_prefs, "autosave")) on = !!_prefs.autosave; }
    el.checked = on;
    if (hint) hint.textContent = on ? "Currently on" : "Currently off";
    el.onchange = () => guarded(el, async () => {
      const r = await api("/api/settings/prefs", { method: "PUT", body: { autosave: el.checked } });
      const next = !!(r.prefs ? r.prefs.autosave : el.checked);
      el.checked = next;
      window._prefs = Object.assign(window._prefs || {}, (r.prefs || { autosave: next }));
      if (hint) hint.textContent = next ? "Currently on" : "Currently off";
      toast(next ? "Auto Save is on" : "Auto Save is off — use the manual Save buttons");
    });
  })();
  $("#saveSettings").onclick = () => guarded($("#saveSettings"), async () => {
    const values = setCollectEnvValues();
    const r = await api("/api/settings", { method: "PUT", body: { values } });
    toast(`Saved (${r.changed.length} changed)`);
    // Reload to refresh masks / set pills; preserve current tab + provider
    const tab = SET_ST.tab, prov = SET_ST.provider;
    await viewSettings(v);
    setShowTab(tab);
    $$(".set-tabs button").forEach((x) => x.setAttribute("aria-selected", x.dataset.tab === tab ? "true" : "false"));
    $$(".set-pane").forEach((p) => { p.hidden = !p.classList.contains("a"); });
    setShowProvider(prov);
    $$(".set-prov").forEach((p) => { p.hidden = !p.classList.contains("a"); });
  });
  $$("[data-clear]").forEach((b) => (b.onclick = () => guarded(b, async () => {
    if (!confirm(`Clear ${b.dataset.clear}?`)) return;
    await api(`/api/settings/${b.dataset.clear}`, { method: "DELETE" });
    const tab = SET_ST.tab, prov = SET_ST.provider;
    await viewSettings(v);
    setShowTab(tab);
    $$(".set-tabs button").forEach((x) => x.setAttribute("aria-selected", x.dataset.tab === tab ? "true" : "false"));
    $$(".set-pane").forEach((p) => { p.hidden = !p.classList.contains("a"); });
    setShowProvider(prov);
    $$(".set-prov").forEach((p) => { p.hidden = !p.classList.contains("a"); });
  })));
  setUpdateDirty();
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
  modal(`<h1>Log out?</h1><div class="sub" style="margin:6px 0 14px">You'll return to the Welcome page. Saved runs stay in Run history on this browser.</div>
    ${u.length ? `<div class="warn" style="margin-bottom:18px">⚠ You have ${u.map(esc).join(", ")}${S.run.story_id ? " for " + esc(S.run.story_id) : ""}. Unsaved edits will be lost if you log out.</div>` : ""}
    <div style="text-align:right"><button class="btn g" id="mCancel">Cancel</button> <button class="btn r" id="mOk">Log out</button></div>`);
  $("#mCancel").onclick = closeModal;
  $("#mOk").onclick = async () => { try { await api("/api/session/logout", { method: "POST" }); } catch {} S.localDirty = false; window.location.href = "/welcome"; };
}
function newRunDialog() {
  const u = unsavedSummary();
  modal(`<h1>Start a new run?</h1><div class="sub" style="margin:6px 0 14px">The current run is kept in Run history and a fresh empty run starts.</div>
    ${u.length ? `<div class="warn" style="margin-bottom:18px">⚠ You have ${u.map(esc).join(", ")}.</div>` : ""}
    <div style="text-align:right"><button class="btn g" id="mCancel">Cancel</button> <button class="btn" id="mOk">Start new run</button></div>`);
  $("#mCancel").onclick = closeModal;
  $("#mOk").onclick = () => guarded($("#mOk"), async () => { await api("/api/run/new", { method: "POST" }); Object.assign(S, { localDirty: false, cases: [], inputMode: null, localText: "", localFile: null, payloadPreview: null, qtab: "upload" }); closeModal(); go("input"); if (window.refreshHistoryCount) refreshHistoryCount(); });
}

// ------------------------------------------------------------------ boot
window.addEventListener("beforeunload", (e) => {
  if (typeof autosaveFlush === "function" && typeof autosaveHasPending === "function" && autosaveHasPending()) {
    try { autosaveFlush({ reason: "unload" }); } catch (err) { /* can't await unload */ }
    e.preventDefault(); e.returnValue = ""; return;
  }
  const rqDirty = typeof window.rqIsDirty === "function" && window.rqIsDirty();
  const trDirty = typeof window.trIsDirty === "function" && window.trIsDirty();
  if (S.localDirty || rqDirty || trDirty) { e.preventDefault(); e.returnValue = ""; }
});
document.addEventListener("click", (e) => { if (!e.target.closest("#userBtn") && !e.target.closest("#userMenu")) $("#userMenu").classList.remove("open"); });
$("#userBtn").onclick = () => $("#userMenu").classList.toggle("open");
$("#logoutItem").onclick = logoutDialog;
$("#newRunBtn").onclick = newRunDialog;
$$("#userMenu [data-go]").forEach((d) => (d.onclick = () => { $("#userMenu").classList.remove("open"); go(d.dataset.go); }));
$$("#nav a").forEach((a) => (a.onclick = () => go(a.dataset.view)));
window.go = go;
window.goSettings = function (tab, opts) {
  opts = opts || {};
  if (tab) SET_ST.tab = tab;
  if (opts.provider) SET_ST.provider = opts.provider;
  if (opts.subtab) SET_ST.subtab = opts.subtab;
  SET_ST.jumpId = opts.jumpId || "";
  if (S.view === "settings") {
    setShowTab(SET_ST.tab);
    $$(".set-tabs button").forEach((x) => x.setAttribute("aria-selected", x.dataset.tab === SET_ST.tab ? "true" : "false"));
    $$(".set-pane").forEach((p) => { p.hidden = !p.classList.contains("a"); });
    if (opts.provider) setShowProvider(opts.provider);
    if (SET_ST.jumpId) {
      const el = document.getElementById(SET_ST.jumpId);
      if (el) setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
      SET_ST.jumpId = "";
    }
    return;
  }
  go("settings");
};

$("#modalBg").onclick = (e) => { if (e.target.id === "modalBg") closeModal(); };
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (h.startsWith("repo/case/")) { if (window.cpRoute) window.cpRoute(h.slice(10)); return; } if (h && h !== S.view) go(h); });
(async function boot() {
  let st; try { st = await api("/api/state"); } catch (e) { return; }
  const h = location.hash.slice(1);
  if (st.mode === "batch") { await resumeBatch(h); if (window.refreshHistoryCount) refreshHistoryCount(); return; }
  if (h.startsWith("repo/case/") && window.cpRoute) { window.cpRoute(h.slice(10)); if (window.refreshHistoryCount) refreshHistoryCount(); return; }
  const h0 = (h || "").split("?")[0];
  S.view = h && (STEPS.includes(h0) ? stepUnlocked(h0) : (h0 === "dashboard" || h0.startsWith("dashboard/") || h0 === "settings" || h0 === "setup" || h0 === "history" || h0 === "tokens" || h0.startsWith("tokens/") || h0 === "prompts" || (h0 === "acs" && stepUnlocked("review")))) ? h : "input";
  render();
  if (window.refreshHistoryCount) refreshHistoryCount();
})();
