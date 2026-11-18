/* Project workspace, 3-step generate-into-framework, Check & Run (additive). */
(function () {
  const FW = {
    tab: "project",
    lang: "python",
    fid: "",
    fw: null,
    tree: [],
    path: "",
    file: null,
    unsaved: {},
    split: false,
    full: false,
    showHist: false,
    preview: null,
    previewMode: "table",
    locators: [],
    assertions: [],
    mapping: null,
    envTab: "",
    wiz: null,
    run: null,
    poll: 0,
    collapsed: {},
    treeQ: "",
    markers: {},
    splitPath: "",
    splitFile: null,
    splitFocus: "left",
    langs: [],
    cursorLine: 1,
    cursorCol: 1,
  };

  function projectId() {
    return (window.RQ && RQ.projectId) || "default";
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fwApi(path, opts) {
    return api("/api/automation" + path, opts || {});
  }
  function defaultFramework(lang) {
    const m = { python: "playwright", java: "selenium", javascript: "playwright", typescript: "playwright", dotnet: "selenium", robot: "seleniumlibrary" };
    return m[lang] || "playwright";
  }
  function extOf(path) {
    const n = String(path || "").split("/").pop() || "";
    if (n === ".env" || /\.env$/i.test(n) || /\.(staging|qa|prod)\.env$/i.test(n)) return "env";
    const i = n.lastIndexOf(".");
    return i >= 0 ? n.slice(i + 1).toLowerCase() : "";
  }
  function fwIcon(path, isDir) {
    if (isDir) return '<span class="fw-foldico" title="Folder"></span>';
    const e = extOf(path);
    const map = { py: "py", java: "java", js: "js", ts: "ts", json: "json", xml: "xml", xlsx: "xlsx", csv: "csv", md: "md", env: "env", robot: "robot", cs: "cs", yaml: "yaml", yml: "yml", ini: "ini", properties: "properties", feature: "feature", txt: "txt", html: "html", htm: "html" };
    const cls = map[e] || "file";
    const lab = ({ properties: "PR", feature: "FT", robot: "RF", yaml: "YML", yml: "YML", html: "HTM", htm: "HTM" }[e]) || (e || "file").slice(0, 4);
    return '<span class="fw-ico ' + cls + '" title=".' + esc(e || "file") + '">' + esc(lab) + "</span>";
  }
  function fwIconLg(path, isDir) {
    if (isDir) return '<span class="ico-lg dir" title="Folder"></span>';
    const e = extOf(path);
    const map = { py: "py", java: "java", js: "js", ts: "ts", json: "json", xml: "xml", xlsx: "xlsx", csv: "csv", md: "md", env: "env", robot: "robot", cs: "cs", yaml: "yaml", yml: "yml", ini: "ini", properties: "properties", feature: "feature", txt: "txt", html: "html", htm: "html" };
    const cls = map[e] || "file";
    const lab = ({ properties: "PR", feature: "FT", robot: "RF", yaml: "YML", yml: "YML", html: "HTM", htm: "HTM" }[e]) || (e || "file").slice(0, 4);
    return '<span class="ico-lg fw-ico ' + cls + '">' + esc(lab) + "</span>";
  }
  function langLabel() {
    const list = FW.langs || [];
    const hit = list.find(function (l) { return l.id === FW.lang; });
    return (hit && hit.name) || FW.lang || "Python";
  }
  function pathName(path) {
    return String(path || "").replace(/\/$/, "").split("/").pop() || path || "";
  }
  function normDir(path) {
    const s = String(path || "");
    if (!s) return "";
    return s.endsWith("/") ? s : s + "/";
  }
  function isChildPath(parent, path) {
    const pre = parent ? normDir(parent) : "";
    if (pre) {
      if (path === parent || path === pre) return false;
      if (path.indexOf(pre) !== 0) return false;
      return path.slice(pre.length).replace(/\/$/, "").indexOf("/") < 0;
    }
    return String(path || "").replace(/\/$/, "").indexOf("/") < 0;
  }
  function descendantOf(parent, path) {
    if (!parent) return true;
    const pre = normDir(parent);
    return path === parent || path === pre || path.indexOf(pre) === 0;
  }
  function clockSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>';
  }
  function isEnvPath(path) {
    const n = (path || "").split("/").pop() || "";
    return n === ".env" || /\.env$/i.test(n);
  }
  function isDataPath(path) {
    const e = extOf(path);
    return /^(xlsx|csv|json|xml|yaml|yml)$/.test(e) || /^test_data\//.test(path || "");
  }
  function isSecretKey(k) {
    return /password|secret|token|key|passwd|api_key|connection/i.test(String(k || ""));
  }

  async function ensureFramework() {
    const project = projectId();
    const lang = FW.lang || "python";
    const list = await fwApi("/frameworks?project=" + encodeURIComponent(project));
    const found = (list.frameworks || []).find((f) => f.language === lang);
    if (found) {
      const full = await fwApi("/frameworks/" + encodeURIComponent(found.id));
      FW.fid = found.id; FW.fw = full.framework || found; FW.tree = (full.tree || []).slice();
      return;
    }
    const created = await fwApi("/frameworks", {
      method: "POST",
      body: { project: project, language: lang, framework: defaultFramework(lang), types: ["ui"] },
    });
    FW.fid = created.framework && created.framework.id; FW.fw = created.framework; FW.tree = (created.tree || []).slice();
    if (!FW.tree.length && FW.fid) {
      const t = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/tree");
      FW.tree = t.tree || [];
    }
  }

  const _viewScripts = window.viewScripts;
  window.viewScripts = async function viewScriptsWrapped(v) {
    const hash = String((typeof S !== "undefined" && S.view) || location.hash.slice(1) || "scripts");
    if (/^scripts\/[^/?]+/.test(hash) && hash.indexOf("tab=project") < 0) {
      return _viewScripts(v);
    }
    const q = hash.split("?")[1] || "";
    if (/tab=library/.test(q)) FW.tab = "library";
    else if (/tab=project/.test(q) || !q) FW.tab = FW.tab || "project";
    v.innerHTML = '<div class="fw-shell asv"><div class="fw-head"><div><h1>Automation Scripts</h1><p class="lead">Project workspace for ' + esc(projectId()) + " · " + esc(langLabel()) + "</p></div>"
      + '<div class="acts"><div class="fw-langwrap"><button type="button" class="fw-pill" id="fwLangBtn">' + esc(langLabel()) + '</button><div class="fw-langmenu" id="fwLangMenu" hidden></div></div>'
      + '<button type="button" class="btn pri" id="fwGen">Generate</button>'
      + '<span class="fw-splitbtn" id="fwRunWrap"><button type="button" class="btn fw-runmain" id="fwRun">Run</button>'
      + '<button type="button" class="fw-runcaret" id="fwRunCaret" title="Check, runner options">▾</button>'
      + '<div class="fw-runmenu" id="fwRunMenu" hidden><button type="button" id="fwCheck">Check</button><button type="button" id="fwRunMenuGo">Run</button></div></span>'
      + '<button type="button" class="fw-hist" id="fwRuns">' + clockSvg() + " Run history</button></div></div>"
      + '<div class="fw-tabs" role="tablist"><button type="button" data-fwtab="project" class="' + (FW.tab === "project" ? "a" : "") + '">Project</button>'
      + '<button type="button" data-fwtab="library" class="' + (FW.tab === "library" ? "a" : "") + '">Library</button></div>'
      + '<div id="fwHost" style="flex:1;min-height:0;display:flex;flex-direction:column"></div></div>';
    await fillLangSelect();
    $$("[data-fwtab]", v).forEach((b) => {
      b.onclick = function () {
        FW.tab = b.dataset.fwtab;
        if (typeof go === "function") go("scripts?tab=" + FW.tab);
        else viewScriptsWrapped(v);
      };
    });
    bindHeaderChrome(v);
    await renderHost();
  };

  function bindHeaderChrome(v) {
    const btn = $("#fwLangBtn", v);
    const menu = $("#fwLangMenu", v);
    if (btn && menu) {
      btn.onclick = function (e) {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        const rm = $("#fwRunMenu"); if (rm) rm.hidden = true;
      };
    }
    if ($("#fwGen")) $("#fwGen").onclick = function () { openWizard(); };
    if ($("#fwRun")) $("#fwRun").onclick = function () { startRun(); };
    if ($("#fwRunMenuGo")) $("#fwRunMenuGo").onclick = function () { const m = $("#fwRunMenu"); if (m) m.hidden = true; startRun(); };
    if ($("#fwCheck")) $("#fwCheck").onclick = function () { const m = $("#fwRunMenu"); if (m) m.hidden = true; startCheck(); };
    if ($("#fwRunCaret")) $("#fwRunCaret").onclick = function (e) {
      e.stopPropagation();
      const m = $("#fwRunMenu");
      if (m) m.hidden = !m.hidden;
      if (menu) menu.hidden = true;
    };
    if ($("#fwRuns")) $("#fwRuns").onclick = function () { showHistory(); };
    if (!FW._menuHide) {
      FW._menuHide = function (ev) {
        if (!ev.target || !ev.target.closest) return;
        if (!ev.target.closest(".fw-langwrap")) { const m = $("#fwLangMenu"); if (m) m.hidden = true; }
        if (!ev.target.closest(".fw-splitbtn")) { const m = $("#fwRunMenu"); if (m) m.hidden = true; }
      };
      document.addEventListener("click", FW._menuHide);
    }
  }

  async function setLanguage(id) {
    FW.lang = id; FW.path = ""; FW.file = null; FW.fid = ""; FW.splitPath = ""; FW.splitFile = null;
    const host = document.getElementById("view") || document.getElementById("fwHost");
    if (typeof go === "function" && FW.tab) {
      /* stay on scripts; re-render header label via view */
    }
    const v = $("#fwHost") && $("#fwHost").closest(".fw-shell");
    if (v) {
      const lead = v.querySelector(".lead");
      if (lead) lead.textContent = "Project workspace for " + projectId() + " · " + langLabel();
      const b = $("#fwLangBtn"); if (b) b.textContent = langLabel();
    }
    await renderHost();
  }

  async function fillLangSelect() {
    let langs = [{ id: "python", name: "Python" }, { id: "java", name: "Java" }, { id: "javascript", name: "JavaScript" }, { id: "typescript", name: "TypeScript" }, { id: "dotnet", name: ".NET" }, { id: "robot", name: "Robot Framework" }];
    try {
      if (typeof window.asLoadOptions === "function") await window.asLoadOptions();
      const cat = (window.ST && ST.cat && ST.cat.languages) || [];
      if (cat.length) langs = cat.filter((l) => l.enabled !== false).map((l) => ({ id: l.id, name: l.name || l.id }));
    } catch (e) {}
    if (!langs.some((l) => l.id === FW.lang)) FW.lang = (langs[0] && langs[0].id) || "python";
    FW.langs = langs;
    const btn = $("#fwLangBtn");
    if (btn) btn.textContent = langLabel();
    const menu = $("#fwLangMenu");
    if (menu) {
      menu.innerHTML = langs.map((l) => "<button type=\"button\" data-lang=\"" + esc(l.id) + "\" class=\"" + (l.id === FW.lang ? "on" : "") + "\">" + esc(l.name) + "</button>").join("");
      $$("[data-lang]", menu).forEach(function (b) {
        b.onclick = async function (e) {
          e.stopPropagation();
          menu.hidden = true;
          await setLanguage(b.dataset.lang);
        };
      });
    }
    const lead = document.querySelector(".fw-shell .lead");
    if (lead) lead.textContent = "Project workspace for " + projectId() + " · " + langLabel();
    const sel = $("#fwLang");
    if (sel) sel.innerHTML = langs.map((l) => "<option value=\"" + esc(l.id) + "\"" + (l.id === FW.lang ? " selected" : "") + ">" + esc(l.name) + "</option>").join("");
  }

  async function renderHost() {
    const host = $("#fwHost");
    if (!host) return;
    if (FW.tab === "library") {
      host.innerHTML = '<div id="asLibHost">Loading…</div>';
      if (typeof window.asRenderLibrary === "function") await window.asRenderLibrary($("#asLibHost"));
      return;
    }
    try {
      await ensureFramework();
      paintProject(host);
    } catch (e) {
      host.innerHTML = '<div class="error">' + esc(e.message || e) + "</div>";
    }
  }

  function paintProject(host) {
    const split = !!FW.split && FW.path && !(FW.file && FW.file.is_dir);
    const full = FW.full && FW.path && !(FW.file && FW.file.is_dir);
    host.innerHTML = '<div class="fw-body' + (split ? " split" : "") + (full ? " full" : "") + '" id="fwBody">'
      + '<div class="fw-tree" id="fwTree">' + treePanel() + "</div>"
      + paneHtml("fwMain", FW.path, FW.file, "left")
      + (split ? paneHtml("fwMain2", FW.splitPath, FW.splitFile, "right") : "")
      + "</div>";
    const body = $("#fwBody");
    if (full && body) body.classList.add("fw-full");
    bindTree($("#fwTree"));
    bindMain($("#fwMain"), "left");
    if (split) bindMain($("#fwMain2"), "right");
  }

  function treePanel() {
    return '<div class="fw-th"><span class="fw-ttl">Files</span><button type="button" class="btn fw-new" id="fwTreeNew">＋ New</button></div>'
      + '<input class="fw-search" id="fwTreeQ" type="search" placeholder="Search files" value="' + esc(FW.treeQ || "") + '">'
      + '<div class="fw-t" id="fwT">' + treeHtml(FW.tree) + "</div>";
  }

  function treeHtml(rows) {
    const items = (rows || []).slice();
    if (!items.length) return '<div class="fw-empty">No files yet. Generate scripts to fill this project framework.</div>';
    const q = String(FW.treeQ || "").toLowerCase();
    function matches(r) {
      if (!q) return true;
      const name = pathName(r.path).toLowerCase();
      return name.indexOf(q) >= 0 || String(r.path).toLowerCase().indexOf(q) >= 0;
    }
    function hasMatch(parent) {
      if (!q) return true;
      return items.some(function (r) { return descendantOf(parent, r.path) && matches(r); });
    }
    function kids(parent) {
      return items.filter(function (r) { return isChildPath(parent, r.path); })
        .filter(function (r) { return !q || matches(r) || hasMatch(r.path); })
        .sort(function (a, b) {
          if (!!a.is_dir !== !!b.is_dir) return a.is_dir ? -1 : 1;
          return pathName(a.path).localeCompare(pathName(b.path));
        });
    }
    function countOf(folder) {
      return items.filter(function (r) { return r.path !== folder && descendantOf(folder, r.path) && !r.is_dir; }).length;
    }
    function isOpen(folder) {
      if (q && hasMatch(folder)) return true;
      return !FW.collapsed[folder];
    }
    let html = "";
    function walk(parent, lvl) {
      kids(parent).forEach(function (r) {
        const name = pathName(r.path);
        const on = (FW.path === r.path || (r.is_dir && (FW.path === r.path || FW.path === normDir(r.path)))) ? " a" : "";
        const dirty = FW.unsaved[r.path] ? '<span class="udot" title="Unsaved changes"></span>' : "";
        const mk = markerHtml(r.path);
        const pad = 6 + Math.max(0, lvl) * 12;
        if (r.is_dir) {
          const open = isOpen(r.path);
          html += '<div class="fw-ti' + on + '" draggable="true" data-path="' + esc(r.path) + '" data-dir="1" style="padding-left:' + pad + 'px">'
            + '<span class="fw-ch" data-ch="' + esc(r.path) + '">' + (open ? "▾" : "▸") + "</span>"
            + fwIcon(r.path, true) + '<span class="nm">' + esc(name) + '</span><span class="cnt">' + countOf(r.path) + "</span></div>";
          if (open) walk(r.path, lvl + 1);
        } else {
          html += '<div class="fw-ti' + on + '" draggable="true" data-path="' + esc(r.path) + '" data-dir="0" style="padding-left:' + (pad + 12) + 'px">'
            + fwIcon(r.path, false) + mk + '<span class="nm">' + esc(name) + "</span>" + dirty + "</div>";
        }
      });
    }
    walk("", 0);
    return html || '<div class="fw-empty">No files match this search.</div>';
  }

  function markerHtml(path) {
    const k = (FW.markers || {})[path];
    if (k === "new") return '<span class="fw-mk n" title="New">New</span>';
    if (k === "changed" || k === "chg") return '<span class="fw-mk c" title="Changed">Chg</span>';
    return "";
  }

  function toggleFold(path) {
    if (FW.collapsed[path]) delete FW.collapsed[path];
    else FW.collapsed[path] = true;
    const t = $("#fwT");
    if (t) { t.innerHTML = treeHtml(FW.tree); bindTreeRows(t); }
  }

  function bindTree(tree) {
    if (!tree) return;
    const q = $("#fwTreeQ", tree);
    if (q) {
      q.oninput = function () {
        FW.treeQ = q.value;
        const box = $("#fwT");
        if (box) { box.innerHTML = treeHtml(FW.tree); bindTreeRows(box); }
      };
    }
    const neu = $("#fwTreeNew", tree);
    if (neu) neu.onclick = function (e) {
      e.stopPropagation();
      const r = neu.getBoundingClientRect();
      showTreeMenu(r.left, r.bottom + 4, FW.path && (FW.file && FW.file.is_dir) ? FW.path : "", true);
    };
    tree.oncontextmenu = function (e) {
      if (e.target === tree || e.target.id === "fwT") { e.preventDefault(); showTreeMenu(e.clientX, e.clientY, "", true); }
    };
    bindTreeRows($("#fwT", tree) || tree);
  }

  function bindTreeRows(root) {
    if (!root) return;
    $$(".fw-ti", root).forEach(function (el) {
      el.onclick = function (e) {
        e.preventDefault();
        if (e.target && e.target.dataset && e.target.dataset.ch != null) {
          e.stopPropagation();
          toggleFold(e.target.dataset.ch);
          return;
        }
        if (el.dataset.dir === "1") { openFolder(el.dataset.path); return; }
        pickTreeFile(el.dataset.path);
      };
      el.oncontextmenu = function (e) {
        e.preventDefault();
        showTreeMenu(e.clientX, e.clientY, el.dataset.path, el.dataset.dir === "1");
      };
      el.ondragstart = function (e) { e.dataTransfer.setData("text/plain", el.dataset.path); };
      el.ondragover = function (e) { if (el.dataset.dir === "1") { e.preventDefault(); el.classList.add("a"); } };
      el.ondragleave = function () { if (el.dataset.path !== FW.path) el.classList.remove("a"); };
      el.ondrop = function (e) {
        e.preventDefault();
        const src = e.dataTransfer.getData("text/plain");
        if (el.dataset.dir === "1" && src) moveFile(src, el.dataset.path);
      };
    });
  }

  function pickTreeFile(path) {
    if (FW.split && FW.splitFocus === "right") return openFileIn("right", path);
    if (FW.split && FW.path && path !== FW.path && !FW.splitPath) return openFileIn("right", path);
    return openFile(path);
  }

  async function openFolder(path) {
    FW.path = path;
    FW.split = false;
    FW.splitPath = "";
    FW.splitFile = null;
    const row = (FW.tree || []).find(function (r) { return r.path === path || r.path === normDir(path); }) || { path: path, is_dir: true };
    FW.file = { path: path, is_dir: true, updated: row.updated || "", version: row.version || 1, updated_by: row.updated_by || "" };
    FW.preview = null;
    const host = $("#fwHost");
    if (host) paintProject(host);
  }

  async function reloadTree() {
    const res = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/tree");
    FW.tree = res.tree || [];
    const host = $("#fwHost");
    if (host && FW.tab === "project") paintProject(host);
  }

  async function openFile(path) {
    FW.path = path;
    FW.splitFocus = "left";
    try {
      const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/file?path=" + encodeURIComponent(path));
      FW.file = j.file || {};
      if (FW.file.is_dir) return openFolder(path);
      FW.file.used_by = j.used_by || [];
      FW.file.versions = j.versions || [];
      if (isDataPath(path) || isEnvPath(path)) {
        try {
          const pr = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/preview?path=" + encodeURIComponent(path));
          FW.preview = pr.preview || null;
          if (pr.used_by) FW.file.used_by = pr.used_by;
        } catch (e2) { FW.preview = null; }
      } else FW.preview = null;
      const host = $("#fwHost");
      if (host) paintProject(host);
    } catch (e) { toast(e.message || String(e)); }
  }

  async function openFileIn(side, path) {
    if (side !== "right") return openFile(path);
    FW.splitPath = path;
    FW.splitFocus = "right";
    try {
      const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/file?path=" + encodeURIComponent(path));
      FW.splitFile = j.file || {};
      FW.splitFile.used_by = j.used_by || [];
      FW.splitFile.versions = j.versions || [];
      const host = $("#fwHost");
      if (host) paintProject(host);
    } catch (e) { toast(e.message || String(e)); }
  }

  function currentContent(path) {
    const pth = path == null ? FW.path : path;
    if (!pth) return "";
    if (Object.prototype.hasOwnProperty.call(FW.unsaved, pth)) return FW.unsaved[pth];
    if (pth === FW.splitPath && FW.splitFile) return FW.splitFile.content || "";
    if (pth === FW.path && FW.file) return FW.file.content || "";
    return (FW.file && FW.file.content) || "";
  }

  function paneHtml(id, path, file, side) {
    return '<div class="fw-main" id="' + id + '" data-side="' + side + '">' + mainHtml(path, file, side) + "</div>";
  }

  function mainHtml(path, file, side) {
    path = path == null ? FW.path : path;
    file = file == null ? FW.file : file;
    side = side || "left";
    if (!path) return emptyStateHtml();
    if (file && file.is_dir) return folderSummaryHtml(path, file);
    return fileViewHtml(path, file, side);
  }

  function emptyStateHtml() {
    return '<div class="fw-empty-state"><div class="ill"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg></div>'
      + "<h2>Pick a file to get started</h2>"
      + "<p>This project framework is ready. Open a file from the tree, or use a shortcut below.</p>"
      + '<div class="acts"><button type="button" class="btn pri" id="fwEmptyGen">Generate tests</button>'
      + '<button type="button" class="btn g" id="fwEmptyRead">Open README</button>'
      + '<button type="button" class="btn g" id="fwEmptyData">Add test data</button></div></div>';
  }

  function folderSummaryHtml(path, file) {
    const kids = (FW.tree || []).filter(function (r) { return isChildPath(path, r.path); })
      .sort(function (a, b) { if (!!a.is_dir !== !!b.is_dir) return a.is_dir ? -1 : 1; return pathName(a.path).localeCompare(pathName(b.path)); });
    const pre = normDir(path);
    const desc = (FW.tree || []).filter(function (r) { return r.path !== path && r.path !== pre && descendantOf(path, r.path); });
    const nFiles = desc.filter(function (r) { return !r.is_dir; }).length;
    const nDirs = desc.filter(function (r) { return r.is_dir; }).length;
    const last = desc.concat([file || {}]).reduce(function (m, r) { return (r.updated || "") > m ? r.updated : m; }, "");
    const cards = kids.map(function (r) {
      const ico = r.is_dir ? '<span class="fw-foldico"></span>' : fwIcon(r.path, false);
      const kind = r.is_dir ? "Folder" : ("." + (r.ext || extOf(r.path) || "file")).replace("..", ".");
      return '<div class="fw-card" data-open="' + esc(r.path) + '" data-dir="' + (r.is_dir ? "1" : "0") + '">'
        + ico + "<div><div class=\"nm\">" + esc(pathName(r.path)) + (r.is_dir ? "/" : "") + "</div>"
        + '<div class="sub">' + esc(kind) + "</div></div>"
        + '<span class="muted">' + esc(r.updated || "") + "</span></div>";
    }).join("") || '<div class="fw-empty">This folder is empty.</div>';
    const name = pathName(path) || path;
    return fileCardHtml({ path: path, name: name, isDir: true, version: "", used: [], unsaved: false, updated: last })
      + '<div class="fw-fold"><div class="sum"><span><b>' + (nFiles + nDirs) + " item" + (nFiles + nDirs === 1 ? "" : "s") + "</b> · "
      + nFiles + " file" + (nFiles === 1 ? "" : "s") + ", " + nDirs + " folder" + (nDirs === 1 ? "" : "s") + "</span>"
      + (last ? "<span>Last updated " + esc(last) + "</span>" : "") + "</div>"
      + '<div class="acts"><button type="button" class="btn pri" id="fwFoldNew">New file</button>'
      + '<button type="button" class="btn g sm" id="fwFoldUp">Upload</button>'
      + '<button type="button" class="btn g sm" id="fwFoldRen">Rename</button></div>'
      + '<div class="fw-cards">' + cards + "</div></div>";
  }

  function fileCardHtml(opts) {
    const used = opts.used || [];
    const chips = used.map(function (id) { return '<span class="tid">' + esc(id) + "</span>"; }).join("");
    const usedHtml = used.length ? '<span class="fw-used">Used by ' + used.length + " test" + (used.length === 1 ? "" : "s") + " " + chips + "</span>" : "";
    const crumb = breadcrumb(opts.path, opts.isDir);
    const ico = opts.isDir ? '<span class="ico-lg dir" title="Folder"></span>' : fwIconLg(opts.path, false);
    return '<div class="fw-fcard">' + ico + '<div class="who"><div class="fn">' + esc(opts.name)
      + (opts.unsaved ? '<span class="udot" title="Unsaved changes"></span>' : "") + "</div>"
      + '<div class="crumb">' + crumb + "</div>"
      + '<div class="meta">' + (opts.version ? '<span class="fw-vchip">' + esc(opts.version) + "</span>" : "") + usedHtml + "</div></div></div>";
  }

  function breadcrumb(path, isDir) {
    const proj = esc(projectId());
    const parts = String(path || "").replace(/\/$/, "").split("/").filter(Boolean);
    if (!parts.length) return "<b>" + proj + "</b> /";
    const last = parts.pop();
    const head = parts.map(function (s) { return esc(s); }).join(" / ");
    return "<b>" + proj + "</b> / " + (head ? head + " / " : "") + "<b>" + esc(last) + (isDir ? " /" : "") + "</b>";
  }

  function fileViewHtml(path, file, side) {
    const unsaved = !!FW.unsaved[path];
    const used = (file && file.used_by) || [];
    const ver = file && file.version ? ("v" + file.version) : "";
    const tabs = [];
    if (isEnvPath(path)) tabs.push(["env", "Variables"]);
    if (isDataPath(path)) tabs.push(["preview", "Preview"]);
    tabs.push(["code", "Code"]);
    tabs.push(["loc", "Locators"]);
    tabs.push(["asrt", "Assertions"]);
    if (isDataPath(path)) tabs.push(["map", "Data mapping"]);
    let pane = FW.viewPane || "code";
    if (side === "right") pane = FW.viewPaneRight || "code";
    if (!tabs.some(function (t) { return t[0] === pane; })) pane = tabs[0][0];
    let body = "";
    if (pane === "env") body = envHtml();
    else if (pane === "preview") body = previewHtml();
    else if (pane === "loc") body = locHtml();
    else if (pane === "asrt") body = asrtHtml();
    else if (pane === "map") body = mapHtml();
    else body = codeHtml(path, side);
    const splitIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>';
    const fullIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
    const histIco = clockSvg();
    const bar = '<div class="fw-bar"><div class="fw-seg">'
      + tabs.map(function (t) { return '<button type="button" data-pane="' + t[0] + '" class="' + (pane === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("")
      + '</div><div class="fw-ibar">'
      + '<button type="button" class="fw-ico-btn" data-act="split" title="Split view">' + splitIco + '<span class="tip">Split view</span></button>'
      + '<button type="button" class="fw-ico-btn" data-act="full" title="Full screen">' + fullIco + '<span class="tip">Full screen</span></button>'
      + '<button type="button" class="fw-ico-btn" data-act="hist" title="Version history">' + histIco + '<span class="tip">Version history</span></button>'
      + '</div><button type="button" class="btn pri save" data-act="save"' + (unsaved ? "" : " disabled") + ">Save</button></div>";
    const hist = (FW.showHist && pane === "code" && side === "left") ? histHtml() : "";
    const stat = pane === "code" ? statusBarHtml(path, side) : "";
    return fileCardHtml({ path: path, name: pathName(path), isDir: false, version: ver, used: used, unsaved: unsaved })
      + bar + '<div class="fw-code" id="fwPane">' + body + hist + "</div>" + stat;
  }

  function statusBarHtml(path, side) {
    const line = side === "right" ? (FW.cursorLineR || 1) : (FW.cursorLine || 1);
    const col = side === "right" ? (FW.cursorColR || 1) : (FW.cursorCol || 1);
    return '<div class="fw-stat" data-stat="' + side + '"><b>' + esc(langLabel()) + "</b><span>UTF-8</span><span class=\"fw-lncol\">Ln " + line + ", Col " + col + "</span><span style=\"margin-left:auto\">" + esc(path) + "</span></div>";
  }

  function codeHtml(path, side) {
    const val = currentContent(path);
    const ext = extOf(path);
    const lines = String(val || "").split("\n");
    const cur = side === "right" ? (FW.cursorLineR || 1) : (FW.cursorLine || 1);
    const ln = lines.map(function (_, i) { return '<i class="' + (i + 1 === cur ? "cur" : "") + '">' + (i + 1) + "</i>"; }).join("");
    const id = side === "right" ? "fwCodeR" : "fwCode";
    const hl = side === "right" ? "fwHlR" : "fwHl";
    const gutter = side === "right" ? "fwLnR" : "fwLn";
    return '<div class="fw-edwrap" data-ed="' + side + '"><div class="fw-ln" id="' + gutter + '">' + ln + "</div>"
      + '<div class="fw-edstack"><pre class="fw-hl" id="' + hl + '">' + highlightCode(val, ext) + "</pre>"
      + '<textarea id="' + id + '" spellcheck="false" data-path="' + esc(path) + '" data-side="' + side + '">' + esc(val) + "</textarea></div></div>";
  }

  function highlightCode(raw, ext) {
    raw = String(raw == null ? "" : raw);
    ext = (ext || "").toLowerCase();
    if (ext === "py") return hlPython(raw);
    if (ext === "js" || ext === "ts") return hlJs(raw);
    if (ext === "ini" || ext === "cfg" || ext === "properties") return hlIni(raw);
    if (ext === "json") return hlGeneric(raw);
    if (ext === "env") return hlEnv(raw);
    if (ext === "md") return hlMd(raw);
    if (ext === "yaml" || ext === "yml") return hlYaml(raw);
    if (ext === "xml" || ext === "html" || ext === "htm") return hlXml(raw);
    return esc(raw);
  }
  function hlParts(src, next) {
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const hit = next(src, i);
      if (!hit) { out.push(esc(src.slice(i))); break; }
      if (hit.start > i) out.push(esc(src.slice(i, hit.start)));
      if (hit.cls) out.push('<span class="' + hit.cls + '">' + esc(src.slice(hit.start, hit.end)) + "</span>");
      else out.push(esc(src.slice(hit.start, hit.end)));
      i = hit.end;
      if (hit.end <= hit.start) { out.push(esc(src.slice(i))); break; }
    }
    return out.join("");
  }
  function hlPython(src) {
    const kw = /^(def|class|return|import|from|as|if|elif|else|for|while|try|except|finally|with|yield|lambda|pass|break|continue|and|or|not|in|is|None|True|False|self|async|await)\b/;
    return hlParts(src, function (s, i) {
      if (s[i] === "#") { const e = s.indexOf("\n", i); return { start: i, end: e < 0 ? s.length : e, cls: "c" }; }
      const tq = String.fromCharCode(34, 34, 34);
      const tqs = String.fromCharCode(39, 39, 39);
      if (s.startsWith(tq, i) || s.startsWith(tqs, i)) {
        const q = s.slice(i, i + 3); const e = s.indexOf(q, i + 3); return { start: i, end: e < 0 ? s.length : e + 3, cls: "s" };
      }
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i]; let j = i + 1;
        while (j < s.length && s[j] !== q) { if (s[j] === "\\") j++; j++; }
        return { start: i, end: Math.min(s.length, j + 1), cls: "s" };
      }
      if (s.startsWith("def ", i) || s.startsWith("class ", i)) {
        const m = s.slice(i).match(/^(def|class)\s+(\w+)/);
        if (m) return { start: i + m[1].length + 1, end: i + m[0].length, cls: "f" };
      }
      if (/[A-Za-z_]/.test(s[i])) {
        const m = s.slice(i).match(/^[A-Za-z_]\w*/);
        if (m && kw.test(m[0])) return { start: i, end: i + m[0].length, cls: "k" };
        return { start: i, end: i + (m ? m[0].length : 1), cls: "" };
      }
      return null;
    });
  }
  function hlJs(src) {
    const kw = /^(function|const|let|var|return|import|from|export|as|if|else|for|while|try|catch|finally|class|new|this|async|await|true|false|null|undefined)\b/;
    return hlParts(src, function (s, i) {
      if (s.startsWith("//", i)) { const e = s.indexOf("\n", i); return { start: i, end: e < 0 ? s.length : e, cls: "c" }; }
      if (s.startsWith("/*", i)) { const e = s.indexOf("*/", i + 2); return { start: i, end: e < 0 ? s.length : e + 2, cls: "c" }; }
      if (s[i] === '"' || s[i] === "'" || s[i] === "`") {
        const q = s[i]; let j = i + 1;
        while (j < s.length && s[j] !== q) { if (s[j] === "\\") j++; j++; }
        return { start: i, end: Math.min(s.length, j + 1), cls: "s" };
      }
      if (/[A-Za-z_$]/.test(s[i])) {
        const m = s.slice(i).match(/^[A-Za-z_$][\w$]*/);
        if (m && kw.test(m[0])) return { start: i, end: i + m[0].length, cls: "k" };
        return { start: i, end: i + (m ? m[0].length : 1), cls: "" };
      }
      return null;
    });
  }
  function hlIni(src) {
    return src.split("\n").map(function (line) {
      if (/^\s*[;#]/.test(line)) return '<span class="c">' + esc(line) + "</span>";
      if (/^\s*\[/.test(line)) return '<span class="sec">' + esc(line) + "</span>";
      const m = line.match(/^(\s*[^=]+?)(\s*=\s*)(.*)$/);
      if (m) return '<span class="key">' + esc(m[1]) + "</span>" + esc(m[2]) + '<span class="s">' + esc(m[3]) + "</span>";
      return esc(line);
    }).join("\n");
  }
  function hlEnv(src) {
    return src.split("\n").map(function (line) {
      if (/^\s*#/.test(line)) return '<span class="c">' + esc(line) + "</span>";
      const m = line.match(/^(\s*[^=]+)(\s*=\s*)(.*)$/);
      if (m) return '<span class="key">' + esc(m[1]) + "</span>" + esc(m[2]) + '<span class="s">' + esc(m[3]) + "</span>";
      return esc(line);
    }).join("\n");
  }
  function hlMd(src) {
    return esc(src).replace(/^#{1,6} .+$/gm, function (m) { return '<span class="k">' + m + "</span>"; })
      .replace(/`[^`]+`/g, function (m) { return '<span class="s">' + m + "</span>"; });
  }
  function hlYaml(src) {
    return src.split("\n").map(function (line) {
      if (/^\s*#/.test(line)) return '<span class="c">' + esc(line) + "</span>";
      const m = line.match(/^(\s*[\w-]+\s*:)(\s*)(.*)$/);
      if (m) return '<span class="key">' + esc(m[1]) + "</span>" + esc(m[2]) + '<span class="s">' + esc(m[3]) + "</span>";
      return esc(line);
    }).join("\n");
  }
  function hlXml(src) {
    return esc(src)
      .replace(/&lt;!--[\s\S]*?--&gt;/g, function (m) { return '<span class="c">' + m + "</span>"; })
      .replace(/&lt;\/?[\w:-]+/g, function (m) { return '<span class="k">' + m + "</span>"; })
      .replace(/&gt;/g, '<span class="k">&gt;</span>');
  }
  function hlGeneric(src) {
    return esc(src).replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, function (m) { return '<span class="s">' + m + "</span>"; });
  }

  function histHtml() {
    const vs = (FW.file && FW.file.versions) || [];
    const rows = vs.map(function (v) {
      return '<label><input type="checkbox" data-ver="' + v.version + '"> v' + v.version + " · " + esc(v.created || "") + " · " + esc(v.author || "") + "</label>";
    }).join("") || '<div class="sub">No versions yet.</div>';
    return '<div class="fw-side" id="fwHistBox"><b>Version history (IST)</b>' + rows + '<div style="margin-top:8px"><button type="button" class="btn g sm" id="fwCmp">Compare selected</button></div><div id="fwCmpOut"></div></div>';
  }

  function showTreeMenu(x, y, path, isDir) {
    closeFwMenu();
    const m = document.createElement("div");
    m.className = "fw-menu"; m.id = "fwMenu";
    m.style.left = x + "px"; m.style.top = y + "px";
    m.innerHTML = '<div data-a="newf">New file</div><div data-a="newd">New folder</div>'
      + (path ? '<div data-a="ren">Rename</div><div data-a="del">Delete</div>' : "");
    document.body.appendChild(m);
    $$("div[data-a]", m).forEach(function (b) {
      b.onclick = function () { closeFwMenu(); treeAction(b.dataset.a, path, isDir); };
    });
    setTimeout(function () { document.addEventListener("click", closeFwMenu, { once: true }); }, 0);
  }
  function closeFwMenu() { const m = $("#fwMenu"); if (m) m.remove(); }

  async function treeAction(act, path, isDir) {
    const parent = isDir ? path : (path || "").split("/").slice(0, -1).join("/");
    const prefix = parent && !/\/$/.test(parent) ? parent + "/" : (parent || "");
    try {
      if (act === "newf") {
        const name = prompt("New file name (relative to folder):");
        if (!name) return;
        await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/files", { method: "POST", body: { path: prefix + name.replace(/^\/+/, ""), content: "" } });
      } else if (act === "newd") {
        const name = prompt("New folder name:");
        if (!name) return;
        await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/files", { method: "POST", body: { path: prefix + name.replace(/^\/+/, "").replace(/\/?$/, "/") + "/", is_dir: true } });
      } else if (act === "ren") {
        const cur = (path || "").replace(/\/$/, "").split("/").pop();
        const name = prompt("Rename to:", cur);
        if (!name || name === cur) return;
        const dest = ((path || "").replace(/\/$/, "").split("/").slice(0, -1).concat([name]).join("/")) + (isDir ? "/" : "");
        await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/files", { method: "PUT", body: { path: path, new_path: dest } });
        if (FW.path === path) FW.path = dest;
      } else if (act === "del") {
        if (!confirm("Delete " + path + "?")) return;
        await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/files?path=" + encodeURIComponent(path), { method: "DELETE" });
        if (FW.path === path) { FW.path = ""; FW.file = null; }
        delete FW.unsaved[path];
      }
      await reloadTree();
    } catch (e) { toast(e.message || String(e)); }
  }

  async function moveFile(src, destDir) {
    const name = (src || "").replace(/\/$/, "").split("/").pop();
    const dest = (destDir.endsWith("/") ? destDir : destDir + "/") + name;
    try {
      await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/files", { method: "PUT", body: { path: src, new_path: dest } });
      if (FW.path === src) FW.path = dest;
      if (FW.unsaved[src]) { FW.unsaved[dest] = FW.unsaved[src]; delete FW.unsaved[src]; }
      await reloadTree();
    } catch (e) { toast(e.message || String(e)); }
  }

  function envHtml() {
    const prev = FW.preview || {};
    const rows = (prev.rows || []).slice();
    const envs = (FW.tree || []).filter(function (f) { return !f.is_dir && isEnvPath(f.path); });
    const tabs = envs.map(function (f) {
      const n = f.path.split("/").pop();
      const on = f.path === FW.path ? " a" : "";
      const cls = /staging/i.test(n) ? "stg" : "";
      return '<button type="button" class="' + cls + on + '" data-env="' + esc(f.path) + '">' + esc(n) + "</button>";
    }).join("");
    return '<div class="fw-sheet">' + tabs + '</div><div class="fw-kv"><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>'
      + rows.map(function (r, i) {
        const masked = isSecretKey(r.key);
        return '<tr><td><input data-ek="' + i + '" value="' + esc(r.key) + '"></td><td><input data-ev="' + i + '" class="' + (masked ? "fw-mask" : "") + '" type="' + (masked ? "password" : "text") + '" value="' + esc(r.value) + '"></td></tr>';
      }).join("")
      + '</tbody></table><button type="button" class="btn g sm" id="fwEnvAdd">Add variable</button></div>';
  }

  function previewHtml() {
    const pr = FW.preview || {};
    const kind = pr.kind || "text";
    const used = ((FW.file && FW.file.used_by) || []).map(function (id) { return '<span class="fw-chip ready">' + esc(id) + "</span>"; }).join(" ") || '<span class="sub">Not used by a test yet.</span>';
    const mode = FW.previewMode || "table";
    const toggles = '<div class="fw-filters"><button type="button" class="btn g sm' + (mode === "table" ? " on" : "") + '" data-pm="table">Table</button>'
      + '<button type="button" class="btn g sm' + (mode === "tree" ? " on" : "") + '" data-pm="tree">Tree</button>'
      + '<button type="button" class="btn g sm' + (mode === "raw" ? " on" : "") + '" data-pm="raw">Raw</button>'
      + (kind === "json" || kind === "xml" || kind === "yaml" ? (pr.ok ? '<span class="fw-ok">Syntax OK</span>' : '<span class="fw-err">Syntax error</span>') : "")
      + '<span style="flex:1"></span><span>Used by ' + used + "</span></div>";
    if (pr.errors && pr.errors.length && kind === "xlsx" && !(pr.sheets && Object.keys(pr.sheets).length)) {
      return toggles + '<div class="sub">' + esc((pr.errors[0] && (pr.errors[0].message || pr.errors[0])) || "Preview unavailable") + "</div>";
    }
    if (mode === "raw") return toggles + '<textarea id="fwRaw" style="width:100%;height:100%;min-height:280px;border:0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">' + esc(pr.raw != null ? pr.raw : currentContent()) + "</textarea>";
    if (kind === "xlsx") return toggles + xlsxHtml(pr);
    if (kind === "csv") return toggles + gridHtml(pr.header || [], pr.rows || [], pr);
    if ((kind === "json" || kind === "xml" || kind === "yaml") && mode === "tree") return toggles + '<div class="fw-tree-json">' + treeNodes(pr.tree || []) + "</div>";
    if (kind === "yaml" && pr.table) return toggles + gridHtml(pr.table.header || [], pr.table.rows || [], pr);
    if (kind === "json" || kind === "xml") return toggles + '<div class="fw-tree-json">' + treeNodes(pr.tree || []) + "</div>";
    return toggles + '<pre style="padding:8px;white-space:pre-wrap">' + esc(pr.raw || currentContent()) + "</pre>";
  }
  function xlsxHtml(pr) {
    const sheets = pr.sheets || {};
    const names = Object.keys(sheets);
    FW.sheet = FW.sheet && sheets[FW.sheet] ? FW.sheet : names[0] || "";
    const sh = sheets[FW.sheet] || { header: [], rows: [] };
    const tabs = names.map(function (n) { return '<button type="button" class="' + (n === FW.sheet ? "a" : "") + '" data-sheet="' + esc(n) + '">' + esc(n) + "</button>"; }).join("");
    return '<div class="fw-sheet">' + tabs + "</div>" + gridHtml(sh.header || [], sh.rows || [], pr);
  }
  function gridHtml(header, rows, pr) {
    const errRows = {};
    ((pr && pr.errors) || []).forEach(function (e) { if (e.row != null) errRows[e.row] = e.message || "invalid"; });
    let h = '<div class="fw-prev"><table><thead><tr>' + (header || []).map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
    (rows || []).forEach(function (r, i) {
      const cells = Array.isArray(r) ? r : (header || []).map(function (c) { return r[c]; });
      h += '<tr class="' + (errRows[i] ? "fw-err" : "") + '">' + cells.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>";
    });
    return h + "</tbody></table></div>";
  }
  function treeNodes(nodes) {
    return (nodes || []).map(function (n) {
      const kids = n.children && n.children.length ? treeNodes(n.children) : "";
      return '<div style="margin-left:12px"><span class="k">' + esc(n.name || n.key || "") + "</span>"
        + (n.type ? '<span class="t">' + esc(n.type) + "</span>" : "")
        + (n.value != null && !n.children ? " = " + esc(String(n.value)) : "")
        + (n.attrs ? " " + esc(JSON.stringify(n.attrs)) : "")
        + kids + "</div>";
    }).join("");
  }

  function locHtml() {
    const rows = FW.locators || [];
    return '<div class="fw-ed" style="padding:8px;overflow:auto;width:100%"><div class="fw-filters"><button type="button" class="btn g sm" id="fwLocAdd">Add locator</button><button type="button" class="btn sm" id="fwLocAi">Suggest with AI</button><button type="button" class="btn sm" id="fwLocSave">Save locators</button></div><table><thead><tr><th>Name</th><th>Strategy</th><th>Value</th><th>Page</th><th>Status</th></tr></thead><tbody>'
      + rows.map(function (r, i) {
        return '<tr><td><input data-loc="' + i + '" data-f="name" value="' + esc(r.name) + '"></td><td><select data-loc="' + i + '" data-f="strategy">'
          + ["css", "xpath", "id", "name", "testid"].map(function (s) { return "<option" + (r.strategy === s ? " selected" : "") + ">" + s + "</option>"; }).join("")
          + '</select></td><td><input data-loc="' + i + '" data-f="value" value="' + esc(r.value) + '"></td><td><input data-loc="' + i + '" data-f="page" value="' + esc(r.page) + '"></td><td><input data-loc="' + i + '" data-f="status" value="' + esc(r.status || "Draft") + '"></td></tr>';
      }).join("") + "</tbody></table></div>";
  }
  function asrtHtml() {
    const rows = FW.assertions || [];
    return '<div class="fw-ed" style="padding:8px;overflow:auto;width:100%"><div class="fw-filters"><button type="button" class="btn g sm" id="fwAsAdd">Add assertion</button><button type="button" class="btn sm" id="fwAsAi">Suggest with AI</button><button type="button" class="btn sm" id="fwAsSave">Save assertions</button></div><table><thead><tr><th>TC</th><th>Type</th><th>Target</th><th>Expected</th></tr></thead><tbody>'
      + rows.map(function (r, i) {
        return '<tr><td><input data-asrt="' + i + '" data-f="tc_id" value="' + esc(r.tc_id) + '"></td><td><input data-asrt="' + i + '" data-f="typ" value="' + esc(r.typ || r.type || "") + '"></td><td><input data-asrt="' + i + '" data-f="target" value="' + esc(r.target) + '"></td><td><input data-asrt="' + i + '" data-f="expected" value="' + esc(r.expected) + '"></td></tr>';
      }).join("") + "</tbody></table></div>";
  }
  function mapHtml() {
    const m = FW.mapping || { columns: [], rows: [], params: [] };
    return '<div class="fw-ed" style="padding:8px;overflow:auto;width:100%"><div class="sub">Map columns in this file to test parameters. Each data row becomes one run.</div>'
      + '<label>Test case <input id="fwMapTc" value="' + esc(m.tc_id || "") + '" placeholder="TC001"></label>'
      + '<div id="fwMapBody"></div><button type="button" class="btn sm" id="fwMapSave">Save mapping</button></div>';
  }

  function bindMain(main, side) {
    if (!main) return;
    side = side || main.dataset.side || "left";
    main.addEventListener("mousedown", function () { FW.splitFocus = side; });
    $$("[data-pane]", main).forEach(function (b) {
      b.onclick = async function () {
        if (side === "right") FW.viewPaneRight = b.dataset.pane;
        else FW.viewPane = b.dataset.pane;
        const pane = b.dataset.pane;
        if (pane === "loc") await loadLocators();
        if (pane === "asrt") await loadAssertions();
        if (pane === "map") await loadMapping();
        paintProject($("#fwHost"));
      };
    });
    const code = $("#fwCode", main) || $("#fwCodeR", main);
    if (code) bindEditor(code, side);
    const raw = $("#fwRaw", main);
    if (raw) raw.oninput = function () {
      const path = raw.dataset.path || (side === "right" ? FW.splitPath : FW.path);
      FW.unsaved[path] = raw.value;
      markDirtyUi(main, path);
    };
    const act = function (name) { return main.querySelector('[data-act="' + name + '"]'); };
    const splitBtn = act("split");
    if (splitBtn) splitBtn.onclick = function () {
      if (FW.split) {
        FW.split = false;
        FW.splitPath = "";
        FW.splitFile = null;
        FW.splitFocus = "left";
      } else {
        if (FW.file && FW.file.is_dir) return;
        FW.split = true;
        FW.splitFocus = "right";
        if (!FW.splitPath) FW.splitFile = null;
      }
      paintProject($("#fwHost"));
    };
    const fullBtn = act("full");
    if (fullBtn) fullBtn.onclick = function () { FW.full = !FW.full; paintProject($("#fwHost")); };
    const histBtn = act("hist");
    if (histBtn) histBtn.onclick = function () { if (side === "left") { FW.showHist = !FW.showHist; paintProject($("#fwHost")); } };
    const saveBtn = act("save");
    if (saveBtn) saveBtn.onclick = function () { saveCurrent(side); };
    if ($("#fwCmp", main)) $("#fwCmp", main).onclick = function () { compareVersions(); };
    $$("[data-env]", main).forEach(function (b) { b.onclick = function () { openFile(b.dataset.env); }; });
    $$("[data-pm]", main).forEach(function (b) { b.onclick = function () { FW.previewMode = b.dataset.pm; paintProject($("#fwHost")); }; });
    $$("[data-sheet]", main).forEach(function (b) { b.onclick = function () { FW.sheet = b.dataset.sheet; paintProject($("#fwHost")); }; });
    if ($("#fwEnvAdd", main)) $("#fwEnvAdd", main).onclick = function () { addEnvRow(); };
    $$("[data-ek],[data-ev]", main).forEach(function (inp) { inp.oninput = function () { collectEnv(); }; });
    if ($("#fwLocAdd", main)) $("#fwLocAdd", main).onclick = function () { FW.locators.push({ name: "", strategy: "css", value: "", page: "", status: "Draft" }); paintProject($("#fwHost")); };
    if ($("#fwAsAdd", main)) $("#fwAsAdd", main).onclick = function () { FW.assertions.push({ tc_id: "", typ: "", target: "", expected: "" }); paintProject($("#fwHost")); };
    if ($("#fwLocSave", main)) $("#fwLocSave", main).onclick = function () { saveLocators(); };
    if ($("#fwAsSave", main)) $("#fwAsSave", main).onclick = function () { saveAssertions(); };
    if ($("#fwLocAi", main)) $("#fwLocAi", main).onclick = function () { suggestAi("locator"); };
    if ($("#fwAsAi", main)) $("#fwAsAi", main).onclick = function () { suggestAi("assertion"); };
    $$("[data-loc]", main).forEach(function (inp) { inp.oninput = inp.onchange = function () { const i = +inp.dataset.loc; if (FW.locators[i]) FW.locators[i][inp.dataset.f] = inp.value; }; });
    $$("[data-asrt]", main).forEach(function (inp) { inp.oninput = function () { const i = +inp.dataset.asrt; if (FW.assertions[i]) FW.assertions[i][inp.dataset.f] = inp.value; }; });
    if ($("#fwMapSave", main)) $("#fwMapSave", main).onclick = function () { saveMapping(); };
    bindEmptyState(main);
    bindFolderSummary(main);
  }

  function bindEditor(ta, side) {
    const wrap = ta.closest(".fw-edwrap");
    const path = ta.dataset.path || (side === "right" ? FW.splitPath : FW.path);
    function caretPos() {
      const v = ta.value;
      const pos = ta.selectionStart || 0;
      const before = v.slice(0, pos);
      const line = before.split("\n").length;
      const col = (before.split("\n").pop() || "").length + 1;
      if (side === "right") { FW.cursorLineR = line; FW.cursorColR = col; }
      else { FW.cursorLine = line; FW.cursorCol = col; }
      const stat = document.querySelector('.fw-stat[data-stat="' + side + '"] .fw-lncol');
      if (stat) stat.textContent = "Ln " + line + ", Col " + col;
      if (wrap) {
        $$("i", wrap.querySelector(".fw-ln") || wrap).forEach(function (el, i) {
          el.classList.toggle("cur", i + 1 === line);
        });
      }
    }
    function syncScroll() {
      if (!wrap) return;
      const hl = wrap.querySelector(".fw-hl");
      const gut = wrap.querySelector(".fw-ln");
      if (hl) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
      if (gut) gut.scrollTop = ta.scrollTop;
    }
    function refresh() {
      if (wrap) {
        const hl = wrap.querySelector(".fw-hl");
        if (hl) hl.innerHTML = highlightCode(ta.value, extOf(path));
        const gut = wrap.querySelector(".fw-ln");
        if (gut) {
          const n = String(ta.value || "").split("\n").length;
          const cur = side === "right" ? (FW.cursorLineR || 1) : (FW.cursorLine || 1);
          if (gut.children.length !== n) {
            let html = "";
            for (let i = 1; i <= n; i++) html += '<i class="' + (i === cur ? "cur" : "") + '">' + i + "</i>";
            gut.innerHTML = html;
          }
        }
      }
      syncScroll();
      const orig = paneOriginal(path, side);
      if (ta.value !== orig) FW.unsaved[path] = ta.value;
      else delete FW.unsaved[path];
      markDirtyUi(ta.closest(".fw-main"), path);
    }
    ta.oninput = function () { caretPos(); refresh(); };
    ta.onkeyup = ta.onclick = ta.onselect = function () { caretPos(); };
    ta.onscroll = syncScroll;
    ta.onfocus = function () { FW.splitFocus = side; };
  }

  function paneOriginal(path, side) {
    if (side === "right" && FW.splitFile && FW.splitPath === path) return FW.splitFile.content || "";
    if (FW.file && FW.path === path) return FW.file.content || "";
    return "";
  }

  function markDirtyUi(main, path) {
    const dirty = Object.prototype.hasOwnProperty.call(FW.unsaved, path);
    if (main) {
      const save = main.querySelector('[data-act="save"]');
      if (save) save.disabled = !dirty;
      const fn = main.querySelector(".fw-fcard .fn");
      if (fn) {
        let dot = fn.querySelector(".udot");
        if (dirty && !dot) {
          dot = document.createElement("span");
          dot.className = "udot";
          dot.title = "Unsaved changes";
          fn.appendChild(dot);
        } else if (!dirty && dot) dot.remove();
      }
    }
    const t = $("#fwT");
    if (t) { t.innerHTML = treeHtml(FW.tree); bindTreeRows(t); }
  }

  function bindEmptyState(main) {
    const gen = $("#fwEmptyGen", main);
    if (gen) gen.onclick = function () { openWizard(); };
    const read = $("#fwEmptyRead", main);
    if (read) read.onclick = function () {
      const row = (FW.tree || []).find(function (r) { return /(?:^|\/)readme\.md$/i.test(r.path || ""); });
      if (row) openFile(row.path);
      else toast("No README.md in this project yet.");
    };
    const data = $("#fwEmptyData", main);
    if (data) data.onclick = function () {
      const folder = (FW.tree || []).find(function (r) {
        return r.is_dir && (r.path === "test_data" || r.path === "test_data/");
      });
      if (folder) openFolder(folder.path);
      else treeAction("newf", "test_data/", true);
    };
  }

  function bindFolderSummary(main) {
    $$("[data-open]", main).forEach(function (card) {
      card.onclick = function () {
        if (card.dataset.dir === "1") openFolder(card.dataset.open);
        else openFile(card.dataset.open);
      };
    });
    const folder = (FW.file && FW.file.is_dir) ? FW.path : "";
    if ($("#fwFoldNew", main)) $("#fwFoldNew", main).onclick = function () { treeAction("newf", folder, true); };
    if ($("#fwFoldRen", main)) $("#fwFoldRen", main).onclick = function () { treeAction("ren", folder, true); };
    if ($("#fwFoldUp", main)) $("#fwFoldUp", main).onclick = function () { uploadInto(folder); };
  }

  function bytesToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function uploadInto(folder) {
    let inp = document.getElementById("fwUpload");
    if (!inp) {
      inp = document.createElement("input");
      inp.type = "file";
      inp.id = "fwUpload";
      inp.style.display = "none";
      document.body.appendChild(inp);
    }
    inp.value = "";
    inp.onchange = async function () {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const dest = (folder ? normDir(folder) : "") + f.name;
      try {
        if (/\.xlsx$/i.test(f.name)) {
          const buf = await f.arrayBuffer();
          await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/import-xlsx", {
            method: "POST",
            body: { path: dest, content_base64: bytesToBase64(buf) },
          });
        } else {
          const text = await f.text();
          try {
            await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/files", { method: "PUT", body: { path: dest, content: text, note: "Uploaded" } });
          } catch (e1) {
            await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/files", { method: "POST", body: { path: dest, content: text } });
          }
        }
        toast("Uploaded " + f.name);
        FW.markers[dest] = "new";
        await reloadTree();
        await openFile(dest);
      } catch (e) { toast(e.message || String(e)); }
    };
    inp.click();
  }

  async function saveCurrent(side) {
    side = side || FW.splitFocus || "left";
    const path = side === "right" ? FW.splitPath : FW.path;
    if (!path) return;
    const content = currentContent(path);
    try {
      await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/files", { method: "PUT", body: { path: path, content: content, note: "Edited" } });
      delete FW.unsaved[path];
      toast("Saved");
      if (side === "right") await openFileIn("right", path);
      else await openFile(path);
    } catch (e) { toast(e.message || String(e)); }
  }

  function addEnvRow() {
    FW.preview = FW.preview || { kind: "env", rows: [] };
    FW.preview.rows = FW.preview.rows || [];
    FW.preview.rows.push({ key: "", value: "" });
    paintProject($("#fwHost"));
  }
  function collectEnv() {
    const rows = [];
    $$("[data-ek]").forEach(function (k) {
      const i = k.dataset.ek;
      const v = document.querySelector('[data-ev="' + i + '"]');
      rows.push({ key: k.value, value: v ? v.value : "" });
    });
    const text = rows.map(function (r) { return r.key ? (r.key + "=" + (r.value || "")) : ""; }).filter(Boolean).join("\n") + "\n";
    FW.preview = FW.preview || { kind: "env" }; FW.preview.rows = rows;
    FW.unsaved[FW.path] = text;
    markDirtyUi($("#fwMain") || document.querySelector(".fw-main"), FW.path);
  }

  async function compareVersions() {
    const sel = $$("#fwHistBox input[data-ver]:checked").map(function (i) { return i.dataset.ver; });
    if (sel.length !== 2) { toast("Select two versions to compare."); return; }
    try {
      const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/file/compare?path=" + encodeURIComponent(FW.path) + "&a=" + sel[0] + "&b=" + sel[1]);
      const a = String(j.left || j.content_a || "").split("\n");
      const b = String(j.right || j.content_b || "").split("\n");
      const out = $("#fwCmpOut"); if (out) out.innerHTML = diffHtml(a.join("\n"), b.join("\n"));
    } catch (e) { toast(e.message || String(e)); }
  }

  async function loadLocators() {
    if (!FW.fid) return;
    try { const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/locators"); FW.locators = j.locators || []; } catch (e) { FW.locators = []; }
  }
  async function loadAssertions() {
    if (!FW.fid) return;
    try { const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/assertions"); FW.assertions = j.assertions || []; } catch (e) { FW.assertions = []; }
  }
  async function loadMapping() {
    if (!FW.fid || !FW.path) return;
    try { const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/mapping?path=" + encodeURIComponent(FW.path)); const first = (j.mappings && j.mappings[0]) || j.mapping || {}; FW.mapping = { tc_id: first.tc_id || "", mapping: first.mapping || [] }; } catch (e) { FW.mapping = { tc_id: "", mapping: [] }; }
  }
  async function saveLocators() {
    try { await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/locators", { method: "PUT", body: { locators: FW.locators } }); toast("Locators saved"); } catch (e) { toast(e.message || String(e)); }
  }
  async function saveAssertions() {
    try { await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/assertions", { method: "PUT", body: { assertions: FW.assertions } }); toast("Assertions saved"); } catch (e) { toast(e.message || String(e)); }
  }
  async function saveMapping() {
    const tc = ($("#fwMapTc") && $("#fwMapTc").value) || (FW.mapping && FW.mapping.tc_id) || "";
    try { await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/mapping", { method: "PUT", body: { file_path: FW.path, tc_id: tc, mapping: (FW.mapping && FW.mapping.mapping) || [] } }); toast("Mapping saved"); } catch (e) { toast(e.message || String(e)); }
  }

  function pickAi(title) {
    return new Promise(function (resolve, reject) {
      if (typeof openAiPicker !== "function") { resolve({ provider: "", model: "" }); return; }
      openAiPicker({
        title: title || "Choose a model",
        kind: "automation",
        onConfirm: function (picked) { resolve(picked || {}); },
        onCancel: function () { reject(new Error("cancelled")); },
      });
    });
  }

  async function suggestAi(kind) {
    try {
      const picked = await pickAi("Suggest " + kind + " with AI");
      const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/suggest", {
        method: "POST",
        body: { kind: kind, path: FW.path, provider: picked.provider, model: picked.model, instruction: picked.instruction || "" },
      });
      const sug = j.suggestion || j.item || {};
      if (kind === "locator") FW.locators = (FW.locators || []).concat(j.locators || j.items || [sug]);
      else if (kind === "assertion") {
        const items = j.assertions || j.items || [sug];
        items.forEach(function (it) { if (it && it.type && !it.typ) it.typ = it.type; });
        FW.assertions = (FW.assertions || []).concat(items);
      } else if (kind === "data" && (j.preview || sug.rows)) FW.preview = j.preview || sug;
      paintProject($("#fwHost"));
      toast("Suggestion added");
    } catch (e) {
      if (String(e.message) === "cancelled") return;
      toast(e.message || String(e));
    }
  }

  function openWizard() {
    FW.wiz = { step: 1, cases: [], sel: {}, filter: "all", tab: "all", preview: null, context: "", changes: null, result: null };
    const ov = document.createElement("div");
    ov.className = "fw-wiz"; ov.id = "fwWiz";
    ov.innerHTML = '<div class="box"><div class="hd"><h2>Generate into project framework</h2><span style="flex:1"></span><div class="fw-steps" id="fwWizSteps"></div></div><div class="bd" id="fwWizBd">Loading…</div><div class="ft" id="fwWizFt"></div></div>';
    document.body.appendChild(ov);
    paintWiz();
  }
  function closeWiz() { const ov = $("#fwWiz"); if (ov) ov.remove(); }

  function paintWiz() {
    const w = FW.wiz; if (!w || !$("#fwWiz")) return;
    $("#fwWizSteps").innerHTML = ["1. Choose test cases", "2. Generate", "3. Review & Run"].map(function (s, i) {
      return "<span class=\"" + (w.step === i + 1 ? "a" : "") + "\">" + s + "</span>";
    }).join(" → ");
    if (w.step === 1) paintWiz1();
    else if (w.step === 2) paintWiz2();
    else paintWiz3();
  }

  async function paintWiz1() {
    $("#fwWizBd").innerHTML = "Loading test cases…";
    let cases = [];
    try {
      const repo = await api("/api/repo");
      cases = repo.cases || [];
    } catch (e) { $("#fwWizBd").innerHTML = '<div class="error">' + esc(e.message) + "</div>"; return; }
    const ids = cases.map(function (c) { return c.id; }).filter(Boolean);
    let status = {};
    try {
      const st = await fwApi("/tc-status?ids=" + encodeURIComponent(ids.join(",")) + "&project=" + encodeURIComponent(projectId()));
      status = st.statuses || {};
    } catch (e) {}
    wCases(cases, status);
  }

  function wCases(cases, status) {
    FW.wiz.cases = cases; FW.wiz.status = status || FW.wiz.status || {};
    const tab = FW.wiz.tab || "all";
    const filter = FW.wiz.filter || "all";
    let list = cases.slice();
    if (tab === "recent") {
      list = list.filter(function (c) { const s = FW.wiz.status[c.id]; return s && (s.status === "regen" || s.status === "ready"); })
        .sort(function (a, b) { return String((FW.wiz.status[b.id] || {}).generated_at || "").localeCompare(String((FW.wiz.status[a.id] || {}).generated_at || "")); })
        .slice(0, 30);
    }
    if (filter === "none") list = list.filter(function (c) { return !FW.wiz.status[c.id] || FW.wiz.status[c.id].status === "none"; });
    const selId = FW.wiz.previewId;
    const prev = list.find(function (c) { return c.id === selId; }) || list[0];
    if (prev) FW.wiz.previewId = prev.id;
    const rows = list.map(function (c) {
      const st = FW.wiz.status[c.id] || { status: "none", label: "No script" };
      const on = c.id === FW.wiz.previewId ? " a" : "";
      const checked = FW.wiz.sel[c.id] ? " checked" : "";
      return '<div class="row' + on + '" data-cid="' + esc(c.id) + '"><input type="checkbox"' + checked + ' data-ck="' + esc(c.id) + '"><div><b>' + esc(c.id) + "</b> " + esc(c.title || c.name || "") + " " + chip(st) + "</div></div>";
    }).join("") || '<div class="fw-empty">No test cases in this view.</div>';
    const ptab = FW.wiz.ptab || "steps";
    $("#fwWizBd").innerHTML = '<div class="fw-filters"><button type="button" class="btn g sm' + (tab === "all" ? " on" : "") + '" data-wtab="all">All</button>'
      + '<button type="button" class="btn g sm' + (tab === "recent" ? " on" : "") + '" data-wtab="recent">Recently generated</button>'
      + '<label><input type="checkbox" id="fwNotAuto"' + (filter === "none" ? " checked" : "") + "> Not automated yet</label>"
      + '<span class="sub">' + Object.keys(FW.wiz.sel).filter(function (k) { return FW.wiz.sel[k]; }).length + " selected</span></div>"
      + '<div class="fw-case"><div class="list" id="fwWizList">' + rows + '</div><div class="prev" id="fwWizPrev">'
      + '<div class="fw-filters"><button type="button" class="btn g sm' + (ptab === "steps" ? " on" : "") + '" data-ptab="steps">Steps</button>'
      + '<button type="button" class="btn g sm' + (ptab === "code" ? " on" : "") + '" data-ptab="code">Code</button></div>'
      + previewCaseHtml(prev, ptab) + "</div></div>";
    $("#fwWizFt").innerHTML = '<button type="button" class="btn g" id="fwWizX">Cancel</button><button type="button" class="btn" id="fwWizNext">Continue</button>';
    bindWiz1();
  }
  function chip(st) {
    const s = (st && st.status) || "none";
    return '<span class="fw-chip ' + s + '">' + esc((st && st.label) || s) + "</span>";
  }
  function previewCaseHtml(c, tab) {
    if (!c) return '<div class="sub">Select a test case to preview.</div>';
    if (tab === "code") {
      const st = (FW.wiz.status && FW.wiz.status[c.id]) || {};
      const files = st.files || (st.file_path ? [st.file_path] : []);
      if (!files.length) return '<div class="sub">No script yet for ' + esc(c.id) + ".</div>";
      return '<div class="sub">Script file' + (files.length > 1 ? "s" : "") + ": " + files.map(esc).join(", ") + '</div><pre id="fwCodePrev" style="white-space:pre-wrap;font-size:12px">Loading…</pre>';
    }
    const steps = c.steps || [];
    if (!steps.length) return "<b>" + esc(c.id) + " · " + esc(c.title || c.name || "") + '</b><div class="sub">No steps recorded.</div>';
    return "<b>" + esc(c.id) + " · " + esc(c.title || c.name || "") + "</b><ol>" + steps.map(function (s) {
      return "<li>" + esc(s.step || s.description || "") + (s.expected ? ' <span class="sub">→ ' + esc(s.expected) + "</span>" : "") + "</li>";
    }).join("") + "</ol>";
  }
  function bindWiz1() {
    $("#fwWizX").onclick = closeWiz;
    $("#fwWizNext").onclick = function () {
      const n = Object.keys(FW.wiz.sel).filter(function (k) { return FW.wiz.sel[k]; }).length;
      if (!n) { toast("Select at least one test case."); return; }
      FW.wiz.step = 2; paintWiz();
    };
    if ($("#fwNotAuto")) $("#fwNotAuto").onchange = function () { FW.wiz.filter = this.checked ? "none" : "all"; wCases(FW.wiz.cases, FW.wiz.status); };
    $$("[data-wtab]").forEach(function (b) { b.onclick = function () { FW.wiz.tab = b.dataset.wtab; wCases(FW.wiz.cases, FW.wiz.status); }; });
    $$("[data-ptab]").forEach(function (b) { b.onclick = function () { FW.wiz.ptab = b.dataset.ptab; wCases(FW.wiz.cases, FW.wiz.status); loadCodePreview(); }; });
    $$("#fwWizList .row").forEach(function (r) {
      r.onclick = function (e) {
        if (e.target && e.target.dataset && e.target.dataset.ck != null) return;
        FW.wiz.previewId = r.dataset.cid; wCases(FW.wiz.cases, FW.wiz.status); loadCodePreview();
      };
    });
    $$("[data-ck]").forEach(function (ck) {
      ck.onchange = function (e) { e.stopPropagation(); FW.wiz.sel[ck.dataset.ck] = ck.checked; };
    });
    loadCodePreview();
  }
  async function loadCodePreview() {
    if ((FW.wiz.ptab || "steps") !== "code") return;
    const id = FW.wiz.previewId;
    const st = (FW.wiz.status && FW.wiz.status[id]) || {};
    const file = (st.files && st.files[0]) || st.file_path;
    const pre = $("#fwCodePrev"); if (!pre || !file || !FW.fid) return;
    try {
      const j = await fwApi("/frameworks/" + encodeURIComponent(st.framework_id || FW.fid) + "/file?path=" + encodeURIComponent(file));
      pre.textContent = (j.file && j.file.content) || "";
    } catch (e) { pre.textContent = e.message || "Unable to load script."; }
  }

  function paintWiz2() {
    $("#fwWizBd").innerHTML = '<p class="sub" style="margin-top:0">The scripts will be written into this project\'s <b>' + esc(FW.lang) + "</b> framework, reusing existing pages, fixtures, and config.</p>"
      + '<label>Anything the AI should know?</label><textarea id="fwCtx" rows="8" placeholder="Base URL, test accounts, things to reuse…">' + esc(FW.wiz.context || "") + "</textarea>"
      + '<p class="sub">Next you will pick a provider and model, then review the proposed file changes before they are applied.</p>';
    $("#fwWizFt").innerHTML = '<button type="button" class="btn g" id="fwWizBack">Back</button><button type="button" class="btn" id="fwWizGo">Generate</button>';
    $("#fwWizBack").onclick = function () { FW.wiz.context = ($("#fwCtx") && $("#fwCtx").value) || ""; FW.wiz.step = 1; paintWiz(); };
    $("#fwWizGo").onclick = function () { FW.wiz.context = ($("#fwCtx") && $("#fwCtx").value) || ""; doGenerate(); };
  }

  async function doGenerate() {
    $("#fwWizBd").innerHTML = "Generating…";
    $("#fwWizFt").innerHTML = "";
    try {
      await ensureFramework();
      const picked = await pickAi("Generate automation scripts");
      const ids = Object.keys(FW.wiz.sel).filter(function (k) { return FW.wiz.sel[k]; });
      const selected = FW.wiz.cases.filter(function (c) { return ids.indexOf(c.id) >= 0; });
      const test_cases = selected.map(function (c) {
        return {
          id: c.id, name: c.title || c.name, description: c.description,
          precondition: c.precondition, priority: c.priority, type: c.type,
          steps: (c.steps || []).map(function (s) { return { description: s.step || s.description, expected: s.expected, data: s.data }; }),
        };
      });
      const body = {
        test_cases: test_cases,
        language: FW.lang,
        frameworks: [(FW.fw && FW.fw.framework) || defaultFramework(FW.lang)],
        types: (FW.fw && FW.fw.types) || ["ui"],
        additional_context: FW.wiz.context || "",
        provider: picked.provider, model: picked.model,
      };
      const res = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/generate", { method: "POST", body: body });
      FW.wiz.result = res;
      FW.wiz.changes = (res.changes || []).map(function (c) { return Object.assign({}, c, { include: c.include !== false, show: false }); });
      FW.wiz.step = 3;
      paintWiz();
    } catch (e) {
      if (String(e.message) === "cancelled") { paintWiz2(); return; }
      $("#fwWizBd").innerHTML = '<div class="error">' + esc(e.message || e) + "</div>";
      $("#fwWizFt").innerHTML = '<button type="button" class="btn g" id="fwWizBack">Back</button>';
      $("#fwWizBack").onclick = function () { FW.wiz.step = 2; paintWiz(); };
    }
  }

  function paintWiz3() {
    const ch = FW.wiz.changes || [];
    const rows = ch.map(function (c, i) {
      const kind = c.kind || "new";
      return '<tr><td><input type="checkbox" data-inc="' + i + '"' + (c.include !== false ? " checked" : "") + "></td>"
        + "<td>" + esc(c.path) + ' <span class="fw-kind ' + kind + '">' + esc(kind.charAt(0).toUpperCase() + kind.slice(1)) + "</span></td>"
        + "<td>" + esc((c.tc_ids || []).join(", ")) + "</td>"
        + '<td><button type="button" class="btn g sm" data-diff="' + i + '">' + (c.show ? "Hide changes" : "Show changes") + "</button></td></tr>"
        + (c.show ? '<tr><td colspan="4">' + diffHtml(existingContent(c.path), c.content || "") + "</td></tr>" : "");
    }).join("") || '<tr><td colspan="4">No file changes returned.</td></tr>';
    $("#fwWizBd").innerHTML = '<table class="fw-chg"><thead><tr><th style="width:36px"></th><th>File</th><th>Test cases</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>";
    $("#fwWizFt").innerHTML = '<button type="button" class="btn g" id="fwWizBack">Back</button>'
      + '<button type="button" class="btn" id="fwWizApply">Apply selected</button>'
      + '<button type="button" class="btn g" id="fwWizChk">Check</button>'
      + '<button type="button" class="btn" id="fwWizRun">Run</button>';
    $("#fwWizBack").onclick = function () { FW.wiz.step = 2; paintWiz(); };
    $$("[data-inc]").forEach(function (ck) { ck.onchange = function () { FW.wiz.changes[+ck.dataset.inc].include = ck.checked; }; });
    $$("[data-diff]").forEach(function (b) { b.onclick = function () { const i = +b.dataset.diff; FW.wiz.changes[i].show = !FW.wiz.changes[i].show; paintWiz3(); }; });
    $("#fwWizApply").onclick = applyChanges;
    $("#fwWizChk").onclick = function () { startCheck(); };
    $("#fwWizRun").onclick = function () { startRun(); };
  }
  function existingContent(path) {
    const row = (FW.tree || []).find(function (f) { return f.path === path; });
    return (row && row.content) || "";
  }
  function diffHtml(a, b) {
    const al = String(a || "").split("\n"); const bl = String(b || "").split("\n");
    let html = '<div class="fw-diff">';
    const n = Math.max(al.length, bl.length);
    for (let i = 0; i < n && i < 400; i++) {
      if (al[i] === bl[i]) html += esc(bl[i] || "") + "\n";
      else {
        if (al[i] != null && al[i] !== "") html += '<span class="del">- ' + esc(al[i]) + "</span>\n";
        if (bl[i] != null) html += '<span class="add">+ ' + esc(bl[i]) + "</span>\n";
      }
    }
    return html + "</div>";
  }
  async function applyChanges() {
    const changes = (FW.wiz.changes || []).filter(function (c) { return c.include !== false; });
    try {
      await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/apply", {
        method: "POST",
        body: { changes: changes, mapping: (FW.wiz.result && FW.wiz.result.mapping) || [], author: "AI" },
      });
      toast("Changes applied to the project framework.");
      changes.forEach(function (c) {
        const k = String(c.kind || c.action || "").toLowerCase();
        if (!c.path) return;
        if (k === "new" || k === "created" || k === "add") FW.markers[c.path] = "new";
        else FW.markers[c.path] = "changed";
      });
      await reloadTree();
    } catch (e) { toast(e.message || String(e)); }
  }

  async function showHistory() {
    try {
      await ensureFramework();
      const j = await fwApi("/runs?framework_id=" + encodeURIComponent(FW.fid));
      const rows = (j.runs || []).map(function (r) {
        const sum = r.summary || {};
        return "<tr data-rid=\"" + esc(r.id) + "\"><td>" + esc(r.id) + "</td><td>" + esc(r.started || "") + "</td><td>" + esc(r.status) + "</td><td>" + (sum.passed || 0) + " / " + (sum.failed || 0) + "</td></tr>";
      }).join("") || '<tr><td colspan="4">No runs yet.</td></tr>';
      showRunBox("Run history", '<table class="fw-chg"><thead><tr><th>ID</th><th>Started (IST)</th><th>Status</th><th>Pass / Fail</th></tr></thead><tbody>' + rows + "</tbody></table>", '<button type="button" class="btn g" id="fwBoxX">Close</button>');
      $("#fwBoxX").onclick = closeRunBox;
    } catch (e) { toast(e.message || String(e)); }
  }
  async function startCheck() {
    try {
      await ensureFramework();
      const j = await fwApi("/check", { method: "POST", body: { framework_id: FW.fid } });
      showRunBox("Preflight check", checkHtml(j), '<button type="button" class="btn g" id="fwBoxX">Close</button><button type="button" class="btn" id="fwBoxRun">Run</button>');
      $("#fwBoxX").onclick = closeRunBox;
      $("#fwBoxRun").onclick = function () { closeRunBox(); startRun(); };
    } catch (e) { toast(e.message || String(e)); }
  }
  function checkHtml(j) {
    const syn = (j.syntax || []).map(function (s) {
      return "<div>" + esc(s.path) + " — " + (s.ok ? '<span class="fw-ok">OK</span>' : '<span class="fw-err">' + esc(s.error) + "</span>") + "</div>";
    }).join("") || "<div>No Python files to syntax-check.</div>";
    const rt = ((j.runtime && j.runtime.runtimes) || []).map(function (r) { return esc(r.label || r.id); }).join(", ") || "Unknown";
    const miss = (j.missing || []).map(function (m) { return "<li>" + esc(m.name) + " — <code>" + esc(m.install) + "</code></li>"; }).join("");
    return "<p><b>Runtime:</b> " + rt + "</p><h3>Syntax</h3>" + syn + "<h3>Missing libraries</h3>" + (miss ? "<ul>" + miss + "</ul>" : '<div class="sub">None detected (heuristic from imports vs requirements.txt).</div>');
  }
  async function startRun() {
    try {
      await ensureFramework();
      const prefs = await fwApi("/prefs");
      const p = prefs.prefs || {};
      showRunBox("Run", '<div class="sub">Workspace: temp folder (never the application .env). Env vars from the request and framework env files are injected into the process.</div>'
        + '<label><input type="checkbox" id="fwHeadless"' + (p.runner_headless !== false ? " checked" : "") + "> Headless</label>"
        + '<div class="fw-log" id="fwLog">Ready to start…</div><div id="fwRunRes"></div>',
        '<button type="button" class="btn g" id="fwBoxX">Close</button><button type="button" class="btn" id="fwBoxStop" disabled>Stop</button><button type="button" class="btn" id="fwBoxGo">Start run</button>');
      $("#fwBoxX").onclick = function () { stopPoll(); closeRunBox(); };
      $("#fwBoxGo").onclick = async function () {
        try {
          const r = await fwApi("/runs", { method: "POST", body: { framework_id: FW.fid, env: {}, headless: $("#fwHeadless") && $("#fwHeadless").checked } });
          FW.run = r.run; $("#fwLog").textContent = "Started " + (r.run && r.run.id) + "\n" + ((r.run && r.run.command) || "") + "\n";
          $("#fwBoxGo").disabled = true; $("#fwBoxStop").disabled = false;
          pollRun();
        } catch (e) { toast(e.message || String(e)); }
      };
      $("#fwBoxStop").onclick = async function () {
        if (!FW.run) return;
        try { await fwApi("/runs/" + encodeURIComponent(FW.run.id) + "/stop", { method: "POST", body: {} }); } catch (e) { toast(e.message || String(e)); }
      };
    } catch (e) { toast(e.message || String(e)); }
  }
  function pollRun() {
    stopPoll();
    FW.poll = setInterval(async function () {
      if (!FW.run) return;
      try {
        const j = await fwApi("/runs/" + encodeURIComponent(FW.run.id));
        const logEl = $("#fwLog"); if (logEl) { logEl.textContent = (j.run && j.run.log) || ""; logEl.scrollTop = logEl.scrollHeight; }
        if (j.run && j.run.status && j.run.status !== "running") {
          stopPoll();
          const box = $("#fwRunRes");
          if (box) box.innerHTML = resultsHtml(j);
          const st = $("#fwBoxStop"); if (st) st.disabled = true;
        }
      } catch (e) { stopPoll(); }
    }, 1000);
  }
  function stopPoll() { if (FW.poll) { clearInterval(FW.poll); FW.poll = 0; } }
  function resultsHtml(j) {
    const sum = (j.run && j.run.summary) || {};
    const rows = (j.results || []).map(function (r) {
      const fix = r.status === "fail" ? ' <button type="button" class="btn g sm" data-fix="' + r.id + '">Fix with AI</button>' : "";
      const shot = r.screenshot ? ' <a href="/api/automation/runs/' + encodeURIComponent(j.run.id) + "/artifact?path=" + encodeURIComponent(relArt(r.screenshot, j.run.artifacts_dir)) + '" target="_blank">screenshot</a>' : "";
      return "<tr><td>" + esc(r.tc_id || r.name) + '</td><td class="' + (r.status === "pass" ? "fw-ok" : r.status === "fail" ? "fw-err" : "") + '">' + esc(r.status) + "</td><td>" + esc(r.error || "") + fix + shot + "</td></tr>";
    }).join("");
    return "<p><b>" + esc(j.run.status) + "</b> — passed " + (sum.passed || 0) + ", failed " + (sum.failed || 0) + ", skipped " + (sum.skipped || 0) + "</p>"
      + (rows ? '<table class="fw-chg"><thead><tr><th>Test</th><th>Result</th><th>Detail</th></tr></thead><tbody>' + rows + "</tbody></table>" : "")
      + '<div id="fwFixOut"></div>';
  }
  function relArt(abs, root) {
    if (!abs) return "";
    if (root && abs.indexOf(root) === 0) return abs.slice(root.length).replace(/^\/+/, "");
    return abs;
  }
  function showRunBox(title, body, ft) {
    closeRunBox();
    const ov = document.createElement("div");
    ov.className = "fw-run"; ov.id = "fwRunBox";
    ov.innerHTML = '<div class="box"><div class="hd" style="padding:12px 16px;border-bottom:1px solid var(--bd,#eee);display:flex"><h2 style="margin:0;font-size:18px">' + esc(title) + '</h2></div><div class="bd" style="flex:1;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;min-height:0">' + body + '</div><div class="ft" style="padding:12px 16px;border-top:1px solid var(--bd,#eee);display:flex;gap:8px;justify-content:flex-end">' + ft + "</div></div>";
    document.body.appendChild(ov);
    ov.addEventListener("click", function (ev) {
      if (ev.target && ev.target.dataset && ev.target.dataset.fix) fixFail(ev.target.dataset.fix);
    });
  }
  function closeRunBox() { stopPoll(); const ov = $("#fwRunBox"); if (ov) ov.remove(); }

  async function fixFail(resultId) {
    if (!FW.run) return;
    try {
      const picked = await pickAi("Fix with AI");
      const j = await fwApi("/runs/" + encodeURIComponent(FW.run.id) + "/fix", { method: "POST", body: { result_id: resultId, provider: picked.provider, model: picked.model } });
      const out = $("#fwFixOut");
      if (out) {
        out.innerHTML = "<h3>Proposed fix for " + esc(j.path || "") + "</h3>" + diffHtml(j.original || "", j.fixed || "")
          + '<button type="button" class="btn sm" id="fwFixSave">Save as new version</button>';
        if ($("#fwFixSave")) $("#fwFixSave").onclick = async function () {
          try {
            await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/files", { method: "PUT", body: { path: j.path, content: j.fixed, note: "Fix with AI" } });
            toast("Fix saved as a new version");
          } catch (e) { toast(e.message || String(e)); }
        };
      }
    } catch (e) {
      if (String(e.message) === "cancelled") return;
      toast(e.message || String(e));
    }
  }

  window.asPaintFolderTemplates = function asPaintFolderTemplates(host) {
    if (!host) return;
    host.innerHTML = "Loading…";
    fwApi("/prefs").then(function (j) {
      const t = (j.prefs && j.prefs.folder_templates) || {};
      const langs = Object.keys(t);
      FW._tpl = t; FW._tplLang = FW._tplLang || langs[0] || "python";
      paintTpl(host);
    }).catch(function (e) { host.innerHTML = '<div class="error">' + esc(e.message) + "</div>"; });
  };
  function paintTpl(host) {
    const t = FW._tpl || {};
    const langs = Object.keys(t);
    const cur = FW._tplLang;
    const paths = t[cur] || [];
    host.innerHTML = '<p class="sub" style="margin-top:0">Default folders created for a new project framework in each language. Existing frameworks are not rewritten when you edit a template.</p>'
      + '<label>Language <select id="fwTplLang">' + langs.map(function (l) { return "<option" + (l === cur ? " selected" : "") + ">" + esc(l) + "</option>"; }).join("") + "</select></label>"
      + '<textarea id="fwTplPaths" rows="14" style="width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">' + esc(paths.join("\n")) + "</textarea>"
      + '<div style="margin-top:8px"><button type="button" class="btn sm" id="fwTplSave">Save folder templates</button></div>';
    $("#fwTplLang").onchange = function () {
      FW._tpl[cur] = ($("#fwTplPaths").value || "").split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      FW._tplLang = this.value; paintTpl(host);
    };
    $("#fwTplPaths").oninput = function () { if (typeof setUpdateDirty === "function") setUpdateDirty(); };
    $("#fwTplSave").onclick = async function () {
      FW._tpl[FW._tplLang] = ($("#fwTplPaths").value || "").split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      try {
        await fwApi("/prefs", { method: "PUT", body: { folder_templates: FW._tpl } });
        toast("Folder templates saved");
      } catch (e) { toast(e.message || String(e)); }
    };
  }

  window.asPaintRunner = function asPaintRunner(host) {
    if (!host) return;
    host.innerHTML = "Loading…";
    fwApi("/prefs").then(function (j) {
      const pr = j.prefs || {};
      const fields = [
        ["runner_python", "Python executable"],
        ["runner_java", "Java executable"],
        ["runner_mvn", "Maven executable"],
        ["runner_dotnet", "dotnet executable"],
        ["runner_node", "Node / npx executable"],
        ["runner_timeout", "Timeout (seconds)"],
        ["runner_temp_folder", "Temp workspace folder (blank = system temp/atg-runs)"],
        ["runner_keep_artifacts_days", "Keep artifacts (days)"],
      ];
      host.innerHTML = '<p class="sub" style="margin-top:0">Used by Check &amp; Run. The runner materializes the project into a temp folder and never reads or writes the application .env.</p>'
        + fields.map(function (f) {
          return "<label>" + esc(f[1]) + '<input data-rk="' + f[0] + '" value="' + esc(pr[f[0]] == null ? "" : pr[f[0]]) + '"></label>';
        }).join("")
        + '<label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="fwRHead" ' + (pr.runner_headless !== false ? "checked" : "") + "> Headless by default</label>"
        + '<div style="margin-top:8px"><button type="button" class="btn sm" id="fwRSave">Save runner settings</button></div>';
      $("#fwRSave").onclick = async function () {
        const body = {};
        $$("[data-rk]", host).forEach(function (inp) { body[inp.dataset.rk] = inp.value; });
        body.runner_headless = !!(!($("#fwRHead")) || $("#fwRHead").checked);
        try { await fwApi("/prefs", { method: "PUT", body: body }); toast("Runner settings saved"); } catch (e) { toast(e.message || String(e)); }
      };
    }).catch(function (e) { host.innerHTML = '<div class="error">' + esc(e.message) + "</div>"; });
  };

  const _hookRepo = window.asHookRepo;
  window.asHookRepo = function asHookRepoWrapped() {
    if (typeof _hookRepo === "function") _hookRepo();
    injectRepoStatus();
  };
  async function injectRepoStatus() {
    const table = $("#trRepoT");
    if (!table) return;
    const rows = $$("#trRepoT tr.clk");
    const ids = rows.map(function (tr) { return tr.dataset.id; }).filter(Boolean);
    if (!ids.length) return;
    const need = rows.filter(function (tr) { return !tr.dataset.fwst; });
    if (!need.length) return;
    let statuses = {};
    try {
      const j = await fwApi("/tc-status?ids=" + encodeURIComponent(ids.join(",")) + "&project=" + encodeURIComponent(projectId()));
      statuses = j.statuses || {};
    } catch (e) { return; }
    rows.forEach(function (tr) {
      if (tr.dataset.fwst) return;
      const st = statuses[tr.dataset.id] || { status: "none", label: "No script" };
      tr.dataset.fwst = st.status;
      const td = tr.querySelector(".as-td") || tr.lastElementChild;
      if (!td) return;
      const span = document.createElement("span");
      span.className = "fw-chip " + (st.status || "none");
      span.textContent = st.label || st.status;
      span.title = (st.files || []).join(", ");
      td.appendChild(document.createTextNode(" "));
      td.appendChild(span);
      if (st.status === "stale") {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn g sm fw-upd"; b.textContent = "Update script";
        b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); updateScript(tr.dataset.id, st.framework_id); };
        td.appendChild(b);
      }
    });
  }
  async function updateScript(tcId, fid) {
    try {
      const picked = await pickAi("Update script");
      await fwApi("/update-script", { method: "POST", body: { tc_id: tcId, framework_id: fid || FW.fid, provider: picked.provider, model: picked.model } });
      toast("Script updated for " + tcId);
      $$("#trRepoT tr.clk").forEach(function (tr) { delete tr.dataset.fwst; });
      injectRepoStatus();
    } catch (e) {
      if (String(e.message) === "cancelled") return;
      toast(e.message || String(e));
    }
  }

  const _renderLib = window.asRenderLibrary;
  if (typeof _renderLib === "function") {
    window.asRenderLibrary = async function (host) {
      await _renderLib(host);
      try {
        const ids = $$("[data-tc]").map(function (el) { return el.dataset.tc; }).filter(Boolean);
        if (!ids.length) return;
        const j = await fwApi("/tc-status?ids=" + encodeURIComponent(ids.join(",")));
        const st = j.statuses || {};
        $$("[data-tc]").forEach(function (el) {
          const s = st[el.dataset.tc];
          if (!s || el.querySelector(".fw-chip")) return;
          const span = document.createElement("span");
          span.className = "fw-chip " + s.status;
          span.textContent = s.label;
          el.appendChild(document.createTextNode(" "));
          el.appendChild(span);
        });
      } catch (e) {}
    };
  }
})();
