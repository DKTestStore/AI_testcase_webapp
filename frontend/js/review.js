/* Review step (v6 UI): collapsible cards, inline editing, priority / AC / status,
   reorder with auto-renumbering, filters, bulk actions, pagination.
   Review-only metadata (priority, acs, status) is saved in the session but never
   written to the Excel file or the qTest payload. */
"use strict";

const STATUS = { not: { label: "◷ Not reviewed", cls: "s-n" }, reviewed: { label: "✓ Reviewed", cls: "s-r" }, changes: { label: "⚠ Needs changes", cls: "s-c" } };
const STATUS_NEXT = { not: "reviewed", reviewed: "changes", changes: "not" };
const PRIO = ["High", "Medium", "Low"];
const ACCOLORS = ["c1", "c2", "c3", "c4", "c5", "c6"];
let _uid = 0;
const RV = { size: 25, q: "", status: "", prio: "", ac: "", page: 0, open: new Set(), sel: new Set(), just: null, justStep: null, confirm: null };

const pad3 = (n) => String(n).padStart(3, "0");
const acCls = (a) => ACCOLORS[(parseInt(String(a).replace(/\D/g, ""), 10) || 0) % ACCOLORS.length];
const acTitle = (a) => { const f = (S.run.ac_list || []).find((x) => x.id === a); return f ? `${a}: ${f.title}` : a; };
function normCase(tc) {
  tc._k = tc._k || ++_uid; tc.priority = PRIO.includes(tc.priority) ? tc.priority : "Medium";
  tc.acs = Array.isArray(tc.acs) ? tc.acs : []; tc.status = STATUS[tc.status] ? tc.status : "not";
  tc.steps = tc.steps && tc.steps.length ? tc.steps : [{ description: "", expected: "" }];
  tc.steps.forEach((s) => (s._k = s._k || ++_uid));
  return tc;
}
function loadCasesFromRun() {
  const openIds = new Set(S.cases.filter((t) => RV.open.has(t._k)).map((t) => t.id));
  S.cases = JSON.parse(JSON.stringify(S.run.test_cases || [])).map(normCase);
  RV.open = new Set(S.cases.filter((t) => openIds.has(t.id)).map((t) => t._k));
  RV.sel.clear();
}
function renumber() { S.cases.forEach((t, i) => (t.id = "TC" + pad3(i + 1))); }
function markDirty() {
  if (!S.localDirty) S.localDirty = true;
  const b = $("#saveCases"); if (b) b.disabled = false;
  const u = $("#unsavedBar"); if (u) u.classList.remove("hidden");
  updateProgress(); renderNav();
}
function updateProgress() {
  const n = S.cases.length, r = S.cases.filter((t) => t.status === "reviewed").length;
  const el = $("#rvProg"); if (el) el.innerHTML = `Reviewed <b>${r}</b> / ${n}<span class="pbar"><i style="width:${n ? (r * 100) / n : 0}%"></i></span>`;
  const st = $("#rvSub"); if (st) st.textContent = `${n} test cases · ${S.cases.reduce((a, t) => a + t.steps.length, 0)} steps · click any field to edit`;
}
function filtered() {
  const q = RV.q.toLowerCase();
  return S.cases.filter((t) => (!window.dupFilter || dupFilter(t)) && (!RV.status || t.status === RV.status) && (!RV.prio || t.priority === RV.prio) && (!RV.ac || t.acs.includes(RV.ac)) &&
    (!q || [t.id, t.name, t.description, t.precondition, ...t.steps.map((s) => s.description + " " + s.expected)].join(" ").toLowerCase().includes(q)));
}
const byK = (k) => S.cases.findIndex((t) => t._k === +k);

// ------------------------------------------------------------------ page shell
function viewReview(v) {
  const r = S.run;
  if (!S.localDirty) loadCasesFromRun();
  const acs = r.ac_list || [];
  v.innerHTML = `<div class="rv-head"><div><h1>Review Test Cases</h1><div class="sub" id="rvSub" style="margin:0"></div></div>
    <div class="rv-actions"><button class="btn g" id="addTc">＋ Test case</button><button class="btn g" id="saveCases" ${S.localDirty ? "" : "disabled"}>💾 Save changes</button><button class="btn g" id="aiRev">🤖 Run AI Reviewer</button><button class="btn g dp-btn" id="dupBtn" title="Find near-identical test cases (local check, no AI call)">≋ Check duplicates</button><button class="btn g" id="upExcel" title="Import test cases from an .xlsx file">⬆ Upload Excel</button><button class="btn s" id="dlExcel">⬇ Save &amp; Download Excel</button><a class="tpl-link" href="/api/excel/template" title="Excel template with all supported columns">Download template</a></div></div>
    <div class="warn rv-unsaved ${S.localDirty ? "" : "hidden"}" id="unsavedBar">⚠ You have unsaved edits in this table. <span class="sub" style="margin:0">Save changes (or Continue — it saves automatically).</span></div>
    ${!S.localDirty && r.excel_name && !r.dirty ? `<div class="note" style="margin:0 0 10px">✅ Excel saved: <b>${esc(r.excel_name)}</b></div>` : ""}
    <div id="covBar"></div><div id="covPanel"></div><div id="dupBanner"></div><div id="dupPanel"></div>
    <div id="reviewPanel">${reviewPanel(r.review)}</div>
    <div class="card rv-toolbar" id="rvToolbar">
      <input id="rvQ" placeholder="🔍 Search…" value="${esc(RV.q)}" style="width:170px">
      <input id="rvJump" placeholder="Jump to TC…" style="width:110px" title="Type e.g. TC042 or 42 and press Enter">
      <select id="rvStatus"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${RV.status === k ? "selected" : ""}>${s.label.slice(2)}</option>`).join("")}</select>
      <select id="rvPrio"><option value="">All priorities</option>${PRIO.map((p) => `<option ${RV.prio === p ? "selected" : ""}>${p}</option>`).join("")}</select>
      <select id="rvAc"><option value="">All ACs</option>${acs.map((a) => `<option value="${esc(a.id)}" ${RV.ac === a.id ? "selected" : ""}>${esc(a.id)}</option>`).join("")}</select>
      <span style="flex:1"></span><span id="dupOnly"></span><span class="rv-prog" id="rvProg"></span>
      <button class="btn g sm" id="expAll">⊞ Expand all</button><button class="btn g sm" id="colAll">⊟ Collapse all</button></div>
    <div class="rv-legend sub"><span><span class="hdl">⋮⋮</span> drag or ▲▼ to reorder</span><span>🔢 IDs &amp; step numbers auto-resequence after a move</span><span>Status: click the pill to change</span><span><span class="edot"></span> edited (unsaved)</span><span>AC mapping, priority &amp; status are display-only — not sent to qTest</span><span>↻ Regenerate: redo one test case with a short instruction</span></div>
    <div id="rvBulk"></div><div id="rvList"></div>
    <div class="footer-nav"><div></div><button class="btn" id="nextBtn" ${S.cases.length ? "" : "disabled"}>Continue to qTest Upload →</button></div>`;
  updateProgress(); renderList();
  $("#dupBtn").onclick = () => dupCheck();
  // toolbar
  const reList = () => { RV.page = 0; renderList(); };
  $("#rvQ").oninput = (e) => { RV.q = e.target.value; clearTimeout(viewReview._t); viewReview._t = setTimeout(reList, 200); };
  $("#rvStatus").onchange = (e) => { RV.status = e.target.value; reList(); };
  $("#rvPrio").onchange = (e) => { RV.prio = e.target.value; reList(); };
  $("#rvAc").onchange = (e) => { RV.ac = e.target.value; reList(); };
  $("#rvJump").onkeydown = (e) => { if (e.key === "Enter") jumpTo(e.target.value); };
  $("#expAll").onclick = () => { filtered().forEach((t) => RV.open.add(t._k)); renderList(); };
  $("#colAll").onclick = () => { RV.open.clear(); renderList(); };
  $("#addTc").onclick = () => {
    const tc = normCase({ name: "New test case", description: "", precondition: "", steps: [{ description: "", expected: "" }], priority: "Medium", acs: [], status: "not" });
    tc._ed = { name: 1 }; S.cases.push(tc); renumber(); RV.open.add(tc._k); RV.just = tc._k;
    RV.q = RV.status = RV.prio = RV.ac = ""; RV.page = Math.floor((S.cases.length - 1) / RV.size); markDirty(); renderList();
    const el = $(`.tc[data-k="${tc._k}"]`); if (el) el.scrollIntoView({ block: "center" });
  };
  $("#saveCases").onclick = () => guarded($("#saveCases"), async () => { await saveCases(); toast("Changes saved — you can continue to qTest Upload"); afterSave(); });
  $("#aiRev").onclick = () => guarded($("#aiRev"), async () => {
    if (S.localDirty) await saveCases();
    $("#reviewPanel").innerHTML = `<div class="card"><div class="bar ind"><div></div></div><div class="sub" style="margin:6px 0 0">AI Reviewer is checking the test cases…</div></div>`;
    try { await api("/api/review/ai", { method: "POST" }); } catch (e) { $("#reviewPanel").innerHTML = `<div class="error">${esc(e.message)}</div>`; throw e; }
    viewReview(v);
  });
  $("#upExcel").onclick = () => { if (S.localDirty && !confirm("You have unsaved edits. Uploading may replace them. Continue?")) return; openUploadModal(); };
  $("#dlExcel").onclick = () => guarded($("#dlExcel"), async () => {
    if (S.localDirty) await saveCases();
    await api("/api/review/save_excel", { method: "POST" });
    download("/api/review/excel"); toast("Excel saved"); viewReview(v); renderNav();
  });
  $("#nextBtn").onclick = () => guarded($("#nextBtn"), async () => { if (S.localDirty) { await saveCases(); toast("Changes saved"); } go("qtest"); });
  bindReviewPanel(v);
  const list = $("#rvList");
  list.addEventListener("click", onListClick);
  list.addEventListener("input", onListInput);
  list.addEventListener("change", (e) => { if (e.target.dataset.act === "pagesize") { RV.size = +e.target.value; RV.page = 0; renderList(); } });
  list.addEventListener("focusin", onFocusIn);
  list.addEventListener("focusout", onFocusOut);
  list.addEventListener("keydown", onKey);
  bindDrag(list);
}
function afterSave() { const b = $("#saveCases"); if (b) b.disabled = true; $("#unsavedBar") && $("#unsavedBar").classList.add("hidden"); renderList(); renderNav(); }
async function saveCases() {
  await api("/api/review/test_cases", { method: "PUT", body: { test_cases: S.cases } });
  S.localDirty = false; S.cases.forEach((t) => { delete t._ed; t.steps.forEach((s) => delete s._ed); });
}

// ------------------------------------------------------------------ list rendering (keeps scroll position — Bug 04)
function renderList() {
  const y = window.scrollY; closePop();
  if (window.dupPrepare) dupPrepare();
  const inner = {}; $$(".tc-scroll").forEach((e) => (inner[e.dataset.sk] = e.scrollTop));
  const PS = RV.size; const f = filtered(); const pages = Math.max(1, Math.ceil(f.length / PS));
  if (RV.page >= pages) RV.page = pages - 1; if (RV.page < 0) RV.page = 0;
  const slice = f.slice(RV.page * PS, RV.page * PS + PS);
  const total = S.cases.length;
  let h = slice.map((t) => card(t, byK(t._k), total)).join("") || `<div class="card muted">${total ? "No test cases match the filters." : "No test cases yet."}</div>`;
  const pager = pagerHtml(RV.page, pages, f.length, PS, total, "page");
  h = pager.replace('class="rv-pager"', 'class="rv-pager top"') + h + pager;
  $("#rvList").innerHTML = h;
  renderBulk(); updateProgress(); if (window.dupRender) dupRender(); if (window.covRender) covRender();
  $$(".tc-scroll").forEach((e) => { if (inner[e.dataset.sk] !== undefined) e.scrollTop = inner[e.dataset.sk]; });
  const js = RV.justStep && $(".sr.just"); if (js) { const sc = js.closest(".tc-scroll"); if (sc && (js.offsetTop < sc.scrollTop || js.offsetTop > sc.scrollTop + sc.clientHeight - 40)) sc.scrollTop = js.offsetTop - sc.clientHeight / 2; }
  window.scrollTo(0, y);
  if (RV.just || RV.justStep) setTimeout(() => { RV.just = RV.justStep = null; $$(".just").forEach((e) => e.classList.remove("just")); }, 2500);
}
const ce = (f, val, ed, ph, extra = "") => `<div class="ed ${ed ? "edited" : ""}" contenteditable="true" data-f="${f}" data-ph="${esc(ph)}" ${extra}>${esc(val)}</div>`;
function card(t, i, total) {
  const open = RV.open.has(t._k); const st = STATUS[t.status]; const ed = t._ed || {};
  const chips = t.acs.map((a) => `<span class="ac ${acCls(a)}" title="${esc(acTitle(a))}">${esc(a)}<b data-act="acdel" data-a="${esc(a)}" title="Remove">×</b></span>`).join("");
  const rgL = window.RG && RG.loading === t._k;
  let h = `<div class="tc st-${t.status} ${window.dupFlagged && dupFlagged(t) ? "dp" : ""} ${open ? "open" : ""} ${RV.just === t._k ? "just" : ""} ${rgL ? "rg-loading" : ""} ${window.RG && RG.flash === t._k ? "rg-flash" : ""}" data-k="${t._k}">
   <div class="tc-h">
    <input type="checkbox" data-act="sel" ${RV.sel.has(t._k) ? "checked" : ""} title="Select">
    <span class="hdl" draggable="true" data-drag="tc" title="Drag to reorder">⋮⋮</span>
    <span class="mvs"><button class="mv" data-act="tcup" title="Move up" ${i === 0 ? "disabled" : ""}>▲</button><button class="mv" data-act="tcdown" title="Move down" ${i === total - 1 ? "disabled" : ""}>▼</button></span>
    <button class="chev" data-act="toggle" title="${open ? "Collapse" : "Expand"}">❯</button>
    <b class="tcid" data-act="toggle">${esc(t.id)}</b>
    <div class="tc-title">${window.dupBadge ? dupBadge(t) : ""}${t.regenerated ? '<span class="rg-badge" title="Regenerated with AI — review it again">↻ Regenerated</span>' : ""}${ce("name", t.name, ed.name, "Test case name", 'data-name="1"')}<span class="namebtns"><button class="btn s sm" data-act="namesave">✓ Save</button><button class="btn g sm" data-act="namecancel">✕ Cancel</button></span>
      ${open ? "" : `<div class="tc-desc" data-act="toggle">${esc(t.description) || '<span class="muted">No description</span>'}</div>`}</div>
    <div class="tc-meta"><span class="acs">${chips}<button class="addac" data-act="acadd">+ AC</button></span>
      <button class="prio p-${t.priority}" data-act="prio">${t.priority} ▾</button>
      <span class="sub nsteps">${t.steps.length} steps</span>
      <button class="stp ${st.cls}" data-act="status" title="Click to change review status">${st.label} <span class="caret">▾</span></button>
      <button class="rg-btn" data-act="regen" title="Regenerate only ${esc(t.id)} with AI · other test cases are untouched" ${window.RG && RG.loading ? "disabled" : ""}>↻ Regenerate</button>
      <button class="ib" data-act="tcmenu" title="More">⋮</button></div>
   </div>${rgL ? window.rgOverlay(t) : ""}`;
  if (open) {
    h += `<div class="tc-b"><div class="tc-scroll" data-sk="${t._k}"><div class="tc-grid"><div><div class="lbl">Test Case Description</div>${ce("description", t.description, ed.description, "Add a description…", 'data-multi="1"')}</div>
      <div><div class="lbl">Precondition</div>${ce("precondition", t.precondition, ed.precondition, "Add a precondition…", 'data-multi="1"')}</div></div>
      <div class="sr lbl"><span></span><span>#</span><span>Step Description</span><span>Expected Result</span><span style="text-align:right">Actions</span></div>`;
    t.steps.forEach((s, si) => {
      const se = s._ed || {};
      h += `<div class="sr ${RV.justStep === s._k ? "just" : ""}" data-s="${si}"><span class="hdl" draggable="true" data-drag="step" title="Drag to reorder">⋮⋮</span><span class="num">${si + 1}</span>
        ${ce("description", s.description, se.description, "Step action…", `data-step="${si}"`)}${ce("expected", s.expected, se.expected, "Expected result…", `data-step="${si}"`)}
        <span class="ra"><button class="ib" data-act="sup" title="Move step up" ${si ? "" : "disabled"}>▲</button><button class="ib" data-act="sdown" title="Move step down" ${si < t.steps.length - 1 ? "" : "disabled"}>▼</button><button class="ib add" data-act="sadd" title="Add step below">＋</button><button class="ib del" data-act="sdel" title="Remove step" ${t.steps.length > 1 ? "" : "disabled"}>−</button><button class="ib" data-act="smenu" title="More">⋮</button></span></div>`;
    });
    h += `</div><div class="tc-foot"><button class="btn g sm" data-act="sadd" data-s="${t.steps.length - 1}">＋ Add step</button><span class="sub" style="margin:0">${t.steps.length} steps</span></div></div>`;
  }
  return h + "</div>";
}
function pagerHtml(page, pages, n, ps, total, act) {
  if (!n) return "";
  const nums = []; for (let i = 0; i < pages; i++) { if (pages > 9 && i > 1 && i < pages - 2 && Math.abs(i - page) > 1) { if (nums[nums.length - 1] !== "…") nums.push("…"); continue; } nums.push(i); }
  return `<div class="rv-pager"><span class="pg-info">Showing <b>${page * ps + 1}–${Math.min(n, (page + 1) * ps)}</b> of <b>${n}</b>${n !== total ? ` (filtered from ${total})` : ""}</span><span style="flex:1"></span>
    <label class="pg-size">Per page <select data-act="${act}size">${[25, 50, 100].map((x) => `<option ${x === ps ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    <button class="btn g sm" data-act="${act}" data-p="${page - 1}" ${page ? "" : "disabled"} title="Previous page">‹ Prev</button>
    ${nums.map((i) => i === "…" ? '<span class="sub" style="margin:0 2px">…</span>' : `<button class="btn g sm ${i === page ? "pg-a" : ""}" data-act="${act}" data-p="${i}">${i + 1}</button>`).join("")}
    <button class="btn g sm" data-act="${act}" data-p="${page + 1}" ${page < pages - 1 ? "" : "disabled"} title="Next page">Next ›</button></div>`;
}
function showCase(t) { const f = filtered(); const ix = f.indexOf(t); if (ix >= 0) RV.page = Math.floor(ix / RV.size); }
function renderBulk() {
  const el = $("#rvBulk"); if (!el) return; const n = RV.sel.size;
  if (!n) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="bulk"><b>${n} selected</b><button class="btn sm" style="background:#fff;color:#1e3a8a;border-color:#fff" data-b="selpage">Select all on page</button><span style="flex:1"></span>
    <button class="btn s sm" data-b="reviewed">✓ Mark reviewed</button>
    <select data-b="prio"><option value="">Set priority…</option>${PRIO.map((p) => `<option>${p}</option>`).join("")}</select>
    <select data-b="status"><option value="">Set status…</option>${Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.label.slice(2)}</option>`).join("")}</select>
    <button class="btn r sm" data-b="delete">🗑 Delete</button><button class="btn sm" style="background:transparent;border-color:#93c5fd" data-b="clear">Clear</button></div>`;
  const sel = () => S.cases.filter((t) => RV.sel.has(t._k));
  $$("[data-b]", el).forEach((b) => {
    const a = b.dataset.b;
    if (b.tagName === "SELECT") b.onchange = () => { if (!b.value) return; sel().forEach((t) => (t[a === "prio" ? "priority" : "status"] = b.value)); markDirty(); renderList(); };
    else b.onclick = () => {
      if (a === "clear") RV.sel.clear();
      else if (a === "selpage") $$(".tc", $("#rvList")).forEach((c) => RV.sel.add(+c.dataset.k));
      else if (a === "reviewed") { sel().forEach((t) => (t.status = "reviewed")); markDirty(); }
      else if (a === "delete") { if (!confirm(`Delete ${n} selected test case(s)? IDs will be renumbered.`)) return; S.cases = S.cases.filter((t) => !RV.sel.has(t._k)); RV.sel.clear(); renumber(); markDirty(); toast(`${n} test case(s) deleted · IDs renumbered`); }
      renderList();
    };
  });
}

// ------------------------------------------------------------------ editing
function onListInput(e) {
  const el = e.target;
  if (el.dataset.act === "sel") return;
  if (!el.classList.contains("ed")) return;
  const card = el.closest(".tc"); const t = S.cases[byK(card.dataset.k)]; const f = el.dataset.f;
  const val = el.innerText.replace(/\s*\n\s*/g, el.dataset.multi ? "\n" : " ").trim();
  if (el.dataset.step !== undefined) { const s = t.steps[+el.dataset.step]; s[f] = val.replace(/\n/g, " "); s._ed = s._ed || {}; s._ed[f] = 1; }
  else { t[f] = val.replace(/\n/g, " "); t._ed = t._ed || {}; t._ed[f] = 1; }
  el.classList.add("edited"); markDirty();
}
function onFocusIn(e) { const el = e.target; if (el.dataset && el.dataset.name) { el.dataset.orig = el.innerText; el.closest(".tc-title").classList.add("editing"); } }
function onFocusOut(e) {
  const el = e.target; if (!(el.dataset && el.dataset.name)) return;
  setTimeout(() => { const tt = el.closest(".tc-title"); if (tt && !tt.contains(document.activeElement)) tt.classList.remove("editing"); }, 150);
}
function onKey(e) {
  const el = e.target; if (!el.classList || !el.classList.contains("ed")) return;
  if (e.key === "Enter" && !(el.dataset.multi && e.shiftKey)) { e.preventDefault(); el.blur(); }
  if (e.key === "Escape" && el.dataset.name) { cancelName(el); }
}
function cancelName(el) {
  const t = S.cases[byK(el.closest(".tc").dataset.k)]; if (el.dataset.orig === undefined) return;
  el.innerText = el.dataset.orig; t.name = el.dataset.orig.trim(); el.blur(); el.closest(".tc-title").classList.remove("editing");
}

// ------------------------------------------------------------------ click actions
function moveTc(i, d) {
  const j = i + d; if (j < 0 || j >= S.cases.length) return;
  const oldId = S.cases[i].id; const [t] = S.cases.splice(i, 1); S.cases.splice(j, 0, t); renumber();
  RV.just = t._k; showCase(t); markDirty(); renderList();
  const el = $(`.tc[data-k="${t._k}"]`); if (el && (el.getBoundingClientRect().top < 0 || el.getBoundingClientRect().bottom > innerHeight)) el.scrollIntoView({ block: "center" });
  toast(`${oldId} moved ${d < 0 ? "up" : "down"} → now ${t.id} · IDs renumbered`);
}
function moveStep(t, si, d) {
  const sj = si + d; if (sj < 0 || sj >= t.steps.length) return;
  const [s] = t.steps.splice(si, 1); t.steps.splice(sj, 0, s); RV.justStep = s._k; markDirty(); renderList();
  toast(`Step ${si + 1} moved ${d < 0 ? "up" : "down"} → now step ${sj + 1} · steps renumbered`);
}
function onListClick(e) {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "pagesize") return;
  if (a === "page") { RV.page = +b.dataset.p; renderList(); if (b.closest(".rv-pager") && !b.closest(".rv-pager.top")) window.scrollTo(0, $("#rvToolbar").offsetTop - 10); return; }
  const card = b.closest(".tc"); if (!card) return;
  const i = byK(card.dataset.k); const t = S.cases[i];
  const row = b.closest(".sr"); const si = row ? +row.dataset.s : (b.dataset.s !== undefined ? +b.dataset.s : -1);
  switch (a) {
    case "toggle": RV.open.has(t._k) ? RV.open.delete(t._k) : RV.open.add(t._k); renderList(); break;
    case "sel": b.checked ? RV.sel.add(t._k) : RV.sel.delete(t._k); renderBulk(); break;
    case "tcup": moveTc(i, -1); break;
    case "tcdown": moveTc(i, 1); break;
    case "status": openStatus(b, t); break;
    case "namesave": { const el = $("[data-name]", card); el.blur(); card.querySelector(".tc-title").classList.remove("editing"); toast("Name updated — click Save changes to persist"); break; }
    case "namecancel": cancelName($("[data-name]", card)); break;
    case "acdel": t.acs = t.acs.filter((x) => x !== b.dataset.a); markDirty(); renderList(); break;
    case "acadd": openAcPicker(b, t); break;
    case "prio": openPrio(b, t); break;
    case "tcmenu": openTcMenu(b, t, i); break;
    case "sup": moveStep(t, si, -1); break;
    case "sdown": moveStep(t, si, 1); break;
    case "sadd": { const ns = { description: "", expected: "", _k: ++_uid, _ed: { description: 1 } }; t.steps.splice(si + 1, 0, ns); RV.justStep = ns._k; markDirty(); renderList(); const el = $(`.sr.just .ed`); if (el) el.focus(); break; }
    case "sdel": if (t.steps.length > 1) { t.steps.splice(si, 1); markDirty(); renderList(); } break;
    case "smenu": openStepMenu(b, t, si); break;
    case "regen": window.openRegen && openRegen(b, t); break;
    case "rgcancel": window.cancelRegen && cancelRegen(); break;
  }
}

// ------------------------------------------------------------------ overlay popovers (absolute, no layout shift)
function closePop() { const p = $("#rvPop"); if (p) p.remove(); document.removeEventListener("mousedown", popOutside, true); }
function popOutside(e) { const p = $("#rvPop"); if (p && !p.contains(e.target) && !e.target.closest("[data-act='acadd'],[data-act='prio'],[data-act='status'],[data-act='tcmenu'],[data-act='smenu'],[data-act='regen']")) closePop(); }
function openPop(anchor, html, width, alignRight) {
  closePop();
  const r = anchor.getBoundingClientRect(); const p = document.createElement("div");
  p.id = "rvPop"; p.className = "pop"; p.style.width = width + "px"; p.innerHTML = html;
  p.style.top = window.scrollY + r.bottom + 4 + "px";
  p.style.left = Math.max(8, window.scrollX + (alignRight ? r.right - width : r.left)) + "px";
  document.body.appendChild(p); setTimeout(() => document.addEventListener("mousedown", popOutside, true), 0);
  return p;
}
function openPrio(b, t) {
  const p = openPop(b, PRIO.map((x) => `<div class="pi ${x === t.priority ? "a" : ""}" data-v="${x}"><span class="prio p-${x}">${x}</span>${x === t.priority ? " ✓" : ""}</div>`).join(""), 140, true);
  $$(".pi", p).forEach((d) => (d.onclick = () => { t.priority = d.dataset.v; t._ed = t._ed || {}; markDirty(); closePop(); renderList(); }));
}
function openStatus(b, t) {
  const p = openPop(b, `<div class="lbl" style="padding:4px 8px">Review status</div>` + Object.entries(STATUS).map(([k, x]) => `<div class="pi ${k === t.status ? "a" : ""}" data-v="${k}"><span class="stp ${x.cls}" style="width:auto">${x.label}</span>${k === t.status ? " ✓" : ""}</div>`).join(""), 190, true);
  $$(".pi", p).forEach((d) => (d.onclick = () => { if (t.status !== d.dataset.v) { t.status = d.dataset.v; markDirty(); } closePop(); renderList(); }));
}
function openAcPicker(b, t) {
  const list = S.run.ac_list || [];
  const p = openPop(b, `<input class="acq" placeholder="Search AC…" style="width:100%;margin-bottom:4px">
    <div class="aclist">${list.map((a) => `<label class="pi"><input type="checkbox" value="${esc(a.id)}" ${t.acs.includes(a.id) ? "checked" : ""}><b>${esc(a.id)}</b><span>${esc(a.title)}</span></label>`).join("") || '<div class="muted" style="padding:6px">No acceptance criteria detected in the input.</div>'}</div>
    <div style="display:flex;gap:6px;margin-top:6px"><input class="acnew" placeholder="Custom e.g. AC-12" style="flex:1"><button class="btn sm" data-x="add">Add</button></div>`, 320, false);
  $(".acq", p).oninput = (e) => $$(".aclist label", p).forEach((l) => l.classList.toggle("hidden", !l.textContent.toLowerCase().includes(e.target.value.toLowerCase())));
  $$(".aclist input", p).forEach((c) => (c.onchange = () => {
    t.acs = c.checked ? [...new Set([...t.acs, c.value])] : t.acs.filter((x) => x !== c.value);
    const order = list.map((x) => x.id); t.acs.sort((x, y) => (order.indexOf(x) + 1 || 999) - (order.indexOf(y) + 1 || 999));
    markDirty(); const card = $(`.tc[data-k="${t._k}"] .acs`); if (card) card.innerHTML = t.acs.map((a) => `<span class="ac ${acCls(a)}" title="${esc(acTitle(a))}">${esc(a)}<b data-act="acdel" data-a="${esc(a)}">×</b></span>`).join("") + `<button class="addac" data-act="acadd">+ AC</button>`;
  }));
  $("[data-x=add]", p).onclick = () => { const v = $(".acnew", p).value.trim().toUpperCase(); if (!v) return; if (!t.acs.includes(v)) t.acs.push(v); markDirty(); closePop(); renderList(); };
  $(".acq", p).focus();
}
function menuHtml(items, confirmText) {
  return items.map(([k, l, c]) => `<div class="pi ${c || ""}" data-m="${k}">${l}</div>`).join("") + (confirmText ? `<div class="confirm hidden">${confirmText}<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px"><button class="btn g sm" data-m="cancel">Cancel</button><button class="btn r sm" data-m="yes">Delete</button></div></div>` : "");
}
function openTcMenu(b, t, i) {
  const p = openPop(b, menuHtml([["dup", "📋 Duplicate test case"], ["top", "⤒ Move to top"], ["bottom", "⤓ Move to bottom"], ["del", "🗑 Delete test case…", "danger"]], `Delete ${esc(t.id)}? IDs will be renumbered.`), 220, true);
  p.onclick = (e) => {
    const m = e.target.closest("[data-m]"); if (!m) return; const k = m.dataset.m;
    if (k === "del") { $(".confirm", p).classList.remove("hidden"); return; }
    if (k === "cancel") { closePop(); return; }
    if (k === "yes") { const id = t.id; S.cases.splice(i, 1); RV.sel.delete(t._k); renumber(); markDirty(); renderList(); toast(`${id} deleted · IDs renumbered`); return; }
    if (k === "dup") { const c = normCase(JSON.parse(JSON.stringify(t))); c._k = ++_uid; c.steps.forEach((s) => (s._k = ++_uid)); c.name += " (copy)"; c.status = "not"; c._ed = { name: 1 }; S.cases.splice(i + 1, 0, c); renumber(); RV.just = c._k; }
    if (k === "top" || k === "bottom") { S.cases.splice(i, 1); k === "top" ? S.cases.unshift(t) : S.cases.push(t); renumber(); RV.just = t._k; showCase(t); }
    markDirty(); closePop(); renderList();
  };
}
function openStepMenu(b, t, si) {
  const p = openPop(b, menuHtml([["dup", "📋 Duplicate step"], ["del", "🗑 Delete test case…", "danger"]], `Delete ${esc(t.id)}? IDs will be renumbered.`), 220, true);
  p.onclick = (e) => {
    const m = e.target.closest("[data-m]"); if (!m) return; const k = m.dataset.m;
    if (k === "del") { $(".confirm", p).classList.remove("hidden"); return; }
    if (k === "cancel") { closePop(); return; }
    if (k === "yes") { const id = t.id; S.cases.splice(byK(t._k), 1); renumber(); markDirty(); renderList(); toast(`${id} deleted · IDs renumbered`); return; }
    if (k === "dup") { const s = { ...t.steps[si], _k: ++_uid, _ed: { description: 1 } }; t.steps.splice(si + 1, 0, s); RV.justStep = s._k; markDirty(); closePop(); renderList(); }
  };
}

// ------------------------------------------------------------------ drag & drop reorder
function bindDrag(list) {
  let drag = null;
  list.addEventListener("dragstart", (e) => {
    const h = e.target.closest("[data-drag]"); if (!h) return;
    const card = h.closest(".tc");
    drag = { type: h.dataset.drag, k: +card.dataset.k, s: h.dataset.drag === "step" ? +h.closest(".sr").dataset.s : -1 };
    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "x");
    (drag.type === "step" ? h.closest(".sr") : card).classList.add("dragging");
  });
  list.addEventListener("dragover", (e) => { if (!drag) return; const tgt = drag.type === "step" ? e.target.closest(".sr[data-s]") : e.target.closest(".tc"); if (tgt) { e.preventDefault(); $$(".dropover").forEach((x) => x.classList.remove("dropover")); tgt.classList.add("dropover"); } });
  list.addEventListener("dragend", () => { drag = null; $$(".dragging,.dropover").forEach((x) => x.classList.remove("dragging", "dropover")); });
  list.addEventListener("drop", (e) => {
    if (!drag) return; e.preventDefault();
    if (drag.type === "tc") {
      const tgt = e.target.closest(".tc"); if (!tgt) return; const from = byK(drag.k), to = byK(tgt.dataset.k); if (from === to) return;
      const old = S.cases[from].id; const [t] = S.cases.splice(from, 1); S.cases.splice(to, 0, t); renumber(); RV.just = t._k; markDirty(); renderList();
      toast(`${old} moved → now ${t.id} · IDs renumbered`);
    } else {
      const row = e.target.closest(".sr[data-s]"); if (!row || +row.closest(".tc").dataset.k !== drag.k) return;
      const t = S.cases[byK(drag.k)], to = +row.dataset.s; if (to === drag.s) return;
      const [s] = t.steps.splice(drag.s, 1); t.steps.splice(to, 0, s); RV.justStep = s._k; markDirty(); renderList();
      toast(`Step ${drag.s + 1} moved → now step ${to + 1} · steps renumbered`);
    }
    drag = null;
  });
}

// ------------------------------------------------------------------ jump to TC
function jumpTo(v) {
  v = String(v || "").trim().toUpperCase(); if (!v) return;
  const id = /^\d+$/.test(v) ? "TC" + pad3(+v) : v;
  const t = S.cases.find((x) => x.id.toUpperCase() === id); if (!t) return toast(`${id} not found`, true);
  let f = filtered(); if (!f.includes(t)) { RV.q = RV.status = RV.prio = RV.ac = ""; ["#rvQ", "#rvStatus", "#rvPrio", "#rvAc"].forEach((s) => ($(s).value = "")); f = filtered(); }
  RV.page = Math.floor(f.indexOf(t) / RV.size); RV.open.add(t._k); RV.just = t._k; renderList();
  const el = $(`.tc[data-k="${t._k}"]`); if (el) el.scrollIntoView({ block: "start" });
}
