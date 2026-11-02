/* Test Case Repo (additive feature): Review actions (Save to repo / Execute now), Repo page, editor, AI review. */
"use strict";
const RP = { showArch: false, pg: { page: 1, size: 25 }, renaming: null, drag: null, folder: "", q: "", prio: "", status: "", source: "", result: "", sel: new Set(), data: null, edit: null, ai: null, ftree: "" };
const TR_PRIO = (p) => (p === "High" ? "r" : p === "Medium" ? "y" : "gr");
const TR_ST = { Draft: "gr", Ready: "", Obsolete: "r" };
const TR_RES = { Pass: "", Fail: "r", Blocked: "k", Skipped: "gr", Retest: "v", "Not run": "gr", "": "gr" };
const TR_SRC = { AI: "v", Manual: "b", Record: "r" };
const trDate = (ts) => { if (!ts) return "—"; const d = new Date(ts); return isNaN(d) ? ts : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-"); };
const trTime = (ts) => { if (!ts) return "—"; const d = new Date(ts); return isNaN(d) ? ts : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };

// ------------------------------------------------------------------ modal / drawer helpers
function trModal(html, width = 600) {
  trClose();
  const ov = document.createElement("div"); ov.className = "tr-ov trv"; ov.id = "trOv";
  ov.innerHTML = `<div class="tr-mo" style="width:${width}px">${html}</div>`;
  document.body.appendChild(ov);
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) trClose(); });
  $$(".tr-x", ov).forEach((x) => (x.onclick = trClose));
  return ov;
}
function trClose() { const o = $("#trOv"); if (o) o.remove(); }
function trDrawerClose() { $$("#trDrw,#trDbg").forEach((e) => e.remove()); }
function trFileB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); }); }

// folder tree (shared with runs.js) --------------------------------------------------------
function trTreeRows(folders, parent = "", lvl = 1) {
  return folders.filter((f) => (f.parent || "") === parent).sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name))
    .flatMap((f) => [{ f, lvl }, ...trTreeRows(folders, f.id, lvl + 1)]);
}

// ------------------------------------------------------------------ Review page hook
function trReviewCases() { return (S.cases && S.cases.length ? S.cases : (S.run && S.run.test_cases) || []); }
function trStory() { const r = S.run || {}; return { story: (r.story_id || "").trim(), story_title: ((r.jira || {}).summary || "").trim(), source: r.source || "", rid: r.rid || "" }; }
function trInjectReview() {
  if (S.mode === "batch" || S.view !== "review") return;
  const nb = $("#view #nextBtn"); if (!nb || $("#trRvActs")) return;
  const foot = nb.parentElement; if (!foot || !foot.classList.contains("footer-nav")) return;
  const wrap = document.createElement("span"); wrap.className = "trv fl"; wrap.id = "trRvActs"; wrap.style.gap = "8px";
  wrap.innerHTML = `<button class="btn g" id="trSaveRepo" title="Save these cases to the Test Case Repo">🗂 Save to Test Case Repo</button><button class="btn s" id="trExecNow" title="Create a quick-run cycle and execute">▶ Execute now</button>`;
  foot.insertBefore(wrap, nb); wrap.appendChild(nb);
  const left = foot.firstElementChild;
  if (left && left !== wrap && !left.textContent.trim()) left.innerHTML = `<div class="trv"><b id="trRvCnt">${trReviewCases().length} test cases</b><div class="muted" style="font-size:12px">What next? Save them for reuse, run them now, or upload to qTest as before.</div></div>`;
  const dis = !trReviewCases().length; $("#trSaveRepo").disabled = dis; $("#trExecNow").disabled = dis;
  const links = (S.run && S.run.source === "repo" && S.run.repo_links) || null;
  if (links && links.length) {
    const n = Math.min(links.length, trReviewCases().length);
    $("#trSaveRepo").innerHTML = `🗂 Save back to repo (update ${n})`; $("#trSaveRepo").title = "Write your edits back to the linked repo cases as new versions (no duplicates)";
    const lt = $("#trRvCnt"); if (lt) { lt.textContent = `${trReviewCases().length} test cases from Repo`; lt.nextElementSibling.textContent = "Save edits back as new versions, run them, or upload to qTest."; }
    const h = $("#view h1"); if (h && !$("#trSrcPill")) h.insertAdjacentHTML("beforeend", ' <span class="pill b" id="trSrcPill" style="font-size:12px;vertical-align:middle">🗂 Source: Repo</span>');
    $("#trSaveRepo").onclick = () => guarded($("#trSaveRepo"), async () => {
      if (S.localDirty && typeof saveCases === "function") await saveCases();
      const r = await api("/api/repo/save_back", { method: "POST", body: { test_cases: trReviewCases(), links, story: (S.run || {}).story_id || "" } });
      toast(`Saved back to repo: ${r.updated.length} updated (new version) · ${r.unchanged.length} unchanged${r.created.length ? ` · ${r.created.length} new` : ""}`);
    });
    return;
  }
  $("#trSaveRepo").onclick = () => trSaveModal();
  $("#trExecNow").onclick = () => trExecModal();
}
new MutationObserver(() => trInjectReview()).observe(document.getElementById("view"), { childList: true, subtree: true });

async function trSaveModal() {
  const cases = trReviewCases(); const st = trStory();
  let j; try { j = await api("/api/repo/check", { method: "POST", body: { test_cases: cases, ...st } }); } catch (e) { return toast(e.message, true); }
  const M = { status: "Draft", folder: j.suggest.folder_id || "__new_default", acts: {} };
  j.matches.forEach((m, i) => { if (m) M.acts[i] = m.identical ? "skip" : "update"; });
  const rows = trTreeRows(j.folders);
  const tree = () => `<div class="card tree" style="padding:8px;margin:0;max-height:210px;overflow:auto" id="trSvTree">
    ${rows.map(({ f, lvl }) => `<a class="l${lvl} ${M.folder === f.id ? "a" : ""}" data-f="${f.id}">${lvl === 1 ? "📁" : "📂"} ${esc(f.name)} <span class="c">${f.count}</span></a>`).join("")}
    ${j.suggest.folder_id ? "" : `<a class="l2 ${M.folder === "__new_default" ? "a" : ""}" data-f="__new_default">📂 (new) ${esc(j.suggest.project)} › ${esc(j.suggest.story_folder)} <span class="c">created on save</span></a>`}
    <a class="l2" style="color:#4361ee" id="trNewF">＋ New folder…</a></div>
    <div id="trNewFBox" style="display:none;margin-top:6px" class="fl"><input id="trNewFName" placeholder="Folder name" style="flex:1"><button class="btn sm" id="trNewFOk">Add</button></div>
    <div class="hint">Default: Project › Story from the Jira key</div>`;
  const nm = j.matches.filter(Boolean).length;
  const label = () => { const c = { new: 0, update: 0, skip: 0 }; j.matches.forEach((m, i) => c[m ? M.acts[i] : "new"]++); return `Save ${c.new} new · update ${c.update} · skip ${c.skip}`; };
  const actSeg = (m, i) => !m ? `<span class="pill">New</span>` : `<span class="sg" data-i="${i}">${[["update", `Update → v${m.version + 1}`], ["new", "Save as new"], ["skip", "Skip"]].map(([k, n]) => `<button data-a="${k}" class="${M.acts[i] === k ? "P" : ""}">${n}</button>`).join("")}</span>`;
  const ov = trModal(`<div class="hd"><h3>Save ${cases.length} test cases to Test Case Repo</h3><span class="tr-x">✕</span></div>
    <div class="g2"><div><label>Folder</label><div id="trTreeBox">${tree()}</div></div>
    <div><label>Save as status</label><div class="sg" id="trSvSt"><button class="P" data-s="Draft">Draft</button><button data-s="Ready">Ready</button></div><div class="hint">Ready = approved for execution in cycles</div>
    <label>Tags (optional)</label><input class="w" id="trSvTags" placeholder="e.g. regression, profile"><label>Link to story</label><input class="w" id="trSvStory" value="${esc(st.story)}"></div></div>
    <label style="margin-top:14px">Duplicate check · ${nm} of ${cases.length} match existing repo cases</label>
    <div style="max-height:260px;overflow:auto"><table id="trDupT"><tr><th>Case</th><th>Title</th><th>Repo match</th><th>Action</th></tr>
    ${cases.map((c, i) => { const m = j.matches[i]; return `<tr><td style="white-space:nowrap"><b>${esc(c.id)}</b></td><td>${esc(c.name)}</td><td><small style="color:${m ? "#a36b00" : "#94a3b8"}">${m ? `Match: REPO ${esc(m.id)} v${m.version} (${m.score}%${m.identical ? " identical" : ""})` : "No match"}</small></td><td>${actSeg(m, i)}</td></tr>`; }).join("")}</table></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn g tr-x">Cancel</button><button class="btn" id="trSvGo">${label()}</button></div>`, 940);
  const bindTree = () => {
    $$("#trSvTree a[data-f]", ov).forEach((a) => (a.onclick = () => { M.folder = a.dataset.f; $("#trTreeBox").innerHTML = tree(); bindTree(); }));
    $("#trNewF", ov).onclick = () => { $("#trNewFBox").style.display = "flex"; $("#trNewFName").focus(); };
    $("#trNewFOk", ov).onclick = () => { const n = $("#trNewFName").value.trim(); if (!n) return; M.newFolder = n; M.folder = "__custom";
      $("#trSvTree").insertAdjacentHTML("beforeend", `<a class="l2 a" data-f="__custom">📂 ${esc(n)} <span class="c">new</span></a>`); $$("#trSvTree a").forEach((x) => x.classList.toggle("a", x.dataset.f === "__custom")); $("#trNewFBox").style.display = "none"; };
  };
  bindTree();
  $$("#trSvSt button", ov).forEach((b) => (b.onclick = () => { M.status = b.dataset.s; $$("#trSvSt button", ov).forEach((x) => x.classList.toggle("P", x === b)); }));
  $$("#trDupT .sg button", ov).forEach((b) => (b.onclick = () => { const i = b.parentElement.dataset.i; M.acts[i] = b.dataset.a; $$("button", b.parentElement).forEach((x) => x.classList.toggle("P", x === b)); $("#trSvGo").textContent = label(); }));
  $("#trSvGo", ov).onclick = () => guarded($("#trSvGo"), async () => {
    const body = { test_cases: cases, ...st, story: $("#trSvStory").value.trim(), status: M.status, tags: $("#trSvTags").value.split(",").map((x) => x.trim()).filter(Boolean),
      actions: Object.fromEntries(j.matches.map((m, i) => [i, m ? M.acts[i] : "new"])) };
    if (M.folder === "__custom") body.new_folder = M.newFolder; else if (M.folder !== "__new_default") body.folder_id = M.folder;
    const r = await api("/api/repo/save_review", { method: "POST", body });
    trClose(); toast(`Saved to Test Case Repo: ${r.created.length} new · ${r.updated.length} updated · ${r.skipped.length} skipped`);
  });
}

async function trExecModal() {
  const cases = trReviewCases(); const st = trStory();
  let cy = []; try { cy = (await api("/api/runs")).cycles.filter((c) => c.status !== "Archived"); } catch (e) { /* ignore */ }
  const d = new Date(); const dd = `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en-US", { month: "short" })}-${d.getFullYear()}`;
  const M = { mode: "new" };
  const ov = trModal(`<div class="hd"><h3>▶ Run these ${cases.length} reviewed cases</h3><span class="tr-x">✕</span></div>
    <div class="tr-opt a" data-m="new"><label style="margin:0;text-transform:none;font-size:13px;color:#1e2433"><input type="radio" name="trEm" value="new" checked> <b>New quick-run cycle</b></label>
    <label>Cycle name</label><input class="w" id="trEnName" value="Quick run – ${esc(st.story || "Local")} – ${dd}"><div class="g2"><div><label>Build</label><input class="w" id="trEnBuild" placeholder="e.g. 4.18.0-rc2"></div><div><label>Environment</label><input class="w" id="trEnEnv" placeholder="e.g. QA"></div></div><label>Assignee</label><input class="w" id="trEnAsg" placeholder="e.g. Dhinakaran"></div>
    <div class="tr-opt" data-m="existing"><label style="margin:0;text-transform:none;font-size:13px;color:#1e2433"><input type="radio" name="trEm" value="existing" ${cy.length ? "" : "disabled"}> <b>Add to an existing cycle</b> ${cy.length ? "" : '<small class="muted">(no cycles yet)</small>'}</label>
    <input class="w" id="trEnQ" style="margin-top:8px" placeholder="🔍 Search cycles…"><select class="w" id="trEnCy" style="margin-top:6px">${cy.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.id})</option>`).join("")}</select></div>
    <div class="note">ℹ Cases will be saved to the Test Case Repo as <b>Draft</b> automatically (folder ${esc(st.story || "Local")}), so results stay linked to a stored version.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn g tr-x">Cancel</button><button class="btn s" id="trEnGo">Create cycle &amp; open Test Run →</button></div>`, 600);
  const setM = (m) => { M.mode = m; $$(".tr-opt", ov).forEach((o) => o.classList.toggle("a", o.dataset.m === m)); $$('input[name="trEm"]', ov).forEach((r) => (r.checked = r.value === m)); $("#trEnGo").textContent = m === "new" ? "Create cycle & open Test Run →" : "Add & open Test Run →"; };
  $$(".tr-opt", ov).forEach((o) => (o.onclick = (e) => { if (o.dataset.m === "existing" && !cy.length) return; setM(o.dataset.m); }));
  $("#trEnQ", ov).oninput = (e) => { const q = e.target.value.toLowerCase(); $("#trEnCy").innerHTML = cy.filter((c) => c.name.toLowerCase().includes(q)).map((c) => `<option value="${c.id}">${esc(c.name)} (${c.id})</option>`).join(""); };
  $("#trEnGo", ov).onclick = () => guarded($("#trEnGo"), async () => {
    const body = { test_cases: cases, ...st };
    if (M.mode === "existing") { body.cycle_id = $("#trEnCy").value; if (!body.cycle_id) throw new Error("Choose a cycle."); }
    else { body.name = $("#trEnName").value.trim(); if (!body.name) throw new Error("Cycle name is required."); body.build = $("#trEnBuild").value; body.env = $("#trEnEnv").value; body.assignee = $("#trEnAsg").value; }
    const r = await api("/api/runs/quick", { method: "POST", body });
    trClose(); toast(`Cycle ${r.cycle.name} ready · ${r.saved.ids.length} cases saved to repo as Draft`);
    if (window.RS) { RS.cycle = r.cycle.id; RS.exec = null; }
    go("runs");
  });
}

// ------------------------------------------------------------------ Repo page
async function viewRepo(v) {
  if (RP.edit) return trEditor(v);
  v.innerHTML = `<div class="trv" id="trRepo"><div class="hd"><div><h1>Test Case Repository</h1><div class="sub">Single source of truth for test cases · versioned · reusable across cycles</div></div>
    <div class="fl"><button class="btn g" id="trImp">⬆ Import (Excel / CSV / JSON)</button><button class="btn" id="trNew">＋ New test case</button></div></div><div id="trRepoBody" class="sub">Loading…</div></div>`;
  $("#trImp").onclick = trImportModal;
  $("#trNew").onclick = () => { RP.edit = { title: "", description: "", precondition: "", priority: "Medium", story: "", tags: [], type: "", steps: [{ step: "", expected: "", data: "" }], folder_path: trFolderPath(RP.folder) }; render(); };
  try { RP.data = await api("/api/repo"); } catch (e) { $("#trRepoBody").innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  trRepoRender();
}
function trFolderPath(fid) { const fs = (RP.data || {}).folders || []; const f = fs.find((x) => x.id === fid); return f ? f.path : ""; }
function trInFolder(c) {
  if (!RP.folder) return true;
  const fs = RP.data.folders; const ids = new Set([RP.folder]); let grew = true;
  while (grew) { grew = false; fs.forEach((f) => { if (ids.has(f.parent) && !ids.has(f.id)) { ids.add(f.id); grew = true; } }); }
  return ids.has(c.folder_id);
}
function trRepoFiltered() {
  const q = RP.q.toLowerCase();
  return RP.data.cases.filter((c) => trInFolder(c) && (RP.showArch || RP.status === "Archived" || c.status !== "Archived") && (!RP.prio || c.priority === RP.prio) && (!RP.status || c.status === RP.status) && (!RP.source || c.source === RP.source) &&
    (!RP.result || (RP.result === "none" ? !c.last_result : c.last_result === RP.result)) &&
    (!q || [c.id, c.title, c.description, c.story, ...(c.steps || []).map((s) => s.step + " " + s.expected)].join(" ").toLowerCase().includes(q)));
}
// pagination (shared with runs.js): st = {page, size}
function trPage(list, st) { st.size = st.size || 25; const pages = Math.max(1, Math.ceil(list.length / st.size)); st.page = Math.min(Math.max(1, st.page || 1), pages); return list.slice((st.page - 1) * st.size, st.page * st.size); }
function trPager(id, total, st) {
  if (!total) return "";
  const pages = Math.max(1, Math.ceil(total / st.size)), a = (st.page - 1) * st.size + 1, b = Math.min(total, st.page * st.size);
  const nums = [...new Set([1, st.page - 1, st.page, st.page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((x, y) => x - y);
  let last = 0; const btns = nums.map((n) => { const gap = n - last > 1 ? "<span>…</span>" : ""; last = n; return `${gap}<button class="btn ${n === st.page ? "on" : "g"} sm" data-p="${n}">${n}</button>`; }).join("");
  return `<div class="tr-pg" id="${id}"><span>Showing <b>${a}–${b}</b> of <b>${total}</b></span><span style="margin-left:14px">Rows per page</span><select data-size="1" style="padding:3px 6px">${[25, 50, 100].map((n) => `<option ${n === st.size ? "selected" : ""}>${n}</option>`).join("")}</select>
    <span style="margin-left:auto" class="fl"><button class="btn g sm" data-p="${st.page - 1}" ${st.page > 1 ? "" : "disabled"}>‹ Prev</button>${btns}<button class="btn g sm" data-p="${st.page + 1}" ${st.page < pages ? "" : "disabled"}>Next ›</button></span></div>`;
}
function trBindPager(id, st, rerender) {
  const el = document.getElementById(id); if (!el) return;
  $$("button[data-p]", el).forEach((b) => (b.onclick = () => { st.page = +b.dataset.p; rerender(); }));
  $("select[data-size]", el).onchange = (e) => { st.size = +e.target.value; st.page = 1; rerender(); };
}
function trRepoRender() {
  const d = RP.data; RP.pg = RP.pg || { page: 1, size: 25 };
  const rows = trTreeRows(d.folders).filter(({ f }) => !RP.ftree || f.name.toLowerCase().includes(RP.ftree.toLowerCase()));
  const list = trRepoFiltered(); const shown = trPage(list, RP.pg); RP.sel = new Set([...RP.sel].filter((id) => d.cases.some((c) => c.id === id)));
  const live = d.cases.filter((c) => c.status !== "Archived").length;
  const opt = (id, lab, vals, cur) => `<select id="${id}"><option value="">${lab}: All</option>${vals.map((x) => `<option value="${x[0]}" ${cur === x[0] ? "selected" : ""}>${x[1]}</option>`).join("")}</select>`;
  const pairs = (a) => a.map((x) => [x, x]);
  const ren = RP.renaming;
  $("#trRepoBody").outerHTML = `<div id="trRepoBody" class="g2" style="grid-template-columns:270px 1fr;align-items:start">
    <div class="card tree" style="padding:10px;margin:0;position:relative" id="trTree"><input class="w" id="trFq" style="margin-bottom:8px" placeholder="🔍 Filter folders" value="${esc(RP.ftree)}">
      <a data-f="" class="${RP.folder ? "" : "a"}">🗂 All test cases <span class="c">${live}</span></a>
      ${rows.map(({ f, lvl }) => ren === f.id ? `<a class="l${Math.min(lvl + 1, 4)}" style="background:#f5f7ff" data-ren="${f.id}"><input id="trRenIn" value="${esc(f.name)}" style="flex:1;padding:3px 6px;font-size:12px;border-color:#4361ee"><button class="btn s sm" id="trRenOk" style="padding:3px 7px">✓</button><button class="btn g sm" id="trRenNo" style="padding:3px 7px">✕</button></a><div class="hint" style="padding-left:40px">Enter to save · Esc to cancel</div>`
        : `<a data-f="${f.id}" draggable="true" title="${esc(f.description || f.path)}" class="l${Math.min(lvl + 1, 4)} ${RP.folder === f.id ? "a" : ""}"><span class="dh" title="Drag to reorder">⋮⋮</span>${RP.folder === f.id ? "📂" : "📁"} ${esc(f.name)} <span class="c">${f.count}</span><span class="mn" data-menu="${f.id}" title="Folder actions">⋯</span></a>`).join("")}
      <a style="color:#4361ee" id="trNewFolder">＋ New folder</a></div>
    <div class="card" style="margin:0"><div class="tb"><input id="trQ" placeholder="🔍 Search title, step text, TC-ID…" style="width:240px" value="${esc(RP.q)}">
      ${opt("trFP", "Priority", pairs(["High", "Medium", "Low"]), RP.prio)}${opt("trFS", "Status", pairs(["Draft", "Ready", "Obsolete", "Archived"]), RP.status)}${opt("trFSrc", "Source", pairs(["AI", "Manual", "Record"]), RP.source)}${opt("trFR", "Last result", [["Pass", "Pass"], ["Fail", "Fail"], ["Blocked", "Blocked"], ["none", "Never run"]], RP.result)}
      <label class="sw" style="margin:0;text-transform:none;font-size:12px;color:#1e2433"><input type="checkbox" id="trShowArch" ${RP.showArch ? "checked" : ""}><span class="t"></span>Show archived</label></div>
      <div class="tr-bulk" id="trBulk" style="${RP.sel.size ? "" : "display:none"}"><b id="trSelN">${RP.sel.size} selected</b><span style="margin-left:auto" class="fl"><button class="btn g sm" id="trBReview">🔍 Review</button><button class="btn sm" id="trBAdd">＋ Add to cycle</button><button class="btn g sm" id="trBMove">Move</button><button class="btn s sm" id="trBReady">✓ Mark Ready</button><button class="btn g sm" id="trBArch">🗄 Archive</button><button class="btn g sm" id="trBDel" style="color:#d33">🗑 Delete</button></span></div>
      ${d.total ? `<table id="trRepoT" class="rt"><tr><th><input type="checkbox" id="trAll" ${shown.length && shown.every((c) => RP.sel.has(c.id)) ? "checked" : ""}></th><th>TC-ID</th><th>Title</th><th>Priority</th><th>Status</th><th>Ver</th><th>Source</th><th>Last run</th><th>Story</th><th>Updated</th>${RP.showArch || RP.status === "Archived" ? "<th></th>" : ""}</tr>
      ${shown.map((c) => `<tr class="clk ${RP.sel.has(c.id) ? "sel" : ""} ${c.status === "Archived" ? "arc" : ""}" data-id="${c.id}"><td><input type="checkbox" class="trCk" ${RP.sel.has(c.id) ? "checked" : ""}></td><td><b style="color:#4361ee">${esc(c.id)}</b></td><td>${esc(c.title)}</td><td><span class="pill ${TR_PRIO(c.priority)}">${esc(c.priority)}</span></td><td><span class="pill ${TR_ST[c.status] ?? "gr"}">${esc(c.status)}</span></td><td>v${c.version}</td><td><span class="pill ${TR_SRC[c.source] || "b"}">${esc(c.source)}</span></td><td><span class="pill ${TR_RES[c.last_result || ""]}">${esc(c.last_result || "—")}</span></td><td>${esc(c.story || "—")}</td><td>${trDate(c.updated)}</td>${RP.showArch || RP.status === "Archived" ? `<td>${c.status === "Archived" ? `<button class="btn g sm" data-restore="${c.id}">↺ Restore</button>` : ""}</td>` : ""}</tr>`).join("")}</table>
      ${list.length > 25 ? trPager("trRepoPg", list.length, RP.pg) : `<div class="muted" style="margin-top:8px">${RP.folder ? "📂 " + esc(trFolderPath(RP.folder)) + " · " : ""}${list.length} of ${RP.showArch ? d.total : live} shown</div>`}`
      : `<div class="tr-empty">No test cases yet. Use <b>Save to Test Case Repo</b> on the Review page, <b>＋ New test case</b>, or <b>Import</b>.</div>`}</div></div>`;
  trBindPager("trRepoPg", RP.pg, trRepoRender);
  trBindTree();
  $("#trFq").oninput = (e) => { RP.ftree = e.target.value; clearTimeout(trRepoRender._f); trRepoRender._f = setTimeout(() => { trRepoRender(); const i = $("#trFq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $("#trNewFolder").onclick = () => trFolderModal(RP.folder);
  $("#trQ").oninput = (e) => { RP.q = e.target.value; RP.pg.page = 1; clearTimeout(trRepoRender._t); trRepoRender._t = setTimeout(() => { trRepoRender(); const i = $("#trQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  [["trFP", "prio"], ["trFS", "status"], ["trFSrc", "source"], ["trFR", "result"]].forEach(([id, k]) => ($("#" + id).onchange = (e) => { RP[k] = e.target.value; RP.pg.page = 1; trRepoRender(); }));
  $("#trShowArch").onchange = (e) => { RP.showArch = e.target.checked; RP.pg.page = 1; trRepoRender(); };
  const syncBulk = () => { $("#trBulk").style.display = RP.sel.size ? "" : "none"; $("#trSelN").textContent = `${RP.sel.size} selected`; };
  $$("#trRepoT tr[data-id]").forEach((tr) => (tr.onclick = (e) => {
    const id = tr.dataset.id;
    if (e.target.dataset.restore) { RP.sel = new Set([id]); return trBulk({ op: "restore" }, "Restored", true); }
    if (e.target.classList.contains("trCk")) { e.target.checked ? RP.sel.add(id) : RP.sel.delete(id); tr.classList.toggle("sel", e.target.checked); syncBulk(); return; }
    trDrawer(id);
  }));
  const all = $("#trAll"); if (all) all.onchange = () => { shown.forEach((c) => (all.checked ? RP.sel.add(c.id) : RP.sel.delete(c.id))); trRepoRender(); };
  const ids = () => [...RP.sel];
  $("#trBReview").onclick = () => trReviewSelected(ids());
  $("#trBAdd").onclick = () => { const ok = ids().filter((i) => (d.cases.find((c) => c.id === i) || {}).status !== "Archived"); if (!ok.length) return toast("Archived cases can't be added to cycles – restore them first.", true); trAddToCycleModal(ok); };
  $("#trBReady").onclick = () => trBulk({ op: "status", status: "Ready" }, "Marked Ready");
  $("#trBArch").onclick = () => trBulk({ op: "archive" }, "Archived", true);
  $("#trBDel").onclick = () => trDeleteCases(ids());
  $("#trBMove").onclick = () => {
    const ov = trModal(`<div class="hd"><h3>Move ${RP.sel.size} test case(s)</h3><span class="tr-x">✕</span></div><label>Destination folder</label>
      <select class="w" id="trMvF">${trTreeRows(d.folders).map(({ f, lvl }) => `<option value="${f.id}">${esc(f.path)}</option>`).join("")}</select>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn g tr-x">Cancel</button><button class="btn" id="trMvGo" ${d.folders.length ? "" : "disabled"}>Move</button></div>`, 460);
    $("#trMvGo", ov).onclick = () => { trClose(); trBulk({ op: "move", folder_id: $("#trMvF", ov).value }, "Moved"); };
  };
}
async function trRepoReload() { RP.data = await api("/api/repo"); if (RP.folder && !RP.data.folders.some((f) => f.id === RP.folder)) RP.folder = ""; trRepoRender(); }
async function trBulk(body, msg, clear) {
  try { const r = await api("/api/repo/bulk", { method: "POST", body: { ids: [...RP.sel], ...body } }); toast(`${msg}: ${r.count}${r.archived && r.archived.length ? ` · archived (has history): ${r.archived.length}` : ""}`); if (clear) RP.sel.clear(); await trRepoReload(); } catch (e) { toast(e.message, true); }
}
async function trDeleteCases(ids) {
  let j; try { j = await api("/api/repo/delete_check", { method: "POST", body: { ids } }); } catch (e) { return toast(e.message, true); }
  const used = j.cases.filter((c) => c.in_use), free = j.cases.filter((c) => !c.in_use);
  const one = j.cases.length === 1 ? j.cases[0] : null;
  let html;
  if (one && one.in_use) html = `<div class="hd"><h3>This case will be archived, not deleted</h3><span class="tr-x">✕</span></div><p><b>${esc(one.id)}</b> · ${esc(one.title)}</p>
      <div class="note" style="margin-top:10px">It has execution history: used in <b>${one.cycles.length} cycle(s)</b>${one.cycles.length ? ` (${one.cycles.map(esc).join(", ")})` : ""} with <b>${one.executions} execution(s)</b>.</div>
      <div class="muted" style="margin-top:10px;font-size:12.5px">Archiving hides it from the repo and from case pickers. Past results, attachments and defects stay linked. You can restore it any time.</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn g tr-x">Cancel</button><button class="btn" id="trDcGo">🗄 Archive</button></div>`;
  else if (one) html = `<div class="hd"><h3 style="color:#d33">🗑 Delete test case?</h3><span class="tr-x">✕</span></div><p><b>${esc(one.id)}</b> · ${esc(one.title)}</p><div class="tr-dz" style="margin-top:10px">Never executed and not in any cycle. This permanently deletes the case and all its versions (v1${one.versions > 1 ? "–v" + one.versions : ""}).</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn g tr-x">Cancel</button><button class="btn r" id="trDcGo">Delete permanently</button></div>`;
  else html = `<div class="hd"><h3 style="color:#d33">🗑 Delete ${j.cases.length} test cases?</h3><span class="tr-x">✕</span></div>
      ${free.length ? `<div class="tr-dz">${free.length} case(s) were never executed and will be <b>permanently deleted</b>.</div>` : ""}
      ${used.length ? `<div class="note">${used.length} case(s) have execution history (${used.map((c) => esc(c.id)).join(", ")}) and will be <b>archived</b> instead, so cycle results stay intact.</div>` : ""}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn g tr-x">Cancel</button><button class="btn r" id="trDcGo">${free.length ? "Delete" : "Archive"}</button></div>`;
  const ov = trModal(html, 540);
  $("#trDcGo", ov).onclick = () => { trClose(); RP.sel = new Set(ids); trBulk({ op: "delete" }, "Deleted", true); };
}

// ------------------------------------------------------------------ folders (v4)
function trCloseMenu() { const m = $("#trFm"); if (m) m.remove(); }
document.addEventListener("mousedown", (e) => { if (!e.target.closest || !e.target.closest("#trFm")) trCloseMenu(); }, true);
function trBindTree() {
  const tree = $("#trTree"); if (!tree) return;
  $$("a[data-f]", tree).forEach((a) => {
    a.onclick = (e) => {
      const m = e.target.closest("[data-menu]"); if (m) { e.stopPropagation(); return trFolderMenu(m.dataset.menu, a); }
      RP.folder = a.dataset.f; RP.pg.page = 1; trRepoRender();
    };
    if (!a.dataset.f) return;
    a.ondragstart = (e) => { RP.drag = a.dataset.f; e.dataTransfer.effectAllowed = "move"; a.classList.add("ghost"); };
    a.ondragend = () => { a.classList.remove("ghost"); $$(".dropl", tree).forEach((x) => x.remove()); };
    a.ondragover = (e) => { if (!RP.drag || RP.drag === a.dataset.f) return; e.preventDefault(); $$(".dropl", tree).forEach((x) => x.remove()); a.insertAdjacentHTML("beforebegin", '<div class="dropl"></div>'); };
    a.ondrop = async (e) => {
      e.preventDefault(); const src = RP.drag; RP.drag = null; if (!src || src === a.dataset.f) return;
      const tgt = RP.data.folders.find((f) => f.id === a.dataset.f); const parent = tgt.parent || "";
      const sib = trTreeRows(RP.data.folders).map((r) => r.f).filter((f) => (f.parent || "") === parent && f.id !== src).map((f) => f.id);
      sib.splice(sib.indexOf(tgt.id), 0, src);
      try { RP.data.folders = (await api("/api/repo/folders/reorder", { method: "POST", body: { parent, ids: sib } })).folders; trRepoRender(); } catch (er) { toast(er.message, true); }
    };
  });
  const ri = $("#trRenIn");
  if (ri) {
    ri.focus(); ri.select();
    const save = async () => { const n = ri.value.trim(); if (!n) return toast("Folder name is required.", true);
      try { RP.data.folders = (await api(`/api/repo/folders/${RP.renaming}`, { method: "PUT", body: { name: n } })).folders; RP.renaming = null; toast("Folder renamed"); trRepoRender(); } catch (er) { toast(er.message, true); ri.classList.add("ierr"); } };
    ri.onkeydown = (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { RP.renaming = null; trRepoRender(); } };
    $("#trRenOk").onclick = save; $("#trRenNo").onclick = () => { RP.renaming = null; trRepoRender(); };
  }
}
function trFolderMenu(fid, anchor) {
  trCloseMenu();
  const tree = $("#trTree"); const r = anchor.getBoundingClientRect(), t = tree.getBoundingClientRect();
  tree.insertAdjacentHTML("beforeend", `<div class="tr-fm" id="trFm" style="top:${r.bottom - t.top}px;left:${Math.min(r.right - t.left - 20, t.width - 195)}px">
    <div data-a="ren">✎ Rename</div><div data-a="sub">📁 New sub-folder</div><div data-a="up">↑ Move up</div><div data-a="down">↓ Move down</div><hr><div data-a="del" class="dg">🗑 Delete…</div></div>`);
  $$("#trFm div[data-a]").forEach((x) => (x.onclick = async () => {
    trCloseMenu(); const a = x.dataset.a;
    if (a === "ren") { RP.renaming = fid; return trRepoRender(); }
    if (a === "sub") return trFolderModal(fid);
    if (a === "del") return trDeleteFolder(fid);
    try { RP.data.folders = (await api("/api/repo/folders/reorder", { method: "POST", body: { id: fid, dir: a } })).folders; trRepoRender(); } catch (er) { toast(er.message, true); }
  }));
}
function trFolderModal(parent) {
  const fs = RP.data.folders; let par = parent || "";
  const ov = trModal(`<div class="hd"><h3>New folder</h3><span class="tr-x">✕</span></div>
    <label>Folder name <span class="req">*</span></label><input class="w" id="trFnName" placeholder="e.g. CX-7001 · Checkout"><div class="etxt" id="trFnErr" style="display:none"></div>
    <label>Parent folder</label><div class="card tree" style="padding:6px;margin:0;max-height:190px;overflow:auto" id="trFnTree"></div><div class="hint">Will be created in: <b id="trFnIn"></b></div>
    <label>Description (optional)</label><textarea class="w" rows="2" id="trFnDesc" placeholder="What goes in this folder?"></textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn g tr-x">Cancel</button><button class="btn" id="trFnGo" disabled>Create folder</button></div>`, 520);
  const check = () => {
    const n = $("#trFnName").value.trim().replace(/\s+/g, " ").toLowerCase();
    const dup = n && fs.some((f) => (f.parent || "") === par && f.name.trim().replace(/\s+/g, " ").toLowerCase() === n);
    const pn = par ? (fs.find((f) => f.id === par) || {}).path : "Top level";
    $("#trFnErr").style.display = dup ? "" : "none"; $("#trFnErr").textContent = dup ? `⚠ A folder named “${$("#trFnName").value.trim()}” already exists in ${pn}. Choose another name.` : "";
    $("#trFnName").classList.toggle("ierr", !!dup); $("#trFnGo").disabled = !n || dup; $("#trFnIn").textContent = pn;
  };
  const paint = () => { $("#trFnTree").innerHTML = `<a data-p="" class="${par ? "" : "a"}">⌂ Top level</a>` + trTreeRows(fs).map(({ f, lvl }) => `<a data-p="${f.id}" class="l${Math.min(lvl + 1, 4)} ${par === f.id ? "a" : ""}">📁 ${esc(f.name)}</a>`).join("");
    $$("#trFnTree a", ov).forEach((a) => (a.onclick = () => { par = a.dataset.p; paint(); check(); })); };
  paint(); check(); $("#trFnName", ov).oninput = check; $("#trFnName", ov).focus();
  $("#trFnGo", ov).onclick = () => guarded($("#trFnGo"), async () => {
    const r = await api("/api/repo/folders", { method: "POST", body: { name: $("#trFnName").value.trim(), parent: par, description: $("#trFnDesc").value } });
    trClose(); toast("Folder created"); RP.folder = r.id; await trRepoReload();
  });
}
function trDeleteFolder(fid) {
  const fs = RP.data.folders, f = fs.find((x) => x.id === fid); if (!f) return;
  const desc = new Set([fid]); let g = true; while (g) { g = false; fs.forEach((x) => { if (desc.has(x.parent) && !desc.has(x.id)) { desc.add(x.id); g = true; } }); }
  const subs = fs.filter((x) => desc.has(x.id) && x.id !== fid), n = RP.data.cases.filter((c) => desc.has(c.folder_id)).length;
  const targets = trTreeRows(fs).filter(({ f: x }) => !desc.has(x.id));
  let mode = n ? (targets.length ? "move" : "archive") : "none";
  const ov = trModal(`<div class="hd"><h3 style="color:#d33">🗑 Delete folder “${esc(f.name)}”?</h3><span class="tr-x">✕</span></div>
    <div class="tr-dz">This folder contains <b>${n} test case(s)</b>${subs.length ? ` and <b>${subs.length} sub-folder(s)</b> (${subs.map((x) => esc(x.name)).join(", ")})` : ""}.</div>
    ${n ? `<label>What should happen to the cases?</label>
    <div class="tr-opt ${mode === "move" ? "a" : ""}" data-m="move"><label style="margin:0;text-transform:none;font-size:13px;color:#1e2433"><input type="radio" name="trDfM" value="move" ${mode === "move" ? "checked" : ""} ${targets.length ? "" : "disabled"}> <b>Move cases to</b></label><select class="w" id="trDfT" style="margin-top:8px">${targets.map(({ f: x }) => `<option value="${x.id}">${esc(x.path)}</option>`).join("")}</select><div class="hint">Sub-folder structure is flattened into the target folder</div></div>
    <div class="tr-opt ${mode === "archive" ? "a" : ""}" data-m="archive"><label style="margin:0;text-transform:none;font-size:13px;color:#1e2433"><input type="radio" name="trDfM" value="archive" ${mode === "archive" ? "checked" : ""}> <b>Archive the cases</b></label><div class="hint">Hidden from the repo; restore any time via “Show archived”</div></div>
    <div class="note">ℹ Cases with execution history are never deleted — they are always archived or moved so cycle results stay intact.</div>` : ""}
    <label>Type the folder name to confirm</label><input class="w" id="trDfName" placeholder="${esc(f.name)}">
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn g tr-x">Cancel</button><button class="btn r" id="trDfGo" disabled>Delete folder</button></div>`, 560);
  $$(".tr-opt", ov).forEach((o) => (o.onclick = () => { if (o.dataset.m === "move" && !targets.length) return; mode = o.dataset.m; $$(".tr-opt", ov).forEach((x) => x.classList.toggle("a", x === o)); $$('input[name="trDfM"]', ov).forEach((r) => (r.checked = r.value === mode)); }));
  const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
  $("#trDfName", ov).oninput = (e) => ($("#trDfGo").disabled = norm(e.target.value) !== norm(f.name));
  $("#trDfGo", ov).onclick = () => guarded($("#trDfGo"), async () => {
    const q = new URLSearchParams({ mode: mode === "archive" ? "archive" : "move", target: mode === "move" && $("#trDfT") ? $("#trDfT").value : "", confirm: $("#trDfName").value });
    const r = await api(`/api/repo/folders/${fid}?${q}`, { method: "DELETE" });
    trClose(); toast(`Folder deleted${r.moved ? ` · ${r.moved} case(s) moved` : ""}${r.archived ? ` · ${r.archived} case(s) archived` : ""}`); await trRepoReload();
  });
}

// ------------------------------------------------------------------ Review selected (v4)
async function trReviewSelected(ids) {
  if (!ids.length) return;
  if (S.mode === "batch") return toast("Exit Batch mode first to review repo cases.", true);
  const r = S.run || {}; const has = (r.test_cases || []).length;
  const go2 = async () => {
    if (S.localDirty && typeof saveCases === "function") { try { await saveCases(); } catch (e) { /* best effort */ } }
    const j = await api("/api/repo/review", { method: "POST", body: { ids } });
    trClose(); S.localDirty = false; S.cases = []; S.view = "review"; location.hash = "review";
    if (j.saved_rid) sessionStorage.setItem("trJustSaved", JSON.stringify({ rid: j.saved_rid, t: Date.now() }));
    render(); if (j.saved_rid) trToast2(j.saved_rid); else toast(`Opened ${ids.length} repo case(s) in Review`);
  };
  if (!has) return guarded(null, go2);
  const ov = trModal(`<div class="hd"><h3>Open selected cases in Review?</h3><span class="tr-x">✕</span></div>
    <p style="line-height:1.6">You have <b>${esc(r.rid || "the current run")}</b>${r.story_id ? ` (${esc(r.story_id)}` : " ("}${has} cases${S.localDirty || r.dirty ? ', <span style="color:#a36b00">unsaved changes</span>' : ""}) open in Review. We'll save it to Run history and open the <b>${ids.length} selected repo case(s)</b> for review.</p>
    <div class="note">Nothing is lost — reopen it any time from Run history.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn g tr-x">Cancel</button><button class="btn" id="trRsGo">Save &amp; continue</button></div>`, 560);
  $("#trRsGo", ov).onclick = () => guarded($("#trRsGo"), go2);
}
function trToast2(rid) {
  const old = $("#trToast2"); if (old) old.remove();
  const t = document.createElement("div"); t.className = "tr-toast2"; t.id = "trToast2";
  t.innerHTML = `✓ Saved ${esc(rid)} to Run history <a href="#history" id="trT2Open" style="color:#7c9cff;font-weight:700">Open</a><span class="x" style="color:#94a3b8;cursor:pointer">✕</span>`;
  document.body.appendChild(t);
  $(".x", t).onclick = () => t.remove(); $("#trT2Open").onclick = (e) => { e.preventDefault(); t.remove(); go("history"); };
  setTimeout(() => t.remove(), 9000);
}
// Run history: highlight the run auto-saved by "Review selected" ("Just saved", 10 min)
function trMarkJustSaved() {
  if (S.view !== "history") return;
  let js; try { js = JSON.parse(sessionStorage.getItem("trJustSaved") || "null"); } catch (e) { js = null; }
  if (!js || Date.now() - js.t > 600000) return;
  $$("#view table.rh tr").forEach((tr) => {
    const c = tr.cells && tr.cells[0]; if (!c || tr.classList.contains("tr-jsv") || !c.textContent.includes(js.rid)) return;
    tr.classList.add("tr-jsv"); c.insertAdjacentHTML("beforeend", '<span class="tr-jb">Just saved</span>');
  });
}
new MutationObserver(() => trMarkJustSaved()).observe(document.getElementById("view"), { childList: true, subtree: true });

async function trAddToCycleModal(ids) {
  let cy = []; try { cy = (await api("/api/runs")).cycles.filter((c) => c.status !== "Archived"); } catch (e) { return toast(e.message, true); }
  const ov = trModal(`<div class="hd"><h3>Add ${ids.length} case(s) to a cycle</h3><span class="tr-x">✕</span></div>
    <label>Existing cycle</label><select class="w" id="trAcC"><option value="">— New cycle —</option>${cy.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.id})</option>`).join("")}</select>
    <div id="trAcNew"><label>New cycle name</label><input class="w" id="trAcN" placeholder="e.g. Sprint 42 – Regression"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn g tr-x">Cancel</button><button class="btn" id="trAcGo">＋ Add</button></div>`, 480);
  $("#trAcC", ov).onchange = (e) => ($("#trAcNew").style.display = e.target.value ? "none" : "");
  $("#trAcGo", ov).onclick = () => guarded($("#trAcGo"), async () => {
    let cid = $("#trAcC").value;
    if (cid) { const r = await api(`/api/runs/${cid}/items`, { method: "POST", body: { case_ids: ids } }); toast(`Added ${r.added} case(s) to cycle`); }
    else { const n = $("#trAcN").value.trim(); if (!n) throw new Error("Cycle name is required."); const r = await api("/api/runs", { method: "POST", body: { name: n, case_ids: ids } }); cid = r.cycle.id; toast(`Created ${r.cycle.name}`); }
    trClose(); trDrawerClose();
  });
}
function trImportModal() {
  const ov = trModal(`<div class="hd"><h3>⬆ Import test cases</h3><span class="tr-x">✕</span></div>
    <div class="sub" style="margin:0">Excel (.xlsx) or CSV using the app's <a href="/api/excel/template">upload template</a> columns (one row per step), or JSON (list of {title, description, precondition, priority, steps:[{step, expected, data}]}).</div>
    <label>File</label><input type="file" id="trImF" accept=".xlsx,.csv,.json">
    <div class="g2"><div><label>Story</label><input class="w" id="trImS" placeholder="e.g. CX-205"></div><div><label>Status</label><select class="w" id="trImSt"><option>Draft</option><option>Ready</option></select></div></div>
    <label class="sw" style="margin-top:10px;text-transform:none"><input type="checkbox" id="trImNew"><span class="t"></span>Always save as new (skip duplicate update)</label>
    <div class="hint">Folder: ${RP.folder ? esc(trFolderPath(RP.folder)) : "Project › Story (auto)"}</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn g tr-x">Cancel</button><button class="btn" id="trImGo">Import</button></div>`, 560);
  $("#trImGo", ov).onclick = () => guarded($("#trImGo"), async () => {
    const f = $("#trImF").files[0]; if (!f) throw new Error("Choose a file.");
    const r = await api("/api/repo/import", { method: "POST", body: { filename: f.name, data: await trFileB64(f), story: $("#trImS").value.trim(), status: $("#trImSt").value, folder_id: RP.folder, as_new: $("#trImNew").checked } });
    trClose(); toast(`Imported: ${r.created.length} new · ${r.updated.length} updated · ${r.skipped.length} skipped${r.warnings.length ? ` · ${r.warnings.length} warnings` : ""}`);
    RP.data = await api("/api/repo"); trRepoRender();
  });
}

// ------------------------------------------------------------------ drawer
async function trDrawer(id, tab = "steps") {
  let j; try { j = await api(`/api/repo/cases/${encodeURIComponent(id)}`); } catch (e) { return toast(e.message, true); }
  const c = j.case, ex = j.executions;
  trDrawerClose();
  document.body.insertAdjacentHTML("beforeend", `<div class="tr-dbg" id="trDbg"></div><div class="tr-drw trv" id="trDrw"></div>`);
  $("#trDbg").onclick = trDrawerClose;
  const vers = [...(c.versions || [])].reverse();
  const paint = () => {
    $("#trDrw").innerHTML = `<div class="hd"><div><small class="muted">${esc(c.id)} · v${c.version} · ${esc(c.source)} · ${esc(c.story || "—")}</small><h3 style="font-size:16px;margin:2px 0 0">${esc(c.title)}</h3><small class="muted">📁 ${esc(c.folder_path || "")}</small></div><span class="tr-x" id="trDx">✕</span></div>
      <div class="fl"><span class="pill ${TR_PRIO(c.priority)}">${esc(c.priority)}</span><span class="pill ${TR_ST[c.status] ?? "gr"}">${esc(c.status)}</span>${c.last_result ? `<span class="pill ${TR_RES[c.last_result]}">Last: ${esc(c.last_result)}</span>` : ""}${(c.tags || []).map((t) => `<span class="pill gr">#${esc(t)}</span>`).join("")}
        <span style="margin-left:auto" class="fl"><button class="btn g sm" id="trDEdit">✎ Edit</button><button class="btn sm" id="trDAdd">＋ Add to cycle</button></span></div>
      <div class="tabs" style="margin-top:12px"><button data-t="steps" class="${tab === "steps" ? "a" : ""}">Steps</button><button data-t="versions" class="${tab === "versions" ? "a" : ""}">Versions (${vers.length})</button><button data-t="exec" class="${tab === "exec" ? "a" : ""}">Executions (${ex.length})</button></div>
      ${tab === "steps" ? `${c.description ? `<div style="font-size:12.5px;margin-bottom:6px">${esc(c.description)}</div>` : ""}<div class="muted" style="font-size:12px"><b>Precondition:</b> ${esc(c.precondition || "—")}</div>
        <table style="margin-top:8px"><tr><th>#</th><th>Step</th><th>Expected</th><th>Data</th></tr>${(c.steps || []).map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.step)}</td><td>${esc(s.expected)}</td><td>${esc(s.data || "")}</td></tr>`).join("")}</table>
        <h3 style="margin:16px 0 8px;font-size:13px">Recent executions</h3>${ex.slice(0, 3).map(trExRow).join("") || '<div class="muted">Not executed yet.</div>'}` : ""}
      ${tab === "versions" ? vers.map((v) => `<div class="rc"><b>v${v.version}</b><div class="t">${esc(v.note || "")}<br><small class="muted">${esc(v.snapshot.title)} · ${(v.snapshot.steps || []).length} steps</small></div><small class="muted">${trTime(v.ts)}</small></div>`).join("") : ""}
      ${tab === "exec" ? (ex.map(trExRow).join("") || '<div class="muted">Not executed yet.</div>') : ""}`;
    $("#trDx").onclick = trDrawerClose;
    $$("#trDrw .tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; paint(); }));
    $("#trDEdit").onclick = () => { trDrawerClose(); RP.edit = { ...JSON.parse(JSON.stringify(c)), folder_path: c.folder_path }; if (S.view !== "repo") go("repo"); else render(); };
    $("#trDAdd").onclick = () => trAddToCycleModal([c.id]);
  };
  paint();
}
function trExRow(e) { return `<div class="rc"><span class="pill ${TR_RES[e.status]}">${esc(e.status)}</span><div class="t">${esc(e.cycle_name || e.cycle_id)}${e.build ? " · " + esc(e.build) : ""} · ran v${e.case_version}${e.override_reason ? ` · <i>override: ${esc(e.override_reason)}</i>` : ""}</div><small class="muted">${trTime(e.ts)}</small></div>`; }

// ------------------------------------------------------------------ editor (create / edit) + AI review
function trEditor(v) {
  const E = RP.edit; const isNew = !E.id;
  if (RP.ai) return trAiView(v);
  const tags = Array.isArray(E.tags) ? E.tags.join(", ") : E.tags || "";
  v.innerHTML = `<div class="trv" id="trEd"><div class="hd"><div><small class="muted">Test Case Repo › ${esc(E.folder_path || "")} ›</small><h1>${isNew ? "New test case" : `Edit ${esc(E.id)} <span class="pill gr">v${E.version}</span>`}</h1><div class="sub">Manual authoring · all fields are text${isNew ? "" : " · saving content changes creates a new version"}</div></div>
    <div class="fl"><button class="btn g" id="trEdCancel">Cancel</button><button class="btn g" id="trEdAi">🤖 Review with AI</button><button class="btn g" id="trEdDraft">Save draft</button><button class="btn s" id="trEdReady">✓ Save as Ready</button></div></div>
    <div class="g2" style="grid-template-columns:1.4fr 1fr;align-items:start"><div class="card" style="margin:0"><label>Title <span class="req">*</span></label><input class="w" id="trTitle" value="${esc(E.title)}" placeholder="Verify …">
      <label>Description</label><textarea class="w" rows="2" id="trDesc" placeholder="What is being verified">${esc(E.description)}</textarea><label>Precondition</label><textarea class="w" rows="2" id="trPre" placeholder="State before step 1">${esc(E.precondition)}</textarea></div>
    <div class="card" style="margin:0"><div class="g2"><div><label>Priority</label><input class="w" id="trPrio" value="${esc(E.priority)}" placeholder="High / Medium / Low"></div><div><label>Linked story</label><input class="w" id="trStory" value="${esc(E.story)}" placeholder="e.g. CX-197"></div></div>
      <label>Folder</label><input class="w" id="trFolder" value="${esc(E.folder_path || "")}" placeholder="Project / Story (auto from story when empty)"><label>Tags</label><input class="w" id="trTags" value="${esc(tags)}" placeholder="comma-separated"><label>Type</label><input class="w" id="trType" value="${esc(E.type || "")}" placeholder="Positive / Negative / Edge">
      <details style="margin-top:8px" ${E.acs_text ? "open" : ""}><summary class="muted" style="cursor:pointer">Acceptance criteria for AI review (optional)</summary><textarea class="w" rows="3" id="trAcs" placeholder="One AC per line">${esc(E.acs_text || "")}</textarea></details></div></div>
    <div class="card" style="margin-top:14px"><div class="fl"><h3 style="margin:0">Steps</h3><small class="muted" style="margin-left:auto">Drag ⋮⋮ (or ▲▼) to reorder · Tab moves to next cell</small></div>
    <div class="dr hdr"><span></span><span>#</span><span>Step</span><span>Expected result</span><span>Test data</span><span></span></div><div id="trSteps"></div>
    <button class="btn g sm" style="margin-top:8px" id="trAddStep">＋ Add step</button></div></div>`;
  trPaintSteps();
  $("#trAddStep").onclick = () => { trReadEditor(); E.steps.push({ step: "", expected: "", data: "" }); trPaintSteps(); $$("#trSteps textarea").slice(-2)[0].focus(); };
  $("#trEdCancel").onclick = () => { RP.edit = null; RP.ai = null; render(); };
  $("#trEdDraft").onclick = () => trSaveEditor("Draft", $("#trEdDraft"));
  $("#trEdReady").onclick = () => trSaveEditor("Ready", $("#trEdReady"));
  $("#trEdAi").onclick = () => guarded($("#trEdAi"), async () => {
    trReadEditor();
    const r = await api("/api/repo/ai_review", { method: "POST", body: { case: E, acs: E.acs_text || "" } });
    RP.ai = { ...r.review, state: {} }; render();
  });
}
function trPaintSteps() {
  const E = RP.edit;
  $("#trSteps").innerHTML = E.steps.map((s, i) => `<div class="dr" draggable="true" data-i="${i}"><span class="drag" title="Drag to reorder">⋮⋮</span><b>${i + 1}</b><textarea rows="2" data-k="step" placeholder="Action">${esc(s.step)}</textarea><textarea rows="2" data-k="expected" placeholder="Expected result">${esc(s.expected)}</textarea><input data-k="data" placeholder="Test data" value="${esc(s.data || "")}">
    <span class="fl" style="flex-wrap:nowrap"><button class="btn g sm" data-a="up" title="Move up">▲</button><button class="btn g sm" data-a="down" title="Move down">▼</button><button class="btn g sm" data-a="dup" title="Duplicate">⧉</button><button class="btn g sm" data-a="del" title="Delete" style="color:#d33">🗑</button></span></div>`).join("");
  let drag = null;
  $$("#trSteps .dr").forEach((row) => {
    const i = +row.dataset.i;
    $$("button", row).forEach((b) => (b.onclick = () => {
      trReadEditor(); const st = E.steps; const a = b.dataset.a;
      if (a === "del") { st.splice(i, 1); if (!st.length) st.push({ step: "", expected: "", data: "" }); }
      if (a === "dup") st.splice(i + 1, 0, { ...st[i] });
      if (a === "up" && i > 0) [st[i - 1], st[i]] = [st[i], st[i - 1]];
      if (a === "down" && i < st.length - 1) [st[i + 1], st[i]] = [st[i], st[i + 1]];
      trPaintSteps();
    }));
    row.ondragstart = (e) => { if (!e.target.classList || !e.target.classList.contains("dr")) return; drag = i; e.dataTransfer.effectAllowed = "move"; };
    row.ondragover = (e) => { if (drag !== null) e.preventDefault(); };
    row.ondrop = (e) => { e.preventDefault(); if (drag === null || drag === i) return; trReadEditor(); const [m] = E.steps.splice(drag, 1); E.steps.splice(i, 0, m); drag = null; trPaintSteps(); };
  });
}
function trReadEditor() {
  const E = RP.edit; if (!$("#trTitle")) return E;
  Object.assign(E, { title: $("#trTitle").value, description: $("#trDesc").value, precondition: $("#trPre").value, priority: $("#trPrio").value, story: $("#trStory").value,
    folder_path: $("#trFolder").value, tags: $("#trTags").value.split(",").map((x) => x.trim()).filter(Boolean), type: $("#trType").value, acs_text: $("#trAcs").value });
  E.steps = $$("#trSteps .dr").map((r) => ({ step: $('[data-k="step"]', r).value, expected: $('[data-k="expected"]', r).value, data: $('[data-k="data"]', r).value }));
  return E;
}
async function trSaveEditor(status, btn) {
  const E = trReadEditor();
  if (!E.title.trim()) { $("#trTitle").classList.add("ierr"); return toast("Title is required.", true); }
  await guarded(btn, async () => {
    const body = { ...E, status, folder_id: "" };
    if (!E.folder_path.trim()) delete body.folder_path;
    const r = E.id ? await api(`/api/repo/cases/${E.id}`, { method: "PUT", body }) : await api("/api/repo/cases", { method: "POST", body: { ...body, source: "Manual" } });
    toast(`${r.case.id} saved as ${status}${r.new_version ? ` · new version v${r.case.version}` : ""}`);
    RP.edit = null; RP.ai = null; render();
  });
}
function trAiView(v) {
  const E = RP.edit, A = RP.ai, u = A.usage || {};
  const nAcc = Object.values(A.state).filter((x) => x === "acc").length;
  const cov = A.coverage || 0, col = cov >= 80 ? "#12a150" : cov >= 50 ? "#f59e0b" : "#d33";
  const kindCol = (k) => (/missing/i.test(k) ? "r" : /expected/i.test(k) ? "y" : /data/i.test(k) ? "gr" : "b");
  const body = (s) => s.op === "add" ? `<span class="tr-ins">＋ Step ${E.steps.length + 1}: ${esc(s.new_step ? s.new_step.step : s.after)}${s.new_step && s.new_step.expected ? " → Expected: " + esc(s.new_step.expected) : ""}</span>`
    : `${s.before ? `<span class="tr-del">${esc(s.before)}</span> → ` : ""}<span class="tr-ins">${esc(s.after)}</span>`;
  v.innerHTML = `<div class="trv" id="trAi"><div class="hd"><div><small class="muted">${E.id ? "Edit " + esc(E.id) : "New test case"} › Review with AI</small><h1>AI review · ${esc(E.title || "(untitled)")}</h1>
    <div class="sub">${A.suggestions.length} suggestions · nothing is changed until you accept · model ${esc(u.model_name || "gemini")} · ${fmt(u.total_tokens)} tokens (in ${fmt(u.input_tokens)} / out ${fmt(u.output_tokens)})</div></div>
    <div class="fl"><button class="btn g" id="trAiRejAll">Reject all</button><button class="btn s" id="trAiAccAll">✓ Accept all (${A.suggestions.length})</button><button class="btn" id="trAiApply">Apply ${nAcc} &amp; back to editor</button></div></div>
    <div class="g2" style="grid-template-columns:1fr 2fr;align-items:start"><div><div class="card"><h3>AC coverage</h3><div class="big" id="trCov" style="color:${col}">${cov}%</div><div class="tr-bar" style="margin:6px 0"><div style="width:${cov}%;background:${col}"></div></div>
      <div style="font-size:12.5px;line-height:1.9">${(A.ac || []).map((a) => a.covered ? `✓ ${esc(a.id)} ${esc(a.title)}` : `<span style="color:#d33">✗ ${esc(a.id)} ${esc(a.title)}</span>`).join("<br>")}</div></div>
      <div class="card"><h3>Summary</h3><div style="font-size:12.5px;line-height:1.8">${esc(A.summary || "")}</div></div></div>
    <div id="trSugs">${A.suggestions.map((s) => `<div class="tr-sug ${A.state[s.id] || ""}" data-id="${s.id}"><div class="fl"><span class="pill ${kindCol(s.kind || "")}">${esc(s.kind || "Suggestion")}</span><b>${esc(s.title || "")}</b>
      <span style="margin-left:auto" class="fl">${A.state[s.id] ? `<span class="pill ${A.state[s.id] === "acc" ? "" : "gr"}">${A.state[s.id] === "acc" ? "Accepted" : "Rejected"}</span><button class="btn g sm" data-a="undo">Undo</button>` : `<button class="btn s sm" data-a="acc">✓ Accept</button><button class="btn g sm" data-a="rej">✕ Reject</button>`}</span></div>
      <div style="margin-top:8px;font-size:12.5px;line-height:1.7">${body(s)}</div></div>`).join("") || '<div class="card">No suggestions – looks good.</div>'}</div></div></div>`;
  $$("#trSugs .tr-sug").forEach((el) => $$("button", el).forEach((b) => (b.onclick = () => { const id = el.dataset.id; if (b.dataset.a === "undo") delete A.state[id]; else A.state[id] = b.dataset.a; render(); })));
  $("#trAiAccAll").onclick = () => { A.suggestions.forEach((s) => (A.state[s.id] = "acc")); render(); };
  $("#trAiRejAll").onclick = () => { A.suggestions.forEach((s) => (A.state[s.id] = "rej")); render(); };
  $("#trAiApply").onclick = () => {
    const acc = A.suggestions.filter((s) => A.state[s.id] === "acc");
    acc.filter((s) => s.op !== "add").forEach((s) => {
      if (["title", "description", "precondition"].includes(s.field)) E[s.field] = s.after;
      else if (s.field === "step" && s.step && E.steps[s.step - 1]) E.steps[s.step - 1][s.part || "step"] = s.after;
    });
    acc.filter((s) => s.op === "add").forEach((s) => E.steps.push(s.new_step ? { data: "", ...s.new_step } : { step: s.after, expected: "", data: "" }));
    RP.ai = null; toast(acc.length ? `Applied ${acc.length} suggestion(s) – review and save` : "No suggestions applied"); render();
  };
}
