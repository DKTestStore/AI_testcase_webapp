/* Test case preview v2 (additive): resizable drawer + full-page view (#repo/case/TC-0001) with
   Steps / Versions / Executions / Attachments / Activity tabs. Replaces the old repo.js drawer; trDrawer(id, tab) keeps its signature. */
"use strict";
const CP = { id: null, j: null, tab: "steps", full: false, mode: localStorage.getItem("trCpMode") || "detailed", edit: null, draft: null,
  selV: null, cmpV: null, dmode: "inline", att: "all", act: "all", open: {}, lastId: null };
const CP_ST = [["Draft", "Draft"], ["Ready", "Ready"], ["Obsolete", "Deprecated"]];
const CP_DOT = { Pass: "#12a150", Fail: "#d33", Blocked: "#f59e0b", Skipped: "#94a3b8", Retest: "#a855f7", "Not run": "#cbd5e1" };
const cpMe = () => { const b = $("#userBtn"); if (!b) return ""; const t = [...b.childNodes].filter((n) => !(n.classList && n.classList.contains("avatar"))).map((n) => n.textContent).join("").replace("▾", "").trim(); return t === "User" ? "" : t; };
const cpC = () => (CP.j || {}).case || {};
const cpStLabel = (s) => (s === "Obsolete" ? "Deprecated" : s);

function cpList() {
  try { if (RP.data && RP.data.cases) { const l = trRepoFiltered().map((c) => c.id); if (l.includes(CP.id)) return l; } } catch (e) { /* repo list not loaded */ }
  return [CP.id];
}
function cpJira(key) { const b = (CP.j || {}).jira_base; return b && key ? `${b}/browse/${encodeURIComponent(key)}` : ""; }
function cpChip(key, label, cls = "cp-chip") { if (!key) return ""; const u = cpJira(key); return u ? `<a class="${cls}" href="${u}" target="_blank" rel="noopener" title="Open in Jira">🔗 ${esc(label || key)} ↗</a>` : `<span class="${cls}">🔗 ${esc(label || key)}</span>`; }
function cpDefect(d) { const u = cpJira(d); return u ? `<a class="cp-def" href="${u}" target="_blank" rel="noopener">🐞 ${esc(d)}</a>` : `<span class="cp-def">🐞 ${esc(d)}</span>`; }

// ------------------------------------------------------------------ open / load
async function trDrawer(id, tab) { CP.full = false; RP.full = null; await cpOpen(id, tab || "steps"); }
async function cpLoad(id) { CP.j = await api(`/api/repo/cases/${encodeURIComponent(id)}`); CP.id = id; }
async function cpOpen(id, tab) {
  try { await cpLoad(id); } catch (e) { return toast(e.message, true); }
  if (id !== CP.lastId) { CP.edit = null; CP.draft = null; CP.selV = null; CP.cmpV = null; CP.open = {}; }
  CP.lastId = id; if (tab) CP.tab = tab === "exec" ? "executions" : tab;
  if (!CP.full && !$("#trDrw")) {
    trDrawerClose();
    document.body.insertAdjacentHTML("beforeend", `<div class="tr-dbg" id="trDbg"></div><div class="tr-drw trv cp-drw" id="trDrw"></div>`);
    $("#trDbg").onclick = trDrawerClose;
    const w = +localStorage.getItem("trDrwW"); $("#trDrw").style.width = w > 300 ? Math.min(w, innerWidth - 60) + "px" : "60vw";
  }
  cpPaint();
}
async function cpReload(listToo) {
  try { await cpLoad(CP.id); } catch (e) { toast(e.message, true); }
  if (listToo && RP.data) { try { RP.data = await api("/api/repo"); if ($("#trRepoBody")) trRepoRender(); } catch (e) { /* ignore */ } }
  cpPaint();
}
function cpRoot() { return CP.full ? $("#cpFull") : $("#trDrw"); }
function cpGo(delta) {
  const l = cpList(), i = l.indexOf(CP.id), n = l[i + delta]; if (!n) return;
  if (CP.full) { location.hash = "repo/case/" + n; } else cpOpen(n);
}

// full page ---------------------------------------------------------------------------------
function cpFullOpen(id) { trDrawerClose(); RP.full = id; RP.edit = null; S.view = "repo"; location.hash = "repo/case/" + id; render(); }
window.cpRoute = function (id) { RP.full = decodeURIComponent(id); RP.edit = null; RP.ai = null; trDrawerClose(); S.view = "repo"; render(); };
const _cpViewRepo = viewRepo;
viewRepo = async function (v) {
  if (RP.full && !RP.edit) { CP.full = true; v.innerHTML = `<div class="trv cp-full" id="cpFull"><div class="sub">Loading…</div></div>`; cpSb(); if (!RP.data) api("/api/repo").then((d) => { RP.data = d; if (CP.full) cpPaint(); }).catch(() => {}); return cpOpen(RP.full); }
  CP.full = false; document.body.classList.remove("cp-sbmin"); return _cpViewRepo(v);
};
function cpSb() { document.body.classList.toggle("cp-sbmin", CP.full && localStorage.getItem("trCpSb") !== "open"); }
window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  if (h.startsWith("repo/case/")) return;
  document.body.classList.remove("cp-sbmin");
  if (RP.full) { RP.full = null; CP.full = false; if (h === "repo" && S.view === "repo") render(); }
});
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest(".nav a[data-view]"); if (!a) return;
  if (RP.full) { RP.full = null; CP.full = false; document.body.classList.remove("cp-sbmin"); if (a.dataset.view === "repo" && S.view === "repo") { location.hash = "repo"; } }
}, true);

// keys: J / K next / previous, Esc closes the drawer
document.addEventListener("keydown", (e) => {
  if (!$("#trDrw") && !(CP.full && $("#cpFull"))) return;
  if ($("#trOv") || $("#trLb") || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target, tag = (t.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable) return;
  if (e.key === "j" || e.key === "J") { e.preventDefault(); cpGo(1); }
  else if (e.key === "k" || e.key === "K") { e.preventDefault(); cpGo(-1); }
  else if (e.key === "Escape" && $("#trDrw")) trDrawerClose();
});

// ------------------------------------------------------------------ paint
function cpPaint() {
  const root = cpRoot(); if (!root || !CP.j) return;
  const c = cpC(), ex = CP.j.executions || [], l = cpList(), pos = l.indexOf(CP.id);
  const vers = c.versions || [], atts = cpAllAtts();
  const tabs = [["steps", "Steps", (c.steps || []).length], ["versions", "Versions", vers.length], ["executions", "Executions", ex.length], ["attachments", "Attachments", atts.length], ["activity", "Activity", (CP.j.activity || []).length]];
  const arch = c.status === "Archived";
  const stSel = arch ? `<span class="pill gr">Archived</span>` : `<select class="cp-stsel st-${esc(c.status)}" id="cpSt" title="Status (saves immediately)">${CP_ST.map(([v, n]) => `<option value="${v}" ${c.status === v ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  const path = (c.folder_path || "").split(" / ").filter(Boolean);
  root.innerHTML = `${CP.full ? "" : '<div class="cp-rz" id="cpRz" title="Drag to resize"></div>'}<div class="cp-hd">
    <div class="cp-top">${CP.full ? `<span class="cp-sbt" id="cpSbT" title="Collapse / expand sidebar">☰</span><span class="cp-bc"><a id="cpBack">Test Case Repo</a>${path.map((p) => " › " + esc(p)).join("")} ›</span>` : ""}
      <b class="cp-id">${esc(c.id)}</b><span class="cp-nav"><button data-nav="-1" ${pos > 0 ? "" : "disabled"} title="Previous (K)">‹</button>${pos + 1} of ${l.length}<button data-nav="1" ${pos < l.length - 1 ? "" : "disabled"} title="Next (J)">›</button></span>
      <span class="cp-acts"><button class="btn g sm" id="cpEdit">✎ Edit</button><button class="btn g sm" id="cpAdd" ${arch ? "disabled" : ""}>＋ Add to cycle</button><button class="btn sm" id="cpRun" ${arch ? "disabled" : ""}>▶ Run now</button>
        <span style="position:relative"><button class="btn g sm" id="cpMore" title="More">⋯</button></span>
        ${CP.full ? `<button class="btn g sm" id="cpDrawer" title="Open as drawer">⤡</button>` : `<button class="btn g sm" id="cpFullB" title="Open full page">⤢</button><button class="btn g sm" id="cpX" title="Close (Esc)">✕</button>`}</span></div>
    <h2 class="cp-title">${esc(c.title)}</h2>
    <div class="cp-meta">${stSel}<span class="pill ${TR_PRIO(c.priority)}">${esc(c.priority)}</span><span class="pill ${TR_SRC[c.source] || "b"}">${esc(c.source)}</span><span class="pill d">v${c.version}</span>${c.last_result ? `<span class="pill ${TR_RES[c.last_result] ?? "gr"}">Last: ${esc(c.last_result)}</span>` : ""}${cpChip(c.story)}${(c.tags || []).map((t) => `<span class="pill gr">#${esc(t)}</span>`).join("")}
      <span class="muted">📁 ${esc(c.folder_path || "—")}</span><span class="muted">· Updated ${trDate(c.updated)}</span></div>
    <div class="cp-tabs">${tabs.map(([k, n, cnt]) => `<button data-t="${k}" class="${CP.tab === k ? "a" : ""}">${n} <span class="cp-cnt">${cnt}</span></button>`).join("")}</div></div>
    <div class="cp-body" id="cpBody">${({ steps: cpSteps, versions: cpVersions, executions: cpExecs, attachments: cpAtts, activity: cpActivity }[CP.tab] || cpSteps)()}</div>`;
  cpBindHeader(root);
  ({ steps: cpBindSteps, versions: cpBindVersions, executions: cpBindExecs, attachments: cpBindAtts, activity: cpBindActivity }[CP.tab] || cpBindSteps)(root);
}

function cpBindHeader(root) {
  const c = cpC();
  $$("[data-nav]", root).forEach((b) => (b.onclick = () => cpGo(+b.dataset.nav)));
  $$(".cp-tabs button", root).forEach((b) => (b.onclick = () => { CP.tab = b.dataset.t; cpPaint(); }));
  const x = $("#cpX", root); if (x) x.onclick = trDrawerClose;
  const fb = $("#cpFullB", root); if (fb) fb.onclick = () => cpFullOpen(c.id);
  const db = $("#cpDrawer", root); if (db) db.onclick = () => { const id = c.id; RP.full = null; CP.full = false; location.hash = "repo"; document.body.classList.remove("cp-sbmin"); render(); setTimeout(() => trDrawer(id, CP.tab), 50); };
  const bk = $("#cpBack", root); if (bk) bk.onclick = () => { location.hash = "repo"; };
  const sbt = $("#cpSbT", root); if (sbt) sbt.onclick = () => { localStorage.setItem("trCpSb", document.body.classList.contains("cp-sbmin") ? "open" : "min"); cpSb(); };
  $("#cpEdit", root).onclick = () => { trDrawerClose(); RP.full = null; CP.full = false; document.body.classList.remove("cp-sbmin"); RP.edit = { ...JSON.parse(JSON.stringify(c)), folder_path: c.folder_path }; if (location.hash !== "#repo") location.hash = "repo"; S.view = "repo"; render(); };
  $("#cpAdd", root).onclick = () => trAddToCycleModal([c.id]);
  $("#cpRun", root).onclick = cpRunNow;
  $("#cpMore", root).onclick = (e) => { e.stopPropagation(); cpMenu(e.currentTarget); };
  const st = $("#cpSt", root);
  if (st) st.onchange = async () => { try { await api(`/api/repo/cases/${encodeURIComponent(c.id)}/status`, { method: "POST", body: { status: st.value, by: cpMe() } }); toast(`Status: ${cpStLabel(st.value)}`); await cpReload(true); } catch (er) { toast(er.message, true); cpPaint(); } };
  const rz = $("#cpRz", root);
  if (rz) rz.onmousedown = (e) => {
    e.preventDefault(); const d = $("#trDrw"); document.body.classList.add("cp-resizing");
    const mv = (ev) => { d.style.width = Math.max(420, Math.min(innerWidth - 60, innerWidth - ev.clientX)) + "px"; };
    const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); document.body.classList.remove("cp-resizing"); localStorage.setItem("trDrwW", parseInt(d.style.width, 10)); };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  };
}

function cpMenu(anchor) {
  const old = $("#cpMenu"); if (old) return old.remove();
  const c = cpC(), arch = c.status === "Archived";
  const m = document.createElement("div"); m.id = "cpMenu"; m.className = "tr-expm cp-menu";
  m.innerHTML = `<a data-a="dup">⧉ Duplicate</a><a data-a="move">📁 Move to folder…</a><a data-a="exp">⬇ Export this case (.xlsx)</a><a data-a="csv">⬇ Export this case (.csv)</a><hr><a data-a="arch" style="color:${arch ? "#12a150" : "#d33"}">${arch ? "↺ Restore" : "🗄 Archive"}</a>`;
  anchor.parentElement.appendChild(m);
  setTimeout(() => document.addEventListener("click", function h(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("click", h); } }), 0);
  $$("a[data-a]", m).forEach((a) => (a.onclick = async () => {
    m.remove(); const k = a.dataset.a;
    try {
      if (k === "dup") { const r = await api(`/api/repo/cases/${encodeURIComponent(c.id)}/duplicate`, { method: "POST", body: { by: cpMe() } }); toast(`Duplicated as ${r.case.id}`); if (RP.data) RP.data = await api("/api/repo"); if ($("#trRepoBody")) trRepoRender(); if (CP.full) location.hash = "repo/case/" + r.case.id; else cpOpen(r.case.id); }
      if (k === "move") cpMoveModal();
      if (k === "exp" || k === "csv") cpExport(k === "csv" ? "csv" : "xlsx");
      if (k === "arch") { await api("/api/repo/bulk", { method: "POST", body: { ids: [c.id], op: arch ? "restore" : "archive", by: cpMe() } }); toast(arch ? "Restored (Draft)" : "Archived"); await cpReload(true); }
    } catch (er) { toast(er.message, true); }
  }));
}
async function cpMoveModal() {
  const c = cpC(); let fs = (RP.data || {}).folders;
  if (!fs) { try { fs = (await api("/api/repo")).folders; } catch (e) { return toast(e.message, true); } }
  const ov = trModal(`<div class="hd"><h3>Move ${esc(c.id)}</h3><span class="tr-x">✕</span></div><label>Destination folder</label>
    <select class="w" id="cpMvF">${trTreeRows(fs).map(({ f }) => `<option value="${f.id}" ${f.id === c.folder_id ? "selected" : ""}>${esc(f.path)}</option>`).join("")}</select>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn g tr-x">Cancel</button><button class="btn" id="cpMvGo" ${fs.length ? "" : "disabled"}>Move</button></div>`, 460);
  $("#cpMvGo", ov).onclick = () => guarded($("#cpMvGo"), async () => { await api("/api/repo/bulk", { method: "POST", body: { ids: [c.id], op: "move", folder_id: $("#cpMvF", ov).value, by: cpMe() } }); trClose(); toast("Moved"); await cpReload(true); });
}
async function cpExport(fmt) {
  const c = cpC();
  try {
    const r = await fetch("/api/repo/export", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [c.id], format: fmt, include_archived: true }) });
    if (r.status === 401) { window.location.href = "/welcome"; return; }
    if (!r.ok) { let j = {}; try { j = await r.json(); } catch (e) { /* not json */ } throw new Error(j.error || `HTTP ${r.status}`); }
    const blob = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${c.id}.${fmt}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Exported ${c.id} as ${fmt.toUpperCase()}`);
  } catch (e) { toast("Export failed: " + e.message, true); }
}

// Run now: open the execution screen for this case (existing cycle item, another cycle, or a new quick-run cycle)
async function cpRunNow() {
  const c = cpC(), mine = CP.j.cycles || [];
  let cy = []; try { cy = (await api("/api/runs")).cycles.filter((x) => x.status !== "Archived" && !mine.some((m) => m.cycle_id === x.id)); } catch (e) { /* ignore */ }
  const d = new Date(), dd = `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en-US", { month: "short" })}-${d.getFullYear()}`;
  const ov = trModal(`<div class="hd"><h3>▶ Run ${esc(c.id)}</h3><span class="tr-x">✕</span></div>
    <label>Execute in</label><select class="w" id="cpRnC">
      ${mine.length ? `<optgroup label="Cycles that already contain this case">${mine.map((m) => `<option value="in:${m.cycle_id}:${m.key}">${esc(m.cycle_name)} (${m.cycle_id}) · ${esc(m.status || "Not run")}</option>`).join("")}</optgroup>` : ""}
      ${cy.length ? `<optgroup label="Add to another cycle">${cy.map((x) => `<option value="add:${x.id}">${esc(x.name)} (${x.id})</option>`).join("")}</optgroup>` : ""}
      <option value="new" ${mine.length ? "" : "selected"}>— New quick-run cycle —</option></select>
    <div id="cpRnNew" style="${mine.length ? "display:none" : ""}"><label>Cycle name</label><input class="w" id="cpRnN" value="Quick run – ${esc(c.story || c.id)} – ${dd}"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn g tr-x">Cancel</button><button class="btn s" id="cpRnGo">▶ Start execution</button></div>`, 520);
  $("#cpRnC", ov).onchange = (e) => ($("#cpRnNew").style.display = e.target.value === "new" ? "" : "none");
  $("#cpRnGo", ov).onclick = () => guarded($("#cpRnGo"), async () => {
    const v = $("#cpRnC").value; let cid, key;
    if (v.startsWith("in:")) [, cid, key] = v.split(":");
    else if (v.startsWith("add:")) { cid = v.slice(4); await api(`/api/runs/${cid}/items`, { method: "POST", body: { case_ids: [c.id] } }); }
    else { const n = $("#cpRnN").value.trim(); if (!n) throw new Error("Cycle name is required."); const r = await api("/api/runs", { method: "POST", body: { name: n, case_ids: [c.id] } }); cid = r.cycle.id; key = ((r.cycle.items || [])[0] || {}).key; }
    if (!key) { const cyc = (await api(`/api/runs/${cid}`)).cycle; key = ((cyc.items || []).find((i) => i.case_id === c.id) || {}).key; }
    if (!key) throw new Error("Could not find the case in that cycle.");
    trClose(); trDrawerClose(); RP.full = null; CP.full = false; document.body.classList.remove("cp-sbmin");
    if (window.RS) { RS.cycle = cid; if (RS.sel) RS.sel.clear(); RS.exec = { queue: [key], key }; }
    go("runs");
  });
}

// ------------------------------------------------------------------ Steps tab
function cpStats() {
  const c = cpC(), ex = CP.j.executions || [], done = ex.filter((e) => e.status && e.status !== "Not run");
  const pass = done.filter((e) => e.status === "Pass").length, last = ex[0];
  const dots = ex.slice(0, 5).map((e) => `<i style="background:${CP_DOT[e.status] || "#cbd5e1"}" title="${esc(e.status)} · ${esc(e.cycle_name || "")} · ${trDate(e.ts)}"></i>`).join("") + "<i></i>".repeat(Math.max(0, 5 - Math.min(5, ex.length)));
  return `<div class="cp-stats"><div><span>Steps</span><b>${(c.steps || []).length}</b></div>
    <div><span>Story</span><b>${c.story ? (cpJira(c.story) ? `<a href="${cpJira(c.story)}" target="_blank" rel="noopener">${esc(c.story)} ↗</a>` : esc(c.story)) : "—"}</b></div>
    <div><span>Last run</span><b>${last ? `<span class="pill ${TR_RES[last.status] ?? "gr"}">${esc(last.status)}</span> ${trDate(last.ts)}` : "Never"}</b></div>
    <div><span>Pass rate</span><b>${done.length ? `${Math.round((100 * pass) / done.length)}% <small class="muted">(${pass}/${done.length})</small>` : "—"}</b></div>
    <div><span>Last 5 runs</span><b class="cp-dots">${dots}</b></div></div>`;
}
function cpWorkSteps() { return CP.draft || cpC().steps || []; }
function cpSteps() {
  const c = cpC(), st = cpWorkSteps(), det = CP.mode === "detailed";
  const card = (s, i) => {
    if (CP.edit === i) return `<div class="cp-st ed" data-i="${i}"><span class="cp-dh">⋮⋮</span><span class="cp-n">${i + 1}</span>
      <div><div class="tr-lbl">Action</div><textarea class="w" rows="3" id="cpEA">${esc(s.step)}</textarea></div><div><div class="tr-lbl">Expected result</div><textarea class="w" rows="3" id="cpEE">${esc(s.expected)}</textarea></div><span></span>
      <div class="cp-edrow"><input id="cpED" value="${esc(s.data || "")}" placeholder="Test data"><small class="muted">Test data</small><span style="margin-left:auto" class="fl"><button class="btn g sm" id="cpECancel">Cancel</button><button class="btn sm" id="cpESave">✓ Save step</button></span></div></div>`;
    if (!det) return `<div class="cp-st cm" draggable="true" data-i="${i}"><span class="cp-dh">⋮⋮</span><span class="cp-n">${i + 1}</span><div class="cp-ce" data-e="${i}">${esc(s.step)} <span class="muted">→ ${esc(s.expected)}</span>${s.data ? ` <span class="cp-data">${esc(s.data)}</span>` : ""}</div><span class="cp-ic"><span data-e="${i}" title="Edit">✎</span><span data-d="${i}" title="Delete">🗑</span></span></div>`;
    return `<div class="cp-st" draggable="true" data-i="${i}"><span class="cp-dh" title="Drag to reorder">⋮⋮</span><span class="cp-n">${i + 1}</span>
      <div class="cp-ce" data-e="${i}"><div class="tr-lbl">Action</div>${esc(s.step) || '<span class="muted">—</span>'}${s.data ? `<div><span class="cp-data">${esc(s.data)}</span></div>` : ""}</div>
      <div class="cp-ce" data-e="${i}"><div class="tr-lbl">Expected result</div>${esc(s.expected) || '<span class="muted">—</span>'}</div>
      <span class="cp-ic"><span data-e="${i}" title="Edit">✎</span><span data-d="${i}" title="Delete">🗑</span></span></div>`;
  };
  const ins = (i) => `<div class="cp-ins" data-ins="${i}"><span>＋ insert step</span></div>`;
  return `${cpStats()}
    <details class="cp-desc" open><summary>Description &amp; Precondition</summary><div><b>Description:</b> ${esc(c.description || "—")}</div><div><b>Precondition:</b> ${esc(c.precondition || "—")}</div></details>
    <div class="cp-sh"><b>Steps (${st.length})</b><span class="sg cp-mode"><button data-m="detailed" class="${det ? "A" : ""}">Detailed</button><button data-m="compact" class="${det ? "" : "A"}">Compact</button></span>
      <span style="margin-left:auto" class="fl"><button class="btn g sm" id="cpCopy">⎘ Copy steps</button><button class="btn g sm" id="cpRegen">✨ Regenerate with AI</button><button class="btn g sm" id="cpAddSt">＋ Add step</button></span></div>
    <div id="cpStList">${st.length ? st.map((s, i) => (i ? ins(i) : "") + card(s, i)).join("") + ins(st.length) : `<div class="tr-empty">No steps yet. ${ins(0)}</div>`}</div>
    <div class="hint">Click a step to edit · drag ⋮⋮ to reorder · each save creates a new version · J / K = next / previous case</div>`;
}
async function cpSaveSteps(steps, note) {
  const c = cpC();
  const r = await api(`/api/repo/cases/${encodeURIComponent(c.id)}`, { method: "PUT", body: { steps, note, by: cpMe() } });
  CP.edit = null; CP.draft = null; toast(r.new_version ? `Saved · new version v${r.case.version}` : "No changes"); await cpReload(true);
}
function cpBindSteps(root) {
  const steps = () => JSON.parse(JSON.stringify(cpWorkSteps()));
  $$(".cp-mode button", root).forEach((b) => (b.onclick = () => { CP.mode = b.dataset.m; localStorage.setItem("trCpMode", CP.mode); cpPaint(); }));
  const startEdit = (i) => { if (CP.edit !== null && CP.edit !== i && CP.draft) CP.draft = null; CP.edit = i; cpPaint(); const a = $("#cpEA"); if (a) a.focus(); };
  $$("[data-e]", root).forEach((el) => (el.onclick = (e) => { if (window.getSelection && String(window.getSelection())) return; e.stopPropagation(); startEdit(+el.dataset.e); }));
  $$("[data-d]", root).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); const i = +el.dataset.d; if (!confirm(`Delete step ${i + 1}? (saves a new version)`)) return; const s = steps(); s.splice(i, 1); guarded(null, () => cpSaveSteps(s, `Deleted step ${i + 1}`)); }));
  $$("[data-ins]", root).forEach((el) => (el.onclick = () => { const i = +el.dataset.ins; const s = JSON.parse(JSON.stringify(cpC().steps || [])); s.splice(i, 0, { step: "", expected: "", data: "" }); CP.draft = s; CP.edit = i; cpPaint(); const a = $("#cpEA"); if (a) a.focus(); }));
  $("#cpAddSt", root).onclick = () => { const s = JSON.parse(JSON.stringify(cpC().steps || [])); s.push({ step: "", expected: "", data: "" }); CP.draft = s; CP.edit = s.length - 1; cpPaint(); const a = $("#cpEA"); if (a) { a.focus(); a.scrollIntoView({ block: "center" }); } };
  const cc = $("#cpECancel", root); if (cc) cc.onclick = () => { CP.edit = null; CP.draft = null; cpPaint(); };
  const sv = $("#cpESave", root);
  if (sv) {
    const save = () => guarded(sv, async () => {
      const i = CP.edit, s = steps(); const isNew = !!CP.draft;
      s[i] = { step: $("#cpEA").value.trim(), expected: $("#cpEE").value.trim(), data: $("#cpED").value.trim() };
      if (!s[i].step && !s[i].expected && !s[i].data) throw new Error("Write an action or expected result first.");
      await cpSaveSteps(s, isNew ? `Inserted step ${i + 1}` : `Edited step ${i + 1}`);
    });
    sv.onclick = save;
    $$("#cpEA,#cpEE,#cpED", root).forEach((el) => (el.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save(); if (e.key === "Escape") { e.stopPropagation(); CP.edit = null; CP.draft = null; cpPaint(); } }));
  }
  let drag = null;
  $$(".cp-st[draggable]", root).forEach((el) => {
    const i = +el.dataset.i;
    el.ondragstart = (e) => { if (CP.edit !== null) return e.preventDefault(); drag = i; e.dataTransfer.effectAllowed = "move"; el.classList.add("ghost"); };
    el.ondragend = () => { el.classList.remove("ghost"); $$(".cp-st.dov", root).forEach((x) => x.classList.remove("dov")); };
    el.ondragover = (e) => { if (drag === null || drag === i) return; e.preventDefault(); $$(".cp-st.dov", root).forEach((x) => x.classList.remove("dov")); el.classList.add("dov"); };
    el.ondrop = (e) => { e.preventDefault(); if (drag === null || drag === i) return; const s = steps(); const [m] = s.splice(drag, 1); s.splice(i, 0, m); const from = drag; drag = null; guarded(null, () => cpSaveSteps(s, `Moved step ${from + 1} → ${i + 1}`)); };
  });
  $("#cpCopy", root).onclick = () => {
    const c = cpC();
    const txt = [`${c.id} – ${c.title}`, c.precondition ? `Precondition: ${c.precondition}` : "", ...(c.steps || []).map((s, i) => `${i + 1}. ${s.step}\n   Expected: ${s.expected}${s.data ? `\n   Test data: ${s.data}` : ""}`)].filter(Boolean).join("\n");
    const ok = () => toast(`Copied ${(c.steps || []).length} step(s) to clipboard`);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(ok, () => cpCopyFallback(txt, ok)); else cpCopyFallback(txt, ok);
  };
  $("#cpRegen", root).onclick = cpRegenModal;
}
function cpCopyFallback(txt, ok) { const t = document.createElement("textarea"); t.value = txt; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); ok(); } catch (e) { toast("Copy failed", true); } t.remove(); }
function cpRegenShowProposal(c, instruction, provider, model, prior) {
  const ov = trModal(`<div class="hd"><h3>✨ Regenerate ${esc(c.id)} with AI</h3><span class="tr-x">✕</span></div>
    <div class="hint">Proposal only — nothing is saved until you confirm, then it becomes a new version (restorable from Versions). ${provider ? esc((typeof prettyProvider === "function" ? prettyProvider(provider) : provider) + (model ? " · " + model : "")) : ""}</div>
    <div id="cpRgOut"><div class="sub">Generating proposal…</div></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn g tr-x">Cancel</button><button class="btn" id="cpRgGo">↻ Try again</button><button class="btn s" id="cpRgSave" style="display:none">✓ Save as new version</button></div>`, 820);
  let prop = prior || null;
  const load = () => guarded($("#cpRgGo", ov), async () => {
    $("#cpRgOut").innerHTML = `<div class="sub">Generating proposal…</div>`;
    const r = await api(`/api/repo/cases/${encodeURIComponent(c.id)}/regenerate`, { method: "POST", body: { instruction: instruction || "", model: provider || undefined, model_name: model || undefined } });
    prop = r.proposal; const u = r.usage || {}; const d = cpDiffBlocks(c, prop, "inline");
    $("#cpRgOut").innerHTML = `<div class="cp-vh" style="margin-top:12px"><b>Proposed changes</b> <span class="cp-m">−${d.del}</span><span class="cp-p">+${d.ins}</span><small class="muted" style="margin-left:auto">${esc(u.model_name || "")} · ${fmt(u.total_tokens)} tokens</small></div><div style="max-height:45vh;overflow:auto">${d.html}</div>`;
    $("#cpRgSave").style.display = "";
  });
  $("#cpRgGo", ov).onclick = load;
  if (!prior) load();
  $("#cpRgSave", ov).onclick = () => guarded($("#cpRgSave"), async () => {
    if (!prop || !confirm("Save the AI proposal as a new version of this case?")) return;
    const r = await api(`/api/repo/cases/${encodeURIComponent(c.id)}`, { method: "PUT", body: { ...prop, note: "Regenerated with AI", event_type: "regenerated", by: cpMe() } });
    trClose(); toast(r.new_version ? `Regenerated · new version v${r.case.version}` : "No changes"); await cpReload(true);
  });
}
function cpRegenModal() {
  const c = cpC();
  const defProv = (window.resolvedRunProvider && resolvedRunProvider()) || (typeof defaultProvider === "function" ? defaultProvider() : "gemini");
  const defModel = (typeof tcDefaultId === "function" ? tcDefaultId(defProv) : "") || "";
  const tc = { id: c.id, name: c.title, title: c.title, description: c.description, precondition: c.precondition, priority: c.priority, steps: c.steps };
  if (typeof openAiPicker === "function") {
    return openAiPicker({
      title: "Regenerate with AI",
      sub: "Proposal only — nothing is saved until you confirm. Same picker as Review.",
      confirmLabel: "Confirm & generate proposal",
      kind: "regenerate", expected: 400, compose: true, instruction: true,
      provider: defProv, model: defModel, test_case: tc,
      extra: { feature_text: c.story || "" },
      onConfirm: (p) => cpRegenShowProposal(c, p.instruction, p.provider, p.model),
    });
  }
  cpRegenShowProposal(c, "", defProv, defModel);
}

// ------------------------------------------------------------------ Versions tab (word diff per field / step)
function cpWDiff(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a === b) return { inl: esc(a), l: esc(a), r: esc(b), del: 0, ins: 0 };
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/), n = A.length, m = B.length;
  if (n * m > 250000) return { inl: `<span class="tr-del">${esc(a)}</span> <span class="tr-ins">${esc(b)}</span>`, l: `<span class="tr-del">${esc(a)}</span>`, r: `<span class="tr-ins">${esc(b)}</span>`, del: a ? 1 : 0, ins: b ? 1 : 0 };
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; const push = (t, s) => { const z = out[out.length - 1]; if (z && z[0] === t) z[1] += s; else out.push([t, s]); };
  let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { push("=", A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) push("-", A[i++]); else push("+", B[j++]); }
  while (i < n) push("-", A[i++]); while (j < m) push("+", B[j++]);
  let del = 0, ins = 0;
  const D = (s) => (s.trim() ? (del++, `<span class="tr-del">${esc(s)}</span>`) : esc(s)), I = (s) => (s.trim() ? (ins++, `<span class="tr-ins">${esc(s)}</span>`) : esc(s));
  const inl = out.map(([t, s]) => (t === "=" ? esc(s) : t === "-" ? D(s) : I(s))).join("");
  const l = out.map(([t, s]) => (t === "+" ? "" : t === "-" ? `<span class="tr-del">${esc(s)}</span>` : esc(s))).join("");
  const r = out.map(([t, s]) => (t === "-" ? "" : t === "+" ? `<span class="tr-ins">${esc(s)}</span>` : esc(s))).join("");
  return { inl, l, r, del, ins };
}
function cpDiffBlocks(o, nw, mode) {
  o = o || {}; nw = nw || {}; let del = 0, ins = 0, same = 0; const blocks = [];
  const blk = (label, a, b) => { const d = cpWDiff(a, b); if (!d.del && !d.ins) return false; del += d.del; ins += d.ins;
    blocks.push(`<div class="cp-dblk"><div class="cp-dl">${label}</div>${mode === "side" ? `<div class="cp-sbs"><div>${d.l || '<span class="muted">(empty)</span>'}</div><div>${d.r || '<span class="muted">(empty)</span>'}</div></div>` : `<div>${d.inl}</div>`}</div>`); return true; };
  [["title", "Title"], ["description", "Description"], ["precondition", "Precondition"], ["priority", "Priority"], ["type", "Type"]].forEach(([k, n]) => blk(n, o[k], nw[k]));
  const so = o.steps || [], sn = nw.steps || [];
  for (let i = 0; i < Math.max(so.length, sn.length); i++) {
    const a = so[i] || {}, b = sn[i] || {}; const tag = !so[i] ? " · added" : !sn[i] ? " · removed" : "";
    const ch = [["step", "Action"], ["expected", "Expected"], ["data", "Test data"]].map(([k, n]) => blk(`Step ${i + 1}${tag} · ${n}`, a[k], b[k])).some(Boolean);
    if (!ch) same++;
  }
  if (same) blocks.push(`<div class="cp-dblk muted">${same} step(s) unchanged</div>`);
  if (!del && !ins) blocks.unshift(`<div class="cp-dblk muted">No content differences.</div>`);
  return { html: blocks.join(""), del, ins };
}
function cpVersions() {
  const c = cpC(), vs = c.versions || [];
  if (!vs.length) return `<div class="tr-empty">No versions recorded.</div>`;
  const cur = c.version; if (!CP.selV || !vs.some((v) => v.version === CP.selV)) CP.selV = vs[vs.length - 1].version;
  const others = vs.filter((v) => v.version !== CP.selV);
  if (!CP.cmpV || CP.cmpV === CP.selV || !vs.some((v) => v.version === CP.cmpV)) { const prev = [...vs].reverse().find((v) => v.version < CP.selV); CP.cmpV = (prev || others[0] || {}).version || null; }
  const sel = vs.find((v) => v.version === CP.selV), cmp = vs.find((v) => v.version === CP.cmpV);
  const [older, newer] = !cmp ? [null, sel] : cmp.version < sel.version ? [cmp, sel] : [sel, cmp];
  const d = older ? cpDiffBlocks(older.snapshot, newer.snapshot, CP.dmode) : null;
  const restoreV = CP.selV !== cur ? CP.selV : CP.cmpV;
  return `<div class="cp-vg"><div class="cp-vl">${[...vs].reverse().map((v) => `<div class="cp-vi ${v.version === CP.selV ? "a" : ""} ${v.version === CP.cmpV ? "c" : ""}" data-v="${v.version}"><b>v${v.version}</b>${v.version === cur ? ' <span class="pill b">Current</span>' : ""}${v.version === 1 && c.source ? ` <span class="pill ${TR_SRC[c.source] || "b"}">${esc(c.source)}</span>` : ""}
      <div class="muted">${trTime(v.ts)} · ${esc(v.note || "")}</div><small class="muted">${(v.snapshot.steps || []).length} steps</small></div>`).join("")}</div>
    <div><div class="cp-vh"><b>${older ? `Changes v${older.version} → v${newer.version}` : `v${sel.version} (only version)`}</b>${d ? `<span class="cp-m">−${d.del}</span><span class="cp-p">+${d.ins}</span>` : ""}
      <span style="margin-left:auto" class="fl"><span class="sg"><button data-dm="inline" class="${CP.dmode === "inline" ? "A" : ""}">Inline</button><button data-dm="side" class="${CP.dmode === "side" ? "A" : ""}">Side-by-side</button></span>
      ${others.length ? `<select id="cpCmp">${others.map((v) => `<option value="${v.version}" ${v.version === CP.cmpV ? "selected" : ""}>Compare: v${v.version}</option>`).join("")}</select>` : ""}
      ${restoreV && restoreV !== cur ? `<button class="btn g sm" id="cpRestore" data-v="${restoreV}">↺ Restore v${restoreV}</button>` : ""}</span></div>
      ${d ? (CP.dmode === "side" ? `<div class="cp-sbs cp-sbh"><div>v${older.version}</div><div>v${newer.version}</div></div>` : "") + d.html : `<div class="cp-dblk muted">Nothing to compare yet.</div>`}</div></div>`;
}
function cpBindVersions(root) {
  $$(".cp-vi", root).forEach((el) => (el.onclick = () => { CP.selV = +el.dataset.v; CP.cmpV = null; cpPaint(); }));
  const s = $("#cpCmp", root); if (s) s.onchange = () => { CP.cmpV = +s.value; cpPaint(); };
  $$("[data-dm]", root).forEach((b) => (b.onclick = () => { CP.dmode = b.dataset.dm; cpPaint(); }));
  const r = $("#cpRestore", root);
  if (r) r.onclick = () => { const v = +r.dataset.v; if (!confirm(`Restore v${v}? This creates a new version with v${v}'s content (history is kept).`)) return;
    guarded(r, async () => { const j = await api(`/api/repo/cases/${encodeURIComponent(CP.id)}/restore_version`, { method: "POST", body: { version: v, by: cpMe() } }); toast(j.new_version ? `Restored v${v} as v${j.case.version}` : "Already identical"); CP.selV = null; CP.cmpV = null; await cpReload(true); }); };
}

// ------------------------------------------------------------------ Executions / Attachments
function cpThumb(a) {
  const m = a.mime || "", u = `/api/attachments/${encodeURIComponent(a.name)}`;
  const inner = m.startsWith("image") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name) ? `<img src="${u}" alt="" loading="lazy">` : m.startsWith("video") || /\.(mp4|webm|mov|ogg)$/i.test(a.name) ? "▶" : "📄";
  return `<span class="cp-th" data-att="${esc(a.name)}" data-mime="${esc(m)}" data-orig="${esc(a.orig || a.name)}" title="${esc(a.orig || a.name)}">${inner}</span>`;
}
function cpLightbox(a) {
  const u = `/api/attachments/${encodeURIComponent(a.name)}`, m = a.mime || "";
  const lb = document.createElement("div"); lb.className = "tr-lb"; lb.id = "trLb";
  const vid = m.startsWith("video") || /\.(mp4|webm|mov|ogg)$/i.test(a.name), img = m.startsWith("image") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name);
  lb.innerHTML = `<span class="x">✕</span>${vid ? `<video src="${u}" controls autoplay></video>` : img ? `<img src="${u}" alt="">` : `<a href="${u}" target="_blank" style="color:#fff">Open ${esc(a.orig || a.name)}</a>`}`;
  lb.onclick = (e) => { if (e.target === lb || e.target.classList.contains("x")) lb.remove(); };
  document.body.appendChild(lb);
}
function cpBindThumbs(root) { $$("[data-att]", root).forEach((t) => (t.onclick = (e) => { if (e.target.closest("[data-rm]")) return; cpLightbox({ name: t.dataset.att, mime: t.dataset.mime, orig: t.dataset.orig }); })); }
function cpSnap(e) { const c = cpC(); const v = (c.versions || []).find((x) => x.version === e.case_version); return ((v && v.snapshot) || c).steps || []; }
function cpExecs() {
  const ex = CP.j.executions || [];
  if (!ex.length) return `<div class="tr-empty">Not executed yet. Use <b>▶ Run now</b> to execute this case.</div>`;
  return `<div class="cp-tl">${ex.map((e, n) => { const open = CP.open[e.id] ?? n === 0; const sn = cpSnap(e);
    return `<div class="cp-tli"><span class="cp-tld" style="background:${CP_DOT[e.status] || "#cbd5e1"}"></span><div class="cp-ex ${open ? "o" : ""}">
      <div class="cp-exh" data-x="${e.id}"><b>${open ? "▾" : "▸"} ${esc(e.cycle_name || e.cycle_id)}</b><span class="muted">${trTime(e.ts)} · ${esc(e.tester || "—")}${e.env ? " · " + esc(e.env) : ""}${e.build ? " · " + esc(e.build) : ""} · v${e.case_version}</span>
        ${(e.defects || []).map(cpDefect).join("")}<span class="pill ${TR_RES[e.status] ?? "gr"}" style="margin-left:auto">${esc(e.status)}</span></div>
      ${open ? `<table class="cp-ext"><tr><th>#</th><th>Step</th><th>Actual result</th><th>Result</th><th>Evidence</th></tr>
        ${(e.steps || []).map((s, i) => `<tr><td>${i + 1}</td><td>${esc(((sn[i] || {}).step || "").slice(0, 160))}</td><td>${esc(s.actual || "—")}</td><td>${s.status ? `<span class="pill ${TR_RES[s.status] ?? "gr"}">${esc(s.status)}</span>` : '<span class="muted">—</span>'}</td><td>${(s.attachments || []).map(cpThumb).join("") || "—"}</td></tr>`).join("")}</table>
        ${e.override_reason ? `<div class="muted" style="margin-top:6px">Override (auto: ${esc(e.auto_status)}): <i>${esc(e.override_reason)}</i></div>` : ""}${e.comments ? `<div class="muted" style="margin-top:6px">💬 ${esc(e.comments)}</div>` : ""}${e.duration ? `<div class="muted" style="margin-top:4px">⏱ ${Math.round(e.duration / 60)} min</div>` : ""}` : ""}</div></div>`; }).join("")}</div>`;
}
function cpBindExecs(root) { $$("[data-x]", root).forEach((h) => (h.onclick = (e) => { if (e.target.closest("a")) return; const id = h.dataset.x, ex = CP.j.executions || []; const n = ex.findIndex((x) => x.id === id); CP.open[id] = !(CP.open[id] ?? n === 0); cpPaint(); })); cpBindThumbs(root); }
function cpAllAtts() {
  const out = [];
  (CP.j.executions || []).forEach((e) => (e.steps || []).forEach((s, i) => (s.attachments || []).forEach((a) => out.push({ ...a, ex: e, step: i + 1 }))));
  (cpC().attachments || []).forEach((a) => out.push({ ...a, ex: null }));
  return out;
}
function cpKind(a) { const m = a.mime || ""; return m.startsWith("image") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name) ? "image" : m.startsWith("video") || /\.(mp4|webm|mov|ogg)$/i.test(a.name) ? "video" : "other"; }
function cpAtts() {
  const all = cpAllAtts().filter((a) => CP.att === "all" || cpKind(a) === CP.att);
  const tile = (a, rm) => `<div class="cp-tile">${cpThumb(a)}${rm ? `<span class="cp-rm" data-rm="${esc(a.name)}" title="Remove from case">✕</span>` : ""}<div class="cp-tn">${a.step ? `Step ${a.step} · ` : ""}${esc(a.orig || a.name)}</div></div>`;
  const groups = []; const seen = {};
  all.filter((a) => a.ex).forEach((a) => { if (!seen[a.ex.id]) { seen[a.ex.id] = { e: a.ex, items: [] }; groups.push(seen[a.ex.id]); } seen[a.ex.id].items.push(a); });
  const caseA = all.filter((a) => !a.ex);
  return `<div class="cp-sh"><select id="cpAttT">${[["all", "Type: All"], ["image", "Images"], ["video", "Videos"], ["other", "Other files"]].map(([k, n]) => `<option value="${k}" ${CP.att === k ? "selected" : ""}>${n}</option>`).join("")}</select><span class="muted">Grouped by run</span>
    <span style="margin-left:auto"><button class="btn g sm" id="cpUp">⬆ Upload</button><input type="file" id="cpUpF" multiple accept="image/*,video/*,.txt,.log,.pdf" style="display:none"></span></div>
    ${groups.map((g) => `<div class="cp-ag"><b>${esc(g.e.cycle_name || g.e.cycle_id)} · ${trDate(g.e.ts)} · <span class="pill ${TR_RES[g.e.status] ?? "gr"}">${esc(g.e.status)}</span></b><div class="cp-grid">${g.items.map((a) => tile(a)).join("")}</div></div>`).join("")}
    <div class="cp-ag"><b>Case attachments</b><div class="cp-grid">${caseA.map((a) => tile(a, true)).join("") || '<span class="muted">None yet — upload specs, screenshots or logs (max 50 MB each).</span>'}</div></div>
    ${!groups.length && CP.att === "all" ? '<div class="muted">No run evidence yet. Screenshots and videos attached during execution show up here.</div>' : ""}`;
}
function cpBindAtts(root) {
  cpBindThumbs(root);
  $("#cpAttT", root).onchange = (e) => { CP.att = e.target.value; cpPaint(); };
  $("#cpUp", root).onclick = () => $("#cpUpF", root).click();
  $("#cpUpF", root).onchange = (e) => guarded($("#cpUp"), async () => {
    let n = 0;
    for (const f of e.target.files) {
      if (f.size > 50 * 1024 * 1024) { toast(`${f.name} is larger than 50 MB`, true); continue; }
      const r = await api("/api/attachments", { method: "POST", body: { filename: f.name, mime: f.type, data: await trFileB64(f) } });
      await api(`/api/repo/cases/${encodeURIComponent(CP.id)}/attachments`, { method: "POST", body: { attachment: r.attachment, by: cpMe() } }); n++;
    }
    if (n) toast(`Attached ${n} file(s)`); await cpReload();
  });
  $$("[data-rm]", root).forEach((x) => (x.onclick = (e) => { e.stopPropagation(); if (!confirm("Remove this attachment from the case?")) return;
    guarded(null, async () => { await api(`/api/repo/cases/${encodeURIComponent(CP.id)}/attachments/${encodeURIComponent(x.dataset.rm)}`, { method: "DELETE" }); toast("Removed"); await cpReload(); }); }));
}

// ------------------------------------------------------------------ Activity tab
const CP_ACT = { all: null, edits: ["created", "edited", "restored", "regenerated", "duplicated"], status: ["status", "archived", "restored", "moved"], runs: ["ran"], comments: ["commented", "attached"] };
function cpEvText(e) {
  const who = `<b>${esc(e.by || (e.type === "created" && cpC().source === "AI" ? "AI" : "Someone"))}</b>`;
  switch (e.type) {
    case "created": return `Created${e.by ? " by " + who : ""}${e.text ? " · " + esc(e.text) : ""}`;
    case "edited": return `${who} edited${e.text ? " · " + esc(e.text) : ""}${e.version ? ` <span class="pill d">v${e.version}</span>` : ""}`;
    case "regenerated": return `${who} regenerated with AI${e.version ? ` <span class="pill d">v${e.version}</span>` : ""}`;
    case "restored": return `${who} ${esc(e.text || "restored")}${e.version ? ` <span class="pill d">v${e.version}</span>` : ""}`;
    case "status": return `${who} changed status <span class="pill gr">${esc(cpStLabel(e.old || ""))}</span> → <span class="pill ${TR_ST[e.new] ?? "gr"}">${esc(cpStLabel(e.new || ""))}</span>`;
    case "moved": return `${who} ${esc(e.text || "moved the case")}`;
    case "archived": return `${who} ${esc(e.text || "archived")}`;
    case "ran": return `${who} ran in <b>${esc(e.text || e.cycle_id || "a cycle")}</b> → <span class="pill ${TR_RES[e.result] ?? "gr"}">${esc(e.result || "")}</span>`;
    case "commented": return `${who} commented: <span class="muted">“${esc(e.text)}”</span>`;
    case "attached": return `${who} ${esc(e.text)}`;
    case "duplicated": return `${who} ${esc(e.text)}`;
    default: return `${who} ${esc(e.type)} ${esc(e.text || "")}`;
  }
}
const CP_ICON = { created: "✨", edited: "✎", regenerated: "✨", restored: "↺", status: "⇄", moved: "📁", archived: "🗄", ran: "▶", commented: "💬", attached: "📎", duplicated: "⧉" };
function cpActivity() {
  const f = CP_ACT[CP.act]; const ev = (CP.j.activity || []).filter((e) => !f || f.includes(e.type)); const cm = cpC().comments || [];
  const av = (n) => `<span class="cp-av" style="background:${["#4361ee", "#12a150", "#a855f7", "#f59e0b", "#0ea5e9"][(n || "?").charCodeAt(0) % 5]}">${esc((n || "?").charAt(0).toUpperCase())}</span>`;
  return `<div class="cp-ag2"><div><div class="cp-sh"><b>Audit log</b><select id="cpActF">${[["all", "All events"], ["edits", "Edits & versions"], ["status", "Status / move / archive"], ["runs", "Runs"], ["comments", "Comments & files"]].map(([k, n]) => `<option value="${k}" ${CP.act === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      ${ev.map((e) => `<div class="cp-ev"><span class="cp-evi">${CP_ICON[e.type] || "•"}</span><div class="t">${cpEvText(e)}</div><small class="muted">${trTime(e.ts)}</small></div>`).join("") || '<div class="muted">No events.</div>'}
      <div class="hint">Older history is derived from versions and executions; new events are recorded on the case.</div></div>
    <div><div class="cp-sh"><b>Comments (${cm.length})</b></div>${cm.map((m) => `<div class="cp-cm">${av(m.by)}<div class="b"><b>${esc(m.by || "User")}</b> <small class="muted">· ${trTime(m.ts)}</small><div>${esc(m.text).replace(/\n/g, "<br>")}</div></div></div>`).join("") || '<div class="muted" style="margin-bottom:8px">No comments yet.</div>'}
      <textarea class="w" rows="3" id="cpCmT" placeholder="Add a comment…"></textarea><div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn sm" id="cpCmGo">Comment</button></div></div></div>`;
}
function cpBindActivity(root) {
  $("#cpActF", root).onchange = (e) => { CP.act = e.target.value; cpPaint(); };
  const go2 = () => guarded($("#cpCmGo"), async () => { const t = $("#cpCmT").value.trim(); if (!t) throw new Error("Write a comment first."); await api(`/api/repo/cases/${encodeURIComponent(CP.id)}/comments`, { method: "POST", body: { text: t, by: cpMe() } }); toast("Comment added"); await cpReload(); });
  $("#cpCmGo", root).onclick = go2;
  $("#cpCmT", root).onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) go2(); };
}
