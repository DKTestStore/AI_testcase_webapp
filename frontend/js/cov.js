/* Coverage check: which acceptance criteria (AC tags) have test cases, positive vs negative.
   Local check, no AI call. "Generate TC for AC" reuses the Regenerate endpoint ("Add as new"). */
"use strict";

const COV = { panel: false, skip: new Set() };
const NEG_RE = /\b(invalid|error|errors|reject|rejected|rejects|expired|expire|expires|empty|blank|missing|wrong|fail|fails|failed|failure|unregistered|unknown|not allowed|denied|locked|negative|incorrect|exceed|exceeds|too long|too short|without)\b/i;
const covIsNeg = (t) => NEG_RE.test(`${t.name} ${t.description}`);
function covCalc(cases, acList) {
  const rows = (acList || []).map((a) => {
    const tcs = cases.filter((t) => (t.acs || []).includes(a.id));
    const neg = tcs.filter(covIsNeg).length;
    return { id: a.id, title: a.title || "", text: a.text || "", tcs, total: tcs.length, neg, pos: tcs.length - neg };
  });
  const unc = rows.filter((r) => !r.total);
  return { rows, unc, noNeg: rows.filter((r) => r.total && !r.neg), covered: rows.length - unc.length };
}
const covRun = () => covCalc(S.cases, (S.run && S.run.ac_list) || []);

// ------------------------------------------------------------------ Review bar + header chip + matrix
function covRender() {
  const bar = $("#covBar"); if (!bar) return;
  const c = covRun(), n = c.rows.length;
  const h = $(".rv-head h1");
  let chip = $("#covChip");
  if (!n) { bar.innerHTML = ""; $("#covPanel").innerHTML = ""; if (chip) chip.remove(); covBatchChip(null); return; }
  if (c.unc.length) {
    if (!chip && h) { chip = document.createElement("span"); chip.id = "covChip"; chip.className = "cov-chip hchip"; h.appendChild(chip); }
    if (chip) chip.textContent = `⚠ ${c.unc.length} AC${c.unc.length === 1 ? "" : "s"} not covered`;
  } else if (chip) chip.remove();
  const pct = Math.round(c.covered * 100 / n);
  bar.innerHTML = `<div class="cov-bar"><b>AC coverage ${c.covered}/${n}</b><span class="pb"><i style="width:${pct}%;background:${c.unc.length ? "#f59e0b" : "#12a150"}"></i></span>
    ${c.unc.length ? `<span class="cov-chip">⚠ ${c.unc.map((r) => esc(r.id)).join(", ")} not covered</span>` : '<span class="cov-chip ok">✓ All ACs covered</span>'}
    <span class="cov-acs">${c.rows.map((r) => `<span class="cov-ac ${r.total ? (r.neg ? "" : "half") : "no"}" title="${esc(r.title)} · ${r.pos} positive · ${r.neg} negative">${esc(r.id)} · ${r.total}</span>`).join("")}</span>
    <span style="margin-left:auto"></span><button class="btn g sm" id="covMx">▦ ${COV.panel ? "Hide" : "Coverage"} matrix</button>${c.unc.length ? `<button class="btn sm" id="covGenTop" data-ac="${esc(c.unc[0].id)}">✨ Generate TC for ${esc(c.unc[0].id)}</button>` : ""}</div>`;
  $("#covMx").onclick = () => { COV.panel = !COV.panel; covRender(); };
  const gt = $("#covGenTop"); if (gt) gt.onclick = () => covGenDialog(gt.dataset.ac);
  $("#covPanel").innerHTML = COV.panel ? covMatrix(c) : "";
  $$("#covPanel [data-gen]").forEach((b) => (b.onclick = () => covGenDialog(b.dataset.gen, b.dataset.neg === "1")));
  $$("#covPanel [data-link]").forEach((b) => (b.onclick = () => covLinkDialog(b.dataset.link)));
  const cl = $("#covClose"); if (cl) cl.onclick = () => { COV.panel = false; covRender(); };
  covBatchChip(c);
}
function covMatrix(c) {
  const tcs = S.cases;
  const head = tcs.map((t) => `<th><span class="tcid">${esc(t.id)}</span></th>`).join("");
  const rows = c.rows.map((r) => {
    const cells = tcs.map((t) => (t.acs.includes(r.id) ? `<td><span class="dot ${covIsNeg(t) ? "n" : "p"}" title="${esc(t.id)} · ${covIsNeg(t) ? "negative" : "positive"}">${covIsNeg(t) ? "N" : "P"}</span></td>` : "<td></td>")).join("");
    const st = !r.total ? '<span class="cov-chip">✕ Not covered</span>' : !r.neg ? '<span class="cov-chip wn">⚠ No negative case</span>' : '<span class="cov-chip ok">✓ Covered</span>';
    const act = !r.total ? `<button class="btn sm" data-gen="${esc(r.id)}">✨ Generate TC for ${esc(r.id)}</button> <button class="btn g sm" data-link="${esc(r.id)}">🔗 Link existing TC</button>`
      : !r.neg ? `<button class="btn g sm" data-gen="${esc(r.id)}" data-neg="1">✨ Add negative case</button>` : "";
    return `<tr class="${r.total ? "" : "unc"}" data-ac="${esc(r.id)}"><td class="l"><span class="ac ${acCls(r.id)}">${esc(r.id)}</span> ${esc(r.title)}</td>${cells}<td><b>${r.total}</b></td><td>${r.pos}</td><td>${r.neg}</td><td class="l">${st}</td><td class="l">${act}</td></tr>`;
  }).join("");
  return `<div class="cov-panel"><h3>▦ AC coverage matrix <span class="pill y">${c.covered} of ${c.rows.length} ACs covered${c.noNeg.length ? ` · ${c.noNeg.length} without negative case` : ""}</span><span style="margin-left:auto"></span><button class="btn g sm" id="covClose">✕ Close</button></h3>
    <div class="mx-wrap"><table class="mx"><tr><th class="l">AC</th>${head}<th>Total</th><th>Positive</th><th>Negative</th><th class="l">Status</th><th class="l">Actions</th></tr>${rows}</table></div>
    <div class="sub" style="margin:8px 0 0;font-size:12px">P = positive · N = negative (keywords like invalid, error, expired, empty in the name/description — local check, no AI call). Coverage uses the AC tags on each test case.</div></div>`;
}
function covBatchChip(c) {
  const it = $(".bt-item.a"); if (!it) return;
  let s = it.querySelector(".cov-chip"); if (!c || !c.unc.length) { if (s) s.remove(); return; }
  if (!s) { s = document.createElement("span"); s.className = "cov-chip bchip"; it.appendChild(s); }
  s.textContent = `⚠ AC ${c.covered}/${c.rows.length}`;
}
function covBatchRefresh() { if ($("#covBar")) covBatchChip(covRun()); }

// ------------------------------------------------------------------ Generate a test case for an AC (Regenerate "add as new")
const covAc = (id) => ((S.run.ac_list || []).find((a) => a.id === id) || { id, title: "", text: "" });
function covGenDialog(acId, neg = false) {
  const a = covAc(acId), next = "TC" + pad3(S.cases.length + 1);
  const chips = { pos: !neg, neg: true, bnd: false };
  const draw = () => {
    modal(`<div class="cov-modal"><h1 style="font-size:19px">✨ ${neg ? "Add negative case" : "Generate test case"} for ${esc(a.id)} ${S.run.story_id ? `<span class="ticket-pill">Ticket ${esc(S.run.story_id)}</span>` : ""}</h1>
      <div class="sub">${esc(a.id)} · ${esc(a.title)}${a.text ? ` — <i>${esc(a.text.slice(0, 200))}</i>` : ""}. Uses the same flow as ↻ Regenerate → “Add as new”.</div>
      <label>What should the new test case cover?</label><textarea id="covIns" style="width:100%;min-height:70px">${esc(`Cover ${a.id}: ${a.title}.${neg ? " Negative case: invalid input is rejected with an error." : ""}`)}</textarea>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">${[["pos", "Positive"], ["neg", "Negative"], ["bnd", "Boundary values"]].map(([k, l]) => `<span class="rg-chip ${chips[k] ? "on" : ""}" data-ch="${k}">${l}</span>`).join("")}</div>
      <div class="note2">Context sent: story ${esc(S.run.story_id || "—")} · ${esc(a.id)} text · titles of the ${S.cases.length} existing test cases (to avoid duplicates). The result is shown for review — Accept adds <b>${next}</b> (tagged ${esc(a.id)}, Not reviewed). 1 Gemini call.</div>
      <div id="covGenErr"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn g" id="covCancel">Cancel</button><button class="btn" id="covGo">✨ Generate ${next} for ${esc(a.id)}</button></div></div>`);
    $("#modal").classList.add("mid");
    $$("#modal [data-ch]").forEach((c) => (c.onclick = () => { chips[c.dataset.ch] = !chips[c.dataset.ch]; c.classList.toggle("on"); }));
    $("#covCancel").onclick = covClose;
    $("#covGo").onclick = () => guarded($("#covGo"), async () => {
      const kinds = Object.entries(chips).filter(([, v]) => v).map(([k]) => ({ pos: "positive", neg: "negative", bnd: "boundary values" }[k]));
      const ins = `${$("#covIns").value.trim()} Include: ${kinds.join(", ") || "positive"}. Existing test cases (do not duplicate): ${S.cases.map((t) => t.name).join("; ").slice(0, 600)}`;
      const seed = { id: next, name: `Verify ${a.id}: ${a.title}`, description: a.text || a.title, precondition: "", priority: "Medium", acs: [a.id], status: "not",
                     steps: [{ description: `Check ${a.title}`, expected: a.text || "Behaviour matches the acceptance criterion" }] };
      let j;
      try { j = await api("/api/review/regenerate", { method: "POST", body: { test_case: seed, instruction: ins.slice(0, 1000) } }); }
      catch (e) { $("#covGenErr").innerHTML = `<div class="error">${esc(e.message)}</div>`; throw e; }
      covProposal(j.proposal, a, next);
    });
  };
  draw();
}
function covProposal(p, a, next) {
  modal(`<div class="cov-modal"><h1 style="font-size:19px">New test case for ${esc(a.id)} <span class="tg add">NEW ${next}</span></h1><div class="sub">Review the proposal. Accept adds it at the end as ${next} (Not reviewed, unsaved until Save — Undo available).</div>
    <div class="col1"><b>${esc(p.name)}</b> <span class="ac ${acCls(a.id)}">${esc(a.id)}</span> <span class="prio p-${esc(p.priority || "Medium")}">${esc(p.priority || "Medium")}</span><div class="res">${esc(p.description)}</div><div class="res">Precondition: ${esc(p.precondition || "—")}</div>
    <table class="mx" style="margin-top:6px"><tr><th>#</th><th class="l">Step</th><th class="l">Expected</th></tr>${(p.steps || []).map((s, i) => `<tr><td>${i + 1}</td><td class="l">${esc(s.description)}</td><td class="l">${esc(s.expected)}</td></tr>`).join("")}</table></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn g" id="covDiscard">Discard</button><button class="btn" id="covAccept">✓ Add as ${next}</button></div></div>`);
  $("#modal").classList.add("mid");
  $("#covDiscard").onclick = covClose;
  $("#covAccept").onclick = () => {
    const snap = dSnap();
    const tc = normCase({ ...p, _k: undefined, id: next, acs: [a.id], status: "not", regenerated: true, steps: (p.steps || []).map((s) => ({ description: s.description, expected: s.expected })) });
    S.cases.push(tc); renumber(); RV.open.add(tc._k); RV.just = tc._k; markDirty(); covClose(); renderList();
    const el = $(`.tc[data-k="${tc._k}"]`); if (el) el.scrollIntoView({ block: "center" });
    dupUndoToast(`✨ ${tc.id} added for ${a.id} · coverage updated`, snap);
  };
}
function covClose() { closeModal(); $("#modal").classList.remove("mid", "wide"); }

// ------------------------------------------------------------------ Link existing test cases to an AC
function covLinkDialog(acId) {
  const a = covAc(acId), at = dTok(`${a.title} ${a.text}`);
  const sc = S.cases.map((t) => ({ t, s: Math.round(dJac(at, dTok(`${t.name} ${t.description} ${t.steps.map((x) => x.description + " " + x.expected).join(" ")}`)) * 100) })).sort((x, y) => y.s - x.s);
  const sug = sc.filter((x) => x.s >= 15).slice(0, 3), sel = new Set(sug.slice(0, 1).map((x) => x.t._k));
  let q = "";
  const row = (x) => `<label class="pick ${sel.has(x.t._k) ? "on" : ""}"><input type="checkbox" data-k="${x.t._k}" ${sel.has(x.t._k) ? "checked" : ""}><b class="tcid">${esc(x.t.id)}</b> ${esc(x.t.name)} ${x.t.acs.map((y) => `<span class="ac ${acCls(y)}">${esc(y)}</span>`).join("")}<span class="pill gr" style="margin-left:auto">${x.s}% match</span></label>`;
  const draw = () => {
    const list = sc.filter((x) => !q || `${x.t.id} ${x.t.name}`.toLowerCase().includes(q.toLowerCase()));
    $("#covList").innerHTML = (sug.length && !q ? `<div class="sub" style="margin:4px 0">Suggested (text match with ${esc(a.id)})</div>${sug.map(row).join("")}<div class="sub" style="margin:8px 0 4px">All test cases</div>` : "")
      + list.filter((x) => q || !sug.includes(x)).map(row).join("");
    $$("#covList input").forEach((c) => (c.onchange = () => { c.checked ? sel.add(+c.dataset.k) : sel.delete(+c.dataset.k); draw(); }));
    $("#covLinkGo").disabled = !sel.size; $("#covLinkGo").textContent = `🔗 Link ${sel.size} test case${sel.size === 1 ? "" : "s"}`;
  };
  modal(`<div class="cov-modal"><h1 style="font-size:19px">🔗 Link existing test case to ${esc(a.id)} ${S.run.story_id ? `<span class="ticket-pill">Ticket ${esc(S.run.story_id)}</span>` : ""}</h1>
    <div class="sub">${esc(a.id)} · ${esc(a.title)}. Pick test cases that already check this rule — adds the ${esc(a.id)} tag (unsaved until Save, like other edits).</div>
    <input id="covQ" placeholder="🔍 Search test cases…" style="width:100%;margin:8px 0"><div id="covList" style="max-height:360px;overflow:auto"></div>
    ${!sc.length || sc[0].s < 50 ? `<div class="note2">⚠ No existing test case clearly covers ${esc(a.id)}${sc.length ? ` (best match ${sc[0].s}%)` : ""}. Generating a new one is recommended.</div>` : ""}
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn g" id="covCancel">Cancel</button><button class="btn g" id="covGenInstead">✨ Generate instead</button><button class="btn" id="covLinkGo">🔗 Link</button></div></div>`);
  $("#modal").classList.add("mid");
  $("#covQ").oninput = (e) => { q = e.target.value; draw(); };
  $("#covCancel").onclick = covClose;
  $("#covGenInstead").onclick = () => covGenDialog(acId);
  $("#covLinkGo").onclick = () => {
    const snap = dSnap(), ids = [];
    S.cases.forEach((t) => { if (sel.has(t._k) && !t.acs.includes(a.id)) { t.acs.push(a.id); ids.push(t.id); } });
    markDirty(); covClose(); renderList();
    dupUndoToast(`🔗 ${a.id} linked to ${ids.join(", ") || "selected test cases"}`, snap);
  };
  draw();
}

// ------------------------------------------------------------------ qTest pre-upload warning
function covBeforeUpload(next) {
  const r = S.run || {}, c = covCalc(r.test_cases || [], r.ac_list || []);
  if (!c.unc.length || COV.skip.has(r.run_id)) return next();
  modal(`<div class="cov-modal"><h1 style="font-size:19px">⚠ ${c.unc.length} acceptance criteri${c.unc.length === 1 ? "on is" : "a are"} not covered ${r.story_id ? `<span class="ticket-pill">Ticket ${esc(r.story_id)}</span>` : ""}</h1>
    <div class="sub">Uploading now sends ${(r.test_cases || []).length} test cases; qTest will have no test case for:</div>
    ${c.unc.map((u) => `<div class="pick" style="border-color:#f3b4b4;background:#fff6f6"><span class="ac ${acCls(u.id)}">${esc(u.id)}</span> ${esc(u.title)}${u.text ? ` — <i>${esc(u.text.slice(0, 120))}</i>` : ""}</div>`).join("")}
    ${c.noNeg.length ? `<div class="sub" style="margin:6px 0">Also: ${c.noNeg.map((x) => esc(x.id)).join(", ")} ha${c.noNeg.length === 1 ? "s" : "ve"} no negative test case.</div>` : ""}
    <label style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-weight:400"><input type="checkbox" id="covSkip"> Don't warn again for this run</label>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn g" id="covCancel">Cancel</button><button class="btn g" id="covAnyway">⬆ Upload anyway</button><button class="btn" id="covFix">✨ Go fix (Review → ${esc(c.unc[0].id)})</button></div></div>`);
  $("#modal").classList.add("mid");
  const skip = () => { if ($("#covSkip").checked) COV.skip.add(r.run_id); };
  $("#covCancel").onclick = () => { skip(); covClose(); };
  $("#covAnyway").onclick = () => { skip(); covClose(); next(); };
  $("#covFix").onclick = () => { skip(); covClose(); COV.panel = true; go("review"); };
}
// Batch qTest: one dialog listing uncovered ACs per selected item
function covBatchBeforeUpload(items, next) {
  const bad = items.filter((i) => (i.cov_uncovered || []).length && !COV.skip.has("b:" + i.run_id));
  if (!bad.length) return next();
  modal(`<div class="cov-modal"><h1 style="font-size:19px">⚠ Uncovered acceptance criteria in ${bad.length} item${bad.length === 1 ? "" : "s"}</h1>
    <div class="sub">These items will be uploaded without a test case for some ACs:</div>
    ${bad.map((i) => `<div class="pick" style="border-color:#f3b4b4;background:#fff6f6"><span class="pill b">${esc(i.item_id)}</span> ${i.cov_uncovered.map((x) => `<span class="ac ${acCls(x)}">${esc(x)}</span>`).join(" ")} <span class="res" style="margin-left:auto">${i.cov_total - i.cov_uncovered.length}/${i.cov_total} covered</span></div>`).join("")}
    <label style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-weight:400"><input type="checkbox" id="covSkip"> Don't warn again for these items</label>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn g" id="covCancel">Cancel</button><button class="btn g" id="covAnyway">⬆ Upload anyway</button><button class="btn" id="covFix">✨ Go fix (${esc(bad[0].item_id)})</button></div></div>`);
  $("#modal").classList.add("mid");
  const skip = () => { if ($("#covSkip").checked) bad.forEach((i) => COV.skip.add("b:" + i.run_id)); };
  $("#covCancel").onclick = () => { skip(); covClose(); };
  $("#covAnyway").onclick = () => { skip(); covClose(); next(); };
  $("#covFix").onclick = () => { skip(); covClose(); COV.panel = true; bOpenItem(bad[0].key).catch((e) => toast(e.message, true)); };
}
