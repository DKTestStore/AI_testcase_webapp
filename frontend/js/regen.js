/* Regenerate ONE test case (mockups regen_01..05).
   The server returns a proposal only; Accept / Add as new / Undo are applied here and persisted
   with PUT /api/review/test_cases (which also updates the Run history entry). */
"use strict";
const RG = { loading: null, ctrl: null, last: null, undo: null, flash: null };
window.RG = RG;
const RG_CHIPS = [["neg", "＋ Add negative cases", "Add negative test cases (invalid, empty and unexpected inputs) with clear error expectations."],
  ["bnd", "Add boundary values", "Add boundary value checks (min, max, just below / above limits)."],
  ["det", "More detailed steps", "Make the steps more detailed and concrete with exact test data and observable expected results."],
  ["sim", "Simplify", "Simplify: fewer, clearer steps without losing coverage."]];
const rgClone = (o) => JSON.parse(JSON.stringify(o));
const rgFind = (k) => S.cases.find((t) => t._k === k);

window.rgOverlay = (t) => `<div class="rg-ov"><div class="box"><span class="rg-spin"></span><span><b>Regenerating ${esc(t.id)}…</b><br><span class="sub" style="margin:0">${esc(RG.last && RG.last.instruction ? "“" + RG.last.instruction.slice(0, 60) + (RG.last.instruction.length > 60 ? "…" : "") + "”" : "Improving this test case")} · other test cases stay editable</span></span><button class="btn g sm" data-act="rgcancel" id="rgCancel">Cancel</button></div></div>`;

function openRegen(btn, t) {
  if (RG.loading) return;
  const acs = (S.run.ac_list || []).filter((a) => t.acs.includes(a.id));
  const acOpts = (S.run.ac_list || []).map((a) => `<option value="${esc(a.id)}">${esc(a.id)}${a.title ? " · " + esc(a.title.slice(0, 40)) : ""}</option>`).join("");
  const keepDefault = !!(t._ed && t._ed.name);
  const p = openPop(btn, `<div class="rg-pop-in"><h4>↻ Regenerate ${esc(t.id)}</h4>
    <div class="sub" style="margin:0 0 10px">Only this test case is rewritten. ID ${esc(t.id)} and its position stay the same.</div>
    <div class="rg-ctx">Context sent: story <b>${esc(S.run.story_id || "—")}</b> · ${acs.length ? "linked <b>" + acs.map((a) => esc(a.id + (a.title ? " " + a.title.slice(0, 30) : ""))).join(", ") + "</b>" : "no linked AC"} · current ${esc(t.id)} (name, ${t.steps.length} steps)</div>
    <label class="rg-l" for="rgIns">Instruction (optional)</label>
    <textarea id="rgIns" maxlength="1000" placeholder="e.g. Add negative cases for invalid and empty email">${esc((RG.lastIns && RG.lastIns[t._k]) || "")}</textarea>
    <div class="rg-chips">${RG_CHIPS.map(([k, l]) => `<span class="rg-chip" data-c="${k}">${l}</span>`).join("")}${acOpts ? `<select class="rg-chip rg-acsel" id="rgAc"><option value="">Cover AC… ▾</option>${acOpts}</select>` : ""}</div>
    <label class="rg-row"><input type="checkbox" id="rgKeep" ${keepDefault ? "checked" : ""}> Keep my edits to title &amp; priority</label>
    <label class="rg-row"><input type="checkbox" id="rgNew"> Add as a new test case instead of replacing</label>
    <div class="rg-foot"><span class="sub" style="margin:0">≈ 1 Gemini call</span><span><button class="btn g sm" id="rgX">Cancel</button> <button class="btn sm" id="rgGo">↻ Regenerate</button></span></div></div>`, 440, true);
  p.classList.add("rg-pop");
  const ta = $("#rgIns", p);
  const addLine = (txt) => { if (!ta.value.includes(txt)) ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + txt; };
  $$(".rg-chip[data-c]", p).forEach((c) => (c.onclick = () => { c.classList.add("on"); addLine(RG_CHIPS.find((x) => x[0] === c.dataset.c)[2]); }));
  const sel = $("#rgAc", p); if (sel) sel.onchange = () => { if (sel.value) { addLine(`Make sure it covers ${sel.value}.`); sel.classList.add("on"); } };
  $("#rgX", p).onclick = closePop;
  $("#rgGo", p).onclick = () => { const o = { k: t._k, instruction: ta.value.trim(), keep: $("#rgKeep", p).checked, asNew: $("#rgNew", p).checked };
    RG.lastIns = RG.lastIns || {}; RG.lastIns[t._k] = o.instruction; closePop(); runRegen(o); };
  setTimeout(() => ta.focus(), 0);
}

async function runRegen(o) {
  const t = rgFind(o.k); if (!t) return;
  RG.last = o; RG.loading = o.k; RG.ctrl = new AbortController(); renderList();
  try {
    const r = await fetch("/api/review/regenerate", { method: "POST", credentials: "same-origin", signal: RG.ctrl.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test_case: t, instruction: o.instruction, keep_title_priority: o.keep }) });
    let j = {}; try { j = await r.json(); } catch { j = { ok: false, error: `HTTP ${r.status}` }; }
    if (r.status === 401) { window.location.href = "/welcome"; return; }
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
    RG.loading = null; renderList(); showCompare(o, j.proposal);
  } catch (e) {
    RG.loading = null; renderList();
    if (e.name === "AbortError") { toast("Regeneration cancelled — test case unchanged"); return; }
    toast(`Could not regenerate ${t.id}: ${e.message}`, true);
  } finally { RG.ctrl = null; }
}
function cancelRegen() { if (RG.ctrl) RG.ctrl.abort(); }
window.cancelRegen = cancelRegen; window.openRegen = openRegen;

function rgSteps(oldS, newS) {
  const n = Math.max(oldS.length, newS.length); const L = [], R = []; let add = 0, chg = 0, del = 0;
  const same = (a, b) => a.description.trim() === b.description.trim() && a.expected.trim() === b.expected.trim();
  for (let i = 0; i < n; i++) {
    const a = oldS[i], b = newS[i];
    if (a && b) { const k = same(a, b) ? "" : "chg"; if (k) chg++; L.push([i + 1, a, k]); R.push([i + 1, b, k]); }
    else if (b) { add++; L.push(null); R.push([i + 1, b, "add"]); }
    else { del++; L.push([i + 1, a, "del"]); R.push(null); }
  }
  return { L, R, add, chg, del };
}
const rgRow = (x) => x ? `<div class="rg-st ${x[2] ? "rg-" + x[2] : ""}"><span class="n">${x[0]}</span><span>${esc(x[1].description)}${x[2] === "add" ? '<span class="rg-tag a">NEW</span>' : x[2] === "chg" ? '<span class="rg-tag c">CHANGED</span>' : x[2] === "del" ? '<span class="rg-tag d">REMOVED</span>' : ""}</span><span>${esc(x[1].expected)}</span></div>` : `<div class="rg-st rg-gap"><span class="n">–</span><span>—</span><span></span></div>`;

function showCompare(o, prop) {
  const t = rgFind(o.k); if (!t) return;
  const d = rgSteps(t.steps, prop.steps);
  const fld = (l, a, b) => { const c = (a || "").trim() !== (b || "").trim(); return [`<div class="rg-f"><div class="l">${l}</div>${c && l === "Name" ? `<span class="rg-del-i">${esc(a) || "—"}</span>` : esc(a) || '<span class="muted">—</span>'}</div>`, `<div class="rg-f ${c ? "rg-chg" : ""}"><div class="l">${l}</div>${esc(b) || '<span class="muted">—</span>'}</div>`, c]; };
  const F = [fld("Name", t.name, prop.name), fld("Description", t.description, prop.description), fld("Precondition", t.precondition, prop.precondition)];
  const changedF = ["name", "description", "precondition"].filter((_, i) => F[i][2]);
  const nextId = "TC" + pad3(S.cases.length + 1);
  const pr = prop.priority === t.priority ? `Priority ${esc(t.priority)}${o.keep ? " (kept)" : ""}` : `Priority ${esc(t.priority)} → ${esc(prop.priority)}`;
  const sub = `Instruction: ${o.instruction ? "“" + esc(o.instruction.slice(0, 120)) + (o.instruction.length > 120 ? "…" : "") + "”" : "<i>none (general improvement)</i>"}${o.keep ? " · Title &amp; priority edits kept" : ""}`;
  const hdr = '<div class="rg-st rg-h"><span>#</span><span>STEP</span><span>EXPECTED</span></div>';
  modal(`<div class="rg-cmp-wrap"><h1 style="font-size:19px">Review regenerated ${esc(t.id)} ${S.run.story_id ? `<span class="ticket-pill">Ticket ${esc(S.run.story_id)}</span>` : ""}</h1>
    <div class="sub" style="margin:2px 0 8px">${sub}</div>
    <div class="rg-sum">${d.add ? `<span class="pill">＋ ${d.add} step${d.add > 1 ? "s" : ""} added</span>` : ""}${d.chg ? `<span class="pill y">✎ ${d.chg} step${d.chg > 1 ? "s" : ""} changed</span>` : ""}${d.del ? `<span class="pill r">− ${d.del} step${d.del > 1 ? "s" : ""} removed</span>` : ""}${changedF.length ? `<span class="pill b">${changedF.join(", ")} updated</span>` : ""}<span class="pill gr">${pr}${t.acs.length ? " · " + esc(t.acs.join(", ")) : ""}</span>${!d.add && !d.chg && !d.del && !changedF.length ? '<span class="pill gr">No changes — try a different instruction</span>' : ""}</div>
    <div class="rg-cmp"><div class="rg-col"><h5><span>Original</span><span class="muted">${t.steps.length} steps</span></h5>${F.map((f) => f[0]).join("")}${hdr}${d.L.map(rgRow).join("")}</div>
      <div class="rg-col new"><h5><span>Regenerated ✨</span><span class="muted">${prop.steps.length} steps</span></h5>${F.map((f) => f[1]).join("")}${hdr}${d.R.map(rgRow).join("")}</div></div>
    <div class="rg-acts"><div><button class="btn g sm" id="rgAgain">↻ Try again</button> <button class="btn g sm" id="rgAddNew">＋ Add as new test case (${nextId})</button></div>
      <div><button class="btn g" id="rgKeepOrig">Keep original</button> <button class="btn s" id="rgAccept">${o.asNew ? `✓ Add as ${nextId}` : `✓ Accept &amp; replace ${esc(t.id)}`}</button></div></div>
    <div class="sub" style="margin:10px 0 0">${o.asNew ? `Adds a new test case ${nextId} at the end; ${esc(t.id)} is unchanged.` : `Accepting replaces ${esc(t.id)} in place (numbering unchanged), sets status to <b>Not reviewed</b> and can be undone.`}</div></div>`);
  $("#modal").classList.add("wide");
  $("#rgKeepOrig").onclick = () => { closeModal(); toast(`${t.id} kept unchanged`); };
  $("#rgAgain").onclick = () => { closeModal(); runRegen(o); };
  $("#rgAddNew").onclick = () => applyRegen(o, prop, true);
  $("#rgAccept").onclick = () => applyRegen(o, prop, !!o.asNew);
}

async function applyRegen(o, prop, asNew) {
  const t = rgFind(o.k); if (!t) return;
  const before = rgClone(S.cases); const undoKeys = S.cases.map((x) => x._k);
  let target;
  if (asNew) {
    target = normCase({ ...rgClone(prop), _k: undefined, id: "", status: "not", regenerated: true, acs: [...t.acs] });
    S.cases.push(target); renumber(); showCase(target);
  } else {
    Object.assign(t, { name: prop.name, description: prop.description, precondition: prop.precondition, priority: prop.priority || t.priority,
      steps: prop.steps.map((s) => ({ description: s.description, expected: s.expected, _k: ++_uid })), status: "not", regenerated: true });
    target = t;
  }
  RG.undo = { before, keys: undoKeys, id: target.id, asNew };
  RG.flash = target._k; closeModal();
  try { await saveCases(); } catch (e) { toast("Applied, but saving failed: " + e.message, true); markDirty(); }
  afterSave(); setTimeout(() => { RG.flash = null; const c = $(`.tc[data-k="${target._k}"]`); if (c) c.classList.remove("rg-flash"); }, 3000);
  rgToast(asNew ? `＋ ${target.id} added from regenerated ${t.id}` : `↻ ${t.id} regenerated · status reset to Not reviewed`);
}
function rgToast(msg) {
  const el = $("#toast"); el.className = "toast rg"; el.innerHTML = `<span>${esc(msg)}</span><a id="rgUndo" href="#">Undo</a>`; el.style.display = "flex";
  $("#rgUndo").onclick = (e) => { e.preventDefault(); undoRegen(); };
  clearTimeout(toast._t); toast._t = setTimeout(() => (el.style.display = "none"), 10000);
}
async function undoRegen() {
  const u = RG.undo; if (!u) return; RG.undo = null;
  S.cases = u.before.map((x, i) => { x._k = u.keys[i]; return normCase(x); });
  $("#toast").style.display = "none";
  try { await saveCases(); afterSave(); toast(u.asNew ? `Removed ${u.id} · undo complete` : `${u.id} restored to the original`); } catch (e) { markDirty(); renderList(); toast("Undo applied, but saving failed: " + e.message, true); }
}
