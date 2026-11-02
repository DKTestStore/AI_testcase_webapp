/* Test Runs (additive feature): cycles, cycle run list, add cases, execution screen with attachments. */
"use strict";
const RS = { cpg: { page: 1, size: 25 }, rpg: { page: 1, size: 25 }, cq: "", cst: "", cycle: null, exec: null, archived: false, f: { q: "", st: "", asg: "" }, sel: new Set() };
window.RS = RS;
const TR_RUN_ST = ["Not run", "Pass", "Fail", "Blocked", "Skipped", "Retest"];
const TR_DOT = { Pass: "#12a150", Fail: "#d33", Blocked: "#f59e0b", Retest: "#a855f7", Skipped: "#64748b", "Not run": "#cbd5e1" };
const TR_CY_FIELDS = [["name", "Cycle name", "e.g. Sprint 42 – Checkout regression"], ["release", "Release", "e.g. R2026.11"], ["sprint", "Sprint", "e.g. S42"], ["build", "Build", "e.g. 4.18.0-rc2"],
  ["env", "Environment", "e.g. QA / Staging / UAT"], ["start", "Planned start", "e.g. 02-Nov-2026"], ["end", "Planned end", "e.g. 08-Nov-2026"], ["assignee", "Default assignee", "e.g. Dhinakaran"], ["owner", "Owner", "e.g. Dhinakaran"]];

function trPb(c, w = 150) {
  const n = c.counts || {}; const t = Object.values(n).reduce((a, b) => a + b, 0) || 1;
  const seg = [["ps", n.Pass], ["pf", n.Fail], ["pk", n.Blocked], ["pr", (n.Retest || 0)], ["pn", (n["Not run"] || 0) + (n.Skipped || 0)]];
  return `<div class="tr-pb" style="width:${w}px">${seg.map(([k, v]) => `<i class="${k}" style="width:${((v || 0) / t) * 100}%"></i>`).join("")}</div><small class="muted">${n.Pass || 0}✓ ${n.Fail || 0}✗ ${n.Blocked || 0}⊘ ${n["Not run"] || 0} not run</small>`;
}
async function viewRuns(v) {
  if (RS.exec) return trExecView(v);
  if (RS.cycle) return trCycleView(v);
  v.innerHTML = `<div class="trv"><div class="hd"><div><h1>Test Runs · Cycles</h1><div class="sub">Group repo test cases into cycles and execute them</div></div><div class="fl"><label class="sw" style="margin:0;text-transform:none"><input type="checkbox" id="trArch" ${RS.archived ? "checked" : ""}><span class="t"></span>Show archived</label><button class="btn" id="trNewCy">＋ New cycle</button></div></div><div id="trCyBody" class="sub">Loading…</div></div>`;
  $("#trArch").onchange = (e) => { RS.archived = e.target.checked; render(); };
  $("#trNewCy").onclick = () => trCycleModal();
  let j; try { j = await api("/api/runs" + (RS.archived ? "?archived=1" : "")); } catch (e) { $("#trCyBody").innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  try { trRenderCycles(j); } catch (e) {   // never leave the page on "Loading…"
    console.error(e); const b = $("#trCyBody");
    if (b) b.outerHTML = `<div id="trCyBody"><div class="error">Could not show the cycles: ${esc(e.message)}</div><div class="card"><div class="tr-empty">No cycles to show. Create one with <b>＋ New cycle</b>, or use <b>▶ Execute now</b> on the Review page.</div></div></div>`;
  }
}
function trRenderCycles(j) {
  const allc = Array.isArray(j.cycles) ? j.cycles : []; allc.forEach((c) => { c.counts = c.counts || {}; c.status = c.status || "Active"; });
  const act = allc.filter((c) => c.status === "Active");
  const stOf = (c) => c.status === "Archived" ? "Archived" : (c.counts["Not run"] === Object.values(c.counts).reduce((a, b) => a + b, 0) ? "Not started" : "In progress");
  const filt = allc.filter((c) => (!RS.cq || [c.name, c.id, c.build, c.env, c.release, c.sprint].join(" ").toLowerCase().includes(RS.cq.toLowerCase())) && (!RS.cst || stOf(c) === RS.cst));
  const cs = trPage(filt, RS.cpg);
  const sum = (k) => act.reduce((a, c) => a + (c.counts[k] || 0), 0); const inPlay = act.reduce((a, c) => a + Object.values(c.counts).reduce((x, y) => x + y, 0), 0);
  const exd = sum("Pass") + sum("Fail") + sum("Blocked");
  $("#trCyBody").outerHTML = `<div id="trCyBody"><div class="kp"><div class="card"><small class="muted">ACTIVE CYCLES</small><b>${act.length}</b></div><div class="card"><small class="muted">CASES IN PLAY</small><b>${inPlay}</b></div><div class="card"><small class="muted">PASS RATE (ACTIVE)</small><b style="color:#12a150">${exd ? Math.round((sum("Pass") * 100) / exd) : 0}%</b></div><div class="card"><small class="muted">OPEN FAILURES</small><b style="color:#d33">${sum("Fail")}</b></div></div>
    <div class="card"><div class="tb"><input id="trCyQ" placeholder="🔍 Search cycles…" style="width:260px" value="${esc(RS.cq)}"><select id="trCySt"><option value="">All statuses</option>${["Not started", "In progress", "Archived"].map((x) => `<option ${RS.cst === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
    ${allc.length ? `<table id="trCyT"><tr><th>Cycle</th><th>Release / Sprint</th><th>Env</th><th>Build</th><th>Assignee</th><th>Dates</th><th>Progress</th><th>Status</th><th></th></tr>
    ${cs.map((c) => `<tr class="clk" data-id="${c.id}"><td><b style="color:#4361ee">${esc(c.name)}</b><br><small class="muted">${c.id}</small></td><td>${esc([c.release, c.sprint].filter(Boolean).join(" / ") || "—")}</td><td>${esc(c.env || "—")}</td><td>${esc(c.build || "—")}</td><td>${esc(c.assignee || "—")}</td><td>${esc([c.start, c.end].filter(Boolean).join(" – ") || "—")}</td><td>${trPb(c)}</td>
      <td><span class="pill ${c.status === "Archived" ? "gr" : "b"}">${c.status === "Archived" ? "Archived" : (c.counts["Not run"] === Object.values(c.counts).reduce((a, b) => a + b, 0) ? "Not started" : "In progress")}</span></td>
      <td style="white-space:nowrap"><button class="btn g sm" data-a="edit" title="Edit">✎</button> <button class="btn g sm" data-a="clone" title="Clone">⧉</button> <button class="btn g sm" data-a="arch" title="${c.status === "Archived" ? "Restore" : "Archive"}">🗄</button> <button class="btn g sm" data-a="del" title="Delete" style="color:#d33">🗑</button></td></tr>`).join("")}</table>`
    + trPager("trCyPg", filt.length, RS.cpg) : `<div class="tr-empty">No cycles yet. Create one here, or use <b>▶ Execute now</b> on the Review page.</div>`}</div></div>`;
  trBindPager("trCyPg", RS.cpg, render);
  $("#trCyQ").oninput = (e) => { RS.cq = e.target.value; RS.cpg.page = 1; clearTimeout(viewRuns._q); viewRuns._q = setTimeout(() => { render(); setTimeout(() => { const i = $("#trCyQ"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); }, 300); };
  $("#trCySt").onchange = (e) => { RS.cst = e.target.value; RS.cpg.page = 1; render(); };
  $$("#trCyT tr[data-id]").forEach((tr) => (tr.onclick = async (e) => {
    const id = tr.dataset.id, b = e.target.closest("button"), c = cs.find((x) => x.id === id);
    if (!b) { RS.cycle = id; RS.sel.clear(); RS.rpg.page = 1; return render(); }
    try {
      if (b.dataset.a === "edit") return trCycleModal(c);
      if (b.dataset.a === "clone") { const r = await api(`/api/runs/${id}/clone`, { method: "POST" }); toast(`Cloned as ${r.cycle.name}`); }
      if (b.dataset.a === "arch") { await api(`/api/runs/${id}/archive`, { method: "POST", body: { restore: c.status === "Archived" } }); toast(c.status === "Archived" ? "Restored" : "Archived"); }
      if (b.dataset.a === "del") return trDeleteCycle(c);
      render();
    } catch (er) { toast(er.message, true); }
  }));
}
function trCycleModal(c) {
  const isNew = !c; c = c || {};
  const F = ([k, l, ph]) => `<div><label>${l}${k === "name" ? ' <span class="req">*</span>' : ""}</label><input class="w" data-k="${k}" placeholder="${ph}" value="${esc(c[k] || "")}"></div>`;
  const by = Object.fromEntries(TR_CY_FIELDS.map((f) => [f[0], f]));
  const ov = trModal(`<div class="hd"><h3>${isNew ? "New test cycle" : "Edit cycle " + esc(c.id)}</h3><span class="tr-x">✕</span></div><small class="muted">All fields are free text. Only Cycle name is required.</small>
    ${F(by.name)}<label>Description</label><textarea class="w" rows="2" data-k="description" placeholder="What does this cycle cover?">${esc(c.description || "")}</textarea>
    <div class="g3">${F(by.release)}${F(by.sprint)}${F(by.build)}</div><div class="g3">${F(by.env)}${F(by.start)}${F(by.end)}</div><div class="g2">${F(by.assignee)}${F(by.owner)}</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn g tr-x">Cancel</button><button class="btn" id="trCyGo">${isNew ? "Create cycle" : "Save changes"}</button></div>`, 720);
  $("#trCyGo", ov).onclick = () => guarded($("#trCyGo"), async () => {
    const body = Object.fromEntries($$("[data-k]", ov).map((i) => [i.dataset.k, i.value]));
    if (!body.name.trim()) { $('[data-k="name"]', ov).classList.add("ierr"); throw new Error("Cycle name is required."); }
    const r = isNew ? await api("/api/runs", { method: "POST", body }) : await api(`/api/runs/${c.id}`, { method: "PUT", body });
    trClose(); toast(isNew ? `Created ${r.cycle.name}` : "Cycle updated"); render();
  });
}
function trDeleteCycle(c) {
  const ov = trModal(`<div class="hd"><h3 style="color:#d33">Delete cycle</h3><span class="tr-x">✕</span></div>
    <div class="warn" style="margin:0">This permanently deletes <b>${esc(c.name)}</b> and all its execution results and history. Repo test cases are not affected.</div>
    <label>Type the cycle name to confirm <small class="muted" style="text-transform:none">(any dash works: - or –)</small></label><input class="w" id="trDelName" placeholder="${esc(c.name)}">
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn g tr-x">Cancel</button><button class="btn r" id="trDelGo" disabled>🗑 Delete cycle</button></div>`, 520);
  const nn = (x) => String(x || "").replace(/[\u2010-\u2015\u2212-]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
  $("#trDelName", ov).oninput = (e) => ($("#trDelGo").disabled = nn(e.target.value) !== nn(c.name));
  $("#trDelGo", ov).onclick = () => guarded($("#trDelGo"), async () => { await api(`/api/runs/${c.id}?confirm=${encodeURIComponent($("#trDelName").value)}`, { method: "DELETE" }); trClose(); toast("Cycle deleted"); if (RS.cycle === c.id) RS.cycle = null; render(); });
}

// ------------------------------------------------------------------ cycle detail (run list)
async function trCycleView(v) {
  v.innerHTML = `<div class="trv" id="trCyc"><div class="sub">Loading…</div></div>`;
  let c; try { c = (await api(`/api/runs/${RS.cycle}`)).cycle; } catch (e) { RS.cycle = null; toast(e.message, true); return render(); }
  RS.c = c;
  const n = c.counts, tot = c.items.length, done = tot - (n["Not run"] || 0);
  const f = RS.f; const asgs = [...new Set(c.items.map((i) => i.assignee).filter(Boolean))];
  const list = c.items.filter((i) => (!f.st || i.status === f.st) && (!f.asg || i.assignee === f.asg) && (!f.q || (i.case_id + " " + i.title).toLowerCase().includes(f.q.toLowerCase())));
  RS.sel = new Set([...RS.sel].filter((k) => c.items.some((i) => i.key === k)));
  const runnable = (i) => !i.case_state;
  const next = c.items.find((i) => runnable(i) && (i.status === "Not run" || i.status === "Retest"));
  const page = trPage(list, RS.rpg);
  $("#trCyc").innerHTML = `<div class="hd"><div><small class="muted"><a href="#runs" id="trBack" style="color:inherit">Test Runs</a> ›</small><h1>${esc(c.name)} <span class="pill ${c.status === "Archived" ? "gr" : "b"}">${c.status === "Archived" ? "Archived" : done ? "In progress" : "Not started"}</span></h1>
    <div class="sub">${[c.build && "Build " + esc(c.build), c.env && "Env " + esc(c.env), tot + " cases", c.description && esc(c.description)].filter(Boolean).join(" · ")}</div></div>
    <div class="fl"><button class="btn g" id="trEditCy">✎ Edit</button><button class="btn g" id="trDelCy" style="color:#d33">🗑 Delete cycle</button><button class="btn g" id="trAddCases">＋ Add cases</button><button class="btn" id="trCont" ${tot ? "" : "disabled"}>▶ Continue execution${next ? ` (next: ${esc(next.case_id)})` : ""}</button></div></div>
    <div class="card"><div class="fl"><b>${done} of ${tot} executed</b><small class="muted">${n.Pass || 0} Pass · ${n.Fail || 0} Fail · ${n.Blocked || 0} Blocked · ${n.Retest || 0} Retest · ${n.Skipped || 0} Skipped · ${n["Not run"] || 0} Not run</small></div><div style="margin-top:8px">${trPb(c, 9999).replace("width:9999px", "width:100%;height:10px")}</div></div>
    <div class="card"><div class="tb"><input id="trRq" placeholder="🔍 Search" style="width:220px" value="${esc(f.q)}"><span class="fc ${f.st ? "" : "a"}" data-st="">Status: All</span>${TR_RUN_ST.map((s) => `<span class="fc ${f.st === s ? "a" : ""}" data-st="${s}">${s} ${n[s] || 0}</span>`).join("")}
      <select id="trRasg"><option value="">Assignee: All</option>${asgs.map((a) => `<option ${f.asg === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
      <span style="margin-left:auto" class="fl" id="trRsel" ${RS.sel.size ? "" : 'style="display:none"'}><small class="muted" id="trRselN">${RS.sel.size} selected</small><input id="trReAsg" placeholder="Reassign to…" style="width:130px"><button class="btn g sm" id="trReGo">Reassign</button><button class="btn g sm" id="trRemove" style="color:#d33">Remove</button><button class="btn sm" id="trRunSel">▶ Run selected (${RS.sel.size})</button></span></div>
    ${tot ? `<table id="trRunT"><tr><th>Order</th><th><input type="checkbox" id="trRall"></th><th>TC-ID</th><th>Title</th><th>Priority</th><th>Assignee</th><th>Status</th><th>Last run</th><th>Defects</th><th></th></tr>
    ${page.map((i) => `<tr class="clk ${i.case_state ? "arc" : ""}" data-k="${i.key}"><td class="drag" style="white-space:nowrap"><button class="btn g sm" data-a="up" title="Move up">▲</button>${i.order}</td><td><input type="checkbox" class="trRk" ${RS.sel.has(i.key) ? "checked" : ""}></td><td><b style="color:#4361ee">${esc(i.case_id)}</b></td><td>${esc(i.title)}${i.case_state ? ` <span class="pill d">${i.case_state === "archived" ? "Case archived" : "Case removed"}</span>` : ""}</td><td><span class="pill ${TR_PRIO(i.priority)}">${esc(i.priority || "—")}</span></td><td>${esc(i.assignee || "—")}</td>
      <td><span class="pill ${TR_RES[i.status]}">${esc(i.status)}</span></td><td>${trTime(i.last_run)}</td><td>${i.defects.length ? `<b style="color:#d33" title="${esc(i.defects.join(", "))}">🐞 ${i.defects.length}</b>` : "—"}</td>
      <td>${i.case_state ? `<button class="btn g sm" data-a="rm" style="color:#d33">Remove from cycle</button>` : `<button class="btn ${["Not run", "Retest"].includes(i.status) ? "" : "g "}sm" data-a="run">`}${["Not run", "Retest"].includes(i.status) ? "▶ Run" : "↻ Re-run"}${i.case_state ? "" : "</button>"}</td></tr>`).join("")}</table>
    ${list.length > 25 ? trPager("trRunPg", list.length, RS.rpg) : `<div class="muted" style="margin-top:8px">${list.length} of ${tot} shown · clicking a row or ▶ Run opens the detailed execution screen</div>`}
    ${c.items.some((i) => i.case_state) ? `<div class="note">Archived / removed cases keep their past results but can't be executed; “Remove from cycle” drops them from this list.</div>` : ""}` : `<div class="tr-empty">No cases in this cycle yet. Use <b>＋ Add cases</b> to pick from the Test Case Repo.</div>`}</div>`;
  if (!RS.sel.size) $("#trRsel").style.display = "none";
  $("#trBack").onclick = (e) => { e.preventDefault(); RS.cycle = null; render(); };
  $("#trEditCy").onclick = () => trCycleModal(c);
  $("#trDelCy").onclick = () => trDeleteCycle(c);
  trBindPager("trRunPg", RS.rpg, render);
  $("#trAddCases").onclick = () => trSelectCases(c);
  $("#trCont").onclick = () => { const q = c.items.filter((i) => runnable(i) && (i.status === "Not run" || i.status === "Retest")).map((i) => i.key); trStartExec(q.length ? q : c.items.filter(runnable).map((i) => i.key)); };
  $("#trRq").oninput = (e) => { f.q = e.target.value; clearTimeout(trCycleView._t); trCycleView._t = setTimeout(() => { render(); }, 300); };
  $$("#trCyc .fc").forEach((x) => (x.onclick = () => { f.st = x.dataset.st; render(); }));
  $("#trRasg").onchange = (e) => { f.asg = e.target.value; render(); };
  const sync = () => { $("#trRsel").style.display = RS.sel.size ? "" : "none"; $("#trRselN").textContent = `${RS.sel.size} selected`; $("#trRunSel").textContent = `▶ Run selected (${RS.sel.size})`; };
  const all = $("#trRall"); if (all) all.onchange = () => { $$(".trRk").forEach((k) => { k.checked = all.checked; const key = k.closest("tr").dataset.k; all.checked ? RS.sel.add(key) : RS.sel.delete(key); }); sync(); };
  $$("#trRunT tr[data-k]").forEach((tr) => (tr.onclick = async (e) => {
    const key = tr.dataset.k;
    if (e.target.classList.contains("trRk")) { e.target.checked ? RS.sel.add(key) : RS.sel.delete(key); sync(); return; }
    const b = e.target.closest("button");
    if (b && b.dataset.a === "up") { const ord = c.items.map((i) => i.key); const ix = ord.indexOf(key); if (ix > 0) { [ord[ix - 1], ord[ix]] = [ord[ix], ord[ix - 1]]; await api(`/api/runs/${c.id}/items/bulk`, { method: "POST", body: { op: "reorder", order: ord } }); render(); } return; }
    if (b && b.dataset.a === "rm") { try { await api(`/api/runs/${c.id}/items/bulk`, { method: "POST", body: { op: "remove", keys: [key] } }); toast("Removed from cycle"); render(); } catch (er) { toast(er.message, true); } return; }
    const it = c.items.find((i) => i.key === key);
    if (it && it.case_state) return toast(it.case_state === "archived" ? "This case is archived – restore it in the repo to run it." : "This case was removed from the repo – use “Remove from cycle”.", true);
    trStartExec(list.filter(runnable).map((i) => i.key), key);
  }));
  const bulk = async (body, msg) => { try { await api(`/api/runs/${c.id}/items/bulk`, { method: "POST", body: { keys: [...RS.sel], ...body } }); toast(msg); render(); } catch (er) { toast(er.message, true); } };
  $("#trReGo").onclick = () => { const a = $("#trReAsg").value.trim(); if (!a) return toast("Enter an assignee name.", true); bulk({ op: "assign", assignee: a }, `Reassigned to ${a}`); };
  $("#trRemove").onclick = () => { if (confirm(`Remove ${RS.sel.size} case(s) from this cycle? Their results in this cycle are kept in history.`)) bulk({ op: "remove" }, "Removed"); RS.sel.clear(); };
  $("#trRunSel").onclick = () => trStartExec(c.items.filter((i) => RS.sel.has(i.key) && runnable(i)).map((i) => i.key));
}

async function trSelectCases(c) {
  let d; try { d = await api("/api/repo"); } catch (e) { return toast(e.message, true); }
  const inCy = new Set(c.items.map((i) => i.case_id));
  const M = { folder: "", ready: true, failed: false, prio: "", q: "", sel: new Set() };
  const desc = (fid) => { const ids = new Set([fid]); let g = true; while (g) { g = false; d.folders.forEach((f) => { if (ids.has(f.parent) && !ids.has(f.id)) { ids.add(f.id); g = true; } }); } return ids; };
  const pool = () => d.cases.filter((x) => !inCy.has(x.id) && (!M.ready || x.status === "Ready") && x.status !== "Obsolete" && x.status !== "Archived" && (!M.failed || x.last_result === "Fail") && (!M.prio || x.priority === M.prio));
  const ov = trModal(`<div class="hd" style="padding:18px 22px;border-bottom:1px solid #e3e7f0;margin:0"><div><h3>Add test cases to <span style="color:#4361ee">${esc(c.name)}</span></h3><small class="muted">From Test Case Repo · testers are assigned later in the cycle</small></div><span class="tr-x">✕</span></div>
    <div style="display:grid;grid-template-columns:290px 1fr;min-height:420px"><div style="border-right:1px solid #e3e7f0;padding:14px;max-height:60vh;overflow:auto" class="tree" id="trScTree"></div>
    <div style="padding:14px 18px;max-height:60vh;overflow:auto"><div class="fl" style="margin-bottom:10px"><input id="trScQ" placeholder="🔍 Search" style="flex:1"><select id="trScP"><option value="">Priority: All</option><option>High</option><option>Medium</option><option>Low</option></select>
      <label class="sw" style="margin:0;text-transform:none"><input type="checkbox" id="trScReady" checked><span class="t"></span>Ready only</label><label class="sw" style="margin:0;text-transform:none"><input type="checkbox" id="trScFail"><span class="t"></span>Last result failed</label></div><div id="trScList"></div></div></div>
    <div class="fl" style="padding:14px 22px;border-top:1px solid #e3e7f0;background:#f8f9fc"><span class="cnt2" id="trScN">0 selected</span><small class="muted" id="trScBy"></small><span style="margin-left:auto" class="fl"><button class="btn g tr-x">Cancel</button><button class="btn" id="trScGo" disabled>＋ Add 0</button></span></div>`, 1000);
  $(".tr-mo", ov).style.padding = "0";
  const paint = () => {
    const p = pool(); const fset = M.folder ? desc(M.folder) : null;
    const cnt = (fid) => { const s = desc(fid); const a = p.filter((x) => s.has(x.folder_id)); return [a.filter((x) => M.sel.has(x.id)).length, a.length]; };
    $("#trScTree").innerHTML = `<a data-f="" class="${M.folder ? "" : "a"}"><input type="checkbox" data-all="" ${p.length && p.every((x) => M.sel.has(x.id)) ? "checked" : ""}> 🗂 All ${M.ready ? "Ready " : ""}cases <span class="c">${p.length}</span></a>` +
      (() => { const tv = trTreeView(d.folders, "pick", M.folder); return (tv.any ? `<a class="tr-xrow">${trTreeAllBtns()}</a>` : "") + tv.rows.map(({ f, lvl }) => { const [s, t] = cnt(f.id); return `<a data-f="${f.id}" class="l${Math.min(lvl, 4)} ${M.folder === f.id ? "a" : ""}">${tv.caret(f)}<input type="checkbox" data-all="${f.id}" ${t && s === t ? "checked" : ""}> ${esc(f.name)} <span class="c">${s}/${t}</span></a>`; }).join(""); })();
    const q = M.q.toLowerCase(); const list = p.filter((x) => (!fset || fset.has(x.folder_id)) && (!q || (x.id + " " + x.title).toLowerCase().includes(q)));
    $("#trScList").innerHTML = list.length ? `<table><tr><th><input type="checkbox" id="trScAll" ${list.every((x) => M.sel.has(x.id)) ? "checked" : ""}></th><th>TC-ID</th><th>Title</th><th>Priority</th><th>Status</th><th>Last run</th></tr>${list.map((x) => `<tr><td><input type="checkbox" class="trSc" data-id="${x.id}" ${M.sel.has(x.id) ? "checked" : ""}></td><td><b>${esc(x.id)}</b></td><td>${esc(x.title)}</td><td><span class="pill ${TR_PRIO(x.priority)}">${esc(x.priority)}</span></td><td><span class="pill ${TR_ST[x.status] ?? "gr"}">${esc(x.status)}</span></td><td><span class="pill ${TR_RES[x.last_result || ""]}">${esc(x.last_result || "—")}</span></td></tr>`).join("")}</table>
      <div class="muted" style="margin-top:8px;font-size:12px">${inCy.size ? inCy.size + " case(s) already in cycle hidden" : ""}</div>` : `<div class="tr-empty">No ${M.ready ? "Ready " : ""}cases here${M.ready ? " – turn off “Ready only” to include Drafts" : ""}.</div>`;
    const by = {}; d.cases.filter((x) => M.sel.has(x.id)).forEach((x) => (by[x.story || "—"] = (by[x.story || "—"] || 0) + 1));
    $("#trScN").textContent = `${M.sel.size} selected`; $("#trScBy").textContent = Object.entries(by).map(([k, n]) => `${k} ×${n}`).join(" · ");
    $("#trScGo").disabled = !M.sel.size; $("#trScGo").textContent = `＋ Add ${M.sel.size} to ${c.name.length > 24 ? c.name.slice(0, 24) + "…" : c.name}`;
    $$("#trScTree a").forEach((a) => (a.onclick = (e) => {
      const car = e.target.closest("[data-car]"); if (car) { trTreeToggle("pick", car.dataset.car); return paint(); }
      const xa = e.target.closest("[data-xa]"); if (xa) { trTreeAll("pick", d.folders, xa.dataset.xa === "1"); return paint(); }
      if (a.classList.contains("tr-xrow")) return;
      if (e.target.tagName === "INPUT") { const s = e.target.dataset.all ? desc(e.target.dataset.all) : null; p.filter((x) => !s || s.has(x.folder_id)).forEach((x) => (e.target.checked ? M.sel.add(x.id) : M.sel.delete(x.id))); }
      else M.folder = a.dataset.f;
      paint();
    }));
    $$(".trSc", ov).forEach((k) => (k.onchange = () => { k.checked ? M.sel.add(k.dataset.id) : M.sel.delete(k.dataset.id); paint(); }));
    const all = $("#trScAll"); if (all) all.onchange = () => { list.forEach((x) => (all.checked ? M.sel.add(x.id) : M.sel.delete(x.id))); paint(); };
  };
  $("#trScQ", ov).oninput = (e) => { M.q = e.target.value; paint(); };
  $("#trScP", ov).onchange = (e) => { M.prio = e.target.value; paint(); };
  $("#trScReady", ov).onchange = (e) => { M.ready = e.target.checked; paint(); };
  $("#trScFail", ov).onchange = (e) => { M.failed = e.target.checked; paint(); };
  $("#trScGo", ov).onclick = () => guarded($("#trScGo"), async () => { const r = await api(`/api/runs/${c.id}/items`, { method: "POST", body: { case_ids: [...M.sel] } }); trClose(); toast(`Added ${r.added} case(s)`); render(); });
  paint();
}

// ------------------------------------------------------------------ execution screen
function trStartExec(keys, start) { if (!keys.length) return toast("Nothing to run.", true); RS.sel.clear(); RS.exec = { queue: keys, key: start || keys[0] }; render(); }
async function trExecView(v) {
  const X = RS.exec; v.innerHTML = `<div class="trv" id="trEx"><div class="sub">Loading…</div></div>`;
  let c, j;
  try { c = (await api(`/api/runs/${RS.cycle}`)).cycle; j = await api(`/api/runs/${RS.cycle}/items/${X.key}`); } catch (e) { RS.exec = null; toast(e.message, true); return render(); }
  RS.c = c; X.queue = X.queue.filter((k) => c.items.some((i) => i.key === k)); if (!X.queue.includes(X.key)) X.queue.unshift(X.key);
  const it = j.item, cs = j.case || { steps: [], title: "(deleted from repo)" };
  const last = j.history.find((e) => e.cycle_id === c.id && e.item_key === it.key);
  // working state: start from the last attempt in this cycle when status is Retest/Not run partial, else fresh
  const st = X.st && X.st.key === it.key ? X.st : (X.st = { key: it.key, t0: Date.now(), cur: 0, override: "", reason: "", comments: "", defects: (it.defects || []).join(", "),
    steps: (cs.steps || []).map((_, i) => ({ status: "", actual: "", attachments: [] })) });
  const ord = X.queue.map((k) => c.items.find((i) => i.key === k)).filter(Boolean);
  const pos = X.queue.indexOf(it.key);
  const auto = () => { const s = st.steps.map((x) => x.status); return s.includes("Fail") ? "Fail" : s.includes("Blocked") ? "Blocked" : s.length && s.every((x) => x === "Pass" || x === "N/A") ? "Pass" : "Not run"; };
  const SC = { Pass: "P", Fail: "F", Blocked: "B", "N/A": "N" };
  const stepCard = (s, i) => { const w = st.steps[i]; const k = { Pass: "p", Fail: "f", Blocked: "b", "N/A": "n" }[w.status] || "";
    return `<div class="stc ${k} ${st.cur === i ? "cur" : ""}" data-i="${i}" tabindex="-1"><div class="fl" style="justify-content:space-between"><b>Step ${i + 1}</b><span class="sg">${["Pass", "Fail", "Blocked", "N/A"].map((x) => `<button data-s="${x}" class="${w.status === x ? SC[x] : ""}">${x}</button>`).join("")}</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:12px;margin-top:8px"><div><div class="tr-lbl">Step</div>${esc(s.step)}${s.data ? `<div class="muted" style="font-size:11.5px;margin-top:4px">Data: ${esc(s.data)}</div>` : ""}</div><div><div class="tr-lbl">Expected</div>${esc(s.expected)}</div>
      <div><div class="tr-lbl" style="display:flex;justify-content:space-between">Actual result <a href="#" data-same="1" style="text-transform:none;color:#4361ee">= Same as expected</a></div><textarea class="w" rows="2" data-act="1" placeholder="What actually happened…">${esc(w.actual)}</textarea></div></div>
      <div class="strip">${w.attachments.map((a, ai) => `<span class="thumb" data-ai="${ai}" title="${esc(a.orig)}">${(a.mime || "").startsWith("image") ? `<img src="/api/attachments/${a.name}" alt="">` : (a.mime || "").startsWith("video") ? "▶" : "📄"}<span class="x" data-del="${ai}" title="Delete">✕</span></span>`).join("")}
        <button class="ab" data-up="1">⬆ Upload</button><button class="ab" data-paste="1" title="Paste a screenshot from the clipboard (or press Ctrl+V on this step)">📋 Paste</button><input type="file" data-file="1" accept="image/*,video/*" multiple style="display:none"></div>
      ${w.status === "Fail" ? `<div class="fl" style="margin-top:8px;background:#fdeaea;border-radius:8px;padding:6px 10px;color:#a12020;font-size:12px"><span>Step failed — note the defect key on the right</span><button class="btn r sm" style="margin-left:auto" disabled title="Log defect to Jira – coming soon">🐞 Log defect (coming soon)</button></div>` : ""}</div>`; };
  const paint = () => {
    const a = auto(), fin = st.override || a; const doneN = st.steps.filter((x) => x.status).length;
    const el = Math.floor((Date.now() - st.t0) / 1000);
    $("#trEx").innerHTML = `<div class="hd"><div><small class="muted"><a href="#runs" id="trExBack" style="color:inherit">Test Runs › ${esc(c.name)}</a> › Execute</small><h1>${esc(cs.title)}</h1>
      <div class="sub">${esc(cs.story || "")} · ${esc(it.case_id)} · v${cs.version || 1} · <span class="pill ${TR_PRIO(cs.priority)}">${esc(cs.priority || "")}</span> · Tester ${esc(it.assignee || "—")}${c.build ? " · <b>Build</b> " + esc(c.build) : ""}${c.env ? " · <b>Env</b> " + esc(c.env) : ""}</div></div>
      <div class="fl" style="gap:22px;align-items:flex-start"><div style="text-align:right"><div class="tr-lbl">Timer</div><span class="timer" id="trTimer">${String(Math.floor(el / 60)).padStart(2, "0")}:${String(el % 60).padStart(2, "0")}</span></div><div style="text-align:right"><div class="tr-lbl">Auto status</div><b id="trAuto" style="font-size:18px;color:${TR_DOT[a]}">${a}</b></div></div></div>
      <div class="card" style="padding:10px 16px"><div class="fl" style="justify-content:space-between"><b>Steps ${doneN}/${st.steps.length} · ${st.steps.filter((x) => x.status === "Pass").length} passed · ${st.steps.filter((x) => x.status === "Fail").length} failed · ${st.steps.length - doneN} to go</b>
        <small class="muted">Shortcuts: <span class="kbd">P</span> <span class="kbd">F</span> <span class="kbd">B</span> <span class="kbd">N</span> set status · <span class="kbd">J</span>/<span class="kbd">K</span> step · <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> save &amp; next</small></div>
        <div class="sp">${st.steps.map((x) => `<i style="background:${x.status ? TR_DOT[x.status === "N/A" ? "Skipped" : x.status] : "#e2e8f0"}"></i>`).join("")}</div></div>
      <div class="ex3"><div class="card ml" style="margin:0"><div class="tr-lbl">Cases in run · ${pos + 1}/${X.queue.length}</div>${ord.map((o, n) => `<a data-k="${o.key}" class="${o.key === it.key ? "a" : ""}"><span class="tr-dot" style="background:${TR_DOT[o.status]}"></span>${n + 1}. ${esc((o.title || o.case_id).slice(0, 38))}</a>`).join("")}</div>
      <div><div class="card" style="margin:0 0 10px;padding:10px 14px"><b>Precondition:</b> ${esc(cs.precondition || "—")}</div>
        ${(cs.steps || []).map(stepCard).join("") || '<div class="card">This case has no steps.</div>'}
        <div class="fl" style="justify-content:space-between"><small class="muted">${st.steps.length - doneN} step(s) not run</small><button class="btn s sm" id="trPassRest" ${doneN === st.steps.length ? "disabled" : ""}>✓ Pass all remaining</button></div></div>
      <div><div class="card" style="margin:0 0 10px"><h3>Overall status</h3><span class="pill ${TR_RES[fin]}" id="trFinal">${fin}${st.override ? " (override)" : " (auto)"}</span> <small class="muted">any Fail → Fail · else any Blocked → Blocked · all Pass/NA → Pass</small>
          <label>Override</label><select class="w" id="trOvr"><option value="">Keep auto</option>${TR_RUN_ST.map((s) => `<option ${st.override === s ? "selected" : ""}>${s}</option>`).join("")}</select>
          <label>Reason</label><input class="w ${st.override && st.override !== a && !st.reason ? "ierr" : ""}" id="trReason" placeholder="Required if overridden" value="${esc(st.reason)}"></div>
        <div class="card" style="margin:0 0 10px"><h3>Defects</h3><input class="w" id="trDef" placeholder="e.g. CX-231, CX-240" value="${esc(st.defects)}"><div class="fl" style="margin-top:8px"><button class="btn g sm" disabled title="Log defect to Jira – coming soon">🐞 Log defect to Jira</button><button class="btn g sm" disabled title="Sync to qTest – coming soon">⇪ Sync to qTest</button></div></div>
        <div class="card" style="margin:0 0 10px"><h3>Comments</h3><textarea class="w" rows="3" id="trCom" placeholder="Notes for this execution">${esc(st.comments)}</textarea></div>
        <div class="card" style="margin:0"><h3>History (${j.history.length})</h3><div id="trHist">${j.history.map((e) => `<div class="rc"><span class="pill ${TR_RES[e.status]}">${esc(e.status)}</span><div class="t">${esc(e.cycle_name || e.cycle_id)} · v${e.case_version}${e.override_reason ? ` · <i>${esc(e.override_reason)}</i>` : ""}${e.steps.some((s) => s.attachments.length) ? " · 📎" + e.steps.reduce((a, s) => a + s.attachments.length, 0) : ""}</div><small class="muted">${trTime(e.ts)}</small></div>`).join("") || '<div class="muted">First execution of this case.</div>'}</div></div></div></div>
      <div class="tr-foot"><button class="btn g" id="trPrev" ${pos > 0 ? "" : "disabled"}>◀ Prev</button><small class="muted" id="trSavedAt">${last ? "Last saved " + trTime(last.ts) : ""}</small>
        <span style="margin-left:auto" class="fl"><button class="btn g" id="trSave">Save</button><button class="btn g" id="trSaveExit">Save &amp; exit</button><button class="btn" id="trSaveNext">${pos < X.queue.length - 1 ? "Save &amp; next ▶" : "Save &amp; finish"} <span class="kbd" style="color:#1e2433">Ctrl+Enter</span></button></span></div>`;
    bind();
  };
  const setStep = (i, s) => { st.steps[i].status = st.steps[i].status === s ? "" : s; if (st.steps[i].status && i === st.cur && i < st.steps.length - 1) st.cur = i + 1; paint(); };
  const upload = async (i, files) => {
    for (const f of files) {
      if (f.size > 50 * 1024 * 1024) { toast(`${f.name || "file"} is larger than 50 MB`, true); continue; }
      try { const r = await api("/api/attachments", { method: "POST", body: { filename: f.name || `screenshot-${Date.now()}.png`, mime: f.type, data: await trFileB64(f) } }); st.steps[i].attachments.push(r.attachment); } catch (e) { toast(e.message, true); }
    }
    paint();
  };
  const lightbox = (a) => { const lb = document.createElement("div"); lb.className = "tr-lb"; lb.id = "trLb";
    lb.innerHTML = `<span class="x">✕</span>${(a.mime || "").startsWith("video") ? `<video src="/api/attachments/${a.name}" controls autoplay></video>` : (a.mime || "").startsWith("image") ? `<img src="/api/attachments/${a.name}" alt="">` : `<a href="/api/attachments/${a.name}" target="_blank" style="color:#fff">Open ${esc(a.orig)}</a>`}`;
    lb.onclick = (e) => { if (e.target === lb || e.target.classList.contains("x")) lb.remove(); }; document.body.appendChild(lb); };
  function bind() {
    $("#trExBack").onclick = (e) => { e.preventDefault(); trExitExec(); };
    $$("#trEx .ml a").forEach((a) => (a.onclick = () => { X.key = a.dataset.k; X.st = null; render(); }));
    $$("#trEx .stc").forEach((card) => {
      const i = +card.dataset.i;
      card.addEventListener("mousedown", () => { if (st.cur !== i) { st.cur = i; $$("#trEx .stc").forEach((x) => x.classList.toggle("cur", x === card)); } });
      $$(".sg button", card).forEach((b) => (b.onclick = () => setStep(i, b.dataset.s)));
      $("[data-same]", card).onclick = (e) => { e.preventDefault(); st.steps[i].actual = cs.steps[i].expected; if (!st.steps[i].status) st.steps[i].status = "Pass"; paint(); };
      $("[data-act]", card).oninput = (e) => (st.steps[i].actual = e.target.value);
      const fi = $("[data-file]", card); $("[data-up]", card).onclick = () => fi.click(); fi.onchange = () => upload(i, [...fi.files]);
      $("[data-paste]", card).onclick = async () => {
        try { const items = await navigator.clipboard.read(); const fs = [];
          for (const it2 of items) { const t = it2.types.find((x) => x.startsWith("image/")); if (t) { const b = await it2.getType(t); fs.push(new File([b], `screenshot-${Date.now()}.png`, { type: t })); } }
          if (!fs.length) return toast("No image on the clipboard. Copy a screenshot first (or press Ctrl+V on this step).", true); upload(i, fs);
        } catch (e) { toast("Clipboard not accessible – press Ctrl+V while this step is selected.", true); }
      };
      $$(".thumb", card).forEach((t) => (t.onclick = async (e) => {
        const ai = +t.dataset.ai; const a = st.steps[i].attachments[ai];
        if (e.target.dataset.del !== undefined) { if (!confirm(`Delete attachment ${a.orig}?`)) return; try { await api(`/api/attachments/${a.name}`, { method: "DELETE" }); } catch (er) { /* already gone */ } st.steps[i].attachments.splice(ai, 1); return paint(); }
        lightbox(a);
      }));
    });
    $("#trPassRest").onclick = () => { st.steps.forEach((x, i) => { if (!x.status) { x.status = "Pass"; if (!x.actual) x.actual = cs.steps[i].expected; } }); paint(); };
    $("#trOvr").onchange = (e) => { st.override = e.target.value; paint(); };
    $("#trReason").oninput = (e) => (st.reason = e.target.value);
    $("#trDef").oninput = (e) => (st.defects = e.target.value);
    $("#trCom").oninput = (e) => (st.comments = e.target.value);
    $("#trPrev").onclick = () => { X.key = X.queue[pos - 1]; X.st = null; render(); };
    $("#trSave").onclick = () => save("stay"); $("#trSaveExit").onclick = () => save("exit"); $("#trSaveNext").onclick = () => save("next");
  }
  const save = (then) => guarded($("#trSaveNext"), async () => {
    if (st.override && st.override !== auto() && !st.reason.trim()) { paint(); $("#trReason").focus(); throw new Error("Enter a reason for the status override."); }
    const r = await api(`/api/runs/${c.id}/items/${it.key}/execute`, { method: "POST", body: { steps: st.steps, override: st.override, reason: st.reason, comments: st.comments,
      defects: st.defects.split(",").map((x) => x.trim()).filter(Boolean), duration: Math.floor((Date.now() - st.t0) / 1000) } });
    toast(`${it.case_id} saved · ${r.execution.status}`);
    if (then === "exit" || (then === "next" && pos >= X.queue.length - 1)) return trExitExec();
    if (then === "next") { X.key = X.queue[pos + 1]; X.st = null; }
    else X.st = { ...st, steps: st.steps.map((x) => ({ ...x, attachments: [...x.attachments] })) };
    render();
  });
  clearInterval(RS.timer); RS.timer = setInterval(() => { const t = $("#trTimer"); if (!t) return clearInterval(RS.timer); const el = Math.floor((Date.now() - st.t0) / 1000); t.textContent = `${String(Math.floor(el / 60)).padStart(2, "0")}:${String(el % 60).padStart(2, "0")}`; }, 1000);
  RS.keyH = (e) => {
    if (S.view !== "runs" || !RS.exec || !$("#trEx") || $("#trOv") || $("#trLb")) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); return save("next"); }
    const tag = (e.target.tagName || "").toLowerCase(); if (["input", "textarea", "select"].includes(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase(); const m = { p: "Pass", f: "Fail", b: "Blocked", n: "N/A" }[k];
    if (m && st.steps.length) { e.preventDefault(); setStep(st.cur, m); }
    else if (k === "j" || k === "k") { e.preventDefault(); st.cur = Math.max(0, Math.min(st.steps.length - 1, st.cur + (k === "j" ? 1 : -1))); paint(); const cur = $(`#trEx .stc[data-i="${st.cur}"]`); if (cur) cur.scrollIntoView({ block: "nearest" }); }
  };
  RS.pasteH = (e) => {
    if (S.view !== "runs" || !RS.exec || !$("#trEx")) return;
    const fs = [...(e.clipboardData || {}).files || []].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (fs.length) { e.preventDefault(); upload(st.cur, fs); }
  };
  paint();
}
function trExitExec() { clearInterval(RS.timer); RS.exec = null; render(); }
document.addEventListener("keydown", (e) => RS.keyH && RS.keyH(e));
document.addEventListener("paste", (e) => RS.pasteH && RS.pasteH(e));
// Sidebar click on Test Case Repo / Test Runs always opens the list page (not a half-open editor / execution).
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('.nav a[data-view="repo"], .nav a[data-view="runs"]'); if (!a) return;
  if (a.dataset.view === "runs") { clearInterval(RS.timer); RS.exec = null; RS.cycle = null; } else { RP.edit = null; RP.ai = null; }
}, true);
