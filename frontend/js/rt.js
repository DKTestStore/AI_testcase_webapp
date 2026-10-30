/* Review tools (additive, loaded last): Export menu, Edit mode, Traceability matrix (List/Matrix),
   Type & Priority tags + filter chips, Version history (restore / compare), Quality score.
   Wraps existing review functions — the original cards, drag handles, priority dropdown,
   '+ Test case', Save & Download Excel and batch layout keep working unchanged. */
"use strict";

const RT = { view: "list", type: "", weak: false, sort: "", edit: new Set(), qc: new Map(), delArm: null,
  exp: { fmt: "xlsx", cols: ["id", "name", "description", "precondition", "priority", "acs"], steps: true, reviewed: false } };
const RT_TYPES = ["Positive", "Negative", "Edge"];
const RT_EDGE = /\b(boundary|boundaries|edge|limit|limits|maximum|minimum|max|min|exactly|zero|overflow|concurrent|timeout|special characters|unicode|largest|smallest)\b/i;
const RT_COLS = [["id", "ID"], ["name", "Name"], ["description", "Description"], ["precondition", "Precondition"], ["priority", "Priority"], ["acs", "AC mapping"], ["status", "Review status"], ["template", "Template"], ["type", "Type"]];
const RT_FMTS = [["xlsx", "📗 Excel (.xlsx)", "default"], ["csv", "📄 CSV (.csv)", ""], ["qtest", "🧪 qTest-import CSV", "qTest"]];

// ------------------------------------------------------------------ Type (Positive / Negative / Edge)
function rtType(t) {
  if (RT_TYPES.includes(t.type)) return t.type;
  const s = `${t.name} ${t.description}`;
  return RT_EDGE.test(s) ? "Edge" : (typeof NEG_RE !== "undefined" && NEG_RE.test(s)) ? "Negative" : "Positive";
}

// ------------------------------------------------------------------ Quality score (local heuristic, no AI call)
const RT_VAGUE = /\b(works?|working|properly|correctly|as expected|fine|ok|okay|etc|appropriate|successfully|check|test|verify|validate)\b/gi;
const rtWords = (s) => (String(s || "").match(/[A-Za-z0-9']+/g) || []).length;
function rtSimTok(t) { return dTok(`${t.name} ${t.description} ${t.steps.map((s) => s.description + " " + s.expected).join(" ")}`); }
function rtQ(t) {
  if (RT.qc.has(t._k)) return RT.qc.get(t._k);
  const iss = [];
  // clarity
  let cl = 100; const tw = rtWords(t.name);
  if (tw < 3) { cl -= 30; iss.push(["c", "Title is too short / vague"]); } else if (tw > 16) { cl -= 15; iss.push(["c", "Title is very long"]); }
  const vg = (t.name.match(RT_VAGUE) || []).length; if (vg && tw <= 5) { cl -= Math.min(40, 20 * vg); iss.push(["c", "Vague title (e.g. “verify … works”)"]); }
  const shortSteps = t.steps.filter((s) => rtWords(s.description) < 3).length; if (shortSteps) { cl -= Math.min(30, 10 * shortSteps); iss.push(["c", `${shortSteps} step${shortSteps > 1 ? "s are" : " is"} very short`]); }
  if (!t.steps.some((s) => /\d|["'“‘]/.test(s.description + s.expected))) { cl -= 10; iss.push(["c", "No concrete test data in steps"]); }
  const vgExp = t.steps.filter((s) => s.expected && rtWords(s.expected) <= 3 && RT_VAGUE.test(s.expected)).length; RT_VAGUE.lastIndex = 0;
  if (vgExp) { cl -= 10; iss.push(["c", "Generic expected results"]); }
  // completeness
  let co = 100;
  if (!t.description) { co -= 15; iss.push(["p", "Missing description"]); }
  if (!t.precondition) { co -= 15; iss.push(["p", "Missing precondition"]); }
  if (t.steps.length < 2) { co -= 25; iss.push(["p", "Only one step"]); }
  const noExp = t.steps.filter((s) => !String(s.expected || "").trim()).length; if (noExp) { co -= Math.min(45, 15 * noExp); iss.push(["p", `Missing expected result on ${noExp} step${noExp > 1 ? "s" : ""}`]); }
  if ((S.run && (S.run.ac_list || []).length) && !t.acs.length) { co -= 10; iss.push(["p", "Not mapped to an acceptance criterion"]); }
  // duplicate risk
  const me = rtSimTok(t); let sim = 0, twin = null;
  S.cases.forEach((o) => { if (o === t) return; const s = dJac(me, rtSimTok(o)); if (s > sim) { sim = s; twin = o; } });
  const du = sim < 0.5 ? 100 : Math.max(0, Math.round((1 - sim) * 200));
  if (sim >= 0.5) iss.push(["d", `${Math.round(sim * 100)}% similar to ${twin.id}`]);
  const c = Math.max(0, Math.min(100, cl)), p = Math.max(0, Math.min(100, co));
  const score = Math.round(0.4 * c + 0.4 * p + 0.2 * du);
  const q = { score, clarity: c, completeness: p, dup: du, sim, twin: twin && sim >= 0.5 ? twin.id : "", issues: iss, weak: score < 50 };
  RT.qc.set(t._k, q); return q;
}
function rtRunQ() {
  const n = S.cases.length; if (!n) return null;
  const qs = S.cases.map(rtQ), avg = (k) => Math.round(qs.reduce((a, q) => a + q[k], 0) / n);
  let pairs = 0; const toks = S.cases.map(rtSimTok);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (dJac(toks[i], toks[j]) >= 0.8) pairs++;
  return { score: avg("score"), clarity: avg("clarity"), completeness: avg("completeness"), pairs, weak: qs.filter((q) => q.weak).length };
}
const rtQCls = (s) => (s >= 80 ? "hi" : s >= 50 ? "md" : "lo");

// ------------------------------------------------------------------ wrappers around the existing review functions
const _rtCard = card, _rtFiltered = filtered, _rtViewReview = viewReview, _rtRenderList = renderList, _rtMarkDirty = markDirty, _rtJumpTo = jumpTo;

window.filtered = function () {
  let f = _rtFiltered();
  if (RT.type) f = f.filter((t) => rtType(t) === RT.type);
  if (RT.weak) f = f.filter((t) => rtQ(t).weak);
  if (RT.sort === "score") f = [...f].sort((a, b) => rtQ(a).score - rtQ(b).score);
  return f;
};
window.markDirty = function () { RT.qc.clear(); return _rtMarkDirty(); };
window.jumpTo = function (v) { if (RT.type || RT.weak) { RT.type = ""; RT.weak = false; } return _rtJumpTo(v); };

window.card = function (t, i, total) {
  const q = rtQ(t), typ = rtType(t), editing = RT.edit.has(t._k);
  let h;
  if (editing) { const was = RV.open.has(t._k); RV.open.delete(t._k); h = _rtCard(t, i, total); if (was) RV.open.add(t._k); h = h.replace(/<\/div>$/, ""); }
  else h = _rtCard(t, i, total);
  h = h.replace('<div class="tc ', `<div class="tc ${editing ? "rt-editing " : ""}${q.weak ? "rt-isweak " : ""}`);
  const tags = `<span class="rt-tags"><button class="rt-edb ${editing ? "on" : ""}" data-rt="edit" title="${editing ? "Close edit mode" : "Edit test case (title, steps, expected results)"}">✎ ${editing ? "Close editor" : "Edit"}</button><button class="rt-sc ${rtQCls(q.score)}" data-rt="q" title="Quality score ${q.score}/100 — click for breakdown">${q.score}</button><button class="rt-type t-${typ}" data-rt="type" title="Test type: ${typ}${t.type ? "" : " (auto-detected)"} — click to change">${typ}</button>${q.weak ? '<span class="rt-weak" title="Quality score below 50">⚑ Weak</span>' : ""}<span class="rt-pc rt-p-${t.priority}" title="Priority: ${t.priority}"><i></i>${t.priority === "Medium" ? "Med" : t.priority}</span></span>`;
  if (h.includes('<div class="tc-desc" data-act="toggle">')) h = h.replace('<div class="tc-desc" data-act="toggle">', `<div class="tc-desc" data-act="toggle">${tags}`);
  else h = h.replace(/<\/div>(\s*)<div class="tc-meta">/, `<div class="rt-tagline">${tags}</div></div>$1<div class="tc-meta">`);
  if (editing) h += rtEditBody(t) + "</div>";
  return h;
};
function rtEditBody(t) {
  const ta = (f, v, ph, si) => `<textarea class="rt-in" data-rf="${f}" ${si !== undefined ? `data-rs="${si}"` : ""} rows="2" placeholder="${esc(ph)}">${esc(v)}</textarea>`;
  return `<div class="tc-b rt-edit"><div class="rt-ehd"><span class="rt-etag">EDITING</span><input class="rt-in rt-title" data-rf="name" value="${esc(t.name)}" placeholder="Test case title">
      <button class="btn r sm" data-rt="tcdel">${RT.delArm === t._k ? "Click again to delete" : "🗑 Delete test case"}</button><button class="btn s sm" data-rt="done">✓ Done</button></div>
    <div class="rt-egrid2"><div><div class="lbl">Description</div>${ta("description", t.description, "Description…")}</div><div><div class="lbl">Precondition</div>${ta("precondition", t.precondition, "Precondition…")}</div></div>
    <div class="rt-egrid"><span class="lbl">#</span><span class="lbl">Step description</span><span class="lbl">Expected result</span><span class="lbl" style="text-align:right">Actions</span>
    ${t.steps.map((s, si) => `<span class="num">${si + 1}</span>${ta("description", s.description, "Step action…", si)}${ta("expected", s.expected, "Expected result…", si)}<span class="rt-sa"><button class="ib" data-rt="sadd" data-s="${si}" title="Add step below">＋</button><button class="ib" data-rt="sdel" data-s="${si}" title="Delete step" ${t.steps.length > 1 ? "" : "disabled"}>🗑</button></span>`).join("")}</div>
    <button class="btn g sm" data-rt="sadd" data-s="${t.steps.length - 1}">＋ Add step</button></div>`;
}

window.renderList = function () {
  RT.qc.clear();
  _rtRenderList();
  const list = $("#rvList"); if (!list) return;
  if (!$("#rtAddBottom", list)) list.insertAdjacentHTML("beforeend", `<button class="rt-addb" id="rtAddBottom" title="Add a new test case at the end (opens in edit mode)">＋ Add test case</button>`);
  rtChips(); rtQual(); if (RT.view === "matrix") rtMatrix();
};

window.viewReview = function (v) {
  _rtViewReview(v);
  try { rtInject(v); } catch (e) { console.error(e); }
};

function rtInject(v) {
  const acts = $(".rv-actions", v), dl = $("#dlExcel", v);
  if (dl && !$("#rtExport", v)) dl.insertAdjacentHTML("afterend", `<button class="btn" id="rtExport" title="Export as Excel, CSV or qTest-import CSV">⇩ Export ▾</button>`);
  const ub = $("#unsavedBar", v);
  if (ub && !$("#rtUnsaved", v)) ub.insertAdjacentHTML("beforeend", `<span id="rtUnsaved" class="rt-ubtns"><button class="btn g sm" id="rtDiscard">Discard</button><button class="btn s sm" id="rtSave">💾 Save</button></span>`);
  const tb = $("#rvToolbar", v);
  if (tb && !$("#rtQual", v)) tb.insertAdjacentHTML("beforebegin", `<div id="rtQual"></div>`);
  if (tb && !$("#rtChips", v)) tb.insertAdjacentHTML("afterend", `<div class="rt-chips" id="rtChips"></div>`);
  const list = $("#rvList", v);
  if (list && !$("#rtMatrix", v)) list.insertAdjacentHTML("afterend", `<div id="rtMatrix"></div>`);
  v.classList.toggle("rt-mx-on", RT.view === "matrix");
  // events
  if (acts && $("#rtExport", v)) $("#rtExport", v).onclick = (e) => rtExportPanel(e.currentTarget, "");
  if ($("#rtSave", v)) $("#rtSave", v).onclick = () => $("#saveCases").click();
  if ($("#rtDiscard", v)) $("#rtDiscard", v).onclick = () => { if (!S.localDirty) return; S.localDirty = false; RT.edit.clear(); RT.delArm = null; render(); toast("Unsaved changes discarded"); };
  if (list) { list.addEventListener("click", rtListClick, true); list.addEventListener("input", rtListInput); }
  rtChips(); rtQual(); if (RT.view === "matrix") rtMatrix();
}

// ------------------------------------------------------------------ list events (edit mode, type, score)
function rtListClick(e) {
  if (e.target.id === "rtAddBottom") {
    e.stopPropagation();
    $("#addTc").click(); const t = S.cases[S.cases.length - 1]; if (t) { RT.edit.add(t._k); renderList(); const el = $(`.tc[data-k="${t._k}"] .rt-title`); if (el) { el.scrollIntoView({ block: "center" }); el.select(); } }
    return;
  }
  const b = e.target.closest("[data-rt]"); if (!b) return;
  const card = b.closest(".tc"); if (!card) return; const t = S.cases[byK(card.dataset.k)]; if (!t) return;
  e.stopPropagation();
  const a = b.dataset.rt, si = +b.dataset.s;
  if (a === "edit" || a === "done") { if (RT.edit.has(t._k)) RT.edit.delete(t._k); else RT.edit.add(t._k); RT.delArm = null; renderList(); return; }
  if (a === "type") { t.type = RT_TYPES[(RT_TYPES.indexOf(rtType(t)) + 1) % 3]; t._ed = t._ed || {}; markDirty(); renderList(); return; }
  if (a === "q") return rtQualPanel(t);
  if (a === "sadd") { t.steps.splice(si + 1, 0, { description: "", expected: "", _k: ++_uid, _ed: { description: 1 } }); markDirty(); renderList(); const ta = $$(`.tc[data-k="${t._k}"] textarea[data-rs="${si + 1}"]`)[0]; if (ta) ta.focus(); return; }
  if (a === "sdel") { if (t.steps.length > 1) { t.steps.splice(si, 1); markDirty(); renderList(); } return; }
  if (a === "tcdel") {
    if (RT.delArm !== t._k) { RT.delArm = t._k; renderList(); return; }
    const id = t.id; S.cases.splice(byK(t._k), 1); RT.edit.delete(t._k); RV.sel.delete(t._k); RT.delArm = null; renumber(); markDirty(); renderList(); toast(`${id} deleted · IDs renumbered`);
  }
}
function rtListInput(e) {
  const el = e.target; if (!el.classList.contains("rt-in")) return;
  const card = el.closest(".tc"); const t = S.cases[byK(card.dataset.k)]; if (!t) return; const f = el.dataset.rf;
  const val = el.value.replace(/\s*\n\s*/g, " ");
  if (el.dataset.rs !== undefined) { const s = t.steps[+el.dataset.rs]; s[f] = val; s._ed = s._ed || {}; s._ed[f] = 1; }
  else { t[f] = val; t._ed = t._ed || {}; t._ed[f] = 1; }
  markDirty();
}

// ------------------------------------------------------------------ filter chips (Priority / Type / Weak / Sort)
function rtChips() {
  const el = $("#rtChips"); if (!el) return;
  const n = S.cases.length, pc = (p) => S.cases.filter((t) => t.priority === p).length, tc = (x) => S.cases.filter((t) => rtType(t) === x).length;
  const weak = S.cases.filter((t) => rtQ(t).weak).length;
  const chip = (attr, val, label, cnt, on) => `<button class="rt-chip ${on ? "a" : ""}" ${attr}="${val}">${label} <b>${cnt}</b></button>`;
  el.innerHTML = `<span class="rt-f"><span class="rt-cl">Priority</span>${chip("data-rp", "", "All", n, !RV.prio)}${["High", "Medium", "Low"].map((p) => chip("data-rp", p, p === "Medium" ? "Med" : p, pc(p), RV.prio === p)).join("")}
    <span class="rt-cl">Type</span>${chip("data-rty", "", "All", n, !RT.type)}${RT_TYPES.map((x) => chip("data-rty", x, x, tc(x), RT.type === x)).join("")}
    ${RV.prio || RT.type || RT.weak ? `<span class="sub rt-showing">Showing <b>${filtered().length}</b> of ${n}</span>` : ""}</span>
    <span style="flex:1"></span><span class="rt-f"><button class="rt-chip weak ${RT.weak ? "a" : ""}" id="rtWeak" title="Show only test cases with quality score below 50">⚑ Weak only <b>${weak}</b></button>
    <select id="rtSort" title="Sort test cases"><option value="">Sort: default</option><option value="score" ${RT.sort === "score" ? "selected" : ""}>Sort: score ↑</option></select></span>
    <button class="btn g sm" id="rtVers" title="Version history: restore or compare versions">🕘 Versions</button>
    <div class="rt-tg rt-seg" id="rtSeg"><button data-v="list" class="${RT.view === "list" ? "a" : ""}">☰ List</button><button data-v="matrix" class="${RT.view === "matrix" ? "a" : ""}">▦ Matrix</button></div>`;
  $("#rtVers").onclick = () => guarded($("#rtVers"), rtVersions);
  $$("#rtSeg button", el).forEach((b) => (b.onclick = () => { RT.view = b.dataset.v; const v = el.closest("#bRv") || $("#view"); v.classList.toggle("rt-mx-on", RT.view === "matrix"); rtChips(); if (RT.view === "matrix") rtMatrix(); else $("#rtMatrix").innerHTML = ""; }));
  const re = () => { RV.page = 0; renderList(); };
  $$("[data-rp]", el).forEach((b) => (b.onclick = () => { RV.prio = b.dataset.rp; const s = $("#rvPrio"); if (s) s.value = RV.prio; re(); }));
  $$("[data-rty]", el).forEach((b) => (b.onclick = () => { RT.type = b.dataset.rty; re(); }));
  $("#rtWeak").onclick = () => { RT.weak = !RT.weak; re(); };
  $("#rtSort").onchange = (e) => { RT.sort = e.target.value; re(); };
}

// ------------------------------------------------------------------ quality summary + breakdown
function rtQual() {
  const el = $("#rtQual"); if (!el) return; const r = rtRunQ();
  if (!r) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="rt-qrow"><div class="rt-qc main"><span>Overall run quality</span><b class="${rtQCls(r.score)}">${r.score} <small>/ 100</small></b><i class="rt-qb"><s class="${rtQCls(r.score)}" style="width:${r.score}%"></s></i></div>
    <div class="rt-qc"><span>Clarity</span><b>${r.clarity}</b></div><div class="rt-qc"><span>Completeness</span><b>${r.completeness}</b></div>
    <div class="rt-qc"><span>Duplicates</span><b>${r.pairs} pair${r.pairs === 1 ? "" : "s"}</b></div><div class="rt-qc"><span>Weak test cases</span><b class="${r.weak ? "lo" : ""}">${r.weak}</b></div></div>`;
}
function rtQualPanel(t) {
  const q = rtQ(t), bar = (l, v, k) => `<div class="rt-qd"><div><b>${l}</b><b>${v}</b></div><i class="rt-qb"><s class="${rtQCls(v)}" style="width:${v}%"></s></i><div class="sub">${q.issues.filter((x) => x[0] === k).map((x) => esc(x[1])).join("; ") || "No issues found"}</div></div>`;
  const sug = q.issues.length ? `💡 Suggestion: ${q.issues.map((x) => esc(x[1])).join("; ")}. Use “Improve with AI” to rewrite ${esc(t.id)} (1 Gemini call), or edit it with ✎.` : "✓ This test case looks good.";
  modal(`<div class="rt-qpanel"><h1 style="font-size:18px">Quality · ${esc(t.id)}</h1><div class="rt-qtop"><span class="rt-sc big ${rtQCls(q.score)}">${q.score}</span><div>${q.weak ? '<b class="lo">Weak</b>' : q.score >= 80 ? '<b class="hi">Good</b>' : '<b class="md">Fair</b>'}<div class="sub" style="margin:0">${esc(t.name)}</div></div></div>
    ${bar("Clarity", q.clarity, "c")}${bar("Completeness", q.completeness, "p")}${bar("Duplicate risk", q.dup, "d")}
    <div class="note rt-sug">${sug}</div><div id="rtImpOut"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn g" id="rtQClose">Dismiss</button><button class="btn" id="rtImprove">✨ Improve with AI</button></div></div>`);
  $("#modal").classList.add("mid");
  $("#rtQClose").onclick = rtCloseModal;
  $("#rtImprove").onclick = () => guarded($("#rtImprove"), async () => {
    const ins = `Improve the quality of this test case. Fix: ${q.issues.map((x) => x[1]).join("; ") || "make the title specific and steps concrete"}. Keep the same intent and acceptance criteria.`;
    const tc = { id: t.id, name: t.name, description: t.description, precondition: t.precondition, priority: t.priority, acs: t.acs, status: t.status, steps: t.steps.map((s) => ({ description: s.description, expected: s.expected })) };
    let j; try { j = await api("/api/review/regenerate", { method: "POST", body: { test_case: tc, instruction: ins.slice(0, 1000) } }); }
    catch (e) { $("#rtImpOut").innerHTML = `<div class="error">${esc(e.message)}</div>`; throw e; }
    const p = j.proposal;
    $("#rtImpOut").innerHTML = `<div class="rt-prop"><b>Proposed:</b> ${esc(p.name)}<div class="sub" style="margin:2px 0">${esc(p.description)}</div><ol>${(p.steps || []).map((s) => `<li>${esc(s.description)} → <i>${esc(s.expected)}</i></li>`).join("")}</ol>
      <div style="text-align:right"><button class="btn s sm" id="rtImpAcc">✓ Apply to ${esc(t.id)}</button></div></div>`;
    $("#rtImprove").classList.add("hidden");
    $("#rtImpAcc").onclick = () => {
      Object.assign(t, { name: p.name, description: p.description, precondition: p.precondition || t.precondition, steps: (p.steps || []).map((s) => ({ description: s.description, expected: s.expected, _k: ++_uid })), status: "not", regenerated: true });
      t._ed = { name: 1 }; markDirty(); rtCloseModal(); renderList(); toast(`${t.id} improved with AI — review it and Save`);
    };
  });
}
function rtCloseModal() { closeModal(); $("#modal").innerHTML = ""; $("#modal").classList.remove("mid", "wide", "rt-wide"); }

// ------------------------------------------------------------------ Traceability matrix (List / Matrix)
function rtMatrix() {
  const el = $("#rtMatrix"); if (!el) return;
  const acs = (S.run && S.run.ac_list) || [], tcs = S.cases;
  if (!acs.length) { el.innerHTML = `<div class="rt-mxwrap muted">No acceptance criteria detected for this run — the matrix needs ACs.</div>`; return; }
  const cov = acs.map((a) => ({ a, tcs: tcs.filter((t) => t.acs.includes(a.id)) })), unc = cov.filter((r) => !r.tcs.length);
  const unm = tcs.filter((t) => !t.acs.some((x) => acs.some((a) => a.id === x))).length, pct = Math.round((acs.length - unc.length) * 100 / acs.length);
  el.innerHTML = `<div class="rt-mxhead"><h3>Traceability Matrix</h3><span class="sub" style="margin:0">${esc(S.run.story_id || "")} · ${acs.length} acceptance criteria × ${tcs.length} test cases</span><span style="flex:1"></span><button class="btn g sm" id="rtMxCsv">⇩ Export matrix</button></div>
    <div class="rt-qrow"><div class="rt-qc main"><span>AC coverage</span><b class="${unc.length ? "md" : "hi"}">${pct}%</b><i class="rt-qb"><s class="${unc.length ? "md" : "hi"}" style="width:${pct}%"></s></i></div>
      <div class="rt-qc"><span>Covered ACs</span><b>${acs.length - unc.length} / ${acs.length}</b></div><div class="rt-qc"><span>Uncovered</span><b class="${unc.length ? "lo" : ""}">${unc.length}</b><div class="sub" style="margin:0">${unc.map((r) => esc(r.a.id)).join(", ")}</div></div>
      <div class="rt-qc"><span>Unmapped test cases</span><b class="${unm ? "md" : ""}">${unm}</b></div></div>
    <div class="rt-mxwrap"><table class="rt-mx"><tr><th class="l">Acceptance criterion</th>${tcs.map((t) => `<th>${esc(t.id)}</th>`).join("")}<th>Covered by</th></tr>
      ${cov.map((r) => `<tr class="${r.tcs.length ? "" : "unc"}" data-ac="${esc(r.a.id)}"><td class="l"><b>${esc(r.a.id)}</b> ${esc(r.a.title)}${r.tcs.length ? "" : ' <span class="rt-uncl">UNCOVERED</span>'}</td>${tcs.map((t) => `<td>${t.acs.includes(r.a.id) ? '<span class="rt-ck" title="' + esc(t.id) + " covers " + esc(r.a.id) + '">✔</span>' : '<span class="rt-dot">·</span>'}</td>`).join("")}<td><b>${r.tcs.length}</b></td></tr>`).join("")}
      <tr class="tot"><td class="l"><b>ACs per test case</b></td>${tcs.map((t) => `<td><b>${t.acs.filter((x) => acs.some((a) => a.id === x)).length}</b></td>`).join("")}<td></td></tr></table></div>
    ${unc.map((r) => `<div class="rt-uncb"><span>✖ <b>${esc(r.a.id)}</b> (${esc(r.a.title)}) has no test case.</span><button class="btn sm" data-rtgen="${esc(r.a.id)}">🤖 Generate test cases for ${esc(r.a.id)}</button></div>`).join("")}`;
  $$("[data-rtgen]", el).forEach((b) => (b.onclick = () => covGenDialog(b.dataset.rtgen)));
  $("#rtMxCsv").onclick = () => {
    const rows = [["Acceptance criterion", "Title", ...tcs.map((t) => t.id), "Covered by"], ...cov.map((r) => [r.a.id, r.a.title, ...tcs.map((t) => (t.acs.includes(r.a.id) ? "X" : "")), r.tcs.length])];
    rtSaveBlob(rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n"), `${S.run.story_id || "LOCAL"}_traceability.csv`, "text/csv");
  };
}
function rtSaveBlob(text, name, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

// ------------------------------------------------------------------ Export panel / menu
function rtExportUrl(fmt, item) {
  const e = RT.exp, q = new URLSearchParams({ fmt, cols: e.cols.join(","), steps: e.steps ? 1 : 0, reviewed: e.reviewed ? 1 : 0 });
  if (item) q.set("item", item); return "/api/export?" + q.toString();
}
async function rtDoExport(fmt, item) {
  if (!item && S.localDirty) { await saveCases(); afterSave(); }
  download(rtExportUrl(fmt, item)); toast(`Export started (${{ xlsx: "Excel", csv: "CSV", qtest: "qTest-import CSV" }[fmt]})`);
}
function rtExportPanel(anchor, item, cases) {
  const e = RT.exp;
  const draw = () => {
    const list = (cases || S.cases).filter((t) => !e.reviewed || t.status === "reviewed");
    const rows = e.fmt === "qtest" || e.steps ? list.reduce((a, t) => a + Math.max(1, t.steps.length), 0) : list.length;
    return `<div class="rt-exp" id="rtExpPanel"><div class="rt-eh">Export format</div>${RT_FMTS.map(([k, l, tag]) => `<div class="pi ${e.fmt === k ? "a" : ""}" data-fmt="${k}">${l}<span style="flex:1"></span>${tag ? `<span class="pill ${k === "qtest" ? "b" : "gr"}">${tag}</span>` : ""}</div>`).join("")}
      <div class="rt-eh">Columns${e.fmt === "qtest" ? ' <span class="sub" style="margin:0;text-transform:none">(fixed qTest layout)</span>' : ""}</div>
      <div class="rt-ecols ${e.fmt === "qtest" ? "dis" : ""}">${RT_COLS.map(([k, l]) => `<label><input type="checkbox" data-col="${k}" ${e.cols.includes(k) ? "checked" : ""} ${e.fmt === "qtest" ? "disabled" : ""}> ${l}</label>`).join("")}</div>
      <div class="rt-eopt"><label><input type="checkbox" id="rtESteps" ${e.steps || e.fmt === "qtest" ? "checked" : ""} ${e.fmt === "qtest" ? "disabled" : ""}> Include steps (one row per step)</label><label><input type="checkbox" id="rtERev" ${e.reviewed ? "checked" : ""}> Only reviewed test cases</label></div>
      <div class="rt-ef"><span class="sub" style="margin:0" id="rtECnt">${list.length} test case${list.length === 1 ? "" : "s"} · ${rows} row${rows === 1 ? "" : "s"}</span><button class="btn sm" id="rtEGo" ${list.length ? "" : "disabled"}>⇩ Export</button></div></div>`;
  };
  const p = openPop(anchor, draw(), 330, true);
  const bind = () => {
    $$("[data-fmt]", p).forEach((d) => (d.onclick = () => { e.fmt = d.dataset.fmt; p.innerHTML = draw(); bind(); }));
    $$("[data-col]", p).forEach((c) => (c.onchange = () => { e.cols = RT_COLS.map((x) => x[0]).filter((k) => (k === c.dataset.col ? c.checked : e.cols.includes(k))); if (!e.cols.length) { e.cols = ["id", "name"]; } p.innerHTML = draw(); bind(); }));
    $("#rtESteps", p).onchange = (x) => { e.steps = x.target.checked; p.innerHTML = draw(); bind(); };
    $("#rtERev", p).onchange = (x) => { e.reviewed = x.target.checked; p.innerHTML = draw(); bind(); };
    $("#rtEGo", p).onclick = () => guarded($("#rtEGo", p), async () => { await rtDoExport(e.fmt, item); closePop(); });
  };
  bind();
}
function rtBatchMenu(anchor, key) {
  const p = openPop(anchor, `${RT_FMTS.map(([k, l]) => `<div class="pi" data-bf="${k}">${l}</div>`).join("")}<div class="pi" data-bf="opt" style="border-top:1px solid #eef0f5">⚙ Options…</div>`, 200, true);
  $$("[data-bf]", p).forEach((d) => (d.onclick = () => {
    if (d.dataset.bf === "opt") { closePop(); const it = (BS.batch.items || []).find((i) => i.key === key); return rtExportPanel(anchor, key, it && it.run && it.run.test_cases ? it.run.test_cases : new Array(it ? it.count : 0).fill({ steps: [{}], status: "not" })); }
    closePop(); download(rtExportUrl(d.dataset.bf, key)); toast("Export started");
  }));
}
// batch Generate table: an Export menu on every item that has test cases
if (typeof bViewGen === "function") {
  const _rtBViewGen = bViewGen;
  window.bViewGen = function (v) {
    _rtBViewGen(v);
    $$("tr[data-k]", v).forEach((tr) => {
      const it = (BS.batch.items || []).find((i) => i.key === tr.dataset.k); if (!it || !it.count) return;
      const td = tr.lastElementChild; td.insertAdjacentHTML("beforeend", ` <button class="btn g sm rt-bexp" data-k="${esc(it.key)}" title="Export ${esc(it.item_id)} test cases">⇩ Export ▾</button>`);
    });
    $$(".rt-bexp", v).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); rtBatchMenu(b, b.dataset.k); }));
  };
}

// ------------------------------------------------------------------ Version history (restore / compare with word-level diff)
const RTV = { sel: [], mode: "unified", data: null, arm: null };
function rtVTime(iso) { try { return hDate(iso); } catch { return iso; } }
async function rtVersions() {
  if (S.localDirty) toast("You have unsaved edits — they are not part of any version until you Save.", true);
  const j = await api("/api/versions"); RTV.data = j; RTV.arm = null;
  const vs = j.versions; RTV.sel = vs.length >= 2 ? [vs[vs.length - 2].v, vs[vs.length - 1].v] : vs.map((x) => x.v);
  rtVDraw();
}
function rtVDraw() {
  const j = RTV.data, vs = [...j.versions].reverse(), cur = j.versions.length ? j.versions[j.versions.length - 1].v : 0;
  const [a, b] = [...RTV.sel].sort((x, y) => x - y);
  modal(`<div class="rt-vers"><div class="rt-vhd"><h1 style="font-size:19px">🕘 Version history</h1><span class="sub" style="margin:0">${esc(j.story_id || "Local run")}${j.title ? " · " + esc(j.title) : ""} · ${j.versions.length} version${j.versions.length === 1 ? "" : "s"}</span><span style="flex:1"></span><button class="btn g sm" id="rtVClose">✕ Close</button></div>
    <div class="rt-vbody"><div class="rt-vlist">${vs.map((x) => `<div class="rt-vi ${RTV.sel.includes(x.v) ? "on" : ""}" data-v="${x.v}"><div class="rt-vt"><b>v${x.v}</b>${x.v === cur ? ' <span class="pill">current</span>' : ""}<span style="flex:1"></span><input type="checkbox" data-vs="${x.v}" ${RTV.sel.includes(x.v) ? "checked" : ""} title="Select for compare"></div>
        <div class="sub" style="margin:2px 0">${esc(rtVTime(x.ts))}</div><div class="rt-vm"><span class="pt-tag">📝 ${esc((x.templates || ["Default"]).join(", "))}</span> ${x.count} TCs · ${esc(x.note)}</div>
        ${x.v === cur ? "" : `<button class="btn g sm" data-vr="${x.v}">${RTV.arm === x.v ? "Confirm restore" : "Restore"}</button>`}</div>`).join("") || '<div class="muted">No versions yet — versions are saved on Generate, Save and Regenerate.</div>'}
      <button class="btn rt-vcmp" id="rtVCmp" ${a && b ? "" : "disabled"}>⇄ Compare ${a ? "v" + a : "…"} ↔ ${b ? "v" + b : "…"}</button></div>
      <div class="rt-vdiff" id="rtVDiff"></div></div></div>`);
  $("#modal").classList.add("wide", "rt-wide");
  $("#rtVClose").onclick = rtCloseModal;
  $$("[data-vs]").forEach((c) => (c.onchange = () => { const v = +c.dataset.vs; RTV.sel = c.checked ? [...RTV.sel.filter((x) => x !== v), v].slice(-2) : RTV.sel.filter((x) => x !== v); rtVDraw(); }));
  $$("[data-vr]").forEach((bt) => (bt.onclick = () => guarded(bt, async () => {
    const v = +bt.dataset.vr; if (RTV.arm !== v) { RTV.arm = v; rtVDraw(); return; }
    const r = await api(`/api/versions/${v}/restore`, { method: "POST" });
    S.localDirty = false; RT.edit.clear(); rtCloseModal(); render(); toast(`Restored v${v}${r.version ? ` — saved as v${r.version}` : ""}`);
  })));
  $("#rtVCmp").onclick = () => rtVDiff(a, b);
  if (a && b) rtVDiff(a, b);
}
function rtWD(x, y) {   // word-level diff -> [oldHtml, newHtml, unifiedHtml]
  const tk = (v) => String(v || "").match(/\S+\s*/g) || [], A = tk(x), B = tk(y), n = A.length, m = B.length;
  if (n * m > 250000) return [`<del>${esc(x)}</del>`, `<ins>${esc(y)}</ins>`, `<del>${esc(x)}</del> <ins>${esc(y)}</ins>`];
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, o = "", nw = "", u = "";
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { o += esc(A[i]); nw += esc(B[j]); u += esc(A[i]); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { nw += `<ins>${esc(B[j])}</ins>`; u += `<ins>${esc(B[j])}</ins>`; j++; }
    else { o += `<del>${esc(A[i])}</del>`; u += `<del>${esc(A[i])}</del>`; i++; }
  }
  return [o, nw, u];
}
function rtCaseFields(t) {
  const f = [["Title", t.name], ["Description", t.description], ["Precondition", t.precondition], ["Priority", t.priority], ["ACs", (t.acs || []).join(", ")]];
  if (t.type) f.push(["Type", t.type]);
  (t.steps || []).forEach((s, i) => { f.push([`Step ${i + 1}`, s.description], [`Step ${i + 1} expected`, s.expected]); });
  return f;
}
function rtCompare(A, B) {
  const ma = new Map(A.map((t) => [t.id, t])), mb = new Map(B.map((t) => [t.id, t])), rows = [], same = [];
  B.forEach((t) => {
    const o = ma.get(t.id);
    if (!o) { rows.push({ id: t.id, k: "added", t }); return; }
    const fo = new Map(rtCaseFields(o)), fn = new Map(rtCaseFields(t)), ch = [];
    new Set([...fo.keys(), ...fn.keys()]).forEach((k) => { if ((fo.get(k) || "") !== (fn.get(k) || "")) ch.push([k, fo.get(k) || "", fn.get(k) || ""]); });
    if (ch.length) rows.push({ id: t.id, k: "modified", ch }); else same.push(t.id);
  });
  A.forEach((t) => { if (!mb.has(t.id)) rows.push({ id: t.id, k: "removed", t }); });
  rows.sort((x, y) => x.id.localeCompare(y.id));
  return { rows, same };
}
function rtVDiff(a, b) {
  const vs = RTV.data.versions, A = vs.find((x) => x.v === a), B = vs.find((x) => x.v === b); if (!A || !B) return;
  const d = rtCompare(A.cases, B.cases), cnt = (k) => d.rows.filter((r) => r.k === k).length, sbs = RTV.mode === "side";
  const sum = (t) => `${esc(t.name)} · ${(t.steps || []).length} steps${(t.acs || []).length ? " · " + esc(t.acs.join(", ")) : ""}`;
  const body = d.rows.map((r) => {
    if (r.k !== "modified") return `<tr class="rt-d ${r.k}"><td><b>${esc(r.id)}</b></td><td><span class="rt-dk ${r.k}">${r.k === "added" ? "Added" : "Removed"}</span></td>${sbs ? (r.k === "added" ? `<td></td><td>${sum(r.t)}</td>` : `<td><del>${sum(r.t)}</del></td><td></td>`) : `<td>${r.k === "added" ? sum(r.t) : `<del>${sum(r.t)}</del>`}</td>`}</tr>`;
    const w = r.ch.map(([k, o, n]) => [k, rtWD(o, n)]);
    return `<tr class="rt-d modified"><td><b>${esc(r.id)}</b></td><td><span class="rt-dk modified">Modified</span></td>${sbs ? `<td>${w.map(([k, x]) => `<div><b>${esc(k)}:</b> ${x[0]}</div>`).join("")}</td><td>${w.map(([k, x]) => `<div><b>${esc(k)}:</b> ${x[1]}</div>`).join("")}</td>` : `<td>${w.map(([k, x]) => `<div><b>${esc(k)}:</b> ${x[2]}</div>`).join("")}</td>`}</tr>`;
  }).join("") + (d.same.length ? `<tr class="rt-d same"><td class="sub">${esc(d.same.join(", "))}</td><td><span class="rt-dk same">Unchanged</span></td><td ${sbs ? 'colspan="2"' : ""} class="sub">${d.same.length} test case${d.same.length === 1 ? "" : "s"} unchanged</td></tr>` : "");
  $("#rtVDiff").innerHTML = `<div class="rt-vdh"><b>Diff: v${a} → v${b}</b><span class="rt-dk added">+${cnt("added")} added</span><span class="rt-dk removed">−${cnt("removed")} removed</span><span class="rt-dk modified">~${cnt("modified")} modified</span><span style="flex:1"></span>
    <div class="rt-tg"><button data-dm="unified" class="${sbs ? "" : "a"}">Unified</button><button data-dm="side" class="${sbs ? "a" : ""}">Side by side</button></div></div>
    <table class="rt-dt"><tr><th>ID</th><th>Change</th>${sbs ? `<th>v${a}</th><th>v${b}</th>` : `<th>v${a} → v${b}</th>`}</tr>${body || `<tr><td colspan="4" class="sub">No differences.</td></tr>`}</table>`;
  $$("[data-dm]").forEach((x) => (x.onclick = () => { RTV.mode = x.dataset.dm; rtVDiff(a, b); }));
}
