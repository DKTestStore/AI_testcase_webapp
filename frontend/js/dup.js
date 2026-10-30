/* Duplicate detection (local text similarity, no AI call).
   Score = 30% title + 40% steps + 30% expected results. Flags pairs >= threshold (Settings, default 80%).
   Delete / Merge are normal unsaved Review edits (Save changes), with Undo. "Keep both" is stored on the run. */
"use strict";

const DUP = { threshold: 80, res: null, dismissed: null, only: false, panel: false, msg: "", undo: null, manual: false };
const _dTokC = new Map();
function dTok(s) {   // memoised word set (renderList recomputes similarity on every edit)
  s = String(s || ""); let v = _dTokC.get(s);
  if (!v) { if (_dTokC.size > 20000) _dTokC.clear(); v = new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1)); _dTokC.set(s, v); }
  return v;
}
function dJac(a, b) { if (!a.size && !b.size) return 1; let n = 0; a.forEach((w) => b.has(w) && n++); return n / (a.size + b.size - n || 1); }
const dNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function dFp(t) {   // content fingerprint, survives renumbering / reordering
  const s = dNorm(t.name) + "#" + t.steps.map((x) => dNorm(x.description) + ">" + dNorm(x.expected)).join("|");
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
}
const dPairKey = (a, b) => [dFp(a), dFp(b)].sort().join("|");
function dStepSim(x, y) { return dJac(dTok(x.description + " " + x.expected), dTok(y.description + " " + y.expected)); }
function dSim(a, b) {
  const title = dJac(dTok(a.name), dTok(b.name));
  const steps = dJac(dTok(a.steps.map((s) => s.description).join(" ")), dTok(b.steps.map((s) => s.description).join(" ")));
  const exp = dJac(dTok(a.steps.map((s) => s.expected).join(" ")), dTok(b.steps.map((s) => s.expected).join(" ")));
  const same = a.steps.filter((s) => b.steps.some((y) => dStepSim(s, y) >= 0.8)).length;
  const why = [];
  if (title >= 0.8) why.push(title === 1 ? "same title" : "similar title");
  if (same && same / Math.max(a.steps.length, b.steps.length) >= 0.5) why.push(`same steps (${same}/${Math.max(a.steps.length, b.steps.length)})`);
  else if (steps >= 0.7) why.push("similar steps");
  if (exp >= 0.8) why.push("same expected result");
  return { pct: Math.round((0.3 * title + 0.4 * steps + 0.3 * exp) * 100), why: why.length ? why : ["similar wording"] };
}
function dupRun() {
  const cs = S.cases, keep = new Set((S.run && S.run.dup_keep) || []), pairs = [];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const s = dSim(cs[i], cs[j]);
    if (s.pct >= DUP.threshold && !keep.has(dPairKey(cs[i], cs[j]))) pairs.push({ a: cs[i]._k, b: cs[j]._k, ...s });
  }
  const par = {}, f = (k) => (par[k] === undefined || par[k] === k ? (par[k] = k) : (par[k] = f(par[k])));
  pairs.forEach((p) => (par[f(p.a)] = f(p.b)));
  const gm = {}; pairs.forEach((p) => { const r = f(p.a); (gm[r] = gm[r] || { pairs: [], keys: new Set() }).pairs.push(p); gm[r].keys.add(p.a); gm[r].keys.add(p.b); });
  const groups = Object.values(gm).map((g) => ({ ...g, pct: Math.max(...g.pairs.map((p) => p.pct)) })).sort((x, y) => y.pct - x.pct);
  const best = new Map();
  pairs.forEach((p) => { [[p.a, p.b], [p.b, p.a]].forEach(([k, o]) => { if (!best.has(k) || best.get(k).pct < p.pct) best.set(k, { other: o, pct: p.pct }); }); });
  DUP.res = { pairs, groups, best, runId: S.run && S.run.run_id };
  return DUP.res;
}
const dOn = () => DUP.res && DUP.dismissed !== (S.run && S.run.run_id);
const dCase = (k) => S.cases.find((t) => t._k === +k);
function dupBadge(t) {
  let h = t.merged ? `<span class="mg-badge" title="Merged duplicate test cases — review it again">≋ Merged from ${esc(t.merged)}</span>` : "";
  if (!dOn()) return h;
  const b = DUP.res.best.get(t._k); const o = b && dCase(b.other);
  if (o) h += `<span class="dp-badge ${b.pct >= 90 ? "hi" : ""}" data-dup="${t._k}" data-o="${o._k}" title="Click to compare">≋ Possible duplicate of ${esc(o.id)} · ${b.pct}% similar</span>`;
  return h;
}
function dupFlagged(t) { return dOn() && DUP.res.best.has(t._k); }
function dupFilter(t) { return !DUP.only || !dOn() || DUP.res.best.has(t._k); }

// ------------------------------------------------------------------ banner / filter / panel (called from renderList)
function dupPrepare() {   // before cards are drawn (badges + filter need the fresh result)
  if (!$("#dupBanner")) return;
  if (!DUP.thr) { DUP.thr = true; api("/api/settings/dup_threshold").then((j) => { if (j.value !== DUP.threshold) { DUP.threshold = j.value; if ($("#rvList")) renderList(); } }).catch(() => {}); }
  if (DUP.res && DUP.res.runId !== (S.run && S.run.run_id)) Object.assign(DUP, { manual: false, msg: "", only: false, panel: false });
  dupRun();
}
function dupRender() {
  const ban = $("#dupBanner"); if (!ban || !DUP.res) return;
  const g = DUP.res.groups, flagged = DUP.res.best.size;
  if (!dOn() || (!g.length && !DUP.manual && !DUP.msg)) { ban.innerHTML = ""; ban.className = ""; $("#dupOnly").innerHTML = ""; $("#dupPanel").innerHTML = ""; dupBatchBadge(0); return; }
  if (!g.length) DUP.only = false;
  ban.className = "dp-banner" + (g.length ? "" : " ok");
  ban.innerHTML = g.length
    ? `≋ <b>${g.length} possible duplicate group${g.length === 1 ? "" : "s"} ${DUP.msg ? "left" : "found"}</b> · ${DUP.msg ? esc(DUP.msg) + " · " : ""}${flagged} of ${S.cases.length} test cases flagged · threshold ${DUP.threshold}% · checked locally (no AI call)<span class="sp"></span>
       <button class="btn sm" id="dupGroups">☰ ${DUP.panel ? "Hide" : "View"} groups</button><button class="btn sm" id="dupOnlyBtn">⚑ ${DUP.only ? "Show all" : "Show duplicates only"}</button><button class="btn sm" id="dupRe">↻ Re-check</button><button class="btn sm" id="dupDis">✕ Dismiss</button>`
    : `✓ <b>No possible duplicates ${DUP.msg ? "left" : "found"}</b>${DUP.msg ? " · " + esc(DUP.msg) : ""} · threshold ${DUP.threshold}% · checked locally (no AI call)<span class="sp"></span><button class="btn sm" id="dupDis">✕ Dismiss</button>`;
  $("#dupOnly").innerHTML = g.length ? `<label class="dp-only"><input type="checkbox" id="dupOnlyChk" ${DUP.only ? "checked" : ""}> Show duplicates only <span class="pill y">${flagged}</span></label>` : "";
  const setOnly = (v) => { DUP.only = v; RV.page = 0; renderList(); };
  const oc = $("#dupOnlyChk"); if (oc) oc.onchange = () => setOnly(oc.checked);
  const ob = $("#dupOnlyBtn"); if (ob) ob.onclick = () => setOnly(!DUP.only);
  const gb = $("#dupGroups"); if (gb) gb.onclick = () => { DUP.panel = !DUP.panel; renderList(); };
  const rb = $("#dupRe"); if (rb) rb.onclick = () => dupCheck();
  $("#dupDis").onclick = () => { DUP.dismissed = S.run.run_id; DUP.only = false; DUP.panel = false; DUP.msg = ""; renderList(); };
  $("#dupPanel").innerHTML = DUP.panel && g.length ? dupPanelHtml(g) : "";
  $$("#dupPanel [data-cmp]").forEach((b) => (b.onclick = () => dupCompare(+b.dataset.a, +b.dataset.b)));
  $$("#dupPanel [data-keep]").forEach((b) => (b.onclick = () => guarded(b, () => dupKeep(+b.dataset.a, +b.dataset.b))));
  const ka = $("#dupKeepAll"); if (ka) ka.onclick = () => guarded(ka, () => dupKeep(null, null, DUP.res.pairs));
  const cl = $("#dupClose"); if (cl) cl.onclick = () => { DUP.panel = false; renderList(); };
  dupBatchBadge(g.length);
}
function dupBatchRefresh() { dupBatchBadge(dOn() ? DUP.res.groups.length : 0); }
function dupBatchBadge(n) {
  const it = $(".bt-item.a"); if (!it) return;
  let s = it.querySelector(".dp-badge"); if (!n) { if (s) s.remove(); return; }
  if (!s) { s = document.createElement("span"); s.className = "dp-badge"; s.style.marginTop = "4px"; it.appendChild(s); }
  s.textContent = `≋ ${n} dup group${n === 1 ? "" : "s"}`;
}
function dupPanelHtml(g) {
  const acs = (t) => t.acs.length ? t.acs.join(", ") : "no AC";
  return `<div class="dp-panel"><h3>≋ Duplicate groups <span class="pill y">${g.length} group${g.length === 1 ? "" : "s"} · ${DUP.res.best.size} TCs</span><span style="margin-left:auto"></span><button class="btn g sm" id="dupKeepAll">Keep all (not duplicates)</button><button class="btn g sm" id="dupClose">✕ Close</button></h3>
    <div class="dp-g dp-hd"><span>Similarity</span><span>Test cases</span><span>Reason</span><span>AC links</span><span>Actions</span></div>
    ${g.map((gr) => gr.pairs.sort((x, y) => y.pct - x.pct).map((p, i) => { const a = dCase(p.a), b = dCase(p.b); return `<div class="dp-g ${i ? "sub-pair" : ""}">
      <span class="pct ${p.pct >= 90 ? "" : "m"}">${p.pct}%</span>
      <span><b class="tcid">${esc(a.id)}</b> ${esc(a.name)}<br><b class="tcid">${esc(b.id)}</b> ${esc(b.name)}</span>
      <span>${p.why.map((w) => `<span class="dp-r">${esc(w)}</span>`).join("")}</span>
      <span class="res">${esc(acs(a))} · ${esc(acs(b))}${a.acs.join() === b.acs.join() ? " (same)" : " → merge keeps both"}</span>
      <span><button class="btn sm" data-cmp="1" data-a="${a._k}" data-b="${b._k}">⇆ Compare</button> <button class="btn g sm" data-keep="1" data-a="${a._k}" data-b="${b._k}">Keep both</button></span></div>`; }).join("")).join("")}
    <div class="sub" style="margin:8px 0 0;font-size:12px">Similarity = 30% title + 40% steps + 30% expected results (local text match). Pairs marked “Keep both” are not flagged again for this run (also after reopening it from Run history).</div></div>`;
}
function dupCheck() {
  DUP.manual = true; DUP.dismissed = null; DUP.msg = ""; DUP.res = null; renderList();
  const g = DUP.res ? DUP.res.groups.length : 0;
  toast(g ? `${g} possible duplicate group${g === 1 ? "" : "s"} found` : "No possible duplicates found");
}
async function dupKeep(ka, kb, pairs) {
  const list = pairs || [{ a: ka, b: kb }];
  const keys = new Set(S.run.dup_keep || []);
  list.forEach((p) => keys.add(dPairKey(dCase(p.a), dCase(p.b))));
  const j = await api("/api/review/dup_keep", { method: "PUT", body: { pairs: [...keys] } });
  S.run.dup_keep = j.dup_keep;
  closeModal(); DUP.msg = list.length === 1 ? `${dCase(ka).id} and ${dCase(kb).id} kept (not duplicates)` : `${list.length} pairs kept`;
  toast(list.length === 1 ? `Kept both ${dCase(ka).id} and ${dCase(kb).id} — not flagged again` : `${list.length} pairs marked as not duplicates`);
  renderList();
}

// ------------------------------------------------------------------ compare / delete / merge
function dStepRows(steps, other) {
  return steps.map((s, i) => {
    const m = Math.max(0, ...other.map((y) => dStepSim(s, y)));
    const cls = m >= 0.999 ? "m-same" : m >= 0.5 ? "m-sim" : "m-diff";
    return `<tr class="${cls}"><td>${i + 1}</td><td>${esc(s.description)}</td><td>${esc(s.expected)}</td></tr>`;
  }).join("");
}
function dCol(t, o) {
  return `<div class="col"><h4><b class="tcid">${esc(t.id)}</b> ${esc(t.name)} ${t.acs.map((a) => `<span class="ac ${acCls(a)}">${esc(a)}</span>`).join("")}<span class="prio p-${t.priority}">${t.priority}</span></h4>
    <div class="res">${esc(t.description)}</div><div class="res">Precondition: ${esc(t.precondition || "—")}</div>
    <table><tr><th>#</th><th>Step</th><th>Expected</th></tr>${dStepRows(t.steps, o.steps)}</table></div>`;
}
const pill = () => (S.run.story_id ? `<span class="ticket-pill">Ticket ${esc(S.run.story_id)}</span>` : "");
function dupCompare(ka, kb) {
  let a = dCase(ka), b = dCase(kb); if (!a || !b) return;
  if (S.cases.indexOf(a) > S.cases.indexOf(b)) [a, b] = [b, a];
  const s = dSim(a, b);
  modal(`<div class="dp-modal"><h1>Compare possible duplicates ${pill()} <span class="pill ${s.pct >= 90 ? "r" : "y"}" style="font-size:13px">${s.pct}% similar</span></h1>
    <div class="sub">Reason: ${s.why.map(esc).join(" · ")} · <span class="lg"><i class="m-same"></i>identical</span><span class="lg"><i class="m-sim"></i>similar wording</span><span class="lg"><i class="m-diff"></i>different</span></div>
    <div class="cmp">${dCol(a, b)}${dCol(b, a)}</div>
    <div class="note2">ℹ Deleting or merging removes one test case — IDs after it are <b>renumbered</b>. AC links of both are kept on a merged result. Changes stay unsaved until you Save; Undo is available right after.</div>
    <div class="dp-acts"><button class="btn g" id="dpCancel">Close</button><span style="flex:1"></span><button class="btn g" id="dpKeep">✓ Keep both (not a duplicate)</button><button class="btn g dp-del" id="dpDelB">🗑 Delete ${esc(b.id)}</button><button class="btn g dp-del" id="dpDelA">🗑 Delete ${esc(a.id)}</button><button class="btn" id="dpMerge">≋ Merge into one…</button></div></div>`);
  $("#modal").classList.add("wide");
  $("#dpCancel").onclick = dupClose;
  $("#dpKeep").onclick = () => guarded($("#dpKeep"), () => dupKeep(a._k, b._k));
  $("#dpDelB").onclick = () => dupDelete(b, a);
  $("#dpDelA").onclick = () => dupDelete(a, b);
  $("#dpMerge").onclick = () => dupMergeEditor(a, b);
}
function dupClose() { closeModal(); $("#modal").classList.remove("wide"); }
function dSnap() { return { cases: JSON.parse(JSON.stringify(S.cases)), keys: S.cases.map((t) => t._k), dirty: S.localDirty }; }
function dupDelete(t, other) {
  const snap = dSnap(), id = t.id;
  S.cases = S.cases.filter((x) => x !== t); renumber(); RV.open.delete(t._k); markDirty();
  DUP.msg = `${id} deleted · IDs renumbered`; dupClose(); renderList();
  dupUndoToast(`🗑 ${id} deleted (duplicate of ${other.id}) · IDs renumbered · ${snap.cases.length} → ${S.cases.length} test cases`, snap);
}
function dupUndoToast(msg, snap) {
  DUP.undo = snap;
  const el = $("#toast"); el.className = "toast rg"; el.innerHTML = `<span>${esc(msg)}</span><a id="dupUndo" href="#">Undo</a>`; el.style.display = "flex";
  $("#dupUndo").onclick = (e) => { e.preventDefault(); dupUndo(); };
  clearTimeout(toast._t); toast._t = setTimeout(() => (el.style.display = "none"), 10000);
}
function dupUndo() {
  const u = DUP.undo; if (!u) return; DUP.undo = null;
  S.cases = u.cases.map((x, i) => { x._k = u.keys[i]; return normCase(x); });
  $("#toast").style.display = "none"; DUP.msg = "";
  if (u.dirty) markDirty(); else markDirty();
  renderList(); toast("Undone");
}
function dupMergeEditor(a, b) {
  const M = { name: "a", description: "a", precondition: "a", priority: "a", acs: new Set([...a.acs, ...b.acs]),
              steps: [...a.steps.map((s, i) => ({ s, on: true, from: "a", i })), ...b.steps.filter((s) => !a.steps.some((y) => dStepSim(s, y) >= 0.999)).map((s, i) => ({ s, on: false, from: "b", i }))] };
  const val = (f) => (M[f] === "a" ? a : b)[f];
  const opt = (f, label) => `<div class="mrow"><span class="lab">${label}</span>${["a", "b"].map((w) => `<label class="opt ${M[f] === w ? "on" : ""}"><input type="radio" name="mg_${f}" value="${w}" ${M[f] === w ? "checked" : ""}> ${esc((w === "a" ? a : b)[f] || "—")}</label>`).join("")}</div>`;
  const draw = () => {
    const acsAll = [...new Set([...a.acs, ...b.acs])];
    const steps = M.steps.filter((x) => x.on);
    $("#modal").innerHTML = `<div class="dp-modal"><h1>Merge ${esc(a.id)} + ${esc(b.id)} ${pill()}</h1><div class="sub">Pick each field from either test case. Steps: tick the ones to keep (${esc(a.id)}'s steps first, then extra steps from ${esc(b.id)}).</div>
      <div class="mg-grid"><div>
        <div class="mrow"><span></span><b>${esc(a.id)} (keeps this ID)</b><b>${esc(b.id)} (removed)</b></div>
        ${opt("name", "Name")}${opt("description", "Description")}${opt("precondition", "Precondition")}${opt("priority", "Priority")}
        <div class="mrow"><span class="lab">AC links</span><div class="opt-wrap">${acsAll.length ? acsAll.map((x) => `<label class="opt ${M.acs.has(x) ? "on" : ""}"><input type="checkbox" data-ac="${esc(x)}" ${M.acs.has(x) ? "checked" : ""}> ${esc(x)}</label>`).join("") : '<span class="res">No AC links</span>'}</div><span></span></div>
        ${M.steps.map((x, n) => `<div class="mrow"><span class="lab">${x.from === "a" ? `${esc(a.id)} step ${x.i + 1}` : `${esc(b.id)} extra ${x.i + 1}`}</span><label class="opt ${x.on ? "on" : ""}" style="grid-column:2/4"><input type="checkbox" data-st="${n}" ${x.on ? "checked" : ""}> ${esc(x.s.description)} → <i>${esc(x.s.expected)}</i></label></div>`).join("")}
        ${b.steps.length - M.steps.filter((x) => x.from === "b").length ? `<div class="res" style="margin:4px 0 0 128px">${b.steps.length - M.steps.filter((x) => x.from === "b").length} identical step(s) of ${esc(b.id)} are kept once.</div>` : ""}
      </div><div><div class="prv" id="mgPrev"><b>Result preview</b> <span class="mg-badge">≋ Merged</span><div style="margin:6px 0"><b class="tcid">${esc(a.id)}</b> ${esc(val("name"))}</div>
        <div class="res">${[...M.acs].map(esc).join(" · ") || "no AC"} · ${esc(val("priority"))} · status → Not reviewed</div><ol>${steps.map((x) => `<li>${esc(x.s.description)} → <i>${esc(x.s.expected)}</i></li>`).join("") || "<li class='res'>No steps selected</li>"}</ol></div>
        <div class="note2">After merge: ${esc(b.id)} is removed and later IDs are <b>renumbered</b>. ${S.cases.length} → ${S.cases.length - 1} test cases. Unsaved until you Save changes.</div></div></div>
      <div class="dp-acts"><button class="btn g" id="mgBack">‹ Back to compare</button><span style="flex:1"></span><button class="btn g" id="mgCancel">Cancel</button><button class="btn" id="mgGo" ${steps.length ? "" : "disabled"}>✓ Merge (keep ${esc(a.id)})</button></div></div>`;
    $$("#modal input[type=radio]").forEach((r) => (r.onchange = () => { M[r.name.slice(3)] = r.value; draw(); }));
    $$("#modal [data-ac]").forEach((c) => (c.onchange = () => { c.checked ? M.acs.add(c.dataset.ac) : M.acs.delete(c.dataset.ac); draw(); }));
    $$("#modal [data-st]").forEach((c) => (c.onchange = () => { M.steps[+c.dataset.st].on = c.checked; draw(); }));
    $("#mgBack").onclick = () => dupCompare(a._k, b._k);
    $("#mgCancel").onclick = dupClose;
    $("#mgGo").onclick = () => {
      const snap = dSnap(), ida = a.id, idb = b.id, n0 = S.cases.length;
      Object.assign(a, { name: val("name"), description: val("description"), precondition: val("precondition"), priority: val("priority"),
        acs: [...M.acs], status: "not", merged: `${ida} + ${idb}`,
        steps: M.steps.filter((x) => x.on).map((x) => ({ description: x.s.description, expected: x.s.expected, _k: ++_uid })) });
      a._ed = { name: 1 };
      S.cases = S.cases.filter((x) => x !== b); renumber(); RV.open.delete(b._k); markDirty();
      DUP.msg = `${idb} merged into ${ida} · IDs renumbered`; dupClose(); RV.just = a._k; renderList();
      dupUndoToast(`≋ Merged ${idb} into ${ida} · ${[...M.acs].join(" + ") || "no AC"} linked · ${n0} → ${S.cases.length} test cases`, snap);
    };
  };
  $("#modal").classList.add("wide"); draw();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest(".dp-badge[data-dup]"); if (!b) return;
  e.preventDefault(); e.stopPropagation(); dupCompare(+b.dataset.dup, +b.dataset.o);
}, true);

