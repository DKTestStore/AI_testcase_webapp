/* Requirement Repo + Projects (additive). Matches mockups under mockups/requirement-repo/. */
"use strict";

const RQ = {
  projectId: localStorage.getItem("rqProjectId") || "",
  folder: "",
  q: "", type: "", priority: "", status: "",
  data: null, projects: [], detail: null, tab: "cases",
  view: "list", // list | detail | trace | projects
  traceCycle: "", gapsOnly: false, matrix: null,
};

const RQ_PRIO = (p) => (p === "High" ? "r" : p === "Medium" || p === "Med" ? "y" : "gr");
const RQ_ST = { Draft: "y", Ready: "b", Approved: "", Archived: "gr" };
const rqEsc = (s) => (typeof esc === "function" ? esc(s) : String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
const rqDate = (ts) => { if (!ts) return "—"; const d = new Date(ts); return isNaN(d) ? ts : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-"); };

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

function rqRenderTree(folders) {
  const el = $("#rqTree"); if (!el) return;
  const allCount = (RQ.data && RQ.data.total) || 0;
  const rows = (typeof trTreeRows === "function" ? trTreeRows(folders) : folders.map((f) => ({ f, lvl: 1 })));
  el.innerHTML = `<div class="rq-tree-h"><b>Folders</b><button class="btn g sm" id="rqAddFolder">＋ folder</button></div>
    <div class="rq-titem ${!RQ.folder ? "on" : ""}" data-fid=""><span>All requirements</span><span class="muted">${allCount}</span></div>
    ${rows.map(({ f, lvl }) => `<div class="rq-titem ${RQ.folder === f.id ? "on" : ""}" data-fid="${rqEsc(f.id)}" style="padding-left:${12 + (lvl - 1) * 14}px">
      <span>${rqEsc(f.name)}</span><span class="muted">${f.count || 0}</span></div>`).join("")}
    <div class="rq-tree-note">Tree is project-scoped · separate from TC folders</div>`;
  el.querySelectorAll(".rq-titem").forEach((n) => n.onclick = () => { RQ.folder = n.dataset.fid || ""; rqReloadList(); });
  $("#rqAddFolder").onclick = () => {
    const name = prompt("Folder name");
    if (!name) return;
    guarded($("#rqAddFolder"), async () => {
      await api("/api/requirements/folders", { method: "POST", body: { project_id: RQ.projectId, name, parent: RQ.folder || "" } });
      toast("Folder created"); rqReloadList();
    })();
  };
}

function rqRenderTable(rows) {
  const el = $("#rqMain"); if (!el) return;
  const folderName = RQ.folder && (RQ.data.folders || []).find((f) => f.id === RQ.folder);
  el.innerHTML = `<div class="rq-main-h">
      <div><b>${rqEsc(folderName ? folderName.name : "All requirements")}</b>
        <span class="muted">${rows.length} shown</span></div>
      <input id="rqSearch" placeholder="Search requirements…" value="${rqEsc(RQ.q)}" style="width:220px">
    </div>
    <div class="rq-filters">
      <select id="rqFType"><option value="">All types</option>${["Story","Epic","Feature"].map((t)=>`<option ${RQ.type===t?"selected":""}>${t}</option>`).join("")}</select>
      <select id="rqFPrio"><option value="">Priority ▾</option>${["High","Medium","Low"].map((t)=>`<option ${RQ.priority===t?"selected":""}>${t}</option>`).join("")}</select>
      <select id="rqFSt"><option value="">Status ▾</option>${["Draft","Ready","Approved"].map((t)=>`<option ${RQ.status===t?"selected":""}>${t}</option>`).join("")}</select>
    </div>
    <div class="rq-table-wrap"><table class="rq-table">
      <thead><tr><th>ID</th><th>Title</th><th>Type</th><th>Source</th><th>Pri</th><th>Status</th><th>TCs</th><th>Coverage</th><th>Last cycle</th></tr></thead>
      <tbody>${rows.map((r) => {
        const pct = r.coverage_pct || 0;
        const col = pct >= 75 ? "#12a150" : pct >= 40 ? "#d97706" : "#d33333";
        const last = r.last_result || "—";
        const lcol = last === "Pass" ? "#12a150" : last === "Fail" || last === "Gap" ? "#d33333" : "#6b7385";
        return `<tr data-rid="${rqEsc(r.id)}" class="rq-row">
          <td class="rq-id">${rqEsc(r.id)}</td>
          <td>${rqEsc(r.title)}${r.jira_key ? `<div class="muted" style="font-size:11px">${rqEsc(r.jira_key)}</div>` : ""}</td>
          <td>${rqEsc(r.type)}</td><td>${rqEsc(r.source)}</td>
          <td><span class="pill ${RQ_PRIO(r.priority)}">${rqEsc(r.priority)}</span></td>
          <td><span class="pill ${RQ_ST[r.status] || ""}">${rqEsc(r.status)}</span></td>
          <td>${r.linked || 0}</td>
          <td><div class="rq-cov"><span style="color:${col};font-weight:600">${pct}%</span>
            <div class="rq-bar"><i style="width:${pct}%;background:${col}"></i></div></div></td>
          <td style="color:${lcol};font-weight:600">${rqEsc(last)}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="9" class="muted">No requirements yet. Create one or Import from Jira.</td></tr>`}
      </tbody></table></div>
    <div class="rq-compat">Compatibility: cases keep their story key; use Auto-link / Import with auto-link to match <code>case.story</code> to a requirement Jira key.</div>`;
  el.querySelectorAll(".rq-row").forEach((tr) => tr.onclick = () => rqOpenDetail(tr.dataset.rid));
  const search = $("#rqSearch");
  let t; search.oninput = () => { clearTimeout(t); t = setTimeout(() => { RQ.q = search.value; rqReloadList(); }, 250); };
  $("#rqFType").onchange = (e) => { RQ.type = e.target.value; rqReloadList(); };
  $("#rqFPrio").onchange = (e) => { RQ.priority = e.target.value; rqReloadList(); };
  $("#rqFSt").onchange = (e) => { RQ.status = e.target.value; rqReloadList(); };
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
  v.innerHTML = `<div class="rq-back"><a href="#requirements" id="rqBack">← Requirements</a></div>
    <h1>${rqEsc(r.id)} · ${rqEsc(r.title)}</h1>
    <div class="rq-meta">
      <span class="pill b">${rqEsc(r.type)}</span>
      <span class="pill ${RQ_PRIO(r.priority)}">${rqEsc(r.priority)}</span>
      <span class="pill ${RQ_ST[r.status] || ""}">${rqEsc(r.status)}</span>
      ${r.jira_key ? `<span class="pill gr">Jira ${rqEsc(r.jira_key)}</span>` : ""}
      <span class="muted">Project ${rqEsc(p ? p.key : "")}${r.folder_path ? " · " + rqEsc(r.folder_path) : ""}</span>
    </div>
    <div class="rq-toolbar" style="justify-content:flex-end">
      <button class="btn g" id="rqLinkBtn">🔗 Link test cases</button>
      <button class="btn" id="rqGenBtn">✨ Generate with AI</button>
    </div>
    <div class="rq-detail">
      <div class="rq-left">
        <div class="card">
          <h3>Description</h3>
          <p>${rqEsc(r.description || "(none)").replace(/\n/g, "<br>")}</p>
          <h3>Acceptance criteria</h3>
          <ul>${(r.acs || []).map((a) => `<li>${rqEsc(a)}</li>`).join("") || "<li class='muted'>(none)</li>"}</ul>
          <div class="muted" style="font-size:11px;margin-top:12px">Source: ${rqEsc(r.source)}${r.jira_key ? " " + rqEsc(r.jira_key) : ""} · Updated ${rqEsc(rqDate(r.updated))}</div>
        </div>
        <div class="card" style="margin-top:12px">
          <h3>Coverage snapshot</h3>
          <div class="rq-snap">
            <div><div class="muted">Linked TCs</div><b style="color:#4361ee">${r.linked || 0}</b></div>
            <div><div class="muted">Coverage</div><b style="color:#12a150">${r.coverage_pct || 0}%</b></div>
            <div><div class="muted">Last result</div><b>${rqEsc(r.last_result || "—")}</b></div>
          </div>
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
    </div>`;
  $("#rqBack").onclick = (e) => { e.preventDefault(); RQ.view = "list"; RQ.detail = null; go("requirements"); };
  $("#rqGenBtn").onclick = () => rqGenerateAI(r.id);
  $("#rqLinkBtn").onclick = () => rqLinkModal(r);
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
      `<div class="rq-act"><span class="muted">${rqEsc(rqDate(a.ts))}</span> <b>${rqEsc(a.type)}</b> ${rqEsc(a.text || "")}</div>`
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

function rqNewReqModal() {
  const folders = (RQ.data && RQ.data.folders) || [];
  const html = `<div class="tr-mh"><b>New requirement</b><button class="tr-x">✕</button></div>
    <label>Title</label><input id="rqRT" style="width:100%">
    <label>Type</label><select id="rqRTy">${["Story","Epic","Feature"].map((t)=>`<option>${t}</option>`).join("")}</select>
    <label>Priority</label><select id="rqRPr">${["High","Medium","Low"].map((t)=>`<option ${t==="Medium"?"selected":""}>${t}</option>`).join("")}</select>
    <label>Status</label><select id="rqRSt">${["Draft","Ready","Approved"].map((t)=>`<option>${t}</option>`).join("")}</select>
    <label>Jira key (optional, 1:1)</label><input id="rqRJ" placeholder="EXPO-33" style="width:160px">
    <label>Folder</label><select id="rqRF"><option value="">(none)</option>${folders.map((f)=>`<option value="${rqEsc(f.id)}" ${RQ.folder===f.id?"selected":""}>${rqEsc(f.name)}</option>`).join("")}</select>
    <label>Description</label><textarea id="rqRD" rows="3" style="width:100%"></textarea>
    <label>Acceptance criteria (one per line)</label><textarea id="rqRA" rows="3" style="width:100%"></textarea>
    <label><input type="checkbox" id="rqRAuto"> Auto-link test cases where story matches Jira key</label>
    <div class="tr-mf"><button class="btn g" id="rqRCancel">Cancel</button><button class="btn" id="rqRSave">Create</button></div>`;
  const ov = (typeof trModal === "function") ? trModal(html, 560) : rqModal(html, 560);
  $("#rqRCancel").onclick = () => (typeof trClose === "function" ? trClose() : ov.remove());
  $("#rqRSave").onclick = () => guarded($("#rqRSave"), async () => {
    const body = {
      project_id: RQ.projectId, title: $("#rqRT").value, type: $("#rqRTy").value,
      priority: $("#rqRPr").value, status: $("#rqRSt").value, jira_key: $("#rqRJ").value,
      folder_id: $("#rqRF").value, description: $("#rqRD").value,
      acs: $("#rqRA").value.split(/\n/).map((s) => s.trim()).filter(Boolean),
      auto_link: $("#rqRAuto").checked, source: $("#rqRJ").value.trim() ? "Jira" : "Manual",
    };
    const j = await api("/api/requirements", { method: "POST", body });
    toast(`Created ${j.requirement.id}` + (j.auto_linked && j.auto_linked.length ? ` · linked ${j.auto_linked.length}` : ""));
    if (typeof trClose === "function") trClose(); else ov.remove();
    RQ.detail = j.requirement; RQ.view = "detail"; viewRequirementDetail($("#view"), RQ.detail);
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
