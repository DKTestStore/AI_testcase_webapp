/* Requirement Repo + Projects (additive). Matches mockups under mockups/requirement-repo/. */
"use strict";

const RQ = {
  projectId: localStorage.getItem("rqProjectId") || "",
  folder: "",
  q: "", type: "", priority: "", status: "",
  data: null, projects: [], detail: null, tab: "cases",
  view: "list", // list | detail | trace | projects
  traceCycle: "", gapsOnly: false, matrix: null,
  sel: new Set(),
  editing: false,
  editSnap: "",
  repoCases: null,
};

const RQ_PRIO = (p) => (p === "High" ? "r" : p === "Medium" || p === "Med" ? "y" : "gr");
const RQ_ST = { Draft: "y", Ready: "b", Approved: "", Archived: "gr" };
const rqEsc = (s) => (typeof esc === "function" ? esc(s) : String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
const rqDate = (ts) => { if (!ts) return "—"; const d = new Date(ts); return isNaN(d) ? ts : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-"); };
const rqDateTime = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d)) return ts;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/,/g, "");
};
function rqFolderPath(folders, fid) {
  const by = Object.fromEntries((folders || []).map((f) => [f.id, f]));
  const parts = [];
  let id = fid, guard = 0;
  while (id && by[id] && guard++ < 30) { parts.unshift(by[id].name); id = by[id].parent || ""; }
  return parts.join(" / ");
}
function rqFolderOptions(folders, selected, { includeRoot = true, exclude = "" } = {}) {
  const rows = (typeof trTreeRows === "function" ? trTreeRows(folders || []) : (folders || []).map((f) => ({ f, lvl: 1 })));
  const opts = includeRoot ? `<option value="">(root / unfiled)</option>` : "";
  return opts + rows.filter(({ f }) => f.id !== exclude && !(typeof rqIsDescendant === "function" && rqIsDescendant(folders, exclude, f.id)))
    .map(({ f }) => `<option value="${rqEsc(f.id)}" ${selected === f.id ? "selected" : ""}>${rqEsc(rqFolderPath(folders, f.id) || f.name)}</option>`).join("");
}
function rqIsDescendant(folders, ancestor, fid) {
  if (!ancestor || !fid || ancestor === fid) return false;
  const by = Object.fromEntries((folders || []).map((f) => [f.id, f]));
  let id = fid, guard = 0;
  while (id && by[id] && guard++ < 30) {
    if ((by[id].parent || "") === ancestor) return true;
    id = by[id].parent || "";
  }
  return false;
}

function rqSetProject(id) {
  RQ.projectId = id || "";
  try { localStorage.setItem("rqProjectId", RQ.projectId); } catch (e) {}
  rqRefreshSwitcher();
}

async function rqLoadProjects() {
  const j = await api("/api/projects");
  RQ.projects = j.projects || [];
  if (!RQ.projectId || !RQ.projects.some((p) => p.id === RQ.projectId)) {
    const prefer = RQ.projects.find((p) => (p.key || "").toUpperCase() !== "LOCAL") || RQ.projects[0];
    if (prefer) rqSetProject(prefer.id);
  }
  return RQ.projects;
}

function rqProject() {
  return RQ.projects.find((p) => p.id === RQ.projectId) || null;
}

function rqRefreshSwitcher() {
  const el = document.getElementById("rqSwitcher");
  if (!el) return;
  const p = rqProject();
  const label = p ? `${p.key} · ${p.name}` : "Select project";
  el.innerHTML = `<button type="button" class="rq-sw-btn" id="rqSwBtn" title="Switch project">▾ ${rqEsc(label)}</button>
    <div class="rq-sw-menu" id="rqSwMenu" hidden></div>`;
  const btn = document.getElementById("rqSwBtn");
  const menu = document.getElementById("rqSwMenu");
  btn.onclick = (e) => {
    e.stopPropagation();
    const open = !menu.hidden;
    menu.hidden = open;
    if (!open) {
      menu.innerHTML = RQ.projects.map((x) =>
        `<button type="button" data-pid="${rqEsc(x.id)}" class="${x.id === RQ.projectId ? "on" : ""}"><b>${rqEsc(x.key)}</b> ${rqEsc(x.name)}</button>`
      ).join("") + `<hr><button type="button" data-act="manage">Manage projects…</button><button type="button" data-act="new">＋ New project</button>`;
      menu.querySelectorAll("[data-pid]").forEach((b) => b.onclick = async () => {
        rqSetProject(b.dataset.pid); menu.hidden = true;
        if (["requirements", "projects", "trace"].includes(S.view) || String(S.view).startsWith("req/")) {
          RQ.view = "list"; RQ.detail = null; go("requirements");
        }
      });
      menu.querySelector("[data-act=manage]").onclick = () => { menu.hidden = true; RQ.view = "projects"; go("projects"); };
      menu.querySelector("[data-act=new]").onclick = () => { menu.hidden = true; rqNewProjectModal(); };
    }
  };
  document.addEventListener("click", () => { if (menu) menu.hidden = true; }, { once: true });
}

async function rqEnsureSwitcher() {
  let host = document.getElementById("rqSwitcher");
  if (!host) {
    const logo = document.querySelector("aside.sb .logo");
    if (!logo) return;
    host = document.createElement("div");
    host.id = "rqSwitcher";
    host.className = "rq-switcher";
    logo.insertAdjacentElement("afterend", host);
  }
  if (!RQ.projects.length) {
    try { await rqLoadProjects(); } catch (e) { /* ignore until logged in */ }
  }
  rqRefreshSwitcher();
}

// ------------------------------------------------------------------ views
async function viewProjects(v) {
  RQ.view = "projects";
  v.innerHTML = `<h1>Projects</h1><div class="sub">Scopes Requirements, Test Case Repo context, Test Runs and Dashboard. Existing features kept.</div>
    <div class="rq-toolbar"><button class="btn" id="rqNewProj">＋ New project</button></div>
    <div id="rqProjList" class="sub">Loading…</div>`;
  $("#rqNewProj").onclick = () => rqNewProjectModal();
  try {
    await rqLoadProjects();
    const list = $("#rqProjList");
    list.innerHTML = `<div class="rq-note">Migration note: existing cases keep their free-text story key. Opt-in auto-link matches <code>case.story</code> to a requirement’s Jira key.</div>` +
      RQ.projects.map((p) => {
        const cur = p.id === RQ.projectId ? `<span class="pill b">current</span>` : "";
        const sys = p.system ? `<span class="pill gr">default</span>` : `<span class="pill">Active</span>`;
        const maps = [p.jira_project_key && `Jira ${p.jira_project_key}`, p.qtest_project_id && `qTest ${p.qtest_project_id}`, p.zephyr_project_key && `Zephyr ${p.zephyr_project_key}`].filter(Boolean).join(" · ") || "No external mapping";
        return `<div class="card rq-pcard ${p.id === RQ.projectId ? "on" : ""}" data-pid="${rqEsc(p.id)}">
          <div class="rq-pkey">${rqEsc(p.key)}</div>
          <div class="rq-pbody"><div class="rq-ptitle">${rqEsc(p.name)} ${sys} ${cur}</div>
            <div class="muted">${p.requirements || 0} requirements · ${p.test_cases || 0} linked test cases · ${p.cycles || 0} cycles</div>
            <div class="muted" style="margin-top:4px">${rqEsc(maps)}</div></div>
          <button class="btn g sm rq-open" data-pid="${rqEsc(p.id)}">Open →</button>
        </div>`;
      }).join("");
    list.querySelectorAll(".rq-open").forEach((b) => b.onclick = () => { rqSetProject(b.dataset.pid); RQ.view = "list"; go("requirements"); });
  } catch (e) {
    $("#rqProjList").innerHTML = `<div class="error">${rqEsc(e.message)}</div>`;
  }
}

function rqNewProjectModal() {
  const html = `<div class="tr-mh"><b>New project</b><button class="tr-x">✕</button></div>
    <p class="muted" style="margin:0 0 12px">Creates a scope for Requirements ↔ Test cases ↔ Test cycles</p>
    <label>Name</label><input id="rqPN" placeholder="Expo Login Suite" style="width:100%">
    <label>Key</label><input id="rqPK" placeholder="EXPO" style="width:160px">
    <div class="muted" style="font-size:11px;margin:-4px 0 8px">Short id · letters/digits · e.g. EXPO</div>
    <label>Description</label><textarea id="rqPD" rows="2" style="width:100%"></textarea>
    <div class="muted" style="margin:10px 0 6px;font-weight:600">External mappings (optional)</div>
    <label>Jira project key <span class="pill b">optional</span></label><input id="rqPJ" style="width:160px">
    <label>qTest project ID <span class="pill b">optional</span></label><input id="rqPQ" style="width:160px" placeholder="numeric id">
    <label>Zephyr Scale project key <span class="pill b">optional</span></label><input id="rqPZ" style="width:160px">
    <div class="tr-mf"><button class="btn g" id="rqPCancel">Cancel</button><button class="btn" id="rqPSave">Create project</button></div>`;
  const ov = (typeof trModal === "function") ? trModal(html, 560) : rqModal(html, 560);
  $("#rqPCancel").onclick = () => (typeof trClose === "function" ? trClose() : ov.remove());
  $("#rqPSave").onclick = () => guarded($("#rqPSave"), async () => {
    const body = {
      name: $("#rqPN").value, key: $("#rqPK").value, description: $("#rqPD").value,
      jira_project_key: $("#rqPJ").value, qtest_project_id: $("#rqPQ").value, zephyr_project_key: $("#rqPZ").value,
    };
    const j = await api("/api/projects", { method: "POST", body });
    toast(`Project ${j.project.key} created`);
    if (typeof trClose === "function") trClose(); else ov.remove();
    await rqLoadProjects();
    rqSetProject(j.project.id);
    if (S.view === "projects") viewProjects($("#view"));
    else go("requirements");
  });
}

function rqModal(html, width) {
  const ov = document.createElement("div"); ov.className = "tr-ov trv"; ov.id = "trOv";
  ov.innerHTML = `<div class="tr-mo" style="width:${width || 560}px">${html}</div>`;
  document.body.appendChild(ov);
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) ov.remove(); });
  ov.querySelectorAll(".tr-x").forEach((x) => (x.onclick = () => ov.remove()));
  return ov;
}

async function viewRequirements(v) {
  await rqEnsureSwitcher();
  if (RQ.view === "projects") return viewProjects(v);
  if (RQ.view === "trace") return viewTraceability(v);
  if (RQ.view === "detail" && RQ.detail) return viewRequirementDetail(v, RQ.detail);
  RQ.view = "list";
  if (!RQ.projects.length) await rqLoadProjects();
  const p = rqProject();
  if (!p) {
    v.innerHTML = `<h1>Requirements</h1><div class="sub">Create a project first.</div><button class="btn" id="rqNeedP">＋ New project</button>`;
    $("#rqNeedP").onclick = () => rqNewProjectModal();
    return;
  }
  v.innerHTML = `<h1>Requirements</h1>
    <div class="sub">Project ${rqEsc(p.key)} · Requirement Repo · maps to Test cases &amp; Cycles
      <a href="#trace" id="rqGoTrace" style="margin-left:12px">Traceability →</a>
      <a href="#projects" id="rqGoProj" style="margin-left:8px">Projects</a>
    </div>
    <div class="rq-toolbar">
      <button class="btn g" id="rqImport">⬇ Import from Jira</button>
      <button class="btn" id="rqNew">＋ New requirement</button>
    </div>
    <div class="rq-layout">
      <aside class="rq-tree card" id="rqTree">Loading…</aside>
      <section class="rq-main card" id="rqMain">Loading…</section>
    </div>`;
  $("#rqGoTrace").onclick = (e) => { e.preventDefault(); RQ.view = "trace"; go("trace"); };
  $("#rqGoProj").onclick = (e) => { e.preventDefault(); RQ.view = "projects"; go("projects"); };
  $("#rqImport").onclick = () => rqImportModal();
  $("#rqNew").onclick = () => rqNewReqModal();
  await rqReloadList();
}

async function rqReloadList() {
  if (!RQ.projectId) return;
  const params = new URLSearchParams({
    project_id: RQ.projectId,
    folder_id: RQ.folder || "",
    q: RQ.q || "",
    type: RQ.type || "",
    priority: RQ.priority || "",
    status: RQ.status || "",
  });
  try {
    const j = await api("/api/requirements?" + params.toString());
    RQ.data = j;
    rqRenderTree(j.folders || []);
    rqRenderTable(j.requirements || []);
  } catch (e) {
    const m = $("#rqMain"); if (m) m.innerHTML = `<div class="error">${rqEsc(e.message)}</div>`;
  }
}

function rqCloseMenu() { const m = $("#rqFm"); if (m) m.remove(); document.querySelectorAll(".rq-kebab.on").forEach((b) => b.classList.remove("on")); }
document.addEventListener("mousedown", (e) => { if (!e.target.closest || !e.target.closest("#rqFm,.rq-kebab")) rqCloseMenu(); }, true);

function rqRenderTree(folders) {
  const el = $("#rqTree"); if (!el) return;
  const allCount = (RQ.data && RQ.data.total) || 0;
  const rows = (typeof trTreeRows === "function" ? trTreeRows(folders) : folders.map((f) => ({ f, lvl: 1 })));
  el.innerHTML = `<div class="rq-tree-h"><b>Folders</b><button class="btn g sm" id="rqAddFolder">＋ New folder</button></div>
    <div class="rq-titem ${!RQ.folder ? "on" : ""}" data-fid=""><span class="rq-tname">All requirements</span><span class="muted">${allCount}</span></div>
    ${rows.map(({ f, lvl }) => `<div class="rq-titem ${RQ.folder === f.id ? "on" : ""}" data-fid="${rqEsc(f.id)}" style="padding-left:${12 + (lvl - 1) * 14}px">
      <span class="rq-tname">${rqEsc(f.name)}</span>
      <span class="muted">${f.count || 0}</span>
      <button type="button" class="rq-kebab" data-menu="${rqEsc(f.id)}" title="Folder actions" aria-label="Folder actions">⋯</button>
    </div>`).join("")}
    <div class="rq-tree-note">Tree is project-scoped · separate from TC folders</div>`;
  el.querySelectorAll(".rq-titem").forEach((n) => n.onclick = (e) => {
    if (e.target.closest(".rq-kebab")) return;
    RQ.folder = n.dataset.fid || ""; RQ.sel = new Set(); rqReloadList();
  });
  el.querySelectorAll(".rq-kebab").forEach((b) => b.onclick = (e) => { e.stopPropagation(); rqFolderMenu(b.dataset.menu, b); });
  $("#rqAddFolder").onclick = () => rqFolderDialog({ mode: "new", parent: RQ.folder || "" });
}

function rqFolderMenu(fid, anchor) {
  rqCloseMenu();
  const tree = $("#rqTree"); if (!tree) return;
  const r = anchor.getBoundingClientRect(), t = tree.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.right - t.left - 20), Math.max(8, t.width - 200));
  tree.insertAdjacentHTML("beforeend", `<div class="rq-fm" id="rqFm" style="top:${r.bottom - t.top + 4}px;left:${left}px">
    <button type="button" data-a="ren">Rename</button>
    <button type="button" data-a="sub">New subfolder</button>
    <hr>
    <button type="button" data-a="del" class="dg">Delete…</button>
  </div>`);
  anchor.classList.add("on");
  $("#rqFm [data-a=ren]").onclick = () => { rqCloseMenu(); rqFolderDialog({ mode: "rename", fid }); };
  $("#rqFm [data-a=sub]").onclick = () => { rqCloseMenu(); rqFolderDialog({ mode: "sub", parent: fid }); };
  $("#rqFm [data-a=del]").onclick = () => { rqCloseMenu(); rqDeleteFolderDialog(fid); };
}

async function rqFolderDialog({ mode, fid, parent }) {
  const folders = (RQ.data && RQ.data.folders) || [];
  const current = fid ? folders.find((f) => f.id === fid) : null;
  const isRen = mode === "rename";
  const title = isRen ? "Rename folder" : "New folder";
  const p = rqProject();
  const defParent = isRen ? (current && current.parent) || "" : (parent || "");
  const html = `<div class="tr-mh"><b>${title}</b><button class="tr-x">✕</button></div>
    <p class="muted" style="margin:0 0 12px">Project ${rqEsc(p ? p.key : "")} · requirement folders only</p>
    <label>Name <span style="color:#d33333">*</span></label>
    <input id="rqFnName" style="width:100%" value="${rqEsc(isRen ? (current && current.name) || "" : "")}" placeholder="e.g. Session policies">
    <div class="rq-err" id="rqFnErr" hidden></div>
    ${isRen ? `<label>Parent folder</label><select id="rqFnParent" style="width:100%">${rqFolderOptions(folders, defParent, { exclude: fid })}</select>`
            : `<label>Parent folder</label><select id="rqFnParent" style="width:100%">${rqFolderOptions(folders, defParent)}</select>`}
    ${isRen ? "" : `<label>Description (optional)</label><textarea id="rqFnDesc" rows="2" style="width:100%" placeholder="What belongs in this folder?"></textarea>`}
    <div class="tr-mf"><button class="btn g" id="rqFnCancel">Cancel</button>
      <button class="btn" id="rqFnSave">${isRen ? "Save" : "Create folder"}</button></div>`;
  const ov = (typeof trModal === "function") ? trModal(html, 520) : rqModal(html, 520);
  const close = () => (typeof trClose === "function" ? trClose() : ov.remove());
  $("#rqFnCancel").onclick = close;
  setTimeout(() => { const i = $("#rqFnName"); if (i) { i.focus(); i.select(); } }, 30);
  $("#rqFnSave").onclick = () => guarded($("#rqFnSave"), async () => {
    const name = ($("#rqFnName").value || "").trim();
    const err = $("#rqFnErr");
    if (!name) { if (err) { err.hidden = false; err.textContent = "Folder name is required."; } return; }
    if (isRen) {
      await api("/api/requirements/folders/" + encodeURIComponent(fid), { method: "PUT", body: { name, parent: $("#rqFnParent").value } });
      toast("Folder renamed");
    } else {
      const body = { project_id: RQ.projectId, name, parent: $("#rqFnParent").value, description: ($("#rqFnDesc") && $("#rqFnDesc").value) || "" };
      await api("/api/requirements/folders", { method: "POST", body });
      toast("Folder created");
    }
    close();
    rqReloadList();
  });
}

async function rqDeleteFolderDialog(fid) {
  let info;
  try { info = await api("/api/requirements/folders/" + encodeURIComponent(fid) + "/delete-check"); }
  catch (e) { toast(e.message, true); return; }
  const folders = (RQ.data && RQ.data.folders) || [];
  const empty = !!info.empty;
  const parentLabel = info.parent_name || "(root / unfiled)";
  const html = `<div class="tr-mh"><b>Delete folder “${rqEsc(info.name)}”?</b><button class="tr-x">✕</button></div>
    <p class="muted" style="margin:0 0 10px">Contains ${info.requirement_count || 0} requirement(s) and ${info.subfolder_count || 0} subfolder(s)${info.descendant_requirement_count ? ` · ${info.descendant_requirement_count} in subfolders` : ""}.</p>
    <div class="muted" style="font-size:11px;font-weight:600;margin-bottom:6px">WHAT SHOULD HAPPEN TO CONTENTS?</div>
    <label class="rq-choice on" id="rqFdParent"><input type="radio" name="rqFdMode" value="parent" ${empty ? "" : "checked"}>
      Move to parent “${rqEsc(parentLabel)}”
      <div class="muted" style="font-size:11px;margin-top:2px">Recommended · requirements stay visible, subfolders are reparented (not deleted)</div></label>
    <label class="rq-choice" id="rqFdOther"><input type="radio" name="rqFdMode" value="other">
      Move to another folder…
      <select id="rqFdDest" style="width:100%;margin-top:6px" disabled>${rqFolderOptions(folders, info.parent_id || "", { exclude: fid })}</select></label>
    <label class="rq-choice ${empty ? "" : "muted"}" id="rqFdEmpty" style="${empty ? "" : "opacity:.65"}">
      <input type="radio" name="rqFdMode" value="empty" ${empty ? "checked" : "disabled"}>
      Delete only if empty ${empty ? "" : "— disabled because this folder is not empty"}</label>
    <p class="muted" style="font-size:12px">Subfolders are never dropped with the parent. Empty folders can be removed outright.</p>
    <div class="tr-mf"><button class="btn g" id="rqFdCancel">Cancel</button>
      <button class="btn r" id="rqFdGo">Delete folder</button></div>`;
  const ov = (typeof trModal === "function") ? trModal(html, 560) : rqModal(html, 560);
  const close = () => (typeof trClose === "function" ? trClose() : ov.remove());
  const mark = () => {
    ov.querySelectorAll(".rq-choice").forEach((c) => c.classList.toggle("on", c.querySelector("input[type=radio]").checked));
    const dest = $("#rqFdDest"); if (dest) dest.disabled = !ov.querySelector("input[name=rqFdMode][value=other]").checked;
  };
  ov.querySelectorAll("input[name=rqFdMode]").forEach((r) => r.onchange = mark);
  mark();
  $("#rqFdCancel").onclick = close;
  $("#rqFdGo").onclick = () => guarded($("#rqFdGo"), async () => {
    const mode = (ov.querySelector("input[name=rqFdMode]:checked") || {}).value;
    let url = "/api/requirements/folders/" + encodeURIComponent(fid);
    if (mode === "empty") {
      if (!empty) { toast("Folder is not empty.", true); return; }
    } else if (mode === "parent") {
      url += "?to_parent=true";
    } else {
      const dest = $("#rqFdDest").value;
      url += "?move_to=" + encodeURIComponent(dest || "__root__");
    }
    await api(url, { method: "DELETE" });
    toast("Folder deleted");
    if (RQ.folder === fid) RQ.folder = info.parent_id || "";
    close();
    rqReloadList();
  });
}

function rqRenderTable(rows) {
  const el = $("#rqMain"); if (!el) return;
  const ids = new Set(rows.map((r) => r.id));
  RQ.sel = new Set([...RQ.sel].filter((id) => ids.has(id)));
  const folderName = RQ.folder && (RQ.data.folders || []).find((f) => f.id === RQ.folder);
  const allOn = rows.length && rows.every((r) => RQ.sel.has(r.id));
  const some = rows.some((r) => RQ.sel.has(r.id));
  el.innerHTML = `<div class="rq-main-h">
      <div><b>${rqEsc(folderName ? folderName.name : "All requirements")}</b>
        <span class="muted">${rows.length} shown${RQ.data && RQ.data.total && RQ.folder ? " of " + RQ.data.total + " in project" : ""}</span></div>
      <input id="rqSearch" placeholder="Search requirements…" value="${rqEsc(RQ.q)}" style="width:220px">
    </div>
    <div class="rq-bulk" id="rqBulk" ${RQ.sel.size ? "" : "hidden"}></div>
    <div class="rq-filters">
      <select id="rqFType"><option value="">All types</option>${["Story","Epic","Feature"].map((t)=>`<option ${RQ.type===t?"selected":""}>${t}</option>`).join("")}</select>
      <select id="rqFPrio"><option value="">Priority ▾</option>${["High","Medium","Low"].map((t)=>`<option ${RQ.priority===t?"selected":""}>${t}</option>`).join("")}</select>
      <select id="rqFSt"><option value="">Status ▾</option>${["Draft","Ready","Approved"].map((t)=>`<option ${RQ.status===t?"selected":""}>${t}</option>`).join("")}</select>
    </div>
    <div class="rq-table-wrap"><table class="rq-table">
      <thead><tr>
        <th class="rq-cb"><input type="checkbox" id="rqSelAll" ${allOn ? "checked" : ""} ${some && !allOn ? "data-indeterminate=1" : ""} title="Select all"></th>
        <th>ID</th><th>Title</th><th>Type</th><th>Source</th><th>Pri</th><th>Status</th><th>TCs</th><th>Coverage</th><th>Last cycle</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows.map((r) => {
        const pct = r.coverage_pct || 0;
        const col = pct >= 75 ? "#12a150" : pct >= 40 ? "#d97706" : "#d33333";
        const last = r.last_result || "—";
        const lcol = last === "Pass" ? "#12a150" : last === "Fail" || last === "Gap" ? "#d33333" : "#6b7385";
        const on = RQ.sel.has(r.id);
        return `<tr data-rid="${rqEsc(r.id)}" class="rq-row${on ? " sel" : ""}">
          <td class="rq-cb"><input type="checkbox" data-sel="${rqEsc(r.id)}" ${on ? "checked" : ""}></td>
          <td class="rq-id">${rqEsc(r.id)}</td>
          <td>${rqEsc(r.title)}${r.jira_key ? `<div class="muted" style="font-size:11px">${rqEsc(r.jira_key)}</div>` : ""}</td>
          <td>${rqEsc(r.type)}</td><td>${rqEsc(r.source)}</td>
          <td><span class="pill ${RQ_PRIO(r.priority)}">${rqEsc(r.priority)}</span></td>
          <td><span class="pill ${RQ_ST[r.status] || ""}">${rqEsc(r.status)}</span></td>
          <td>${r.linked || 0}</td>
          <td><div class="rq-cov"><span style="color:${col};font-weight:600">${pct}%</span>
            <div class="rq-bar"><i style="width:${pct}%;background:${col}"></i></div></div></td>
          <td style="color:${lcol};font-weight:600">${rqEsc(last)}</td>
          <td class="rq-acts">
            <button type="button" class="btn g sm" data-act="edit" data-rid="${rqEsc(r.id)}">Edit</button>
            <button type="button" class="btn g sm" data-act="dup" data-rid="${rqEsc(r.id)}">Dup</button>
            <button type="button" class="btn g sm dg" data-act="del" data-rid="${rqEsc(r.id)}">Del</button>
          </td>
        </tr>`;
      }).join("") || `<tr><td colspan="11" class="muted">No requirements yet. Create one or Import from Jira.</td></tr>`}
      </tbody></table></div>
    <div class="rq-compat">Compatibility: cases keep their story key; use Auto-link / Import with auto-link to match <code>case.story</code> to a requirement Jira key. Row click opens detail · Edit / Duplicate / Delete stay available here.</div>`;
  const selAll = $("#rqSelAll");
  if (selAll && some && !allOn) selAll.indeterminate = true;
  if (selAll) selAll.onchange = () => {
    if (selAll.checked) rows.forEach((r) => RQ.sel.add(r.id));
    else RQ.sel.clear();
    rqRenderTable(rows);
  };
  el.querySelectorAll("input[data-sel]").forEach((cb) => cb.onchange = (e) => {
    e.stopPropagation();
    if (cb.checked) RQ.sel.add(cb.dataset.sel); else RQ.sel.delete(cb.dataset.sel);
    rqRenderTable(rows);
  });
  el.querySelectorAll(".rq-row").forEach((tr) => tr.onclick = (e) => {
    if (e.target.closest("input,button,a,.rq-acts,.rq-cb")) return;
    rqOpenDetail(tr.dataset.rid);
  });
  el.querySelectorAll("button[data-act]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const id = b.dataset.rid, act = b.dataset.act;
    if (act === "edit") rqOpenReqDrawer({ mode: "edit", id });
    else if (act === "dup") rqDuplicate(id);
    else if (act === "del") rqDeleteReqDialog(id);
  });
  rqRenderBulkBar();
  const search = $("#rqSearch");
  let timer; search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { RQ.q = search.value; rqReloadList(); }, 250); };
  $("#rqFType").onchange = (e) => { RQ.type = e.target.value; rqReloadList(); };
  $("#rqFPrio").onchange = (e) => { RQ.priority = e.target.value; rqReloadList(); };
  $("#rqFSt").onchange = (e) => { RQ.status = e.target.value; rqReloadList(); };
}

function rqRenderBulkBar() {
  const bar = $("#rqBulk"); if (!bar) return;
  const n = RQ.sel.size;
  bar.hidden = n === 0;
  if (!n) return;
  bar.innerHTML = `<span class="rq-bulk-n">${n} selected</span>
    <button type="button" class="btn g sm" id="rqBulkMove">Move to folder</button>
    <button type="button" class="btn g sm" id="rqBulkStatus">Change status</button>
    <button type="button" class="btn g sm dg" id="rqBulkArch">Archive…</button>
    <button type="button" class="btn g sm" id="rqBulkClear">Clear</button>`;
  $("#rqBulkMove").onclick = () => rqBulkMove();
  $("#rqBulkStatus").onclick = () => rqBulkStatus();
  $("#rqBulkArch").onclick = () => rqBulkArchive();
  $("#rqBulkClear").onclick = () => { RQ.sel = new Set(); rqReloadList(); };
}

function rqBulkIds() { return [...RQ.sel]; }

function rqBulkMove() {
  const folders = (RQ.data && RQ.data.folders) || [];
  const html = `<div class="tr-mh"><b>Move ${RQ.sel.size} requirement(s)</b><button class="tr-x">✕</button></div>
    <label>Destination folder</label>
    <select id="rqBmFolder" style="width:100%">${rqFolderOptions(folders, RQ.folder || "")}</select>
    <div class="tr-mf"><button class="btn g" id="rqBmCancel">Cancel</button><button class="btn" id="rqBmGo">Move</button></div>`;
  const ov = (typeof trModal === "function") ? trModal(html, 480) : rqModal(html, 480);
  const close = () => (typeof trClose === "function" ? trClose() : ov.remove());
  $("#rqBmCancel").onclick = close;
  $("#rqBmGo").onclick = () => guarded($("#rqBmGo"), async () => {
    const j = await api("/api/requirements/bulk", { method: "POST", body: { ids: rqBulkIds(), op: "move", folder_id: $("#rqBmFolder").value } });
    toast(`Moved ${j.count}`); close(); RQ.sel = new Set(); rqReloadList();
  });
}

function rqBulkStatus() {
  const html = `<div class="tr-mh"><b>Change status · ${RQ.sel.size} selected</b><button class="tr-x">✕</button></div>
    <label>New status</label>
    <select id="rqBsSt" style="width:100%">${["Draft","Ready","Approved"].map((s) => `<option>${s}</option>`).join("")}</select>
    <p class="muted" style="font-size:12px">Use Archive… to archive. This does not permanently delete.</p>
    <div class="tr-mf"><button class="btn g" id="rqBsCancel">Cancel</button><button class="btn" id="rqBsGo">Update status</button></div>`;
  const ov = (typeof trModal === "function") ? trModal(html, 440) : rqModal(html, 440);
  const close = () => (typeof trClose === "function" ? trClose() : ov.remove());
  $("#rqBsCancel").onclick = close;
  $("#rqBsGo").onclick = () => guarded($("#rqBsGo"), async () => {
    const j = await api("/api/requirements/bulk", { method: "POST", body: { ids: rqBulkIds(), op: "status", status: $("#rqBsSt").value } });
    toast(`Updated ${j.count}`); close(); RQ.sel = new Set(); rqReloadList();
  });
}

function rqBulkArchive() {
  const n = RQ.sel.size;
  const html = `<div class="tr-mh"><b>Archive ${n} requirement(s)?</b><button class="tr-x">✕</button></div>
    <p>Archived requirements are hidden from the default list. Linked test cases and cycle results are kept.</p>
    <div class="tr-mf"><button class="btn g" id="rqBaCancel">Cancel</button><button class="btn r" id="rqBaGo">Archive</button></div>`;
  const ov = (typeof trModal === "function") ? trModal(html, 480) : rqModal(html, 480);
  const close = () => (typeof trClose === "function" ? trClose() : ov.remove());
  $("#rqBaCancel").onclick = close;
  $("#rqBaGo").onclick = () => guarded($("#rqBaGo"), async () => {
    const j = await api("/api/requirements/bulk", { method: "POST", body: { ids: rqBulkIds(), op: "archive" } });
    toast(`Archived ${j.count}`); close(); RQ.sel = new Set(); rqReloadList();
  });
}

async function rqOpenDetail(rid) {
  try {
    const j = await api("/api/requirements/" + encodeURIComponent(rid));
    RQ.detail = j.requirement; RQ.view = "detail"; RQ.tab = "cases";
    viewRequirementDetail($("#view"), RQ.detail);
  } catch (e) { toast(e.message, true); }
}

async function viewRequirementDetail(v, r) {
  await rqEnsureSwitcher();
  const p = rqProject();
  const editing = !!RQ.editing;
  const lastBy = r.updated_by || ((r.activity || []).find((a) => a.by) || {}).by || "";
  if (editing && !(RQ.data && RQ.data.folders) && RQ.projectId) {
    try { RQ.data = await api("/api/requirements?" + new URLSearchParams({ project_id: RQ.projectId }).toString()); }
    catch (e) { /* folder picker can stay empty */ }
  }
  const folders = (RQ.data && RQ.data.folders) || [];
  const leftView = `<div class="card">
          <h3>Description</h3>
          <p>${rqEsc(r.description || "(none)").replace(/\n/g, "<br>")}</p>
          <h3>Acceptance criteria</h3>
          <ul>${(r.acs || []).map((a) => `<li>${rqEsc(a)}</li>`).join("") || "<li class='muted'>(none)</li>"}</ul>
          <div class="muted" style="font-size:11px;margin-top:12px">Source: ${rqEsc(r.source)}${r.jira_key ? " " + rqEsc(r.jira_key) : ""} · Updated ${rqEsc(rqDateTime(r.updated))}${lastBy ? " by " + rqEsc(lastBy) : ""}</div>
        </div>`;
  const leftEdit = `<div class="card" id="rqEditForm">
          <h3>Edit requirement</h3>
          <p class="muted" style="margin-top:0">Same fields as New · values prefilled from ${rqEsc(r.id)}</p>
          ${rqFormHtml(r, folders)}
        </div>`;
  v.innerHTML = `<div class="rq-back"><a href="#requirements" id="rqBack">← Requirements</a></div>
    <div class="rq-main-h" style="align-items:flex-start">
      <div>
        <h1 style="margin-bottom:6px">${rqEsc(r.id)} · ${rqEsc(r.title)}</h1>
        <div class="rq-meta">
          <span class="pill b">${rqEsc(r.type)}</span>
          <span class="pill ${RQ_PRIO(r.priority)}">${rqEsc(r.priority)}</span>
          <span class="pill ${RQ_ST[r.status] || ""}">${rqEsc(r.status)}</span>
          ${editing ? `<span class="pill rq-edit-pill">Editing</span>` : ""}
          ${r.jira_key ? `<span class="pill gr">Jira ${rqEsc(r.jira_key)}</span>` : ""}
          <span class="muted">Project ${rqEsc(p ? p.key : "")}${r.folder_path ? " · " + rqEsc(r.folder_path) : ""}</span>
        </div>
      </div>
      <div class="rq-toolbar" style="margin:0">
        <button class="btn g" id="rqEditBtn">${editing ? "Editing…" : "Edit"}</button>
        <button class="btn g" id="rqDupBtn">Duplicate</button>
        <button class="btn g dg" id="rqDelBtn">Delete…</button>
        <button class="btn g" id="rqLinkBtn">🔗 Link test cases</button>
        <button class="btn" id="rqGenBtn">✨ Generate with AI</button>
      </div>
    </div>
    <div class="rq-detail">
      <div class="rq-left">
        ${editing ? leftEdit : leftView}
        <div class="card" style="margin-top:12px">
          <h3>Coverage snapshot</h3>
          <div class="rq-snap">
            <div><div class="muted">Linked TCs</div><b style="color:#4361ee">${r.linked || 0}</b></div>
            <div><div class="muted">Coverage</div><b style="color:#12a150">${r.coverage_pct || 0}%</b></div>
            <div><div class="muted">Last result</div><b>${rqEsc(r.last_result || "—")}</b></div>
          </div>
          ${editing ? `<p class="muted" style="font-size:11px;margin:10px 0 0">Unlink / Generate remain on the cases tab after Save.</p>` : ""}
        </div>
      </div>
      <div class="rq-right card">
        <div class="rq-tabs">
          <button data-tab="cases" class="${RQ.tab==="cases"?"on":""}">Linked test cases</button>
          <button data-tab="cycles" class="${RQ.tab==="cycles"?"on":""}">Test cycles</button>
          <button data-tab="activity" class="${RQ.tab==="activity"?"on":""}">Activity</button>
        </div>
        <div id="rqTabBody"></div>
      </div>
    </div>
    ${editing ? `<div class="rq-unsaved" id="rqUnsaved">
      <div><b>● Unsaved changes</b>
        <div class="muted" style="font-size:12px">Last saved ${rqEsc(rqDateTime(r.updated))}${lastBy ? " by " + rqEsc(lastBy) : ""}</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="as-ind" data-as="requirements" hidden></span>
        <button class="btn g" id="rqEditDiscard">Discard</button>
        <button class="btn" id="rqEditSave">Save changes</button>
      </div>
    </div>` : ""}`;
  $("#rqBack").onclick = async (e) => {
    e.preventDefault();
    if (typeof autosaveFlush === "function" && typeof autosaveHasPending === "function" && autosaveHasPending()) {
      const rflush = await autosaveFlush({ reason: "navigate" });
      if (rflush === "cancel") return;
    }
    if (RQ.editing && rqFormDirty($("#rqEditForm"), RQ.editSnap) && !confirm("You have unsaved changes. Leave without saving?")) return;
    RQ.view = "list"; RQ.detail = null; RQ.editing = false; RQ.editSnap = ""; go("requirements");
  };
  $("#rqGenBtn").onclick = () => rqGenerateAI(r.id);
  $("#rqLinkBtn").onclick = () => rqLinkModal(r);
  $("#rqDupBtn").onclick = () => rqDuplicate(r.id, { open: true });
  $("#rqDelBtn").onclick = () => rqDeleteReqDialog(r.id, { fromDetail: true });
  $("#rqEditBtn").onclick = () => {
    if (RQ.editing) return;
    RQ.editing = true;
    viewRequirementDetail($("#view"), r);
  };
  if (editing) {
    $("#rqEditBtn").disabled = true;
    rqBindForm($("#rqEditForm"), r);
    RQ.editSnap = rqFormSnapshot($("#rqEditForm"));
    rqBindAutosave($("#rqEditForm"), {
      getId: () => r.id,
      setId: () => {},
      getSnap: () => RQ.editSnap,
      setSnap: (s) => { RQ.editSnap = s; },
      getBefore: () => (r.linked_cases || []).map((c) => c.id),
      after: async (id) => {
        const fresh = await api("/api/requirements/" + encodeURIComponent(id));
        RQ.detail = fresh.requirement;
        r = fresh.requirement;
        const last = document.querySelector("#rqUnsaved .muted");
        if (last) last.textContent = "Last saved " + rqDateTime(r.updated);
      },
    });
    $("#rqEditDiscard").onclick = () => {
      if (rqFormDirty($("#rqEditForm"), RQ.editSnap) && !confirm("Discard unsaved changes?")) return;
      RQ.editing = false; RQ.editSnap = ""; viewRequirementDetail($("#view"), r);
    };
    $("#rqEditSave").onclick = () => guarded($("#rqEditSave"), async () => {
      const body = rqReadForm($("#rqEditForm"));
      if (!rqValidateForm($("#rqEditForm"), body)) return;
      const j = await api("/api/requirements/" + encodeURIComponent(r.id), { method: "PUT", body });
      await rqSyncLinks(r.id, (r.linked_cases || []).map((c) => c.id), body.case_ids);
      const fresh = await api("/api/requirements/" + encodeURIComponent(r.id));
      RQ.detail = fresh.requirement; RQ.editing = false; RQ.editSnap = "";
      toast("Saved " + r.id);
      viewRequirementDetail($("#view"), RQ.detail);
    });
  }
  v.querySelectorAll(".rq-tabs button").forEach((b) => b.onclick = () => { RQ.tab = b.dataset.tab; rqRenderTab(r); });
  rqRenderTab(r);
}

function rqRenderTab(r) {
  const el = $("#rqTabBody"); if (!el) return;
  if (RQ.tab === "cycles") {
    el.innerHTML = (r.cycles || []).map((c) =>
      `<div class="rq-cyc"><b>${rqEsc(c.id)}</b> · ${rqEsc(c.name)}
        <span class="muted">Pass ${c.counts.Pass || 0} · Fail ${c.counts.Fail || 0} · Not run ${c.counts["Not run"] || 0}</span></div>`
    ).join("") || `<div class="muted">No cycles contain these cases yet.</div>`;
    return;
  }
  if (RQ.tab === "activity") {
    el.innerHTML = (r.activity || []).map((a) =>
      `<div class="rq-act"><span class="muted">${rqEsc(rqDateTime(a.ts))}</span>
        ${a.by ? `<span class="rq-by">${rqEsc(a.by)}</span> · ` : ""}<b>${rqEsc(a.type)}</b> ${rqEsc(a.text || "")}</div>`
    ).join("") || `<div class="muted">No activity yet.</div>`;
    return;
  }
  const rows = r.linked_cases || [];
  el.innerHTML = `<div class="rq-tab-h"><span>${rows.length} linked · unlink keeps the TC in Repo</span>
      <button class="btn g sm" id="rqAutoLink">Auto-link by story key</button></div>
    <table class="rq-table"><thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Pri</th><th>Last result</th><th>Cycle</th><th></th></tr></thead>
    <tbody>${rows.map((c) => `<tr>
      <td class="rq-id">${rqEsc(c.id)}</td><td>${rqEsc(c.title)}</td>
      <td>${rqEsc(c.status)}</td><td>${rqEsc(c.priority)}</td>
      <td>${rqEsc(c.last_result || "—")}</td><td class="muted">${rqEsc(c.cycle_id || "—")}</td>
      <td><button class="btn g sm rq-un" data-cid="${rqEsc(c.id)}">Unlink</button></td>
    </tr>`).join("") || `<tr><td colspan="7" class="muted">No linked cases. Link existing or Generate with AI.</td></tr>`}</tbody></table>
    <div class="rq-gen-note card">
      <b>Generate test cases with AI for this requirement</b>
      <p class="muted">Uses the existing Generate pipeline with this requirement’s description + ACs. New TCs should use story key ${rqEsc(r.jira_key || "(none)")}.</p>
      <button class="btn sm" id="rqGen2">✨ Generate…</button>
    </div>`;
  el.querySelectorAll(".rq-un").forEach((b) => b.onclick = () => guarded(b, async () => {
    const j = await api(`/api/requirements/${encodeURIComponent(r.id)}/links/${encodeURIComponent(b.dataset.cid)}`, { method: "DELETE" });
    RQ.detail = j.requirement; toast("Unlinked"); viewRequirementDetail($("#view"), RQ.detail);
  }));
  const al = $("#rqAutoLink"); if (al) al.onclick = () => guarded(al, async () => {
    const j = await api(`/api/requirements/${encodeURIComponent(r.id)}/auto-link`, { method: "POST", body: {} });
    RQ.detail = j.requirement; toast(`Auto-linked ${j.linked.length} case(s)`); viewRequirementDetail($("#view"), RQ.detail);
  });
  const g2 = $("#rqGen2"); if (g2) g2.onclick = () => rqGenerateAI(r.id);
}

async function rqGenerateAI(rid) {
  try {
    const j = await api("/api/requirements/generate-context/" + encodeURIComponent(rid));
    // Prefill existing Generate flow via local input APIs
    await api("/api/input/local", { method: "POST", body: { text: j.feature_text, story_id: j.story_id || "", filename: "" } });
    toast("Requirement loaded into Generate · story " + (j.story_id || "(none)"));
    S.inputMode = "local";
    go("generate");
  } catch (e) { toast(e.message, true); }
}

function rqNewReqModal() { rqOpenReqDrawer({ mode: "new" }); }

function rqCloseDrawer({ force } = {}) {
  const root = $("#rqDrw");
  if (!force && typeof autosaveHasPending === "function" && autosaveHasPending()) {
    if (typeof autosaveFlush === "function") autosaveFlush({ reason: "navigate" });
  }
  if (!force && root && rqFormDirty(root, RQ._drawerSnap) && !confirm("You have unsaved changes. Close without saving?")) return false;
  ["rqDrw", "rqDbg"].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
  document.body.style.overflow = "";
  RQ._drawerSnap = "";
  if (RQ._drawerEsc) { document.removeEventListener("keydown", RQ._drawerEsc); RQ._drawerEsc = null; }
  return true;
}

async function rqOpenReqDrawer({ mode, id } = {}) {
  rqCloseDrawer({ force: true });
  let r = { folder_id: RQ.folder || "", type: "Story", priority: "Medium", status: "Draft", acs: [""], linked_cases: [] };
  if (mode === "edit" && id) {
    try {
      const j = await api("/api/requirements/" + encodeURIComponent(id));
      r = j.requirement;
    } catch (e) { toast(e.message, true); return; }
  }
  if (!RQ.data || !RQ.data.folders) {
    try {
      const params = new URLSearchParams({ project_id: RQ.projectId });
      RQ.data = await api("/api/requirements?" + params.toString());
    } catch (e) { /* folder list may already be loaded */ }
  }
  const folders = (RQ.data && RQ.data.folders) || [];
  const p = rqProject();
  let isNew = mode !== "edit";
  document.body.style.overflow = "hidden";
  const dbg = document.createElement("div"); dbg.className = "rq-dbg"; dbg.id = "rqDbg";
  const drw = document.createElement("div"); drw.className = "rq-drw"; drw.id = "rqDrw";
  drw.innerHTML = `<div class="rq-drw-h">
      <div>
        <h2>${isNew ? "New requirement" : "Edit " + rqEsc(r.id)}</h2>
        <div class="muted" style="font-size:12px;margin-top:4px">Project ${rqEsc(p ? p.key : "")}${isNew ? " · will be created as REQ-####" : " · same fields as New"}</div>
      </div>
      <button type="button" class="btn g sm" id="rqDrwX" title="Close">✕</button>
    </div>
    <div class="rq-drw-b">${rqFormHtml(r, folders, { isNew })}</div>
    <div class="rq-drw-f">
      <span class="as-ind" data-as="requirements" hidden></span>
      <button type="button" class="btn g" id="rqDrwCancel">Cancel</button>
      ${isNew ? `<button type="button" class="btn g" id="rqDrwAnother">Save &amp; add another</button>` : ""}
      <button type="button" class="btn" id="rqDrwSave">${isNew ? "Save" : "Save changes"}</button>
    </div>`;
  document.body.appendChild(dbg);
  document.body.appendChild(drw);
  const close = () => rqCloseDrawer();
  dbg.addEventListener("mousedown", (e) => { if (e.target === dbg) close(); });
  $("#rqDrwX").onclick = close;
  $("#rqDrwCancel").onclick = close;
  rqBindForm(drw, r);
  RQ._drawerSnap = rqFormSnapshot(drw);
  RQ._drawerId = isNew ? "" : r.id;
  rqBindAutosave(drw, {
    getId: () => RQ._drawerId,
    setId: (id, rec) => { RQ._drawerId = id; r = rec || r; r.id = id; isNew = false; const h = drw.querySelector(".rq-drw-h h2"); if (h) h.textContent = "Edit " + id; },
    getSnap: () => RQ._drawerSnap,
    setSnap: (s) => { RQ._drawerSnap = s; },
    getBefore: () => (r.linked_cases || []).map((c) => c.id),
    source: r.source,
  });
  const save = async (addAnother) => {
    const body = rqReadForm(drw);
    if (!rqValidateForm(drw, body)) return false;
    body.project_id = RQ.projectId;
    body.source = (body.jira_key || "").trim() ? (r.source || "Jira") : (isNew ? "Manual" : (r.source || "Manual"));
    if (isNew) {
      const j = await api("/api/requirements", { method: "POST", body });
      const extra = (j.auto_linked && j.auto_linked.length) ? ` · linked ${j.auto_linked.length}` : "";
      toast(`Created ${j.requirement.id}` + extra);
      if (addAnother) {
        const keep = { folder_id: body.folder_id, type: body.type, priority: body.priority, status: body.status, acs: [""], linked_cases: [], title: "", description: "", jira_key: "" };
        drw.querySelector(".rq-drw-b").innerHTML = rqFormHtml(keep, folders, { isNew: true });
        rqBindForm(drw, keep);
        RQ._drawerSnap = rqFormSnapshot(drw);
        const title = drw.querySelector("[data-f=title]"); if (title) title.focus();
        return true;
      }
      rqCloseDrawer({ force: true });
      RQ.detail = j.requirement; RQ.view = "detail"; RQ.editing = false;
      viewRequirementDetail($("#view"), RQ.detail);
      return true;
    }
    await api("/api/requirements/" + encodeURIComponent(r.id), { method: "PUT", body });
    await rqSyncLinks(r.id, (r.linked_cases || []).map((c) => c.id), body.case_ids);
    toast("Saved " + r.id);
    rqCloseDrawer({ force: true });
    if (RQ.view === "detail" && RQ.detail && RQ.detail.id === r.id) {
      const fresh = await api("/api/requirements/" + encodeURIComponent(r.id));
      RQ.detail = fresh.requirement; RQ.editing = false;
      viewRequirementDetail($("#view"), RQ.detail);
    } else {
      rqReloadList();
    }
    return true;
  };
  $("#rqDrwSave").onclick = () => guarded($("#rqDrwSave"), () => save(false));
  const another = $("#rqDrwAnother");
  if (another) another.onclick = () => guarded(another, () => save(true));
  if (RQ._drawerEsc) document.removeEventListener("keydown", RQ._drawerEsc);
  RQ._drawerEsc = (e) => {
    if (e.key !== "Escape" || !$("#rqDrw")) return;
    e.preventDefault();
    if (rqCloseDrawer()) { document.removeEventListener("keydown", RQ._drawerEsc); RQ._drawerEsc = null; }
  };
  document.addEventListener("keydown", RQ._drawerEsc);
  setTimeout(() => { const i = drw.querySelector("[data-f=title]"); if (i) i.focus(); }, 30);
}

function rqFormHtml(r, folders, { isNew } = {}) {
  r = r || {};
  const acs = (r.acs && r.acs.length) ? r.acs : [""];
  const chips = r.linked_cases || [];
  return `<div class="rq-form">
    <section class="rq-sec">
      <h3>1 · Basics</h3>
      <div class="rq-field">
        <label class="rq-lbl">TITLE <span style="color:#d33333">*</span></label>
        <input type="text" data-f="title" value="${rqEsc(r.title || "")}" placeholder="Requirement title" maxlength="300">
        <div class="rq-err" data-err="title" hidden></div>
      </div>
      <div class="rq-grid3">
        <div class="rq-field"><label class="rq-lbl">TYPE</label>
          <select data-f="type">${["Story","Epic","Feature"].map((t) => `<option ${(r.type || "Story") === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="rq-field"><label class="rq-lbl">PRIORITY</label>
          <select data-f="priority">${["High","Medium","Low"].map((t) => `<option ${(r.priority || "Medium") === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="rq-field"><label class="rq-lbl">STATUS</label>
          <select data-f="status">${["Draft","Ready","Approved"].map((t) => `<option ${(r.status || "Draft") === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      </div>
      <div class="rq-grid2">
        <div class="rq-field"><label class="rq-lbl">FOLDER</label>
          <select data-f="folder_id">${rqFolderOptions(folders, r.folder_id || RQ.folder || "")}</select></div>
        <div class="rq-field"><label class="rq-lbl">JIRA KEY <span style="font-weight:500">(optional · 1:1)</span></label>
          <input type="text" data-f="jira_key" value="${rqEsc(r.jira_key || "")}" placeholder="EXPO-33" maxlength="40">
          <div class="rq-hint">Must be unique in this project if set</div>
          <div class="rq-err" data-err="jira_key" hidden></div></div>
      </div>
    </section>
    <section class="rq-sec">
      <h3>2 · Description</h3>
      <div class="muted" style="font-size:11px;margin-bottom:6px">B · I · List · Link &nbsp; plain textarea for now</div>
      <textarea data-f="description" rows="5" placeholder="As a … I want … so that …">${rqEsc(r.description || "")}</textarea>
    </section>
    <section class="rq-sec">
      <h3>3 · Acceptance criteria</h3>
      <div data-acs>${acs.map((a, i) => rqAcRowHtml(a, i)).join("")}</div>
      <button type="button" class="btn g sm" data-ac-add style="margin-top:6px">+ Add criterion</button>
    </section>
    <section class="rq-sec">
      <h3>4 · Linked test cases (optional)</h3>
      <div class="rq-field" style="position:relative">
        <input type="text" data-tc-q placeholder="Search Test Case Repo… e.g. TC-0001 or title" autocomplete="off">
        <div class="rq-suggest" data-tc-sug hidden></div>
      </div>
      <div class="rq-chips" data-tc-chips>${chips.map((c) => rqChipHtml(c.id, c.title)).join("")}</div>
      <div class="rq-hint">Search existing repo cases. Unlink keeps cases in Repo.${isNew ? " You can also auto-link later by Jira key." : ""}</div>
      ${isNew ? `<label style="margin-top:8px;display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" data-f="auto_link"> Auto-link test cases where story matches Jira key</label>` : ""}
    </section>
    <div class="rq-ok" data-ok hidden></div>
  </div>`;
}

function rqAcRowHtml(text, i) {
  return `<div class="rq-ac-row" data-ac>
    <span class="rq-ac-h" title="Reorder">⋮⋮</span>
    <button type="button" class="rq-ac-move" data-ac-up title="Move up">▲</button>
    <button type="button" class="rq-ac-move" data-ac-dn title="Move down">▼</button>
    <input type="text" data-ac-text value="${rqEsc(text || "")}" placeholder="AC${i + 1} · e.g. Redirect to IdP when clicking Sign in">
    <button type="button" class="rq-ac-del" data-ac-del title="Remove">✕</button>
  </div>`;
}

function rqChipHtml(id, title) {
  return `<span class="rq-chip" data-cid="${rqEsc(id)}">${rqEsc(id)}${title && title !== id ? " · " + rqEsc(title) : ""} <button type="button" data-chip-x title="Remove">×</button></span>`;
}

function rqAutosaveValid(root, body) {
  body = body || rqReadForm(root);
  if (!body.title) return false;
  const jk = (body.jira_key || "").trim();
  // Mid-typing a Jira key (ends with "-" or has a hyphen but no number) — wait.
  if (jk.includes("-") && !/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(jk)) return false;
  return true;
}
function rqIsDirty() {
  if ($("#rqEditForm") && RQ.editing && rqFormDirty($("#rqEditForm"), RQ.editSnap)) return true;
  if ($("#rqDrw") && rqFormDirty($("#rqDrw"), RQ._drawerSnap)) return true;
  return false;
}
function rqNavGuard() {
  if (rqIsDirty() && !confirm("You have unsaved changes on this requirement. Leave without saving?")) return false;
  return true;
}
window.rqIsDirty = rqIsDirty;
window.rqNavGuard = rqNavGuard;

async function rqDoAutosave(root, ctx) {
  ctx = ctx || {};
  const body = rqReadForm(root);
  if (!rqAutosaveValid(root, body)) return;
  if (ctx.snapKey && !rqFormDirty(root, ctx.getSnap())) return;
  body.project_id = RQ.projectId;
  let id = ctx.getId();
  if (!id) {
    body.source = (body.jira_key || "").trim() ? (ctx.source || "Jira") : (ctx.source || "Manual");
    const j = await api("/api/requirements", { method: "POST", body });
    id = j.requirement.id;
    ctx.setId(id, j.requirement);
    if (ctx.setSnap) ctx.setSnap(rqFormSnapshot(root));
    return;
  }
  await api("/api/requirements/" + encodeURIComponent(id), { method: "PUT", body });
  const before = ctx.getBefore ? ctx.getBefore() : [];
  await rqSyncLinks(id, before, body.case_ids);
  if (ctx.after) await ctx.after(id);
  if (ctx.setSnap) ctx.setSnap(rqFormSnapshot(root));
}

function rqBindAutosave(root, ctx) {
  if (!root) return;
  const kick = () => {
    if (typeof autosaveSchedule !== "function") return;
    autosaveSchedule("requirements", () => rqDoAutosave(root, ctx), { valid: () => rqAutosaveValid(root) && (!ctx.getSnap || rqFormDirty(root, ctx.getSnap())) });
  };
  root.addEventListener("input", kick);
  root.addEventListener("change", kick);
}

function rqBindForm(root, r) {
  if (!root) return;
  const acsHost = () => root.querySelector("[data-acs]");
  const refreshAc = () => {
    const add = root.querySelector("[data-ac-add]");
    if (add) add.onclick = () => {
      acsHost().insertAdjacentHTML("beforeend", rqAcRowHtml("", acsHost().querySelectorAll("[data-ac]").length));
      bindAc();
    };
    bindAc();
  };
  const bindAc = () => {
    acsHost().querySelectorAll("[data-ac]").forEach((row, i) => {
      const input = row.querySelector("[data-ac-text]");
      if (input && !input.placeholder) input.placeholder = "AC" + (i + 1);
      const up = row.querySelector("[data-ac-up]");
      const dn = row.querySelector("[data-ac-dn]");
      const del = row.querySelector("[data-ac-del]");
      if (up) up.onclick = () => { if (row.previousElementSibling) acsHost().insertBefore(row, row.previousElementSibling); };
      if (dn) dn.onclick = () => { if (row.nextElementSibling) acsHost().insertBefore(row.nextElementSibling, row); };
      if (del) del.onclick = () => {
        if (acsHost().querySelectorAll("[data-ac]").length <= 1) { input.value = ""; return; }
        row.remove();
      };
    });
  };
  refreshAc();

  const q = root.querySelector("[data-tc-q]");
  const sug = root.querySelector("[data-tc-sug]");
  const chips = root.querySelector("[data-tc-chips]");
  const selected = () => [...chips.querySelectorAll(".rq-chip")].map((c) => c.dataset.cid);
  const addChip = (id, title) => {
    if (selected().includes(id)) return;
    chips.insertAdjacentHTML("beforeend", rqChipHtml(id, title));
    bindChips();
  };
  const bindChips = () => {
    chips.querySelectorAll("[data-chip-x]").forEach((b) => b.onclick = () => b.closest(".rq-chip").remove());
  };
  bindChips();
  let timer;
  const runSearch = async () => {
    const term = (q.value || "").trim().toLowerCase();
    if (!term) { sug.hidden = true; sug.innerHTML = ""; return; }
    const cases = await rqLoadRepoCases();
    const have = new Set(selected());
    const hits = cases.filter((c) => !have.has(c.id) && (`${c.id} ${c.title || ""} ${c.story || ""}`).toLowerCase().includes(term)).slice(0, 12);
    if (!hits.length) { sug.hidden = false; sug.innerHTML = `<div class="muted" style="padding:8px 10px">No matching cases</div>`; return; }
    sug.hidden = false;
    sug.innerHTML = hits.map((c) => `<button type="button" data-pick="${rqEsc(c.id)}" data-title="${rqEsc(c.title || "")}"><b>${rqEsc(c.id)}</b> ${rqEsc(c.title || "")}${c.story ? ` <span class="muted">${rqEsc(c.story)}</span>` : ""}</button>`).join("");
    sug.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => {
      addChip(b.dataset.pick, b.dataset.title);
      q.value = ""; sug.hidden = true;
    });
  };
  if (q) {
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(runSearch, 180); };
    q.onfocus = () => { if (q.value.trim()) runSearch(); };
    q.onkeydown = (e) => { if (e.key === "Escape") { sug.hidden = true; } };
  }
  document.addEventListener("mousedown", function hideSug(e) {
    if (!root.isConnected) return document.removeEventListener("mousedown", hideSug);
    if (sug && !sug.contains(e.target) && e.target !== q) sug.hidden = true;
  });
}

async function rqLoadRepoCases() {
  if (RQ.repoCases) return RQ.repoCases;
  try {
    const j = await api("/api/repo");
    RQ.repoCases = (j.cases || []).filter((c) => c.status !== "Archived");
  } catch (e) {
    RQ.repoCases = [];
    toast("Could not load Test Case Repo for linking: " + e.message, true);
  }
  return RQ.repoCases;
}

function rqReadForm(root) {
  const g = (name) => {
    const el = root.querySelector(`[data-f="${name}"]`);
    if (!el) return "";
    if (el.type === "checkbox") return el.checked;
    return el.value;
  };
  const acs = [...root.querySelectorAll("[data-ac-text]")].map((i) => i.value.trim()).filter(Boolean);
  const case_ids = [...root.querySelectorAll(".rq-chip")].map((c) => c.dataset.cid);
  return {
    title: (g("title") || "").trim(),
    type: g("type") || "Story",
    priority: g("priority") || "Medium",
    status: g("status") || "Draft",
    folder_id: g("folder_id") || "",
    jira_key: (g("jira_key") || "").trim(),
    description: g("description") || "",
    acs,
    case_ids,
    auto_link: !!g("auto_link"),
  };
}

function rqFormSnapshot(root) { try { return JSON.stringify(rqReadForm(root)); } catch (e) { return ""; } }
function rqFormDirty(root, snap) { if (!root || !snap) return false; return rqFormSnapshot(root) !== snap; }

function rqValidateForm(root, body) {
  body = body || rqReadForm(root);
  let ok = true;
  const show = (name, msg) => {
    const el = root.querySelector(`[data-err="${name}"]`);
    if (el) { el.hidden = !msg; el.textContent = msg || ""; }
    const field = root.querySelector(`[data-f="${name}"]`);
    if (field) field.style.borderColor = msg ? "#d33333" : "";
  };
  if (!body.title) { show("title", "Title is required."); ok = false; const t = root.querySelector("[data-f=title]"); if (t) t.focus(); }
  else show("title", "");
  const jk = (body.jira_key || "").trim();
  if (jk && !/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(jk) && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(jk)) {
    show("jira_key", "Use a short key such as EXPO-33.");
  } else show("jira_key", "");
  const banner = root.querySelector("[data-ok]");
  if (banner) {
    banner.hidden = !ok;
    if (ok) banner.textContent = "Ready to save · Title and project are set";
  }
  return ok;
}

async function rqSyncLinks(rid, before, after) {
  const prev = new Set(before || []);
  const next = new Set(after || []);
  const add = [...next].filter((id) => !prev.has(id));
  const rem = [...prev].filter((id) => !next.has(id));
  if (add.length) await api(`/api/requirements/${encodeURIComponent(rid)}/links`, { method: "POST", body: { case_ids: add } });
  for (const cid of rem) {
    await api(`/api/requirements/${encodeURIComponent(rid)}/links/${encodeURIComponent(cid)}`, { method: "DELETE" });
  }
}

async function rqDuplicate(id, { open } = {}) {
  try {
    const j = await api("/api/requirements/" + encodeURIComponent(id) + "/duplicate", { method: "POST", body: {} });
    toast(`Duplicated as ${j.requirement.id}`);
    if (open || (RQ.view === "detail")) {
      RQ.detail = j.requirement; RQ.view = "detail"; RQ.editing = false;
      viewRequirementDetail($("#view"), RQ.detail);
    } else {
      rqReloadList();
    }
  } catch (e) { toast(e.message, true); }
}

async function rqDeleteReqDialog(id, { fromDetail } = {}) {
  let info;
  try { info = await api("/api/requirements/" + encodeURIComponent(id) + "/delete-check"); }
  catch (e) { toast(e.message, true); return; }
  const canPerm = !!info.can_permanent_delete;
  const cycles = (info.cycles || []).map((c) => c.id + (c.name ? " · " + c.name : "")).join(", ");
  const html = canPerm
    ? `<div class="tr-mh"><b>Permanently delete ${rqEsc(id)}?</b><button class="tr-x">✕</button></div>
        <p class="muted" style="margin:0 0 8px">${rqEsc(info.title || "")} · ${rqEsc(info.status || "")}</p>
        <div class="rq-danger"><b>No linked test cases or executions (0 / 0)</b>
          <div>This cannot be undone. Type the ID to confirm.</div></div>
        <label>Confirm ID</label>
        <input id="rqDelConfirm" style="width:100%" placeholder="${rqEsc(id)}" autocomplete="off">
        <div class="rq-err" id="rqDelErr" hidden></div>
        <div class="tr-mf"><button class="btn g" id="rqDelCancel">Cancel</button>
          <button class="btn r" id="rqDelGo">Delete permanently</button></div>`
    : `<div class="tr-mh"><b>Archive ${rqEsc(id)}?</b><button class="tr-x">✕</button></div>
        <p class="muted" style="margin:0 0 8px">${rqEsc(info.title || "")}</p>
        <div class="rq-warn"><b>This requirement is in use</b>
          <ul style="margin:8px 0 0;padding-left:18px">
            <li>${info.linked_cases || 0} linked test case(s)${info.case_ids && info.case_ids.length ? " (" + rqEsc(info.case_ids.join(", ")) + ")" : ""}</li>
            <li>${info.executions || 0} execution(s)${info.cycle_count ? " in " + rqEsc(cycles || (info.cycle_count + " cycle(s)")) : ""}</li>
          </ul>
          <p style="margin:8px 0 0">Permanent delete is blocked. Archive hides it from the default list; cases and cycle results stay intact.</p>
        </div>
        <div class="tr-mf"><button class="btn g" id="rqDelCancel">Cancel</button>
          <button class="btn" id="rqDelGo" style="background:#d97706;border-color:#d97706;color:#fff">Archive requirement</button></div>`;
  const ov = (typeof trModal === "function") ? trModal(html, 560) : rqModal(html, 560);
  const close = () => (typeof trClose === "function" ? trClose() : ov.remove());
  $("#rqDelCancel").onclick = close;
  $("#rqDelGo").onclick = () => guarded($("#rqDelGo"), async () => {
    if (canPerm) {
      const typed = (($("#rqDelConfirm") && $("#rqDelConfirm").value) || "").trim().toUpperCase();
      if (typed !== String(id).toUpperCase()) {
        const err = $("#rqDelErr"); if (err) { err.hidden = false; err.textContent = "Type " + id + " to confirm permanent delete."; }
        return;
      }
      await api("/api/requirements/" + encodeURIComponent(id) + "?permanent=true", { method: "DELETE" });
      toast("Deleted " + id);
    } else {
      await api("/api/requirements/" + encodeURIComponent(id), { method: "DELETE" });
      toast("Archived " + id);
    }
    close();
    RQ.sel.delete(id);
    if (fromDetail || (RQ.view === "detail" && RQ.detail && RQ.detail.id === id)) {
      RQ.view = "list"; RQ.detail = null; RQ.editing = false; go("requirements");
    } else {
      rqReloadList();
    }
  });
}

function rqImportModal() {
  const html = `<div class="tr-mh"><b>Import from Jira</b><button class="tr-x">✕</button></div>
    <p class="muted">Paste Jira keys (one per line) or <code>KEY | Title</code>. Optionally fetch each key via the existing Jira helper (uses your Settings).</p>
    <textarea id="rqImpText" rows="8" style="width:100%" placeholder="EXPO-33&#10;EXPO-34 | Session timeout"></textarea>
    <label><input type="checkbox" id="rqImpFetch" checked> Fetch details from Jira for each key</label>
    <label><input type="checkbox" id="rqImpAuto" checked> Auto-link matching test cases (story = key)</label>
    <div class="tr-mf"><button class="btn g" id="rqImpCancel">Cancel</button><button class="btn" id="rqImpGo">Import</button></div>`;
  const ov = (typeof trModal === "function") ? trModal(html, 560) : rqModal(html, 560);
  $("#rqImpCancel").onclick = () => (typeof trClose === "function" ? trClose() : ov.remove());
  $("#rqImpGo").onclick = () => guarded($("#rqImpGo"), async () => {
    const j = await api("/api/requirements/import", {
      method: "POST",
      body: {
        project_id: RQ.projectId, folder_id: RQ.folder || "",
        text: $("#rqImpText").value,
        fetch_jira: $("#rqImpFetch").checked,
        auto_link: $("#rqImpAuto").checked,
      },
    });
    toast(`Imported ${j.created.length}` + (j.skipped.length ? ` · skipped ${j.skipped.length}` : "") + (j.errors.length ? ` · ${j.errors.length} fetch error(s)` : ""));
    if (typeof trClose === "function") trClose(); else ov.remove();
    rqReloadList();
  });
}

function rqLinkModal(r) {
  const html = `<div class="tr-mh"><b>Link test cases</b><button class="tr-x">✕</button></div>
    <p class="muted">Enter TC ids (comma or space separated), e.g. TC-0001 TC-0002</p>
    <input id="rqLinkIds" style="width:100%" placeholder="TC-0001, TC-0002">
    <div class="tr-mf"><button class="btn g" id="rqLCancel">Cancel</button><button class="btn" id="rqLGo">Link</button></div>`;
  const ov = (typeof trModal === "function") ? trModal(html, 480) : rqModal(html, 480);
  $("#rqLCancel").onclick = () => (typeof trClose === "function" ? trClose() : ov.remove());
  $("#rqLGo").onclick = () => guarded($("#rqLGo"), async () => {
    const ids = $("#rqLinkIds").value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const j = await api(`/api/requirements/${encodeURIComponent(r.id)}/links`, { method: "POST", body: { case_ids: ids } });
    toast(`Linked ${j.added.length}`);
    if (typeof trClose === "function") trClose(); else ov.remove();
    RQ.detail = j.requirement; viewRequirementDetail($("#view"), RQ.detail);
  });
}

async function viewTraceability(v) {
  await rqEnsureSwitcher();
  RQ.view = "trace";
  const p = rqProject();
  if (!p) { v.innerHTML = `<h1>Traceability</h1><div class="sub">Select a project first.</div>`; return; }
  let cycles = [];
  try { const rj = await api("/api/runs"); cycles = (rj.cycles || rj.items || []).filter((c) => c.status !== "Archived"); } catch (e) {}
  v.innerHTML = `<h1>Traceability</h1>
    <div class="sub">Project ${rqEsc(p.key)} · Requirement → Test cases → Cycle results
      <a href="#requirements" id="rqBack2" style="margin-left:12px">← Requirements</a></div>
    <div class="card rq-trace-bar">
      <label>Cycle <select id="rqTrCycle"><option value="">(any / last result)</option>
        ${cycles.map((c) => `<option value="${rqEsc(c.id)}" ${RQ.traceCycle===c.id?"selected":""}>${rqEsc(c.id)} · ${rqEsc(c.name)}</option>`).join("")}
      </select></label>
      <label><input type="checkbox" id="rqGapsOnly" ${RQ.gapsOnly?"checked":""}> Gaps only</label>
      <span class="pill r" id="rqGapPill">…</span>
    </div>
    <div class="card" id="rqMatrix">Loading…</div>`;
  $("#rqBack2").onclick = (e) => { e.preventDefault(); RQ.view = "list"; go("requirements"); };
  $("#rqTrCycle").onchange = (e) => { RQ.traceCycle = e.target.value; rqLoadMatrix(); };
  $("#rqGapsOnly").onchange = (e) => { RQ.gapsOnly = e.target.checked; rqLoadMatrix(); };
  await rqLoadMatrix();
}

async function rqLoadMatrix() {
  const el = $("#rqMatrix"); if (!el) return;
  try {
    const params = new URLSearchParams({
      project_id: RQ.projectId, cycle_id: RQ.traceCycle || "", gaps_only: RQ.gapsOnly ? "true" : "false",
    });
    const j = await api("/api/requirements/traceability?" + params.toString());
    RQ.matrix = j;
    const gapPill = $("#rqGapPill"); if (gapPill) gapPill.textContent = `${j.gaps || 0} gaps`;
    const cols = j.columns || [];
    el.innerHTML = `<div class="rq-matrix-scroll"><table class="rq-matrix">
      <thead><tr><th>Requirement</th>${cols.map((c) => `<th title="${rqEsc(c.title)}">${rqEsc(c.id)}</th>`).join("")}<th>Coverage</th></tr></thead>
      <tbody>${(j.rows || []).map((r) => {
        const gapCls = r.gap ? "rq-gap" : "";
        return `<tr class="${gapCls}"><td><b>${rqEsc(r.id)}</b> ${rqEsc(r.title)}${r.gap ? `<div class="pill r">coverage gap</div>` : ""}</td>
          ${cols.map((c) => {
            const st = (r.cells || {})[c.id];
            if (!st) return `<td class="rq-cell empty">·</td>`;
            const cls = st === "Pass" ? "pass" : st === "Fail" ? "fail" : st === "Linked" ? "link" : "nr";
            const label = st === "Pass" ? "✓ Pass" : st === "Fail" ? "✗ Fail" : st === "Linked" ? "🔗 Linked" : st === "Not run" ? "○ N/R" : rqEsc(st);
            return `<td class="rq-cell ${cls}">${label}</td>`;
          }).join("")}
          <td><b>${r.coverage_pct || 0}%</b></td></tr>`;
      }).join("") || `<tr><td colspan="${cols.length + 2}" class="muted">No requirements in this project.</td></tr>`}
      </tbody></table></div>
      <div class="rq-legend muted">Pass · Fail · Not run · Linked (no exec in cycle) · row highlight = coverage gap (no linked TCs)</div>`;
  } catch (e) {
    el.innerHTML = `<div class="error">${rqEsc(e.message)}</div>`;
  }
}

// boot: switcher + hash routes
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => { rqEnsureSwitcher().catch(() => {}); }, 300);
});
window.viewRequirements = viewRequirements;
window.viewProjects = viewProjects;
window.viewTraceability = viewTraceability;
window.RQ = RQ;
