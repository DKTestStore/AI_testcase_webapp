/* Compare runs: two runs of the same story from Run history. Read-only diff computed in the browser;
   matching = title similarity >= 70% first, then step similarity; each test case is matched at most once. */
"use strict";

const CMP = { sel: [], data: null, rows: [], hide: false, kind: "", undo: null };
const CMP_T = 0.7;
function cBig(s) { s = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; }
function cDice(a, b) {   // bigram Dice similarity 0..1
  const x = cBig(a), y = cBig(b); let n = 0, tx = 0, ty = 0;
  x.forEach((v) => (tx += v)); y.forEach((v) => (ty += v));
  if (!tx && !ty) return 1; x.forEach((v, g) => (n += Math.min(v, y.get(g) || 0)));
  return (2 * n) / (tx + ty || 1);
}
const cStepTxt = (t) => (t.steps || []).map((s) => `${s.description} ${s.expected}`).join(" ");
const cStepsEq = (a, b) => JSON.stringify((a.steps || []).map((s) => [s.description, s.expected])) === JSON.stringify((b.steps || []).map((s) => [s.description, s.expected]));
const cSame = (a, b) => a.name === b.name && (a.description || "") === (b.description || "") && (a.precondition || "") === (b.precondition || "") && (a.priority || "") === (b.priority || "") && [...(a.acs || [])].sort().join() === [...(b.acs || [])].sort().join() && cStepsEq(a, b);

function cmpMatch(older, newer) {
  const pairs = [], usedO = new Set(), usedN = new Set(), cand = [];
  older.forEach((o, i) => newer.forEach((n, j) => { const t = cDice(o.name, n.name); if (t >= CMP_T) cand.push([t, cDice(cStepTxt(o), cStepTxt(n)), i, j]); }));
  cand.sort((x, y) => y[0] - x[0] || y[1] - x[1]);
  cand.forEach(([t, s, i, j]) => { if (!usedO.has(i) && !usedN.has(j)) { usedO.add(i); usedN.add(j); pairs.push({ i, j, t, s }); } });
  // second pass: unmatched pairs with very similar steps (renamed test case)
  const c2 = [];
  older.forEach((o, i) => !usedO.has(i) && newer.forEach((n, j) => { if (!usedN.has(j)) { const s = cDice(cStepTxt(o), cStepTxt(n)); if (s >= 0.8 && cStepTxt(o)) c2.push([s, i, j]); } }));
  c2.sort((x, y) => y[0] - x[0]).forEach(([s, i, j]) => { if (!usedO.has(i) && !usedN.has(j)) { usedO.add(i); usedN.add(j); pairs.push({ i, j, t: cDice(older[i].name, newer[j].name), s }); } });
  const rows = [];
  pairs.forEach((p) => { const o = older[p.i], n = newer[p.j]; rows.push({ kind: cSame(o, n) ? "same" : "chg", o, n, t: p.t, ord: p.j }); });
  older.forEach((o, i) => !usedO.has(i) && rows.push({ kind: "rem", o, n: null, ord: i + 0.5 }));
  newer.forEach((n, j) => !usedN.has(j) && rows.push({ kind: "add", o: null, n, ord: j }));
  rows.sort((a, b) => a.ord - b.ord || (a.kind === "rem") - (b.kind === "rem"));
  rows.forEach((r) => (r.diff = cmpDiffText(r)));
  return rows;
}
function cmpStepStats(o, n) {
  const a = o.steps || [], b = n.steps || [], st = { same: 0, chg: 0, add: 0, rem: 0 };
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    if (!a[k]) st.add++; else if (!b[k]) st.rem++; else if (a[k].description === b[k].description && a[k].expected === b[k].expected) st.same++; else st.chg++;
  }
  return st;
}
function cmpDiffText(r) {
  if (r.kind === "same") return "—";
  if (r.kind === "add") return `new${r.n.acs.length ? " · " + r.n.acs.join(", ") : ""}`;
  if (r.kind === "rem") { const lost = (r.o.acs || []).filter((a) => !CMP.data.newer.test_cases.some((t) => (t.acs || []).includes(a))); return `removed${lost.length ? ` · ${lost.join(", ")} lost (only test case)` : ""}`; }
  const p = [], st = cmpStepStats(r.o, r.n);
  if (r.o.name !== r.n.name) p.push(`title ${Math.round(r.t * 100)}% similar`);
  if (st.chg) p.push(`${st.chg} step${st.chg > 1 ? "s" : ""} changed`);
  if (st.add) p.push(`${st.add} step${st.add > 1 ? "s" : ""} added`);
  if (st.rem) p.push(`${st.rem} step${st.rem > 1 ? "s" : ""} removed`);
  if ((r.o.priority || "") !== (r.n.priority || "")) p.push(`priority ${r.o.priority} → ${r.n.priority}`);
  if ([...r.o.acs].sort().join() !== [...r.n.acs].sort().join()) p.push(`ACs ${r.o.acs.join(", ") || "none"} → ${r.n.acs.join(", ") || "none"}`);
  if ((r.o.description || "") !== (r.n.description || "")) p.push("description changed");
  if ((r.o.precondition || "") !== (r.n.precondition || "")) p.push("precondition changed");
  return p.join(" · ") || "changed";
}
// word-level LCS diff → [olderHtml, newerHtml]
function cWordDiff(a, b) {
  const x = String(a || "").split(/(\s+)/).filter((w) => w !== ""), y = String(b || "").split(/(\s+)/).filter((w) => w !== "");
  if (x.length * y.length > 250000) return [`<del>${esc(a)}</del>`, `<ins>${esc(b)}</ins>`];
  const L = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, A = "", B = "";
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { A += esc(x[i]); B += esc(y[j]); i++; j++; }
    else if (j < y.length && (i >= x.length || L[i][j + 1] >= L[i + 1][j])) { B += `<ins>${esc(y[j])}</ins>`; j++; }
    else { A += `<del>${esc(x[i])}</del>`; i++; }
  }
  return [A.replace(/<\/del><del>/g, ""), B.replace(/<\/ins><ins>/g, "")];
}
const cCov = (r) => { const ids = (r.ac_list || []).map((a) => a.id); return { n: ids.length, c: ids.filter((a) => r.test_cases.some((t) => (t.acs || []).includes(a))).length, ids }; };
const cShortRid = (rid) => esc(rid || "—");
function cWhen(r) { try { return r.created ? hDate(r.created) : ""; } catch { return ""; } }

// ------------------------------------------------------------------ Run history: checkboxes + compare bar
function cmpHistory(root, j) {
  const info = {};
  j.items.forEach((e) => { if (e.kind !== "batch") info[e.run_id] = { story: e.story_id || "", rid: e.rid, cur: e.run_id === j.current }; else (e.children || []).forEach((c) => (info[c.run_id] = { story: c.story_id || "", rid: c.rid, cur: false })); });
  CMP.sel = CMP.sel.filter((id) => info[id]);
  root.querySelectorAll("tr[data-id]:not(.bgrp), tr.bchild").forEach((tr) => {
    const id = tr.dataset.cid || tr.dataset.id, td = tr.querySelector("td"); if (!td || !info[id] || td.querySelector(".cmp-cb")) return;
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.className = "cbx cmp-cb"; cb.dataset.id = id; cb.checked = CMP.sel.includes(id);
    cb.title = "Select to compare"; td.prepend(cb);
    cb.onchange = () => { CMP.sel = cb.checked ? [...CMP.sel.filter((x) => x !== id), id].slice(-2) : CMP.sel.filter((x) => x !== id); cmpHistory(root, j); };
  });
  root.querySelectorAll(".cmp-cb").forEach((c) => (c.checked = CMP.sel.includes(c.dataset.id)));
  const [a, b] = CMP.sel.map((id) => info[id]);
  const ok = CMP.sel.length === 2 && a.story && a.story.toUpperCase() === b.story.toUpperCase();
  const why = CMP.sel.length < 2 ? `Pick ${2 - CMP.sel.length} more run${CMP.sel.length ? "" : "s"} of the same story` : !a.story || !b.story ? "Runs without a story ID can't be compared" : `Pick 2 runs of the same story — ${a.story} ≠ ${b.story}`;
  const msg = CMP.sel.length === 2 ? (ok ? `<b>${esc(a.story)}</b>: ${esc(a.rid)}${a.cur ? " (current)" : ""} vs ${esc(b.rid)}${b.cur ? " (current)" : ""}` : '<span style="color:#a12020">different stories selected</span>') : `${CMP.sel.length} selected`;
  let bar = root.querySelector(".cmpbar");
  if (!bar) { bar = document.createElement("div"); bar.className = "cmpbar"; const t = root.querySelector("table.rh"); if (!t) return; t.before(bar); }
  bar.innerHTML = `⇆ <b>Compare runs</b> · tick 2 runs of the same story · <span id="cmpMsg">${msg}</span><span style="margin-left:auto"></span>${CMP.sel.length ? '<button class="btn g sm" id="cmpClr">Clear</button>' : ""}<button class="btn sm" id="cmpBtn" ${ok ? "" : "disabled"} title="${esc(ok ? "Compare the 2 selected runs" : why)}">⇆ Compare${ok ? " 2 runs" : ""}</button>`;
  const clr = bar.querySelector("#cmpClr"); if (clr) clr.onclick = () => { CMP.sel = []; cmpHistory(root, j); };
  bar.querySelector("#cmpBtn").onclick = () => cmpOpen(CMP.sel[0], CMP.sel[1]);
}
async function cmpOpen(a, b) {
  const j = await api(`/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  CMP.data = j; CMP.rows = cmpMatch(j.older.test_cases, j.newer.test_cases); CMP.hide = false; CMP.kind = "";
  S.view = "compare"; location.hash = "compare"; render();
}

// ------------------------------------------------------------------ Compare view
function viewCompare(v) {
  if (!CMP.data) { S.view = "history"; location.hash = "history"; return viewHistory(v); }
  const { older: o, newer: n } = CMP.data, R = CMP.rows, cnt = (k) => R.filter((r) => r.kind === k).length;
  const co = cCov(o), cn = cCov(n), lost = co.ids.filter((a) => o.test_cases.some((t) => t.acs.includes(a)) && !n.test_cases.some((t) => t.acs.includes(a)));
  const tok = o.tokens && n.tokens ? `<b>${n.tokens - o.tokens >= 0 ? "+" : "−"}${Math.abs(n.tokens - o.tokens).toLocaleString("en-IN")}</b><span>Tokens (${n.tokens.toLocaleString("en-IN")} vs ${o.tokens.toLocaleString("en-IN")})</span>` : "<b>—</b><span>Tokens (not recorded for both runs)</span>";
  const covK = co.n || cn.n ? `<b style="color:${cn.c < co.c ? "#d33" : cn.c > co.c ? "#12a150" : "inherit"}">${co.c}/${co.n} → ${cn.c}/${cn.n}</b><span>AC coverage${lost.length ? ` (${lost.join(", ")} lost)` : ""}</span>` : "<b>—</b><span>AC coverage (no AC list)</span>";
  const isCur = (r) => CMP.data.current === r.run_id;
  const tg = { same: "Same", chg: "Changed", rem: "Removed", add: "Added" };
  const vis = R.filter((r) => (!CMP.hide || r.kind !== "same") && (!CMP.kind || r.kind === CMP.kind));
  const canCopy = isCur(n) || isCur(o);
  const tc = (t) => (t ? `<b class="tcid">${esc(t.id)}</b> ${esc(t.name)}` : '<span class="muted">—</span>');
  v.innerHTML = `<h1>Compare runs <span class="ticket-pill">Ticket ${esc(n.story_id)}</span></h1>
    <div class="sub">${cShortRid(o.rid)} (older${isCur(o) ? " · current" : ""}${cWhen(o) ? " · " + esc(cWhen(o)) : ""}) → ${cShortRid(n.rid)} (newer${isCur(n) ? " · current" : ""}${cWhen(n) ? " · " + esc(cWhen(n)) : ""}) · matched by title similarity ≥ 70%, then steps · read-only</div>
    <div class="cmp-sum"><div class="k add"><b>+${cnt("add")}</b><span>Added test cases</span></div><div class="k rem"><b>−${cnt("rem")}</b><span>Removed</span></div><div class="k chg"><b>${cnt("chg")}</b><span>Changed</span></div><div class="k"><b>${cnt("same")}</b><span>Unchanged</span></div><div class="k" id="cmpCov">${covK}</div><div class="k" id="cmpTok">${tok}</div></div>
    ${canCopy ? "" : '<div class="note2">ℹ Neither run is the one open now — open one of them from Run history to copy test cases into it.</div>'}
    <div class="card"><div style="display:flex;gap:10px;align-items:center;margin-bottom:8px"><label style="display:inline-flex;gap:6px;text-transform:none;letter-spacing:0;margin:0"><input type="checkbox" id="cmpHide" ${CMP.hide ? "checked" : ""}> Hide unchanged</label>
      <select id="cmpKind"><option value="">All changes</option>${["add", "rem", "chg", "same"].map((k) => `<option value="${k}" ${CMP.kind === k ? "selected" : ""}>${tg[k]}</option>`).join("")}</select>
      <span class="muted">${vis.length} of ${R.length} rows</span><span style="margin-left:auto"></span><button class="btn g sm" id="cmpXl">⬇ Export diff (Excel)</button><button class="btn g sm" id="cmpClose">✕ Close</button></div>
      <table class="cr" id="cmpTbl"><tr><th style="width:90px">Match</th><th>Older run ${cShortRid(o.rid)}</th><th>Newer run ${cShortRid(n.rid)}</th><th>Difference</th><th style="width:170px"></th></tr>
      ${vis.map((r) => { const k = R.indexOf(r), older = r.o && !r.n;
        const cp = canCopy && isCur(n) && r.o ? `<button class="btn ${r.kind === "rem" ? "" : "g"} sm cmp-copy" data-r="${k}">⤵ Copy into current</button>` : "";
        return `<tr class="${r.kind}" data-r="${k}"><td><span class="tg ${r.kind}">${tg[r.kind]}</span></td><td class="o">${tc(r.o)}</td><td class="n">${tc(r.n)}</td><td class="res">${esc(r.diff)}</td><td>${r.kind !== "same" ? `<button class="btn g sm cmp-det" data-r="${k}">⇆ Details</button>` : ""} ${r.kind === "rem" || r.kind === "chg" ? cp : ""}</td></tr>`; }).join("")}
      ${vis.length ? "" : '<tr><td colspan="5" class="muted">No rows for this filter.</td></tr>'}</table></div>`;
  $("#cmpHide").onchange = (e) => { CMP.hide = e.target.checked; render(); };
  $("#cmpKind").onchange = (e) => { CMP.kind = e.target.value; render(); };
  $("#cmpClose").onclick = () => { CMP.data = null; go("history"); };
  $("#cmpXl").onclick = () => guarded($("#cmpXl"), cmpExport);
  $$(".cmp-det").forEach((b) => (b.onclick = () => cmpDetail(+b.dataset.r)));
  $$(".cmp-copy").forEach((b) => (b.onclick = () => cmpCopyDialog(+b.dataset.r)));
}
function cmpDetail(k) {
  const R = CMP.rows, r = R[k], { older: o, newer: n } = CMP.data, tg = { chg: "Changed", rem: "Removed", add: "Added", same: "Same" };
  const ch = R.map((x, i) => (x.kind !== "same" ? i : -1)).filter((i) => i >= 0), pos = ch.indexOf(k);
  const steps = (t, side) => {
    const a = (r.o || {}).steps || [], b = (r.n || {}).steps || [], m = Math.max(a.length, b.length);
    let h = ""; for (let i = 0; i < m; i++) {
      const x = a[i], y = b[i];
      if (side === "o" && !x) { h += '<tr><td></td><td class="muted">—</td><td></td></tr>'; continue; }
      if (side === "n" && !y) { h += '<tr><td></td><td class="muted">—</td><td></td></tr>'; continue; }
      let cls, d, e;
      if (x && y) { const s = x.description === y.description && x.expected === y.expected; cls = s ? "m-same" : "m-chg";
        const dd = cWordDiff(x.description, y.description), ee = cWordDiff(x.expected, y.expected); d = side === "o" ? dd[0] : dd[1]; e = side === "o" ? ee[0] : ee[1]; }
      else { const z = x || y; cls = side === "o" ? "m-rem" : "m-add"; const tag = side === "o" ? "del" : "ins"; d = `<${tag}>${esc(z.description)}</${tag}>`; e = `<${tag}>${esc(z.expected)}</${tag}>`; }
      h += `<tr class="${cls}"><td>${i + 1}</td><td>${d}</td><td>${e}</td></tr>`;
    }
    return h;
  };
  const nm = r.o && r.n ? cWordDiff(r.o.name, r.n.name) : [esc((r.o || {}).name || ""), esc((r.n || {}).name || "")];
  const col = (t, lab, side, i) => `<div class="col"><b>${lab}</b>${t ? `<div style="margin:6px 0"><b class="tcid">${esc(t.id)}</b> ${nm[i]} ${t.acs.map((a) => `<span class="ac ${acCls(a)}">${esc(a)}</span>`).join("")} <span class="prio p-${esc(t.priority)}">${esc(t.priority)}</span></div><table><tr><th>#</th><th>Step</th><th>Expected</th></tr>${steps(t, side)}</table>` : '<div class="muted" style="margin-top:8px">— not in this run</div>'}</div>`;
  const t = r.n || r.o, st = r.o && r.n ? cmpStepStats(r.o, r.n) : null;
  const rs = (x) => ({ reviewed: "Reviewed", not: "Not reviewed", rework: "Needs rework" }[(x || {}).status] || (x || {}).status || "—");
  const canCopy = CMP.data.current === n.run_id && r.o && r.kind !== "same";
  modal(`<h1 style="font-size:19px">${esc(t.id)} · ${esc(t.name)} <span class="ticket-pill">Ticket ${esc(n.story_id)}</span> <span class="tg ${r.kind}">${tg[r.kind]}</span></h1>
    <div class="sub">${esc(o.rid)} → ${esc(n.rid)}${st ? ` · steps: ${st.same} same · ${st.chg} changed · ${st.add} added · ${st.rem} removed` : ""} · ${esc(r.diff)}</div>
    <div class="sbs">${col(r.o, `Older · ${esc(o.rid)}`, "o", 0)}${col(r.n, `Newer · ${esc(n.rid)}`, "n", 1)}</div>
    <div class="note2">Review status: ${r.o ? rs(r.o) : "—"} (older) · ${r.n ? rs(r.n) : "—"} (newer). Copying the older version never replaces anything automatically.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn g" id="cdPrev" ${pos > 0 ? "" : "disabled"}>‹ Prev change</button><button class="btn g" id="cdNext" ${pos < ch.length - 1 ? "" : "disabled"}>Next change ›</button>${canCopy ? '<button class="btn g" id="cdCopy">⤵ Copy older version into current</button>' : ""}<button class="btn" id="cdClose">Close</button></div>`);
  $("#modal").classList.add("wide");
  $("#cdPrev").onclick = () => cmpDetail(ch[pos - 1]);
  $("#cdNext").onclick = () => cmpDetail(ch[pos + 1]);
  $("#cdClose").onclick = covClose;
  const cc = $("#cdCopy"); if (cc) cc.onclick = () => cmpCopyDialog(k);
}
function cmpCopyDialog(k) {
  const r = CMP.rows[k], src = r.o, n = CMP.data.newer;
  if (!S.localDirty) loadCasesFromRun();
  const nextId = "TC" + pad3(S.cases.length + 1);
  // a replace target: best current test case with title similarity >= 70%
  let best = null; S.cases.forEach((t) => { const s = cDice(src.name, t.name); if (s >= CMP_T && (!best || s > best.s)) best = { t, s }; });
  const covBefore = covCalc(S.cases, S.run.ac_list || []);
  modal(`<h1 style="font-size:19px">⤵ Copy ${esc(src.id)} from ${esc(CMP.data.older.rid)} into current run <span class="ticket-pill">Ticket ${esc(n.story_id)}</span></h1>
    <div class="sub">“${esc(src.name)}” · ${esc(src.acs.join(", ") || "no AC")} · ${src.steps.length} step${src.steps.length === 1 ? "" : "s"}</div>
    <label class="pick on"><input type="radio" name="cpm" value="end" checked> Add as new <b class="tcid">${nextId}</b> at the end</label>
    <label class="pick"><input type="radio" name="cpm" value="after"> Insert after <select id="cpAfter">${S.cases.map((t) => `<option value="${t._k}">${esc(t.id)}</option>`).join("")}</select> (later IDs renumbered)</label>
    <label class="pick"><input type="radio" name="cpm" value="rep" ${best ? "" : "disabled"}> Replace matching test case — ${best ? `<b class="tcid">${esc(best.t.id)}</b> ${esc(best.t.name)} <span class="pill gr">${Math.round(best.s * 100)}%</span>` : '<span class="muted">none (no match ≥ 70%)</span>'}</label>
    <label style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-weight:400;margin-top:8px"><input type="checkbox" id="cpReset" checked> Reset status to Not reviewed</label>
    <div class="note2" id="cpNote"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn g" id="cpCancel">Cancel</button><button class="btn" id="cpGo">⤵ Copy</button></div>`);
  $("#modal").classList.add("mid");
  const mode = () => ($("input[name=cpm]:checked") || {}).value;
  const note = () => {
    const m = mode(), after = S.cases.filter((t) => m !== "rep" || t !== best.t).concat([{ acs: src.acs }]);
    const ca = covCalc(after, S.run.ac_list || []), nn = S.cases.length + (m === "rep" ? 0 : 1);
    $("#cpNote").innerHTML = `Result: current run ${S.cases.length} → ${nn} test cases${covBefore.rows.length ? ` · AC coverage ${covBefore.covered}/${covBefore.rows.length} → <b>${ca.covered}/${ca.rows.length}</b>` : ""}. Unsaved until you Save in Review; Undo available.`;
    $("#cpGo").textContent = m === "rep" ? `⤵ Replace ${best.t.id}` : m === "after" ? "⤵ Insert" : `⤵ Copy as ${nextId}`;
    $$("#modal .pick").forEach((p) => p.classList.toggle("on", p.querySelector("input").checked));
  };
  $$("input[name=cpm]").forEach((x) => (x.onchange = note)); $("#cpAfter").onchange = () => { $("input[value=after]").checked = true; note(); };
  note();
  $("#cpCancel").onclick = covClose;
  $("#cpGo").onclick = () => {
    const snap = dSnap(), m = mode();
    const c = normCase({ ...JSON.parse(JSON.stringify(src)), _k: undefined });
    if ($("#cpReset").checked) c.status = "not";
    let at = S.cases.length;
    if (m === "after") at = S.cases.findIndex((t) => t._k === +$("#cpAfter").value) + 1;
    if (m === "rep") { at = S.cases.indexOf(best.t); S.cases.splice(at, 1); RV.open.delete(best.t._k); }
    S.cases.splice(at, 0, c); renumber(); RV.open.add(c._k); RV.just = c._k; markDirty(); covClose();
    const msg = `⤵ ${src.id} from ${CMP.data.older.rid} ${m === "rep" ? "replaced" : "copied as"} ${c.id}`;
    go("review");
    const el = $(`.tc[data-k="${c._k}"]`); if (el) el.scrollIntoView({ block: "center" });
    dupUndoToast(msg, snap);
  };
}
async function cmpExport() {
  const { older: o, newer: n } = CMP.data, tg = { same: "Same", chg: "Changed", rem: "Removed", add: "Added" };
  const rows = CMP.rows.map((r) => ({ match: tg[r.kind], old_id: r.o ? r.o.id : "", old_name: r.o ? r.o.name : "", new_id: r.n ? r.n.id : "", new_name: r.n ? r.n.name : "", diff: r.diff }));
  const fn = `compare_${n.story_id}_${o.rid}_vs_${n.rid}.xlsx`;
  const res = await fetch("/api/compare/excel", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `${n.story_id}: ${o.rid} (older) vs ${n.rid} (newer)`, filename: fn, rows }) });
  if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
  const url = URL.createObjectURL(await res.blob()), a = document.createElement("a");
  a.href = url; a.download = fn.replace(/[^A-Za-z0-9_.-]/g, "_"); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Diff exported");
}
