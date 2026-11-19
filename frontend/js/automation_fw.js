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
    editing: { left: false, right: false },
    panel: "files",
    fromTc: "",
    showUsed: false,
    usage: null,
    verCount: 0,
    openTabs: [],
    revealLine: 0,
    symbols: null,
    dataMode: {},
    acFromKey: false,
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
  function isPlainEditor() {
    try { return localStorage.getItem("fwEditorPlain") === "1"; } catch (e) { return !!FW.plain; }
  }
  function setPlainEditor(on) {
    FW.plain = !!on;
    try { localStorage.setItem("fwEditorPlain", on ? "1" : "0"); } catch (e) {}
  }
  function isEditing(side) {
    return !!(FW.editing && FW.editing[side || "left"]);
  }
  function setEditing(side, on) {
    FW.editing = FW.editing || { left: false, right: false };
    FW.editing[side || "left"] = !!on;
  }
  function codeTheme() {
    try { return localStorage.getItem("fwCodeTheme") === "light" ? "light" : "dark"; } catch (e) { return "dark"; }
  }
  function setCodeTheme(theme) {
    try { localStorage.setItem("fwCodeTheme", theme === "light" ? "light" : "dark"); } catch (e) {}
  }
  function byteSizeLabel(str) {
    let n = 0;
    try { n = new TextEncoder().encode(String(str == null ? "" : str)).length; } catch (e) { n = String(str || "").length; }
    if (n < 1024) return n + " Bytes";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 2 : 1).replace(/\.0+$/, "") + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }
  function locCount(raw) {
    const lines = visText(raw).split("\n");
    let loc = 0;
    for (let i = 0; i < lines.length; i++) { if (lines[i].trim()) loc++; }
    if (lines.length && lines[lines.length - 1] === "") { /* trailing newline empty */ }
    return loc;
  }
  function highlightLines(raw, ext, rawMode) {
    raw = String(raw == null ? "" : raw);
    const lines = visText(raw).split("\n");
    if (rawMode) return lines.map(function (ln) { return esc(ln); });
    let html;
    try { html = highlightCode(raw, ext); } catch (e) { html = null; }
    if (html == null) return lines.map(function (ln) { return esc(ln); });
    const recovered = html
      .replace(/<span class="[^"]*">/g, "")
      .replace(/<\/span>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    if (visText(recovered) !== visText(raw)) return lines.map(function (ln) { return esc(ln); });
    const parts = html.split(/\r\n|\n|\r/);
    if (parts.length !== lines.length) return lines.map(function (ln) { return esc(ln); });
    return parts;
  }
  function cbarSvg(kind) {
    if (kind === "copy") return '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    if (kind === "dl") return '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 21h16"/></svg>';
    if (kind === "edit") return '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
    if (kind === "sun") return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    if (kind === "moon") return '<svg viewBox="0 0 24 24"><path d="M21 14a8 8 0 1 1-9-11 7 7 0 0 0 9 11z"/></svg>';
    return "";
  }


  function isEnvPath(path) {
    const n = (path || "").split("/").pop() || "";
    return n === ".env" || /\.env$/i.test(n);
  }
  function isDataPath(path) {
    const e = extOf(path);
    return /^(xlsx|csv|json|xml|yaml|yml|txt)$/.test(e) || /^test_data\//.test(path || "");
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
    const params = new URLSearchParams(q);
    const tc = params.get("tc") || "";
    const view = params.get("view") || "";
    const tab = params.get("tab") || "";
    if (view === "versions" || tab === "library") FW.panel = "versions";
    else FW.panel = "files";
    FW.tab = FW.panel === "versions" ? "library" : "project";
    FW.fromTc = tc;
    FW.showUsed = params.get("used") === "1";
    if (!tc) FW.usage = null;
    const verOn = FW.panel === "versions" ? " on" : "";
    v.innerHTML = '<div class="fw-shell asv"><div class="fw-head"><div><h1>Automation Scripts</h1><p class="lead">Project workspace for ' + esc(projectId()) + " · " + esc(langLabel()) + "</p></div>"
      + '<div class="acts"><div class="fw-langwrap"><button type="button" class="fw-pill" id="fwLangBtn">' + esc(langLabel()) + '</button><div class="fw-langmenu" id="fwLangMenu" hidden></div></div>'
      + '<button type="button" class="btn pri" id="fwGen">Generate</button>'
      + '<span class="fw-splitbtn" id="fwRunWrap"><button type="button" class="btn fw-runmain" id="fwRun">Run</button>'
      + '<button type="button" class="fw-runcaret" id="fwRunCaret" title="Check, runner options">▾</button>'
      + '<div class="fw-runmenu" id="fwRunMenu" hidden><button type="button" id="fwCheck">Check</button><button type="button" id="fwRunMenuGo">Run</button></div></span>'
      + '<button type="button" class="fw-hist" id="fwRuns">' + clockSvg() + " Run history</button>"
      + '<button type="button" class="fw-hist fw-termbtn" id="fwTermBtn" title="Terminal (Ctrl+`)">' + termSvg() + " Terminal</button>"
      + '<button type="button" class="fw-hist fw-verbtn' + verOn + '" id="fwVersions">Generated versions<span class="fw-vercnt" id="fwVerCnt">' + (FW.verCount || "") + "</span></button></div></div>"
      + '<div id="fwCrumb"></div>'
      + '<div id="fwHost" style="flex:1;min-height:0;display:flex;flex-direction:column"></div></div>';
    await fillLangSelect();
    bindHeaderChrome(v);
    bindFwEditorKeys();
    loadVerCount();
    paintCrumb();
    await renderHost();
    mountTerm();
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
    if ($("#fwGen")) $("#fwGen").onclick = function () { openWizard(FW.fromTc ? { tcId: FW.fromTc } : {}); };
    if ($("#fwVersions")) $("#fwVersions").onclick = function () {
      const qs = [];
      if (FW.fromTc) qs.push("tc=" + encodeURIComponent(FW.fromTc));
      if (FW.panel !== "versions") qs.push("view=versions");
      goScripts(qs.join("&"));
    };
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
    if ($("#fwTermBtn")) $("#fwTermBtn").onclick = function () { toggleTerm(); };
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

  function goScripts(query) {
    const dest = query ? ("scripts?" + query) : "scripts";
    if (typeof go === "function") go(dest);
    else {
      location.hash = dest;
      const v = document.getElementById("view");
      if (v && typeof window.viewScripts === "function") window.viewScripts(v);
    }
  }

  async function loadVerCount() {
    try {
      const f = await api("/api/automation/folders");
      const n = (f.folders || []).reduce(function (s, x) { return s + (x.count || 0); }, 0) + (f.unfiled || 0);
      FW.verCount = n;
      const el = $("#fwVerCnt");
      if (el) el.textContent = n ? String(n) : "";
    } catch (e) {}
  }

  function paintCrumb() {
    const box = $("#fwCrumb");
    if (!box) return;
    if (!FW.fromTc || FW.panel === "versions") { box.innerHTML = ""; return; }
    const usage = FW.usage || {};
    const title = usage.title || "";
    const mapped = !!usage.mapped;
    const usedOn = FW.showUsed ? " on" : "";
    box.innerHTML = '<div class="fw-crumb"><a data-nav="repo">Test Case Repo</a><span class="sep">›</span>'
      + '<span class="tid">' + esc(FW.fromTc) + "</span>"
      + (title ? '<span class="ttl">' + esc(title) + "</span>" : "")
      + (mapped ? '<span class="pill g">In project</span>' : '<span class="pill gr">No script</span>')
      + (mapped ? '<button type="button" class="btn g sm' + usedOn + '" id="fwWhereBtn">Where is this used</button>' : "")
      + "</div>";
    const link = box.querySelector("[data-nav=repo]");
    if (link) link.onclick = function (e) { e.preventDefault(); if (typeof go === "function") go("repo"); };
    const btn = $("#fwWhereBtn", box);
    if (btn) btn.onclick = function () {
      FW.showUsed = !FW.showUsed;
      const qs = ["tc=" + encodeURIComponent(FW.fromTc)];
      if (FW.showUsed) qs.push("used=1");
      goScripts(qs.join("&"));
    };
  }

  function revealPath(path) {
    const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? acc + "/" + parts[i] : parts[i];
      delete FW.collapsed[acc];
      delete FW.collapsed[acc + "/"];
    }
  }

  function pickTestFile(usage) {
    const files = (usage && usage.test_files) || [];
    if (!files.length) return "";
    const hit = files.find(function (f) {
      const p = String((f && f.path) || f || "").toLowerCase();
      const base = p.split("/").pop();
      return p.indexOf("/tests/") >= 0 || p.indexOf("tests/") === 0 || base.indexOf("test_") === 0;
    });
    return (hit && (hit.path || hit)) || files[0].path || files[0] || "";
  }

  async function landFromTc(tcId) {
    const host = $("#fwHost");
    try {
      const q = "/tc-usage?tc_id=" + encodeURIComponent(tcId)
        + "&project=" + encodeURIComponent(projectId())
        + (FW.fid ? "&framework_id=" + encodeURIComponent(FW.fid) : "");
      const usage = await fwApi(q);
      FW.usage = usage || {};
      paintCrumb();
      if (usage && usage.mapped) {
        const path = pickTestFile(usage);
        if (path) {
          revealPath(path);
          await openFile(path);
          return;
        }
      }
      FW.path = ""; FW.file = null;
      if (host) paintProject(host);
    } catch (e) {
      FW.usage = { tc_id: tcId, mapped: false, title: "", versions: [] };
      paintCrumb();
      FW.path = ""; FW.file = null;
      if (host) paintProject(host);
      toast(e.message || String(e));
    }
  }

  function whereUsedHtml(usage) {
    usage = usage || FW.usage || {};
    const tc = usage.tc_id || FW.fromTc || "";
    const title = usage.title || "";
    function fileItem(path, extra) {
      if (!path) return "";
      const parts = String(path).replace(/\\/g, "/");
      const cut = parts.lastIndexOf("/");
      const shown = cut > 0 ? (parts.slice(0, cut + 1) + "<wbr>" + parts.slice(cut + 1)) : parts;
      return '<div class="item">' + fwIcon(path, false) + '<div><a data-open="' + esc(path) + '" class="mono">' + shown + "</a>"
        + (extra ? '<div class="sub">' + extra + "</div>" : "") + "</div></div>";
    }
    const tests = (usage.test_files || []).map(function (f) { return fileItem(f.path || f); }).join("") || '<div class="item"><span class="sub">Not in this project framework.</span></div>';
    const pages = (usage.page_objects || []).map(function (f) { return fileItem(f.path || f); }).join("") || '<div class="item"><span class="sub">None detected yet.</span></div>';
    const locs = (usage.locators || []).map(function (l) {
      return '<div class="item"><span class="mono">' + esc(l.name || "") + '</span> <span class="sub">' + esc((l.strategy ? l.strategy + " " : "") + (l.value || "")) + "</span></div>";
    }).join("");
    const data = (usage.test_data || []).map(function (d) {
      return fileItem(d.path, d.note ? esc(d.note) : "");
    }).join("");
    const locBlk = (locs || data)
      ? (locs + data)
      : '<div class="item"><span class="sub">None recorded yet.</span></div>';
    const run = usage.last_run;
    let runHtml = '<div class="item"><span class="sub">No run recorded yet.</span></div>';
    if (run) {
      const ok = /pass/i.test(run.status || "");
      const fail = /fail|error/i.test(run.status || "");
      const dur = run.duration_ms ? ((run.duration_ms / 1000).toFixed(1) + "s") : "";
      runHtml = '<div class="item"><span class="' + (fail ? "faildot" : "okdot") + '"></span><div><div><span class="pill ' + (ok ? "g" : fail ? "r" : "gr") + '">' + esc(run.status || "") + "</span> "
        + esc(run.id || "") + (dur ? " · " + dur : "") + '</div><div class="sub">' + esc(run.started || run.finished || "") + "</div></div></div>";
    }
    const vers = (usage.versions || []).map(function (s) {
      return '<div class="item"><a data-preview="' + esc(s.id) + '" class="mono" style="color:#4361ee;font-weight:700">' + esc(s.id) + "</a> <span>v" + esc(s.version || 1) + '</span> <span class="sub">' + esc(s.updated || "") + "</span></div>";
    }).join("") || '<div class="item"><span class="sub">No generated versions linked to this case.</span></div>';
    return '<aside class="fw-usedp" id="fwUsedP"><h3>Where is this used</h3>'
      + '<div class="who"><span class="tid">' + esc(tc) + "</span> " + esc(title) + "</div>"
      + '<div class="blk"><div class="lab">Test file</div>' + tests + "</div>"
      + '<div class="blk"><div class="lab">Page objects</div>' + pages + "</div>"
      + '<div class="blk"><div class="lab">Locators &amp; test data</div>' + locBlk + "</div>"
      + '<div class="blk"><div class="lab">Last run</div>' + runHtml + "</div>"
      + '<div class="blk"><div class="lab">Generated versions</div>' + vers + "</div></aside>";
  }

  function bindWhereUsed(root) {
    if (!root) return;
    $$("[data-open]", root).forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); if (a.dataset.open) openFile(a.dataset.open); };
    });
    $$("[data-preview]", root).forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        if (typeof go === "function") go("scripts/" + a.dataset.preview + "?preview=1");
      };
    });
  }

  async function addLibraryToProject(sid) {
    try {
      await ensureFramework();
      const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/from-library?script_id=" + encodeURIComponent(sid));
      const ch = (j.changes || []).map(function (c) { return Object.assign({}, c, { include: c.include !== false, show: false }); });
      FW.wiz = {
        step: 3, cases: [], sel: {}, filter: "all", tab: "all", preview: null, context: "",
        changes: ch, result: { changes: j.changes || [], mapping: j.mapping || [] },
        mapping: j.mapping || [], fromLibrary: sid, libraryName: j.name || sid,
      };
      const ov = document.createElement("div");
      ov.className = "fw-wiz"; ov.id = "fwWiz";
      ov.innerHTML = '<div class="box"><div class="hd"><h2>Review changes</h2><span style="flex:1"></span><div class="fw-steps" id="fwWizSteps"></div></div><div class="bd" id="fwWizBd">Loading…</div><div class="ft" id="fwWizFt"></div></div>';
      document.body.appendChild(ov);
      paintWiz();
    } catch (e) { toast(e.message || String(e)); }
  }

  async function renderVersions(host) {
    const intro = '<div class="fw-verintro"><div class="fn">Generated versions</div>'
      + '<div class="sub">Former Library bundles — nothing is deleted. Add a version into the project framework when you want it in the tree.</div></div>';
    host.innerHTML = intro + '<div id="asLibHost">Loading…</div>';
    if (window.ST && ST.lib) ST.lib.mode = "versions";
    if (typeof window.asRenderLibrary === "function") await window.asRenderLibrary($("#asLibHost"));
  }

  async function renderHost() {
    const host = $("#fwHost");
    if (!host) return;
    paintCrumb();
    if (FW.panel === "versions" || FW.tab === "library") {
      try { await renderVersions(host); } catch (e) { host.innerHTML = '<div class="error">' + esc(e.message || e) + "</div>"; }
      return;
    }
    if (window.ST && ST.lib) ST.lib.mode = "";
    try {
      await ensureFramework();
      if (FW.fromTc) await landFromTc(FW.fromTc);
      else paintProject(host);
    } catch (e) {
      host.innerHTML = '<div class="error">' + esc(e.message || e) + "</div>";
    }
  }

  function paintProject(host) {
    if (typeof hideAutocomplete === "function") hideAutocomplete();
    const split = !!FW.split && FW.path && !(FW.file && FW.file.is_dir);
    const full = FW.full && FW.path && !(FW.file && FW.file.is_dir);
    const used = !!(FW.showUsed && FW.fromTc && FW.panel !== "versions") && !split && !full;
    host.innerHTML = '<div class="fw-body' + (split ? " split" : "") + (full ? " full" : "") + (used ? " used" : "") + '" id="fwBody">'
      + '<div class="fw-tree" id="fwTree">' + treePanel() + "</div>"
      + paneHtml("fwMain", FW.path, FW.file, "left")
      + (split ? paneHtml("fwMain2", FW.splitPath, FW.splitFile, "right") : "")
      + (used ? whereUsedHtml(FW.usage) : "")
      + "</div>";
    const body = $("#fwBody");
    if (full && body) body.classList.add("fw-full");
    bindTree($("#fwTree"));
    bindMain($("#fwMain"), "left");
    if (split) bindMain($("#fwMain2"), "right");
    if (used) bindWhereUsed($("#fwUsedP"));
    paintCrumb();
  }

  function treePanel() {
    return '<div class="fw-th"><span class="fw-ttl">Files</span><span class="fw-th-acts">'
      + '<button type="button" class="btn g sm" id="fwNormBtn" title="Fold duplicate ui/ and tests/web/ folders into pages/ and tests/…">Normalize folders</button>'
      + '<button type="button" class="btn fw-new" id="fwTreeNew">＋ New</button></span></div>'
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
    const row = (FW.tree || []).find(function (r) { return r.path === path; });
    if (row && row.edited) return '<span class="fw-mk e" title="Manually edited since the last generated version">edited</span>';
    if (k === "edited") return '<span class="fw-mk e" title="Manually edited">edited</span>';
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
    const norm = $("#fwNormBtn", tree);
    if (norm) norm.onclick = function (e) { e.stopPropagation(); openNormalize(); };
    const neu = $("#fwTreeNew", tree);
    if (neu) neu.onclick = function (e) {
      e.stopPropagation();
      const folder = FW.path && FW.file && FW.file.is_dir ? FW.path : ((FW.path || "").split("/").slice(0, -1).join("/") || "");
      openNewFileDialog({ folder: folder });
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
    setEditing("left", false);
    setEditing("right", false);
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
    setEditing("left", false);
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
      rememberTab(path);
      if (isPreviewable(path) && FW.dataMode[path] !== "edit") FW.viewPane = "preview";
      const host = $("#fwHost");
      if (host) paintProject(host);
      if (FW.revealLine) {
        const line = FW.revealLine;
        FW.revealLine = 0;
        setTimeout(function () { revealCodeLine("left", line); }, 0);
      }
    } catch (e) { toast(e.message || String(e)); }
  }

  async function openFileIn(side, path) {
    if (side !== "right") return openFile(path);
    FW.splitPath = path;
    FW.splitFocus = "right";
    setEditing("right", false);
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
    if (FW.fromTc) {
      const usage = FW.usage || {};
      const vers = usage.versions || [];
      const bundles = vers.length
        ? ('<div class="fw-veracts" style="margin:0 0 14px;justify-content:center;flex-wrap:wrap">' + vers.map(function (s) {
            return '<a data-preview="' + esc(s.id) + '">' + esc(s.id) + " v" + esc(s.version || 1) + "</a>";
          }).join("") + "</div>")
        : "";
      return '<div class="fw-empty-state"><div class="ill"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/><path d="M9 12h6"/></svg></div>'
        + "<h2>No script for " + esc(FW.fromTc) + " yet</h2>"
        + "<p>This case is not in the project framework. Generate a script from the case, or link an existing generated version.</p>"
        + bundles
        + '<div class="acts"><button type="button" class="btn pri" id="fwEmptyGenTc">Generate script</button>'
        + '<button type="button" class="btn g" id="fwEmptyLink">Link existing</button></div></div>';
    }
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
    const pev = isPreviewable(path) ? previewEditToggle(path, pane) : "";
    const bar = '<div class="fw-bar"><div class="fw-seg">'
      + tabs.map(function (t) { return '<button type="button" data-pane="' + t[0] + '" class="' + (pane === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("")
      + "</div>" + pev + '<div class="fw-ibar">'
      + '<button type="button" class="fw-ico-btn" data-act="split" title="Split view">' + splitIco + '<span class="tip">Split view</span></button>'
      + '<button type="button" class="fw-ico-btn" data-act="full" title="Full screen">' + fullIco + '<span class="tip">Full screen</span></button>'
      + '<button type="button" class="fw-ico-btn" data-act="hist" title="Version history">' + histIco + '<span class="tip">Version history</span></button>'
      + '</div><button type="button" class="btn g sm" data-act="regen" title="Regenerate this file or its test case">Regenerate</button>'
      + '<button type="button" class="btn pri save" data-act="save"' + (unsaved || isEditing(side) ? "" : " disabled") + ">Save</button></div>";
    const hist = (FW.showHist && pane === "code" && side === "left") ? histHtml() : "";
    const stat = pane === "code" ? statusBarHtml(path, side) : "";
    const tabsBar = side === "left" ? openTabsHtml(path) : "";
    return tabsBar + fileCardHtml({ path: path, name: pathName(path), isDir: false, version: ver, used: used, unsaved: unsaved })
      + bar + '<div class="fw-code" id="fwPane">' + body + hist + "</div>" + stat;
  }

  function statusBarHtml(path, side) {
    const line = side === "right" ? (FW.cursorLineR || 1) : (FW.cursorLine || 1);
    const col = side === "right" ? (FW.cursorColR || 1) : (FW.cursorCol || 1);
    const mid = isEditing(side) ? ("Ln " + line + ", Col " + col) : (visText(currentContent(path)).split("\n").length + " lines");
    const hint = isEditing(side)
      ? "Ctrl+Space for suggestions"
      : "Double-click a line or start typing to edit · Ctrl+Space for suggestions";
    return '<div class="fw-stat" data-stat="' + side + '"><b>' + esc(langLabel()) + "</b><span>UTF-8</span><span class=\"fw-lncol\">" + mid + "</span><span class=\"fw-edithint\">" + hint + "</span><span style=\"margin-left:auto\">" + esc(path) + "</span></div>";
  }

  function codeHtml(path, side) {
    const val = currentContent(path);
    const ext = extOf(path);
    const lines = visText(val).split("\n");
    const n = lines.length;
    const loc = locCount(val);
    const info = n + " line" + (n === 1 ? "" : "s") + " (" + loc + " loc) · " + byteSizeLabel(val);
    const theme = codeTheme();
    const rawMode = isPlainEditor();
    const editing = isEditing(side);
    const id = side === "right" ? "fwCodeR" : "fwCode";
    const unsaved = !!FW.unsaved[path];
    let acts;
    if (editing) {
      acts = '<button type="button" class="fw-cbtn pri" data-cact="save">Save</button>'
        + '<button type="button" class="fw-cbtn ghost" data-cact="cancel">Cancel</button>';
    } else {
      acts = '<button type="button" class="fw-cbtn' + (rawMode ? " on" : "") + '" data-cact="raw" aria-pressed="' + (rawMode ? "true" : "false") + '" title="Raw">Raw</button>'
        + '<button type="button" class="fw-cbtn ghost" data-cact="theme" title="' + (theme === "light" ? "Dark theme" : "Light theme") + '">' + cbarSvg(theme === "light" ? "moon" : "sun") + "</button>"
        + '<button type="button" class="fw-cbtn ghost" data-cact="copy" title="Copy">' + cbarSvg("copy") + "</button>"
        + '<button type="button" class="fw-cbtn ghost" data-cact="dl" title="Download">' + cbarSvg("dl") + "</button>"
        + '<button type="button" class="fw-cbtn" data-cact="edit" title="Edit file">' + cbarSvg("edit") + " Edit</button>";
    }
    const bar = '<div class="fw-cbar"><span class="fw-cinfo">' + esc(info) + "</span><div class=\"fw-cacts\">" + acts + "</div></div>";
    if (editing) {
      const cur = side === "right" ? (FW.cursorLineR || 1) : (FW.cursorLine || 1);
      const gut = lines.map(function (_, i) { return '<i class="' + (i + 1 === cur ? "cur" : "") + '">' + (i + 1) + "</i>"; }).join("");
      return '<div class="fw-codeview editing" data-theme="' + theme + '" data-ed="' + side + '" data-path="' + esc(path) + '">' + bar
        + '<div class="fw-editpane"><div class="fw-ln" id="' + (side === "right" ? "fwLnR" : "fwLn") + '">' + gut + "</div>"
        + '<textarea class="fw-edit-ta" id="' + id + '" wrap="off" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" data-path="' + esc(path) + '" data-side="' + side + '">' + esc(val) + "</textarea></div></div>";
    }
    const htmlLines = highlightLines(val, ext, rawMode);
    const rows = htmlLines.map(function (html, i) {
      return '<tr><td class="fw-cln">' + (i + 1) + '</td><td class="fw-ccode">' + (html || "") + "</td></tr>";
    }).join("");
    return '<div class="fw-codeview" data-theme="' + theme + '" data-ed="' + side + '" data-path="' + esc(path) + '">' + bar
      + '<div class="fw-cscroll" tabindex="0"><table class="fw-ctable" aria-label="File contents"><tbody>' + rows + "</tbody></table></div></div>";
  }

  function highlightCode(raw, ext) {
    raw = String(raw == null ? "" : raw);
    ext = (ext || "").toLowerCase();
    try {
      if (ext === "py") return hlTokenize(raw, "py");
      if (ext === "js" || ext === "ts") return hlTokenize(raw, "js");
      if (ext === "ini" || ext === "cfg" || ext === "properties") return hlIni(raw);
      if (ext === "json") return hlTokenize(raw, "json");
      if (ext === "env") return hlEnv(raw);
      if (ext === "md") return hlMd(raw);
      if (ext === "yaml" || ext === "yml") return hlYaml(raw);
      if (ext === "xml" || ext === "html" || ext === "htm") return hlXml(raw);
      return esc(raw);
    } catch (e) {
      return esc(raw);
    }
  }
  function visText(s) {
    return String(s == null ? "" : s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
  function hlPush(out, text, cls) {
    if (!text) return;
    if (!cls) { out.push(esc(text)); return; }
    const parts = text.split(/(\r\n|\n|\r)/);
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      if (!part) continue;
      if (part === "\n" || part === "\r" || part === "\r\n") out.push(part);
      else out.push('<span class="fw-t-' + cls + '">' + esc(part) + "</span>");
    }
  }
  function pyStringPrefixLen(s, i) {
    if (i > 0 && /[A-Za-z0-9_]/.test(s[i - 1])) return 0;
    const two = s.slice(i, i + 2).toLowerCase();
    if ((two === "fr" || two === "rf" || two === "br" || two === "rb") && (s[i + 2] === "'" || s[i + 2] === '"')) return 2;
    const one = s.charAt(i).toLowerCase();
    if ((one === "r" || one === "f" || one === "b" || one === "u") && (s[i + 1] === "'" || s[i + 1] === '"')) return 1;
    return 0;
  }
  function scanQuoted(s, i, opts) {
    const q = s[i];
    const triple = !!(opts.triple && s[i + 1] === q && s[i + 2] === q);
    const delimLen = triple ? 3 : 1;
    let j = i + delimLen;
    const allowMulti = triple || !!opts.multiline;
    while (j < s.length) {
      const ch = s[j];
      if (ch === "\\" && j + 1 < s.length) {
        if (s[j + 1] === "\r" && s[j + 2] === "\n") { j += 3; continue; }
        j += 2;
        continue;
      }
      if (!allowMulti && (ch === "\n" || ch === "\r")) return j;
      if (triple) {
        if (s[j] === q && s[j + 1] === q && s[j + 2] === q) return j + 3;
      } else if (ch === q) {
        return j + 1;
      }
      j++;
    }
    return s.length;
  }
  function hlTokenize(src, mode) {
    const pyKw = { def: 1, class: 1, return: 1, import: 1, from: 1, as: 1, if: 1, elif: 1, else: 1, for: 1, while: 1, try: 1, except: 1, finally: 1, with: 1, yield: 1, lambda: 1, pass: 1, break: 1, continue: 1, and: 1, or: 1, not: 1, in: 1, is: 1, None: 1, True: 1, False: 1, self: 1, async: 1, await: 1, global: 1, nonlocal: 1, assert: 1, raise: 1, del: 1 };
    const jsKw = { function: 1, const: 1, let: 1, var: 1, return: 1, import: 1, from: 1, export: 1, as: 1, if: 1, else: 1, for: 1, while: 1, try: 1, catch: 1, finally: 1, class: 1, new: 1, this: 1, async: 1, await: 1, true: 1, false: 1, null: 1, undefined: 1, typeof: 1, instanceof: 1, in: 1, of: 1, break: 1, continue: 1, switch: 1, case: 1, default: 1, throw: 1 };
    const jsonKw = { true: 1, false: 1, null: 1 };
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (mode === "py" && ch === "#") {
        let j = i + 1;
        while (j < n && src[j] !== "\n" && src[j] !== "\r") j++;
        hlPush(out, src.slice(i, j), "c");
        i = j;
        continue;
      }
      if (mode === "js" && ch === "/" && src[i + 1] === "/") {
        let j = i + 2;
        while (j < n && src[j] !== "\n" && src[j] !== "\r") j++;
        hlPush(out, src.slice(i, j), "c");
        i = j;
        continue;
      }
      if (mode === "js" && ch === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        const j = end < 0 ? n : end + 2;
        hlPush(out, src.slice(i, j), "c");
        i = j;
        continue;
      }
      if (mode === "py") {
        const pref = pyStringPrefixLen(src, i);
        const qi = i + pref;
        if (qi < n && (src[qi] === "'" || src[qi] === '"')) {
          const end = scanQuoted(src, qi, { triple: true });
          hlPush(out, src.slice(i, end), "s");
          i = end;
          continue;
        }
      }
      if ((mode === "js" || mode === "json") && (ch === "'" || ch === '"' || (mode === "js" && ch === "`"))) {
        if (mode === "json" && ch === "'") { hlPush(out, ch, ""); i++; continue; }
        const end = scanQuoted(src, i, { triple: false, multiline: ch === "`" });
        hlPush(out, src.slice(i, end), "s");
        i = end;
        continue;
      }
      if ((mode === "py" && /[A-Za-z_]/.test(ch)) || ((mode === "js" || mode === "json") && /[A-Za-z_$]/.test(ch))) {
        let j = i + 1;
        const re = mode === "js" ? /[\w$]/ : /\w/;
        while (j < n && re.test(src[j])) j++;
        const word = src.slice(i, j);
        const kw = mode === "py" ? pyKw : mode === "json" ? jsonKw : jsKw;
        const isFn = mode === "py" && (word === "def" || word === "class") && (src[j] === " " || src[j] === "\t");
        if (isFn) {
          hlPush(out, word, "k");
          let k = j;
          while (k < n && (src[k] === " " || src[k] === "\t")) k++;
          hlPush(out, src.slice(j, k), "");
          let e = k;
          while (e < n && /\w/.test(src[e])) e++;
          if (e > k) hlPush(out, src.slice(k, e), "f");
          i = e > k ? e : k;
          continue;
        }
        hlPush(out, word, kw[word] ? "k" : "");
        i = j;
        continue;
      }
      hlPush(out, ch, "");
      i++;
    }
    return out.join("");
  }
  function hlIni(src) {
    return src.split("\n").map(function (line) {
      if (/^\s*[;#]/.test(line)) return '<span class="fw-t-c">' + esc(line) + "</span>";
      if (/^\s*\[/.test(line)) return '<span class="fw-t-sec">' + esc(line) + "</span>";
      const m = line.match(/^(\s*[^=]+?)(\s*=\s*)(.*)$/);
      if (m) return '<span class="fw-t-key">' + esc(m[1]) + "</span>" + esc(m[2]) + '<span class="fw-t-s">' + esc(m[3]) + "</span>";
      return esc(line);
    }).join("\n");
  }
  function hlEnv(src) {
    return src.split("\n").map(function (line) {
      if (/^\s*#/.test(line)) return '<span class="fw-t-c">' + esc(line) + "</span>";
      const m = line.match(/^(\s*[^=]+)(\s*=\s*)(.*)$/);
      if (m) return '<span class="fw-t-key">' + esc(m[1]) + "</span>" + esc(m[2]) + '<span class="fw-t-s">' + esc(m[3]) + "</span>";
      return esc(line);
    }).join("\n");
  }
  function hlMd(src) {
    return esc(src).replace(/^#{1,6} .+$/gm, function (m) { return '<span class="fw-t-k">' + m + "</span>"; })
      .replace(/`[^`]+`/g, function (m) { return '<span class="fw-t-s">' + m + "</span>"; });
  }
  function hlYaml(src) {
    return src.split("\n").map(function (line) {
      if (/^\s*#/.test(line)) return '<span class="fw-t-c">' + esc(line) + "</span>";
      const m = line.match(/^(\s*[\w-]+\s*:)(\s*)(.*)$/);
      if (m) return '<span class="fw-t-key">' + esc(m[1]) + "</span>" + esc(m[2]) + '<span class="fw-t-s">' + esc(m[3]) + "</span>";
      return esc(line);
    }).join("\n");
  }
  function hlXml(src) {
    return esc(src)
      .replace(/&lt;!--[\s\S]*?--&gt;/g, function (m) { return '<span class="fw-t-c">' + m + "</span>"; })
      .replace(/&lt;\/?[\w:-]+/g, function (m) { return '<span class="fw-t-k">' + m + "</span>"; })
      .replace(/&gt;/g, '<span class="fw-t-k">&gt;</span>');
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
      + (path && !isDir ? '<div data-a="regen">Regenerate…</div>' : "")
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
      if (act === "regen") {
        openRegenDialog({ path: path, scope: "file" });
        return;
      }
      if (act === "newf") {
        openNewFileDialog({ folder: prefix });
        return;
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
    const used = ((FW.file && FW.file.used_by) || []).map(function (id) { return '<span class="tid">' + esc(id) + "</span>"; }).join(" ") || '<span class="sub">Not used by a test yet.</span>';
    const mode = FW.previewMode || (kind === "json" || kind === "xml" ? "tree" : "table");
    const showTree = kind === "json" || kind === "xml" || kind === "yaml";
    const showTable = kind === "xlsx" || kind === "csv" || kind === "yaml";
    const toggles = '<div class="fw-filters">'
      + (showTable ? '<button type="button" class="btn g sm' + (mode === "table" ? " on" : "") + '" data-pm="table">Table</button>' : "")
      + (showTree ? '<button type="button" class="btn g sm' + (mode === "tree" ? " on" : "") + '" data-pm="tree">Tree</button>' : "")
      + '<button type="button" class="btn g sm' + (mode === "raw" ? " on" : "") + '" data-pm="raw">Raw</button>'
      + (kind === "json" || kind === "xml" || kind === "yaml" ? (pr.ok ? '<span class="fw-ok">Syntax OK</span>' : '<span class="fw-err">Syntax error</span>') : "")
      + '<span style="flex:1"></span><span>Used by ' + used + "</span></div>";
    if (pr.errors && pr.errors.length && kind === "xlsx" && !(pr.sheets && Object.keys(pr.sheets).length)) {
      return toggles + '<div class="sub">' + esc((pr.errors[0] && (pr.errors[0].message || pr.errors[0])) || "Preview unavailable") + "</div>";
    }
    if (mode === "raw") return toggles + '<textarea id="fwRaw" style="width:100%;height:100%;min-height:280px;border:0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">' + esc(pr.raw != null ? pr.raw : currentContent(FW.path)) + "</textarea>";
    if (kind === "xlsx") return toggles + xlsxHtml(pr);
    if (kind === "csv") return toggles + gridHtml(pr.header || [], pr.rows || [], pr);
    if ((kind === "json" || kind === "xml" || kind === "yaml") && mode === "tree") return toggles + '<div class="fw-tree-json">' + treeNodes(pr.tree || [], 1) + "</div>";
    if (kind === "yaml" && pr.table) {
      const envs = pr.envs || (pr.table[0] ? Object.keys(pr.table[0]).filter(function (k) { return k !== "key"; }) : []);
      const header = ["key"].concat(envs);
      const rows = (Array.isArray(pr.table) ? pr.table : []).map(function (r) {
        return header.map(function (h) { return r[h] == null ? "" : r[h]; });
      });
      return toggles + gridHtml(header, rows, pr);
    }
    if (kind === "json" || kind === "xml") return toggles + '<div class="fw-tree-json">' + treeNodes(pr.tree || [], 1) + "</div>";
    return toggles + '<pre class="fw-txtprev">' + esc(pr.raw || currentContent(FW.path) || "") + "</pre>";
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
  function treeNodes(nodes, lvl) {
    lvl = lvl || 1;
    return (nodes || []).map(function (n) {
      const typ = String(n.type || "").toLowerCase();
      const badge = typ ? '<span class="tbadge ' + (typ === "object" ? "obj" : typ === "array" ? "arr" : typ === "string" || typ === "str" ? "str" : typ === "number" || typ === "int" || typ === "float" ? "num" : typ === "bool" || typ === "boolean" ? "bool" : typ === "attr" ? "attr" : typ === "element" ? "el" : "obj") + '">' + esc(typ) + "</span>" : "";
      const hasKids = n.children && n.children.length;
      const kids = hasKids ? treeNodes(n.children, Math.min(4, lvl + 1)) : "";
      const val = (n.value != null && !hasKids) ? '<span class="v">' + esc(typeof n.value === "string" ? JSON.stringify(n.value) : String(n.value)) + "</span>" : "";
      return '<div class="n i' + lvl + '"><span class="ch">' + (hasKids ? "▾" : "•") + '</span><span class="k">' + esc(n.name || n.key || "") + "</span> " + val + badge + "</div>" + kids;
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
    const view = main.querySelector(".fw-codeview");
    if (view) bindCodeView(view, side);
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
    const regenBtn = act("regen");
    if (regenBtn) regenBtn.onclick = function () { openRegenDialog({ path: side === "right" ? FW.splitPath : FW.path }); };
    $$("[data-pev]", main).forEach(function (b) {
      b.onclick = function () { setPreviewEdit(side === "right" ? FW.splitPath : FW.path, b.dataset.pev, side); };
    });
    bindOpenTabs(main);
    $$(".fw-ccode", main).forEach(function (td) {
      td.addEventListener("click", function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        const w = wordFromPoint(e);
        if (w) { e.preventDefault(); goToDefinition(w); }
      });
    });
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

  function bindCodeView(view, side) {
    if (!view) return;
    const path = view.dataset.path || (side === "right" ? FW.splitPath : FW.path);
    const main = view.closest(".fw-main");
    const cact = function (name) { return view.querySelector('[data-cact="' + name + '"]'); };
    const repaint = function () { const host = $("#fwHost"); if (host) paintProject(host); };
    if (cact("raw")) cact("raw").onclick = function () {
      setPlainEditor(!isPlainEditor());
      repaint();
    };
    if (cact("theme")) cact("theme").onclick = function () {
      setCodeTheme(codeTheme() === "light" ? "dark" : "light");
      repaint();
    };
    if (cact("copy")) cact("copy").onclick = async function () {
      try {
        await navigator.clipboard.writeText(currentContent(path));
        toast("Copied");
      } catch (e) { toast("Could not copy"); }
    };
    if (cact("dl")) cact("dl").onclick = function () {
      const name = pathName(path) || "file.txt";
      const blob = new Blob([currentContent(path)], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    };
    if (cact("edit")) cact("edit").onclick = function () {
      setEditing(side, true);
      repaint();
    };
    if (cact("cancel")) cact("cancel").onclick = function () {
      delete FW.unsaved[path];
      setEditing(side, false);
      if (main) markDirtyUi(main, path);
      repaint();
    };
    if (cact("save")) cact("save").onclick = function () { saveCurrent(side); };
    const ta = view.querySelector("textarea.fw-edit-ta");
    if (!ta) { bindReadOnlyCode(view, side, path); return; }
    const gut = view.querySelector(".fw-ln");
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
      if (gut) $$("i", gut).forEach(function (el, i) { el.classList.toggle("cur", i + 1 === line); });
    }
    function syncScroll() {
      if (gut) {
        gut.style.marginBottom = (ta.offsetHeight - ta.clientHeight) + "px";
        gut.scrollTop = ta.scrollTop;
      }
    }
    function renderGutter() {
      if (!gut) return;
      const n = String(ta.value || "").split("\n").length;
      const cur = side === "right" ? (FW.cursorLineR || 1) : (FW.cursorLine || 1);
      if (gut.children.length !== n) {
        let html = "";
        for (let i = 1; i <= n; i++) html += '<i class="' + (i === cur ? "cur" : "") + '">' + i + "</i>";
        gut.innerHTML = html;
      } else {
        $$("i", gut).forEach(function (el, i) { el.classList.toggle("cur", i + 1 === cur); });
      }
    }
    ta.oninput = function () {
      caretPos();
      renderGutter();
      syncScroll();
      const orig = paneOriginal(path, side);
      if (ta.value !== orig) FW.unsaved[path] = ta.value;
      else delete FW.unsaved[path];
      markDirtyUi(main, path);
      maybeAutocomplete(ta, view, false);
    };
    ta.onkeyup = ta.onclick = ta.onselect = function () { caretPos(); };
    ta.onscroll = function () { syncScroll(); hideAutocomplete(); };
    ta.onfocus = function () { FW.splitFocus = side; };
    ta.addEventListener("keydown", function (e) { handleEditorKey(e, ta, view, side); });
    if (typeof ResizeObserver === "function") {
      if (view._fwRo) view._fwRo.disconnect();
      const ro = new ResizeObserver(function () { syncScroll(); });
      view._fwRo = ro;
      ro.observe(ta);
    }
    syncScroll();
    const pend = FW.pendingEdit;
    if (pend && pend.side === side) {
      FW.pendingEdit = null;
      const line = Math.max(1, pend.line || 1);
      const lines = String(ta.value || "").split("\n");
      let pos = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
      const lineText = lines[line - 1] || "";
      const col = Math.max(0, Math.min(pend.col || 0, lineText.length));
      pos += col;
      if (pend.insert) {
        ta.value = ta.value.slice(0, pos) + pend.insert + ta.value.slice(pos);
        pos += String(pend.insert).length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        ta.focus();
        ta.setSelectionRange(pos, pos);
        caretPos();
        renderGutter();
        syncScroll();
      }
    }
  }

  function bindReadOnlyCode(view, side, path) {
    if (!view) return;
    const scroll = view.querySelector(".fw-cscroll") || view;
    const rows = view.querySelectorAll(".fw-ctable tr");
    rows.forEach(function (tr, i) {
      tr.addEventListener("click", function () {
        if (side === "right") FW.clickLineR = i + 1;
        else FW.clickLine = i + 1;
        if (scroll && scroll.focus) scroll.focus();
      });
      tr.addEventListener("dblclick", function (e) {
        e.preventDefault();
        enterEditAt(side, path, i + 1, 0, "");
      });
    });
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Tab" || e.key === "Escape" || e.key === "Enter" || e.key === "Backspace") return;
      if (e.key.length !== 1) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      e.preventDefault();
      const line = side === "right" ? (FW.clickLineR || 1) : (FW.clickLine || 1);
      enterEditAt(side, path, line, 0, e.key);
    }
    scroll.addEventListener("keydown", onKey);
  }

  function enterEditAt(side, path, line, col, insert) {
    FW.pendingEdit = { side: side, line: line || 1, col: col || 0, insert: insert || "" };
    if (side === "right") { FW.cursorLineR = line || 1; FW.cursorColR = (col || 0) + 1; }
    else { FW.cursorLine = line || 1; FW.cursorCol = (col || 0) + 1; }
    setEditing(side, true);
    const host = $("#fwHost");
    if (host) paintProject(host);
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
    const genTc = $("#fwEmptyGenTc", main);
    if (genTc) genTc.onclick = function () { openWizard({ tcId: FW.fromTc }); };
    const link = $("#fwEmptyLink", main);
    if (link) link.onclick = function () {
      const qs = ["view=versions"];
      if (FW.fromTc) qs.unshift("tc=" + encodeURIComponent(FW.fromTc));
      goScripts(qs.join("&"));
    };
    $$("[data-preview]", main).forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        if (typeof go === "function") go("scripts/" + a.dataset.preview + "?preview=1");
      };
    });
    const gen = $("#fwEmptyGen", main);
    if (gen) gen.onclick = function () { openWizard(FW.fromTc ? { tcId: FW.fromTc } : {}); };
    const read = $("#fwEmptyRead", main);
    if (read) read.onclick = function () {
      const row = (FW.tree || []).find(function (r) { return /(?:^|\/)readme\.md$/i.test(r.path || ""); });
      if (row) openFile(row.path);
      else toast("No README.md in this project yet.");
    };
    const data = $("#fwEmptyData", main);
    if (data) data.onclick = function () { openNewFileDialog({ type: "xlsx", folder: "test_data/" }); };
  }

  function bindFolderSummary(main) {
    $$("[data-open]", main).forEach(function (card) {
      card.onclick = function () {
        if (card.dataset.dir === "1") openFolder(card.dataset.open);
        else openFile(card.dataset.open);
      };
    });
    const folder = (FW.file && FW.file.is_dir) ? FW.path : "";
    if ($("#fwFoldNew", main)) $("#fwFoldNew", main).onclick = function () { openNewFileDialog({ folder: folder }); };
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
      setEditing(side, false);
      FW.symbols = null;
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

  function openWizard(opts) {
    opts = opts || {};
    const sel = {};
    if (opts.tcId) sel[opts.tcId] = true;
    FW.wiz = { step: 1, cases: [], sel: sel, filter: "all", tab: "all", preview: null, previewId: opts.tcId || null, context: "", changes: null, result: null };
    const ov = document.createElement("div");
    ov.className = "fw-wiz"; ov.id = "fwWiz";
    ov.innerHTML = '<div class="box"><div class="hd"><h2>Generate into project framework</h2><span style="flex:1"></span><div class="fw-steps" id="fwWizSteps"></div></div><div class="bd" id="fwWizBd">Loading…</div><div class="ft" id="fwWizFt"></div></div>';
    document.body.appendChild(ov);
    paintWiz();
  }
  function closeWiz() { const ov = $("#fwWiz"); if (ov) ov.remove(); }

  function paintWiz() {
    const w = FW.wiz; if (!w || !$("#fwWiz")) return;
    const h2 = $("#fwWiz h2");
    if (w.mode === "regen") {
      if (h2) h2.textContent = "Regenerate script";
      $("#fwWizSteps").innerHTML = '<span class="sub">AI draft vs your files. Manual edits are never overwritten silently.</span>';
    } else if (w.fromLibrary) {
      if (h2) h2.textContent = "Review changes";
      $("#fwWizSteps").innerHTML = '<span class="sub">Adding <b>' + esc(w.fromLibrary) + "</b>"
        + (w.libraryName && w.libraryName !== w.fromLibrary ? " (" + esc(w.libraryName) + ")" : "")
        + " into the project framework</span>";
    } else {
      if (h2) h2.textContent = "Generate into project framework";
      $("#fwWizSteps").innerHTML = ["1. Choose test cases", "2. Generate", "3. Review & Run"].map(function (s, i) {
        return "<span class=\"" + (w.step === i + 1 ? "a" : "") + "\">" + s + "</span>";
      }).join(" → ");
    }
    if (w.fromLibrary || w.mode === "regen") paintWiz3();
    else if (w.step === 1) paintWiz1();
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
    const regen = !!(FW.wiz && FW.wiz.mode === "regen");
    const rows = ch.map(function (c, i) {
      const kind = c.kind || "new";
      const mine = c.current != null ? c.current : existingContent(c.path);
      const edited = c.edited ? ' <span class="fw-mk e">edited</span>' : "";
      return '<tr><td><input type="checkbox" data-inc="' + i + '"' + (c.include !== false ? " checked" : "") + "></td>"
        + "<td>" + esc(c.path) + (c.from_path ? ' <span class="sub">from ' + esc(c.from_path) + "</span>" : "") + ' <span class="fw-kind ' + kind + '">' + esc(kind.charAt(0).toUpperCase() + kind.slice(1)) + "</span>" + edited + "</td>"
        + "<td>" + esc((c.tc_ids || []).join(", ")) + "</td>"
        + '<td><button type="button" class="btn g sm" data-diff="' + i + '">' + (c.show ? "Hide changes" : (regen ? "Show AI vs mine" : "Show changes")) + "</button></td></tr>"
        + (c.show ? '<tr><td colspan="4">' + diffHtml(mine, c.content || "") + "</td></tr>" : "");
    }).join("") || '<tr><td colspan="4">No file changes returned.</td></tr>';
    const intro = regen
      ? '<p class="sub" style="margin-top:0">Compare the new AI draft with your current files. Manually edited files are tagged. Nothing is overwritten until you choose.</p>'
        + '<div class="fw-scope">'
        + '<button type="button" class="' + (FW.wiz.scope !== "tc" ? "on" : "") + '" id="fwRegenFile">Per file</button>'
        + '<button type="button" class="' + (FW.wiz.scope === "tc" ? "on" : "") + '" id="fwRegenTc">Per test case' + (FW.wiz.scopeTc ? " · " + esc(FW.wiz.scopeTc) : "") + "</button>"
        + "</div>"
      : "";
    $("#fwWizBd").innerHTML = intro + '<table class="fw-chg"><thead><tr><th style="width:36px"></th><th>File</th><th>Test cases</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>";
    if (regen) {
      $("#fwWizFt").innerHTML = '<button type="button" class="btn g" id="fwWizKeep">Keep mine</button>'
        + '<button type="button" class="btn g" id="fwWizTake">Take AI</button>'
        + '<button type="button" class="btn" id="fwWizApply">Merge selected</button>';
      const h2 = $("#fwWiz h2"); if (h2) h2.textContent = "Regenerate script";
    } else {
      $("#fwWizFt").innerHTML = '<button type="button" class="btn g" id="fwWizBack">Back</button>'
        + '<button type="button" class="btn" id="fwWizApply">Apply selected</button>'
        + '<button type="button" class="btn g" id="fwWizChk">Check</button>'
        + '<button type="button" class="btn" id="fwWizRun">Run</button>';
    }
    if ($("#fwWizBack")) $("#fwWizBack").onclick = function () {
      if (FW.wiz && (FW.wiz.fromLibrary || FW.wiz.mode === "regen")) { closeWiz(); return; }
      FW.wiz.step = 2; paintWiz();
    };
    if ($("#fwWizKeep")) $("#fwWizKeep").onclick = function () { closeWiz(); toast("Kept your files. Nothing was overwritten."); };
    if ($("#fwWizTake")) $("#fwWizTake").onclick = function () {
      (FW.wiz.changes || []).forEach(function (c) { c.include = true; });
      applyChanges();
    };
    $$("[data-inc]").forEach(function (ck) { ck.onchange = function () { FW.wiz.changes[+ck.dataset.inc].include = ck.checked; }; });
    $$("[data-diff]").forEach(function (b) { b.onclick = function () { const i = +b.dataset.diff; FW.wiz.changes[i].show = !FW.wiz.changes[i].show; paintWiz3(); }; });
    if ($("#fwWizApply")) $("#fwWizApply").onclick = applyChanges;
    if ($("#fwWizChk")) $("#fwWizChk").onclick = function () { startCheck(); };
    if ($("#fwWizRun")) $("#fwWizRun").onclick = function () { startRun(); };
    if ($("#fwRegenFile")) $("#fwRegenFile").onclick = function () { if (FW.wiz.scope !== "file") openRegenDialog({ path: FW.wiz.scopePath, scope: "file", rerun: true }); };
    if ($("#fwRegenTc")) $("#fwRegenTc").onclick = function () { if (FW.wiz.scope !== "tc") openRegenDialog({ path: FW.wiz.scopePath, scope: "tc", rerun: true }); };
  }
  function existingContent(path) {
    if (Object.prototype.hasOwnProperty.call(FW.unsaved, path)) return FW.unsaved[path];
    if (FW.file && FW.path === path && FW.file.content != null) return FW.file.content || "";
    if (FW.splitFile && FW.splitPath === path && FW.splitFile.content != null) return FW.splitFile.content || "";
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
        delete FW.unsaved[c.path];
      });
      FW.symbols = null;
      await reloadTree();
      if (FW.wiz && FW.wiz.mode === "regen") closeWiz();
    } catch (e) { toast(e.message || String(e)); }
  }

  async function openNormalize() {
    try {
      await ensureFramework();
      const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/normalize");
      const items = j.items || [];
      if (!items.length) {
        toast(j.message || "Folders already match the project layout.");
        return;
      }
      FW.norm = { items: items.map(function (it) { return Object.assign({}, it); }) };
      paintNormalize();
    } catch (e) { toast(e.message || String(e)); }
  }
  function paintNormalize() {
    let ov = $("#fwWiz");
    if (!ov) {
      ov = document.createElement("div");
      ov.className = "fw-wiz"; ov.id = "fwWiz";
      ov.innerHTML = '<div class="box"><div class="hd"><h2>Normalize folders</h2><span style="flex:1"></span></div><div class="bd" id="fwWizBd"></div><div class="ft" id="fwWizFt"></div></div>';
      document.body.appendChild(ov);
    }
    const h2 = $("#fwWiz h2"); if (h2) h2.textContent = "Normalize folders";
    const items = (FW.norm && FW.norm.items) || [];
    const rows = items.map(function (it, i) {
      const st = it.status === "differs" ? "differs" : (it.status === "same" ? "same" : "new");
      const label = it.action === "conflict" ? "Contents differ" : (it.action === "reuse" ? "Same content" : "Move");
      let res = "";
      if (it.action === "conflict") {
        const r = it.resolution || "keep";
        res = '<div class="fw-norm-res">'
          + '<label><input type="radio" name="nres' + i + '" value="keep"' + (r === "keep" ? " checked" : "") + '> Keep mine</label>'
          + '<label><input type="radio" name="nres' + i + '" value="take"' + (r === "take" ? " checked" : "") + '> Take incoming</label>'
          + '<label><input type="radio" name="nres' + i + '" value="merge"' + (r === "merge" ? " checked" : "") + '> Merge</label></div>';
        if (r === "merge") {
          const draft = it.merged_content != null ? it.merged_content : defaultMergeDraft(it);
          res += '<textarea class="fw-norm-merge" data-nmerge="' + i + '">' + esc(draft) + "</textarea>";
        }
        res += '<button type="button" class="btn g sm" data-ndiff="' + i + '">' + (it.show ? "Hide changes" : "Show changes") + "</button>";
      }
      return '<tr><td><input type="checkbox" data-ninc="' + i + '"' + (it.include !== false ? " checked" : "") + "></td>"
        + "<td>" + esc(it.from) + ' → <b>' + esc(it.to) + "</b> <span class=\"fw-kind " + (st === "differs" ? "changed" : (st === "same" ? "reused" : "new")) + '">' + esc(label) + "</span>"
        + ' <span class="sub">' + esc(it.kind || "") + "</span></td><td>" + res + "</td></tr>"
        + (it.show ? '<tr><td colspan="3">' + diffHtml(it.to_content || "", it.from_content || "") + "</td></tr>" : "");
    }).join("") || '<tr><td colspan="3">Nothing to normalize.</td></tr>';
    $("#fwWizBd").innerHTML = '<p class="sub" style="margin-top:0">These files sit in a duplicate tree (<code>ui/</code> or <code>tests/web/</code>). Confirm each move into the existing <code>pages/</code> and <code>tests/&lt;area&gt;/</code> folders. Nothing is deleted until you apply. When contents differ, choose Keep mine, Take incoming, or Merge.</p>'
      + '<table class="fw-chg"><thead><tr><th style="width:36px"></th><th>Move</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>";
    $("#fwWizFt").innerHTML = '<button type="button" class="btn g" id="fwWizX">Cancel</button>'
      + '<button type="button" class="btn" id="fwNormApply">Apply selected</button>';
    if ($("#fwWizX")) $("#fwWizX").onclick = closeWiz;
    $$("[data-ninc]").forEach(function (ck) { ck.onchange = function () { FW.norm.items[+ck.dataset.ninc].include = ck.checked; }; });
    $$("[data-ndiff]").forEach(function (b) { b.onclick = function () { FW.norm.items[+b.dataset.ndiff].show = !FW.norm.items[+b.dataset.ndiff].show; paintNormalize(); }; });
    $$("input[name^=nres]").forEach(function (r) {
      r.onchange = function () {
        const i = +r.name.replace("nres", "");
        FW.norm.items[i].resolution = r.value;
        if (r.value === "merge" && FW.norm.items[i].merged_content == null) FW.norm.items[i].merged_content = defaultMergeDraft(FW.norm.items[i]);
        paintNormalize();
      };
    });
    $$("[data-nmerge]").forEach(function (ta) {
      ta.oninput = function () { FW.norm.items[+ta.dataset.nmerge].merged_content = ta.value; };
    });
    if ($("#fwNormApply")) $("#fwNormApply").onclick = applyNormalize;
  }
  function defaultMergeDraft(it) {
    const mine = it.to_content || "";
    const incoming = it.from_content || "";
    return "# --- current (keep) ---\\n" + mine + (mine && !/\\n$/.test(mine) ? "\\n" : "") + "\\n# --- incoming ---\\n" + incoming;
  }
  async function applyNormalize() {
    const items = ((FW.norm && FW.norm.items) || []).filter(function (it) { return it.include !== false; });
    if (!items.length) { toast("Select at least one move to apply."); return; }
    const missing = items.filter(function (it) { return it.action === "conflict" && it.resolution === "merge" && !String(it.merged_content || "").trim(); });
    if (missing.length) { toast("Add merged content for each Merge row, or choose Keep mine / Take incoming."); return; }
    try {
      const payload = {
        confirm: true,
        author: "You",
        items: items.map(function (it) {
          return {
            from: it.from,
            to: it.to,
            include: true,
            resolution: it.resolution || (it.action === "conflict" ? "keep" : "take"),
            merged_content: it.merged_content || "",
          };
        }),
      };
      const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/normalize", { method: "POST", body: payload });
      toast("Folder layout updated (" + ((j.applied || []).length) + " move" + ((j.applied || []).length === 1 ? "" : "s") + ").");
      closeWiz();
      FW.norm = null;
      FW.symbols = null;
      if (j.tree) FW.tree = j.tree;
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


  function isPreviewable(path) {
    const e = extOf(path);
    return /^(xlsx|csv|json|xml|yaml|yml|txt)$/.test(e);
  }

  function previewEditToggle(path, pane) {
    const mode = (FW.dataMode[path] === "edit" || (pane === "code" && isEditing("left") && FW.dataMode[path] !== "preview")) ? "edit" : "preview";
    if (pane !== "preview" && pane !== "code") return "";
    return '<span class="fw-pev"><button type="button" data-pev="preview" class="' + (mode === "preview" && pane === "preview" ? "on" : "") + '">Preview</button>'
      + '<button type="button" data-pev="edit" class="' + (pane === "code" ? "on" : "") + '">Edit</button></span>';
  }

  function setPreviewEdit(path, mode, side) {
    side = side || "left";
    FW.dataMode[path] = mode === "edit" ? "edit" : "preview";
    if (mode === "edit") {
      if (side === "right") FW.viewPaneRight = "code";
      else FW.viewPane = "code";
      setEditing(side, true);
    } else {
      if (side === "right") FW.viewPaneRight = "preview";
      else FW.viewPane = "preview";
      setEditing(side, false);
    }
    const host = $("#fwHost");
    if (host) paintProject(host);
  }

  function rememberTab(path) {
    if (!path) return;
    FW.openTabs = FW.openTabs || [];
    if (FW.openTabs.indexOf(path) < 0) FW.openTabs.push(path);
  }

  function openTabsHtml(active) {
    const tabs = (FW.openTabs || []).filter(function (p) { return (FW.tree || []).some(function (r) { return r.path === p && !r.is_dir; }) || p === active; });
    FW.openTabs = tabs;
    if (!tabs.length) return "";
    return '<div class="fw-tabs" id="fwOpenTabs">'
      + tabs.map(function (p) {
          const on = p === active ? " on" : "";
          const dirty = FW.unsaved[p] ? '<span class="udot" title="Unsaved changes"></span>' : "";
          return '<button type="button" class="tab' + on + '" data-tab="' + esc(p) + '">' + fwIcon(p, false) + '<span class="nm">' + esc(pathName(p)) + "</span>" + dirty + '<span class="x" data-tabx="' + esc(p) + '" title="Close">×</span></button>';
        }).join("")
      + '<button type="button" class="qp" id="fwQuickOpen" title="Quick open">Quick open <kbd>Ctrl</kbd><kbd>P</kbd></button></div>';
  }

  function bindOpenTabs(main) {
    if (!main) return;
    $$("[data-tab]", main).forEach(function (b) {
      b.onclick = function (e) {
        if (e.target && e.target.dataset && e.target.dataset.tabx != null) return;
        if (b.dataset.tab) openFile(b.dataset.tab);
      };
    });
    $$("[data-tabx]", main).forEach(function (x) {
      x.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeEditorTab(x.dataset.tabx);
      };
    });
    if ($("#fwQuickOpen", main)) $("#fwQuickOpen", main).onclick = function () { openQuickOpen(); };
  }

  function closeEditorTab(path) {
    FW.openTabs = (FW.openTabs || []).filter(function (p) { return p !== path; });
    if (FW.path === path) {
      const next = FW.openTabs[FW.openTabs.length - 1];
      if (next) openFile(next);
      else { FW.path = ""; FW.file = null; const host = $("#fwHost"); if (host) paintProject(host); }
    } else {
      const host = $("#fwHost"); if (host) paintProject(host);
    }
  }

  function bindFwEditorKeys() {
    if (FW._keysBound) return;
    FW._keysBound = true;
    document.addEventListener("keydown", function (e) {
      if (!$(".fw-shell")) return;
      onTermGlobalKey(e);
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        openQuickOpen();
        return;
      }
      if (e.key === "Escape") {
        hideAutocomplete();
        closeQuickOpen();
        return;
      }
      if (e.key === "F12") {
        const ta = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("fw-edit-ta") ? document.activeElement : null;
        const w = ta ? wordAtCaret(ta).token.replace(/\.$/, "").split(".").pop() : null;
        if (w) { e.preventDefault(); goToDefinition(w); }
      }
    });
  }

  function FILE_TYPES() {
    return [
      { id: "py", ext: "py", label: "Python" },
      { id: "xlsx", ext: "xlsx", label: "Excel" },
      { id: "csv", ext: "csv", label: "CSV" },
      { id: "json", ext: "json", label: "JSON" },
      { id: "txt", ext: "txt", label: "TXT" },
      { id: "yaml", ext: "yaml", label: "YAML" },
      { id: "xml", ext: "xml", label: "XML" },
    ];
  }

  function defaultNewFolder(typeId) {
    const folders = (FW.tree || []).filter(function (r) { return r.is_dir; }).map(function (r) { return r.path; });
    if (typeId === "py") {
      if (folders.indexOf("tests/") >= 0) return "tests/";
      if (folders.indexOf("pages/") >= 0) return "pages/";
    } else if (folders.indexOf("test_data/") >= 0) return "test_data/";
    if (FW.path && FW.file && FW.file.is_dir) return normDir(FW.path);
    if (FW.path) {
      const p = (FW.path || "").split("/").slice(0, -1).join("/");
      return p ? normDir(p) : "";
    }
    return "";
  }

  function openNewFileDialog(opts) {
    opts = opts || {};
    closeFwMenu();
    const types = FILE_TYPES();
    let typeId = opts.type || (FW.lang === "python" || !FW.lang ? "py" : types[0].id);
    if (!types.some(function (t) { return t.id === typeId; })) typeId = "py";
    let folder = opts.folder != null && opts.folder !== "" ? normDir(opts.folder) : defaultNewFolder(typeId);
    let name = opts.name || "";
    const ov = document.createElement("div");
    ov.className = "fw-wiz"; ov.id = "fwNewFile";
    function typ() { return types.find(function (t) { return t.id === typeId; }) || types[0]; }
    function paint() {
      const t = typ();
      const folders = (FW.tree || []).filter(function (r) { return r.is_dir; })
        .sort(function (a, b) { return a.path.localeCompare(b.path); });
      if (folder && folders.every(function (r) { return r.path !== folder && r.path !== normDir(folder); })) {
        /* keep typed folder even if not in tree yet */
      }
      const typeBtns = types.map(function (x) {
        return '<button type="button" class="' + (x.id === typeId ? "on" : "") + '" data-nt="' + x.id + '">' + fwIcon("file." + x.ext, false) + esc(x.label) + "</button>";
      }).join("");
      const foldRows = '<button type="button" class="row' + (!folder ? " on" : "") + '" data-folder="">(project root)</button>'
        + folders.map(function (r) {
            const depth = r.path.replace(/\/$/, "").split("/").length;
            return '<button type="button" class="row' + (normDir(r.path) === folder ? " on" : "") + '" data-folder="' + esc(r.path) + '" style="padding-left:' + (8 + (depth - 1) * 12) + 'px">' + fwIcon(r.path, true) + esc(r.path.replace(/\/$/, "")) + "</button>";
          }).join("");
      const stem = name.replace(/\.[^.]+$/, "");
      ov.querySelector(".box").innerHTML = '<div class="hd"><div><h2>New file</h2><p class="sub" style="margin:4px 0 0">The extension and icon follow the file type. Excel, JSON, TXT, CSV, YAML, and XML get a Preview after they are created.</p></div><button type="button" class="btn g sm" id="fwNfX">✕</button></div>'
        + '<div class="bd">'
        + '<label class="sub" style="display:block;font-weight:750;text-transform:uppercase;letter-spacing:.04em;font-size:11px;margin:0 0 6px">Type</label>'
        + '<div class="fw-types">' + typeBtns + "</div>"
        + '<label class="sub" style="display:block;font-weight:750;text-transform:uppercase;letter-spacing:.04em;font-size:11px;margin:0 0 6px">File name</label>'
        + '<div class="fw-name">' + fwIcon("file." + t.ext, false) + '<input id="fwNfName" value="' + esc(stem) + '" placeholder="file_name" spellcheck="false"><span class="ext">.' + esc(t.ext) + "</span></div>"
        + '<p class="sub" style="margin:6px 0 12px">The extension is set from the file type (.' + esc(t.ext) + ").</p>"
        + '<label class="sub" style="display:block;font-weight:750;text-transform:uppercase;letter-spacing:.04em;font-size:11px;margin:0 0 6px">Target folder</label>'
        + '<div class="fw-folderlist" id="fwNfFolders">' + foldRows + "</div>"
        + "</div>"
        + '<div class="ft"><button type="button" class="btn g" id="fwNfCancel">Cancel</button><button type="button" class="btn" id="fwNfGo">Create file</button></div>';
      ov.querySelector(".box").classList.add("fw-newf");
      $$("[data-nt]", ov).forEach(function (b) {
        b.onclick = function () {
          const inp = $("#fwNfName", ov);
          name = inp ? inp.value : name;
          typeId = b.dataset.nt;
          if (!opts.folder) folder = defaultNewFolder(typeId);
          paint();
        };
      });
      $$("[data-folder]", ov).forEach(function (b) {
        b.onclick = function () { folder = b.dataset.folder || ""; const inp = $("#fwNfName", ov); name = inp ? inp.value : name; paint(); };
      });
      if ($("#fwNfX", ov)) $("#fwNfX", ov).onclick = close;
      if ($("#fwNfCancel", ov)) $("#fwNfCancel", ov).onclick = close;
      if ($("#fwNfGo", ov)) $("#fwNfGo", ov).onclick = function () { create(); };
      const inp = $("#fwNfName", ov);
      if (inp) { inp.focus(); inp.select(); inp.onkeydown = function (e) { if (e.key === "Enter") create(); if (e.key === "Escape") close(); }; }
    }
    function close() { if (ov && ov.parentNode) ov.remove(); }
    async function create() {
      const inp = $("#fwNfName", ov);
      let stem = ((inp && inp.value) || name || "").trim();
      if (!stem) { toast("Enter a file name."); return; }
      const t = typ();
      const re = new RegExp("\\." + t.ext + "$", "i");
      if (re.test(stem)) stem = stem.slice(0, -(t.ext.length + 1));
      const base = folder ? (folder.endsWith("/") ? folder : folder + "/") : "";
      const path = base + stem + "." + t.ext;
      try {
        await ensureFramework();
        await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/files", { method: "POST", body: { path: path } });
        close();
        FW.symbols = null;
        await reloadTree();
        await openFile(path);
        if (isPreviewable(path)) {
          FW.dataMode[path] = "preview";
          FW.viewPane = "preview";
          const host = $("#fwHost"); if (host) paintProject(host);
        } else {
          setEditing("left", true);
          const host = $("#fwHost"); if (host) paintProject(host);
        }
        toast("Created " + path);
      } catch (e) { toast(e.message || String(e)); }
    }
    ov.innerHTML = '<div class="box fw-newf"></div>';
    document.body.appendChild(ov);
    paint();
  }

  function closeQuickOpen() { const el = $("#fwPalette"); if (el) el.remove(); }

  function openQuickOpen(preset) {
    closeQuickOpen();
    const files = (FW.tree || []).filter(function (r) { return !r.is_dir; });
    const box = document.createElement("div");
    box.className = "fw-palette"; box.id = "fwPalette";
    box.innerHTML = '<div class="q">🔍 <input id="fwPq" type="search" placeholder="Open file" spellcheck="false" value="' + esc(preset || "") + '"> <kbd>Ctrl</kbd><kbd>P</kbd></div><div id="fwPqList"></div>';
    document.body.appendChild(box);
    let sel = 0;
    function qv() { return (($("#fwPq") && $("#fwPq").value) || "").trim().toLowerCase(); }
    function hits() {
      const q = qv();
      const list = files.filter(function (r) {
        if (!q) return true;
        const n = pathName(r.path).toLowerCase();
        return n.indexOf(q) >= 0 || String(r.path).toLowerCase().indexOf(q) >= 0;
      }).slice(0, 12);
      return list;
    }
    function paintList() {
      const list = hits();
      if (sel >= list.length) sel = Math.max(0, list.length - 1);
      const el = $("#fwPqList");
      if (!el) return;
      el.innerHTML = list.map(function (r, i) {
        const dir = r.path.split("/").slice(0, -1).join("/");
        return '<div class="row' + (i === sel ? " on" : "") + '" data-i="' + i + '" data-open="' + esc(r.path) + '">' + fwIcon(r.path, false) + "<b>" + esc(pathName(r.path)) + '</b><span class="path">' + esc(dir) + "</span></div>";
      }).join("") || '<div class="row">No matching files.</div>';
      $$("[data-open]", el).forEach(function (row) {
        row.onmouseenter = function () { sel = +row.dataset.i; paintList(); };
        row.onclick = function () { pick(row.dataset.open); };
      });
    }
    function pick(path) {
      closeQuickOpen();
      if (path) openFile(path);
    }
    paintList();
    const inp = $("#fwPq");
    if (inp) {
      inp.focus();
      inp.setSelectionRange((inp.value || "").length, (inp.value || "").length);
      inp.oninput = function () { sel = 0; paintList(); };
      inp.onkeydown = function (e) {
        const list = hits();
        if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(list.length - 1, sel + 1); paintList(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); paintList(); }
        else if (e.key === "Enter") { e.preventDefault(); if (list[sel]) pick(list[sel].path); }
        else if (e.key === "Escape") { e.preventDefault(); closeQuickOpen(); }
      };
    }
  }

  async function ensureSymbols() {
    if (FW.symbols) return FW.symbols;
    if (!FW.fid) return [];
    try {
      const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/symbols");
      FW.symbols = j.symbols || [];
    } catch (e) { FW.symbols = []; }
    return FW.symbols;
  }

  function PY_KEYWORDS() {
    return ["and","as","assert","async","await","break","class","continue","def","del","elif","else","except","False","finally","for","from","global","if","import","in","is","lambda","None","nonlocal","not","or","pass","raise","return","True","try","while","with","yield","self","pytest"];
  }
  function PW_APIS() {
    return [
      { name: "get_by_role", detail: "playwright.sync_api" },
      { name: "get_by_label", detail: "playwright.sync_api" },
      { name: "get_by_text", detail: "playwright.sync_api" },
      { name: "get_by_placeholder", detail: "playwright.sync_api" },
      { name: "get_by_test_id", detail: "playwright.sync_api" },
      { name: "locator", detail: "playwright.sync_api" },
      { name: "goto", detail: "page.goto" },
      { name: "click", detail: "locator.click" },
      { name: "fill", detail: "locator.fill" },
      { name: "press", detail: "locator.press" },
      { name: "hover", detail: "locator.hover" },
      { name: "check", detail: "locator.check" },
      { name: "uncheck", detail: "locator.uncheck" },
      { name: "select_option", detail: "locator.select_option" },
      { name: "wait_for", detail: "locator.wait_for" },
      { name: "expect", detail: "playwright.sync_api" },
      { name: "to_be_visible", detail: "expect" },
      { name: "to_have_url", detail: "expect" },
      { name: "to_have_text", detail: "expect" },
      { name: "to_be_enabled", detail: "expect" },
      { name: "page", detail: "fixture" },
    ];
  }

  function wordAtCaret(ta) {
    const v = ta.value || "";
    const pos = ta.selectionStart || 0;
    const left = v.slice(0, pos);
    const right = v.slice(pos);
    const dotted = (left.match(/[A-Za-z_][\w.]*$/) || [""])[0];
    const pre = (left.match(/[A-Za-z0-9_]+$/) || [""])[0];
    const suf = (right.match(/^[A-Za-z0-9_]+/) || [""])[0];
    return { prefix: pre, token: dotted, start: pos - pre.length, end: pos + suf.length, pos: pos };
  }

  function wordFromPoint(e) {
    const td = e.currentTarget || e.target;
    const text = td && td.innerText ? td.innerText : "";
    if (!text) return "";
    let idx = 0;
    try {
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (r && td.contains(r.startContainer)) {
          const pre = document.createRange();
          pre.selectNodeContents(td);
          pre.setEnd(r.startContainer, r.startOffset);
          idx = pre.toString().length;
        }
      }
    } catch (err) { idx = 0; }
    const left = text.slice(0, idx);
    const right = text.slice(idx);
    const pre = (left.match(/[A-Za-z0-9_]+$/) || [""])[0];
    const suf = (right.match(/^[A-Za-z0-9_]+/) || [""])[0];
    return pre + suf;
  }

  function hideAutocomplete() {
    const el = $("#fwAc");
    if (el) el.remove();
    FW.acFromKey = false;
  }

  function acItems(prefix, token, symbols) {
    const q = String(prefix || "").toLowerCase();
    const dotted = String(token || "");
    const afterDot = dotted.indexOf(".") >= 0;
    const obj = afterDot ? dotted.split(".").slice(0, -1).join(".") : "";
    const out = [];
    function add(it) {
      const name = it.name || "";
      if (q && name.toLowerCase().indexOf(q) !== 0) return;
      out.push(it);
    }
    (symbols || []).forEach(function (s) {
      if (afterDot && (s.kind === "method" || s.kind === "locator")) {
        if (obj && s.page && s.page.toLowerCase() !== obj.toLowerCase() && s.page.toLowerCase().indexOf(obj.toLowerCase()) < 0) {
          /* still include locators/methods that match the prefix */
        }
        add({ name: s.name, kind: s.kind, detail: s.detail, path: s.path, line: s.line, insert: s.name + (s.kind === "method" ? "()" : "") });
      } else if (!afterDot) {
        add({ name: s.name, kind: s.kind, detail: s.detail, path: s.path, line: s.line, insert: s.name });
      }
    });
    if (!afterDot) {
      PY_KEYWORDS().forEach(function (k) { add({ name: k, kind: "keyword", detail: "Python", insert: k }); });
    }
    PW_APIS().forEach(function (k) { add({ name: k.name, kind: "playwright", detail: k.detail, insert: k.name + "()" }); });
    const seen = {};
    const uniq = [];
    out.forEach(function (it) {
      const key = it.kind + ":" + it.name;
      if (seen[key]) return;
      seen[key] = 1;
      uniq.push(it);
    });
    uniq.sort(function (a, b) {
      const rank = { method: 0, class: 1, locator: 2, function: 3, playwright: 4, keyword: 5 };
      return (rank[a.kind] || 9) - (rank[b.kind] || 9) || a.name.localeCompare(b.name);
    });
    return uniq.slice(0, 12);
  }

  async function maybeAutocomplete(ta, view, fromKey) {
    if (fromKey) FW.acFromKey = true;
    const w = wordAtCaret(ta);
    if (!fromKey && (!w.prefix || w.prefix.length < 1) && !/\.$/.test(w.token)) { hideAutocomplete(); return; }
    const symbols = await ensureSymbols();
    const items = acItems(w.prefix, w.token, symbols);
    showAutocomplete(ta, view, items, w, !!fromKey || FW.acFromKey);
  }

  function showAutocomplete(ta, view, items, word, withAi) {
    hideAutocomplete();
    if (!items.length && !withAi) return;
    const box = document.createElement("div");
    box.className = "fw-ac"; box.id = "fwAc";
    const rows = items.map(function (it, i) {
      return '<div class="row' + (i === 0 ? " on" : "") + '" data-i="' + i + '"><span class="name">' + esc(it.name) + '</span><span class="sub">' + esc(it.detail || "") + '</span><span class="kind">' + esc(it.kind) + "</span></div>";
    }).join("");
    const ai = withAi ? '<div class="row ai" data-ai="1"><span class="name">✨ Ask AI for a suggestion</span><span class="kind">AI</span></div>' : "";
    box.innerHTML = rows + ai;
    document.body.appendChild(box);
    const c = caretViewport(ta);
    let left = c.left || 48;
    let top = (c.bottom || ((c.top || 24) + 18)) + 4;
    box.style.position = "fixed";
    box.style.zIndex = "120";
    box.style.top = top + "px";
    box.style.left = left + "px";
    const br = box.getBoundingClientRect();
    if (top + br.height > window.innerHeight - 8) {
      top = Math.max(8, (c.top || 24) - br.height - 4);
      box.style.top = top + "px";
    }
    if (left + br.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - br.width - 8);
      box.style.left = left + "px";
    }
    if (left < 8) box.style.left = "8px";
    let sel = 0;
    const all = box.querySelectorAll(".row");
    function paintSel() {
      all.forEach(function (r, i) { r.classList.toggle("on", i === sel); });
    }
    function accept(i) {
      const row = all[i];
      if (!row) return;
      if (row.dataset.ai) { hideAutocomplete(); askAiCompletion(ta, view, word); return; }
      const it = items[+row.dataset.i];
      if (it) insertCompletion(ta, word, it.insert || it.name);
      hideAutocomplete();
    }
    all.forEach(function (r, i) {
      r.onmouseenter = function () { sel = i; paintSel(); };
      r.onclick = function (e) { e.preventDefault(); accept(i); };
    });
    box._fwMove = function (dir) { sel = (sel + dir + all.length) % all.length; paintSel(); };
    box._fwAccept = function () { accept(sel); };
  }

  function caretOffsetInView(ta, parent) {
    const div = document.createElement("div");
    const st = window.getComputedStyle(ta);
    const props = ["fontFamily","fontSize","fontWeight","fontStyle","letterSpacing","textTransform","wordSpacing","textIndent","lineHeight","padding","border","boxSizing"];
    props.forEach(function (p) { try { div.style[p] = st[p]; } catch (e) {} });
    div.style.position = "absolute";
    div.style.visibility = "hidden";
    div.style.whiteSpace = "pre";
    div.style.overflow = "hidden";
    div.style.width = ta.clientWidth + "px";
    div.style.left = "0";
    div.style.top = "0";
    const pos = ta.selectionStart || 0;
    div.textContent = ta.value.slice(0, pos);
    const span = document.createElement("span");
    span.textContent = "\u200b";
    div.appendChild(span);
    document.body.appendChild(div);
    const taRect = ta.getBoundingClientRect();
    const pRect = (parent || ta).getBoundingClientRect();
    const sRect = span.getBoundingClientRect();
    const dRect = div.getBoundingClientRect();
    const top = (sRect.top - dRect.top) - ta.scrollTop + (taRect.top - pRect.top);
    const left = (sRect.left - dRect.left) - ta.scrollLeft + (taRect.left - pRect.left);
    div.remove();
    return { top: top, left: left };
  }

  function caretViewport(ta) {
    const rel = caretOffsetInView(ta, ta);
    const taRect = ta.getBoundingClientRect();
    const st = window.getComputedStyle(ta);
    const lh = parseFloat(st.lineHeight) || 20;
    const top = taRect.top + (rel.top || 0);
    const left = taRect.left + (rel.left || 0);
    return { top: top, left: left, bottom: top + lh, height: lh };
  }

  function insertCompletion(ta, word, text) {
    const v = ta.value || "";
    const start = word && word.start != null ? word.start : (ta.selectionStart || 0);
    const end = word && word.end != null ? word.end : (ta.selectionEnd || 0);
    ta.value = v.slice(0, start) + text + v.slice(end);
    const caret = start + String(text).length;
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
  }

  async function askAiCompletion(ta, view, word) {
    if (!FW.fid) { toast("No project framework is loaded."); return; }
    try {
      const picked = await pickAi("Ask AI for a completion");
      const v = ta.value || "";
      const pos = (word && word.pos) || ta.selectionStart || 0;
      const j = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/suggest", {
        method: "POST",
        body: {
          kind: "completion",
          provider: picked.provider,
          model: picked.model,
          context: {
            path: ta.dataset.path || FW.path,
            prefix: (word && word.prefix) || "",
            before: v.slice(Math.max(0, pos - 2000), pos),
            after: v.slice(pos, pos + 800),
          },
        },
      });
      const text = (j.suggestion && (j.suggestion.text || j.suggestion.completion)) || (typeof j.suggestion === "string" ? j.suggestion : "");
      if (!text) { toast("No suggestion returned."); return; }
      insertCompletion(ta, word, text);
      toast("AI suggestion inserted");
    } catch (e) {
      if (String(e.message) === "cancelled") return;
      toast(e.message || String(e));
    }
  }

  function handleEditorKey(e, ta, view, side) {
    const ac = $("#fwAc");
    if (ac && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      if (ac._fwMove) ac._fwMove(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (ac && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      if (ac._fwAccept) ac._fwAccept();
      return;
    }
    if (ac && e.key === "Escape") { e.preventDefault(); hideAutocomplete(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === " ") {
      e.preventDefault();
      maybeAutocomplete(ta, view, true);
      return;
    }
    if (mod && !e.shiftKey && (e.key === "b" || e.key === "B") && e.altKey) {
      /* reserved */
    }
  }

  async function goToDefinition(name) {
    name = String(name || "").trim();
    if (!name) return;
    const symbols = await ensureSymbols();
    const lower = name.toLowerCase();
    let hit = symbols.find(function (s) { return s.kind === "class" && String(s.name).toLowerCase() === lower; });
    if (!hit) hit = symbols.find(function (s) { return (s.kind === "function" || s.kind === "method") && String(s.name).toLowerCase() === lower; });
    if (!hit) hit = symbols.find(function (s) { return String(s.name).toLowerCase() === lower; });
    if (!hit || !hit.path) { toast("No definition found for “" + name + "”."); return; }
    FW.revealLine = hit.line || 1;
    if (FW.path === hit.path) {
      const line = FW.revealLine; FW.revealLine = 0;
      revealCodeLine("left", line);
    } else {
      await openFile(hit.path);
    }
  }

  function revealCodeLine(side, line) {
    const root = side === "right" ? $("#fwMain2") : $("#fwMain");
    if (!root) return;
    const rows = root.querySelectorAll(".fw-ctable tr");
    const n = Math.max(1, line | 0);
    const tr = rows[n - 1];
    if (tr) {
      tr.classList.add("fw-reveal");
      tr.scrollIntoView({ block: "center" });
      setTimeout(function () { tr.classList.remove("fw-reveal"); }, 1600);
    }
    const gut = root.querySelectorAll(".fw-ln i")[n - 1];
    if (gut) {
      gut.classList.add("cur");
      gut.scrollIntoView({ block: "center" });
    }
    if (isEditing(side)) {
      const ta = root.querySelector("textarea.fw-edit-ta");
      if (ta) {
        const parts = String(ta.value || "").split("\n");
        let pos = 0;
        for (let i = 0; i < n - 1 && i < parts.length; i++) pos += parts[i].length + 1;
        ta.focus();
        ta.setSelectionRange(pos, pos);
        const lh = parseFloat(window.getComputedStyle(ta).lineHeight) || 18;
        ta.scrollTop = Math.max(0, (n - 4) * lh);
      }
    }
  }

  async function openRegenDialog(opts) {
    opts = opts || {};
    const path = opts.path || FW.path;
    let scope = opts.scope || "file";
    try {
      await ensureFramework();
      let used = (FW.file && FW.path === path && FW.file.used_by) || [];
      if ((!used || !used.length) && path) {
        try {
          const jf = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/file?path=" + encodeURIComponent(path));
          used = (jf && jf.used_by) || [];
        } catch (e1) { used = used || []; }
      }
      let tcs = used.slice();
      if ((!tcs || !tcs.length) && FW.fromTc) tcs = [FW.fromTc];
      if (scope === "tc" && (!tcs || !tcs.length)) {
        toast("This file is not linked to a test case. Link a case, or regenerate from Generate.");
        return;
      }
      if (scope === "file" && (!tcs || !tcs.length)) {
        toast("Regenerate needs a linked test case for this file. Generate one first, or choose Per test case after linking.");
        return;
      }
      const picked = await pickAi("Regenerate automation script");
      let cases = [];
      try {
        const repo = await api("/api/repo");
        cases = repo.cases || [];
      } catch (e) { toast(e.message || String(e)); return; }
      const ids = scope === "tc" ? [tcs[0]] : tcs;
      const selected = cases.filter(function (c) { return ids.indexOf(c.id) >= 0; });
      if (!selected.length) { toast("Could not load the linked test case(s)."); return; }
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
        additional_context: (scope === "file" && path) ? ("Regenerate in particular: " + path + ". Preserve unrelated files. Do not drop manual comments if they still apply.") : "",
        provider: picked.provider, model: picked.model,
      };
      closeWiz();
      const ov = document.createElement("div");
      ov.className = "fw-wiz"; ov.id = "fwWiz";
      ov.innerHTML = '<div class="box"><div class="hd"><h2>Regenerate script</h2><span style="flex:1"></span><div class="fw-steps" id="fwWizSteps"></div></div><div class="bd" id="fwWizBd">Generating…</div><div class="ft" id="fwWizFt"></div></div>';
      document.body.appendChild(ov);
      const res = await fwApi("/frameworks/" + encodeURIComponent(FW.fid) + "/generate", { method: "POST", body: body });
      let changes = (res.changes || []).map(function (c) { return Object.assign({}, c, { include: c.include !== false, show: !!c.edited || (scope === "file" && c.path === path) }); });
      if (scope === "file" && path) {
        changes.forEach(function (c) { c.include = c.path === path ? c.include !== false : false; });
      }
      FW.wiz = {
        step: 3, mode: "regen", scope: scope, scopePath: path, scopeTc: ids[0] || "",
        cases: cases, sel: {}, changes: changes, result: res, context: "",
      };
      paintWiz();
    } catch (e) {
      if (String(e.message) === "cancelled") return;
      if ($("#fwWizBd")) {
        $("#fwWizBd").innerHTML = '<div class="error">' + esc(e.message || e) + "</div>";
        $("#fwWizFt").innerHTML = '<button type="button" class="btn g" id="fwWizX">Close</button>';
        if ($("#fwWizX")) $("#fwWizX").onclick = closeWiz;
      } else toast(e.message || String(e));
    }
  }


  window.fwAddLibraryToProject = addLibraryToProject;
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


  /* ---- v14 flexible terminal (additive) ---- */
  var TERM_STORE = "atg.fw.term.layout";
  var TERM_FLAGS = ["-m","-k","-v","-vv","-q","-x","-s","-n","--lf","--ff","--headed","--headless","--tb=short","--tb=long","--tb=line","--browser","--maxfail=1","--collect-only","--tracing=retain-on-failure","--junitxml=reports/junit.xml"];

  function termSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M12 15h5"/></svg>';
  }
  function defaultTermFavs() {
    return [
      { name: "UI smoke", cmd: "pytest tests/web -m ui" },
      { name: "Rerun failed", cmd: "pytest --lf" },
      { name: "Headed Chromium", cmd: "pytest tests --headed --browser chromium" },
      { name: "API only", cmd: "pytest tests/api" },
    ];
  }
  function newTermTab(title, kind) {
    return {
      id: "t" + Date.now().toString(36) + Math.floor(Math.random() * 1000),
      title: title || "Terminal",
      kind: kind || "cmd",
      cmd: "",
      runId: "",
      log: "",
      status: "idle",
      startedAt: 0,
      exitCode: null,
      summary: null,
      lineTimes: [],
    };
  }
  function defaultTermState() {
    return {
      open: false,
      dock: "bottom",
      theme: "follow",
      remember: true,
      timeoutMin: 30,
      shell: false,
      height: 322,
      width: 420,
      float: { left: 240, top: 80, w: 640, h: 400 },
      maximized: false,
      collapsed: false,
      tabs: [newTermTab("Run all", "all")],
      active: 0,
      split: false,
      favs: defaultTermFavs(),
      hist: [],
      histIdx: -1,
      filter: "all",
      wrap: false,
      font: 12,
      timestamps: false,
      findOpen: false,
      findQ: "",
      findIdx: 0,
      browser: "chromium",
      headed: false,
      envName: "staging",
      settingsOpen: false,
      histOpen: false,
      cmdDraft: "",
      acOpen: false,
      acItems: [],
      acSel: 0,
    };
  }
  function ensureTermState() {
    if (FW.term) return FW.term;
    const t = defaultTermState();
    try {
      const raw = localStorage.getItem(TERM_STORE);
      if (raw) {
        const saved = JSON.parse(raw);
        ["dock","theme","remember","timeoutMin","shell","height","width","browser","headed","envName","wrap","font","timestamps","open"].forEach(function (k) {
          if (saved[k] != null) t[k] = saved[k];
        });
        if (saved.float && typeof saved.float === "object") t.float = Object.assign(t.float, saved.float);
        if (Array.isArray(saved.favs) && saved.favs.length) t.favs = saved.favs;
        if (Array.isArray(saved.hist)) t.hist = saved.hist.slice(0, 30);
      }
    } catch (e) {}
    t.shell = !!t.shell;
    if (!t.tabs || !t.tabs.length) t.tabs = [newTermTab("Run all", "all")];
    FW.term = t;
    return t;
  }
  function saveTermLayout() {
    const t = ensureTermState();
    if (!t.remember) return;
    try {
      localStorage.setItem(TERM_STORE, JSON.stringify({
        dock: t.dock, theme: t.theme, remember: t.remember, timeoutMin: t.timeoutMin,
        shell: !!t.shell, height: t.height, width: t.width, float: t.float,
        browser: t.browser, headed: t.headed, envName: t.envName,
        wrap: t.wrap, font: t.font, timestamps: t.timestamps, open: t.open,
        favs: t.favs, hist: (t.hist || []).slice(0, 30),
      }));
    } catch (e) {}
  }
  function termActive() {
    const t = ensureTermState();
    return t.tabs[t.active] || t.tabs[0];
  }
  function termTheme() {
    const t = ensureTermState();
    if (t.theme === "light") return "light";
    return "dark";
  }
  function toggleTerm(force) {
    const t = ensureTermState();
    if (typeof force === "boolean") t.open = force;
    else t.open = !t.open;
    if (t.open) t.collapsed = false;
    saveTermLayout();
    mountTerm();
  }
  function mountTerm() {
    const shell = document.querySelector(".fw-shell");
    if (!shell) return;
    ensureTermState();
    let root = $("#fwTermRoot");
    if (!root) {
      root = document.createElement("div");
      root.id = "fwTermRoot";
      shell.appendChild(root);
    }
    applyTermLayout();
    paintTerm();
  }
  function applyTermLayout() {
    const shell = document.querySelector(".fw-shell");
    const t = ensureTermState();
    if (!shell) return;
    shell.classList.toggle("fw-term-on", !!t.open);
    shell.classList.toggle("fw-term-off", !t.open);
    shell.classList.toggle("fw-term-bot", t.dock === "bottom");
    shell.classList.toggle("fw-term-right", t.dock === "right");
    shell.classList.toggle("fw-term-float", t.dock === "float");
    shell.classList.toggle("fw-term-collapsed", !!(t.open && t.collapsed));
    shell.classList.toggle("fw-term-max", !!(t.dock === "float" && t.maximized && !t.collapsed));
    shell.style.setProperty("--fw-term-h", (t.height || 322) + "px");
    shell.style.setProperty("--fw-term-w", (t.width || 420) + "px");
    const fl = t.float || {};
    shell.style.setProperty("--fw-term-x", (fl.left || 240) + "px");
    shell.style.setProperty("--fw-term-y", (fl.top || 80) + "px");
    shell.style.setProperty("--fw-term-fw", (fl.w || 640) + "px");
    shell.style.setProperty("--fw-term-fh", (fl.h || 400) + "px");
    const btn = $("#fwTermBtn");
    if (btn) btn.classList.toggle("on", !!t.open);
  }
  function istClock(d) {
    d = d || new Date();
    const utc = d.getTime() + d.getTimezoneOffset() * 60000;
    const ist = new Date(utc + 5.5 * 3600000);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(ist.getHours()) + ":" + p(ist.getMinutes()) + ":" + p(ist.getSeconds());
  }
  function istStamp(d) {
    d = d || new Date();
    const utc = d.getTime() + d.getTimezoneOffset() * 60000;
    const ist = new Date(utc + 5.5 * 3600000);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return ist.getDate() + " " + months[ist.getMonth()] + " " + ist.getFullYear() + ", " + istClock(d).slice(0, 5) + " IST";
  }
  function assignLineTimes(tab, text) {
    tab.lineTimes = tab.lineTimes || [];
    const n = String(text || "").split("\n").length;
    while (tab.lineTimes.length < n) tab.lineTimes.push(istClock());
    if (tab.lineTimes.length > n) tab.lineTimes.length = n;
  }
  function ansiToHtml(s) {
    s = String(s == null ? "" : s);
    const out = [];
    let cur = "";
    const re = /\x1b\[([0-9;]*)m/g;
    let last = 0, m;
    function flush(cls) {
      if (!cur) return;
      const body = linkifyLog(cur);
      out.push(cls ? '<span class="' + cls + '">' + body + "</span>" : body);
      cur = "";
    }
    let cls = "";
    while ((m = re.exec(s))) {
      cur += s.slice(last, m.index);
      last = re.lastIndex;
      flush(cls);
      const parts = (m[1] || "0").split(";");
      cls = "";
      parts.forEach(function (p) {
        if (p === "0" || p === "") cls = "";
        else if (p === "31" || p === "91") cls = "err";
        else if (p === "32" || p === "92") cls = "ok";
        else if (p === "33" || p === "93") cls = "run";
        else if (p === "36" || p === "96") cls = "dim";
        else if (p === "35" || p === "95") cls = "warn";
      });
    }
    cur += s.slice(last);
    flush(cls);
    return out.join("");
  }
  function linkifyLog(s) {
    const re = /([A-Za-z0-9_./\\-]+\.(?:py|robot|js|ts|java|cs)):(\d+)/g;
    let last = 0, m, html = "";
    while ((m = re.exec(s))) {
      html += esc(s.slice(last, m.index));
      html += '<a class="fw-term-link" href="#" data-tpath="' + esc(m[1].replace(/\\/g, "/")) + '" data-tline="' + esc(m[2]) + '">' + esc(m[0]) + "</a>";
      last = re.lastIndex;
    }
    html += esc(s.slice(last));
    return html;
  }
  function colorizeLine(line) {
    const raw = String(line || "");
    if (/\x1b\[/.test(raw)) return ansiToHtml(raw);
    const t = raw;
    let cls = "";
    if (/\bFAILED\b|\bERROR\b|AssertionError|E\s{2,}/.test(t)) cls = "err";
    else if (/\bPASSED\b|\bpassed\b/.test(t) && !/\bfailed\b/i.test(t)) cls = "ok";
    else if (/\bRUNNING\b|\bQUEUED\b/.test(t)) cls = "run";
    else if (/\bWARNING\b|\bwarn\b/i.test(t)) cls = "warn";
    else if (/^=======|^collected |^platform |^BASE_URL/.test(t)) cls = "dim";
    const body = linkifyLog(t);
    return cls ? '<span class="' + cls + '">' + body + "</span>" : body;
  }
  function filterLogLine(line, filter) {
    if (!filter || filter === "all") return true;
    const t = String(line || "");
    if (filter === "failures") return /\bFAILED\b|AssertionError/.test(t);
    if (filter === "errors") return /\bERROR\b|\bError\b/.test(t);
    if (filter === "warnings") return /\bWARNING\b|\bwarn\b/i.test(t);
    return true;
  }
  function renderTermLog(tab, t) {
    t = t || ensureTermState();
    tab = tab || termActive();
    const raw = String((tab && tab.log) || "");
    assignLineTimes(tab, raw);
    const lines = raw.split("\n");
    const q = (t.findOpen && t.findQ) ? String(t.findQ) : "";
    let marks = 0;
    const html = lines.map(function (line, i) {
      if (!filterLogLine(line, t.filter)) return "";
      let inner = colorizeLine(line);
      if (q) {
        const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(safe, "gi");
        inner = inner.replace(re, function (h) {
          if (h.indexOf("<") >= 0) return h;
          marks += 1;
          return "<mark>" + h + "</mark>";
        });
      }
      const ts = t.timestamps ? '<span class="fw-term-ts">' + esc((tab.lineTimes && tab.lineTimes[i]) || "") + "</span>" : "";
      return ts + inner;
    }).filter(Boolean).join("\n");
    tab._findCount = marks;
    return html || '<span class="dim">Ready.</span>';
  }
  function paintTerm() {
    const root = $("#fwTermRoot");
    const t = ensureTermState();
    if (!root) return;
    if (!t.open) { root.innerHTML = ""; return; }
    if (t.collapsed) {
      root.innerHTML = termStatusBarHtml();
      bindTermChrome(root);
      return;
    }
    const tab = termActive();
    const showSplit = (t.split || t.dock === "right") && t.tabs.length > 1;
    const theme = termTheme();
    root.innerHTML = '<div class="fw-term' + (t.dock === "right" ? " fw-term-right-inner" : "") + '" data-theme="' + theme + '">'
      + (t.dock === "float" ? termTitleHtml(tab) : "")
      + (t.dock !== "right" ? '<div class="fw-term-grip" id="fwTermGrip" title="Drag to resize"><i></i></div>' : '<div class="fw-term-grip" id="fwTermGrip" title="Drag to resize"><i></i></div>')
      + termTabsHtml()
      + termQuickActsHtml()
      + termToolsHtml()
      + termFavsHtml()
      + '<div class="fw-term-body"><div class="fw-term-mid">'
      + (showSplit ? termSplitHtml() : ('<div class="fw-term-log' + (t.wrap ? " wrap" : "") + '" id="fwTermLog" style="font-size:' + (t.font || 12) + 'px">' + renderTermLog(tab, t) + "</div>"))
      + (t.histOpen ? termHistHtml() : "")
      + "</div>"
      + termCmdHtml()
      + (t.acOpen ? termAcHtml() : "")
      + (t.settingsOpen ? termSettingsHtml() : "")
      + "</div></div>";
    bindTermChrome(root);
    scrollTermLog();
  }
  function termWinBtns(opts) {
    const t = ensureTermState();
    const maxed = !!t.maximized && t.dock === "float";
    const maxLab = maxed ? "Restore" : "Maximize";
    const maxIcon = maxed ? "❐" : "□";
    return '<span class="fw-term-win">'
      + '<button type="button" class="fw-term-ctrl" data-tact="min" title="Minimize the terminal to a status bar">– Minimize</button>'
      + '<button type="button" class="fw-term-ctrl" data-tact="max" title="' + maxLab + ' the terminal">' + maxIcon + " " + maxLab + "</button>"
      + '<button type="button" class="fw-term-ctrl" data-tact="close" title="Close the terminal">✕ Close</button>'
      + ((opts && opts.gear) ? '<button type="button" class="fw-term-gear" data-tact="settings" title="Terminal settings">⚙</button>' : "")
      + "</span>";
  }
  function termTitleHtml(tab) {
    const t = ensureTermState();
    const live = tab && tab.status === "running";
    return '<div class="fw-term-title" id="fwTermTitle"><span class="ttl">' + (live ? '<span class="dot"></span>' : "") + " Terminal · " + esc((tab && tab.title) || "Run") + "</span>"
      + '<span class="meta">' + esc((tab && tab.runId) || "") + (t.envName ? " · " + esc(t.envName) : "") + (t.browser ? " · " + esc(t.browser) : "") + "</span>"
      + termWinBtns() + "</div>";
  }
  function termTabsHtml() {
    const t = ensureTermState();
    return '<div class="fw-term-tabs">' + t.tabs.map(function (tab, i) {
      return '<button type="button" class="tab' + (i === t.active ? " on" : "") + '" data-tabi="' + i + '">'
        + (tab.status === "running" ? '<span class="dot"></span>' : "") + esc(tab.title) + "</button>";
    }).join("") + '<button type="button" class="plus" data-tact="newtab" title="New terminal">＋</button><span class="sp"></span>'
      + '<button type="button" class="plus" data-tact="split" title="Split view">' + (t.split ? "Unsplit" : "Split") + "</button>"
      + (t.dock === "float" ? '<span class="fw-term-win"><button type="button" class="fw-term-gear" data-tact="settings" title="Terminal settings">⚙</button></span>' : termWinBtns({ gear: true }))
      + "</div>";
  }
  function termQuickActsHtml() {
    const t = ensureTermState();
    return '<div class="fw-term-acts">'
      + '<button type="button" class="btn on" data-tact="runall">Run all</button>'
      + '<button type="button" class="btn" data-tact="runfile">Run file</button>'
      + '<button type="button" class="btn" data-tact="runtc">Run TC</button>'
      + '<button type="button" class="btn" data-tact="rerun">Rerun failed</button>'
      + '<button type="button" class="btn" data-tact="runtags">Run with tags</button>'
      + '<select class="fw-term-pick" id="fwTermBrowser">'
      + '<option value="chromium"' + (t.browser === "chromium" ? " selected" : "") + '>Chromium</option>'
      + '<option value="firefox"' + (t.browser === "firefox" ? " selected" : "") + '>Firefox</option>'
      + '<option value="webkit"' + (t.browser === "webkit" ? " selected" : "") + '>WebKit</option></select>'
      + '<select class="fw-term-pick" id="fwTermHeaded">'
      + '<option value="0"' + (!t.headed ? " selected" : "") + '>Headless</option>'
      + '<option value="1"' + (t.headed ? " selected" : "") + '>Headed</option></select>'
      + '<select class="fw-term-pick" id="fwTermEnv">'
      + '<option value="staging"' + (t.envName === "staging" ? " selected" : "") + '>staging</option>'
      + '<option value="qa"' + (t.envName === "qa" ? " selected" : "") + '>qa</option>'
      + '<option value="prod"' + (t.envName === "prod" ? " selected" : "") + '>prod</option></select>'
      + "</div>";
  }
  function termToolsHtml() {
    const t = ensureTermState();
    const tab = termActive();
    const n = tab && tab._findCount != null ? tab._findCount : 0;
    return '<div class="fw-term-tools">'
      + (t.findOpen ? '<div class="fw-term-find"><b>Ctrl+F</b><input id="fwTermFind" value="' + esc(t.findQ || "") + '" placeholder="Search output"><span class="n">' + (n ? (Math.min(t.findIdx + 1, n) + " / " + n) : "0 / 0") + "</span></div>" : '<button type="button" class="btn" data-tact="find">Ctrl+F</button>')
      + '<span class="fw-term-seg">'
      + '<button type="button" class="' + (t.filter === "all" ? "on" : "") + '" data-tfilter="all">All</button>'
      + '<button type="button" class="' + (t.filter === "failures" ? "on" : "") + '" data-tfilter="failures">Failures</button>'
      + '<button type="button" class="' + (t.filter === "errors" ? "on" : "") + '" data-tfilter="errors">Errors</button>'
      + '<button type="button" class="' + (t.filter === "warnings" ? "on" : "") + '" data-tfilter="warnings">Warnings</button></span>'
      + '<button type="button" class="btn' + (t.wrap ? " on" : "") + '" data-tact="wrap">Wrap</button>'
      + '<span class="fw-term-fs"><b data-tact="font-">−</b> ' + (t.font || 12) + ' <b data-tact="font+">+</b></span>'
      + '<button type="button" class="btn' + (t.timestamps ? " on" : "") + '" data-tact="ts">Timestamps</button>'
      + '<button type="button" class="btn" data-tact="copy">Copy log</button>'
      + '<button type="button" class="btn" data-tact="download">Download</button>'
      + '<button type="button" class="btn' + (t.histOpen ? " on" : "") + '" data-tact="hist" title="Show or hide command history">History</button>'
      + '<span style="flex:1"></span>'
      + '<button type="button" class="btn r" data-tact="stop">■ Stop <kbd style="margin-left:4px;border-color:#ffb4b0;color:#fff">Ctrl+C</kbd></button>'
      + "</div>";
  }
  function termFavsHtml() {
    const t = ensureTermState();
    return '<div class="fw-term-favs"><span class="lab">Favorites</span>'
      + (t.favs || []).map(function (f, i) {
        return '<button type="button" class="fw-term-chip" data-tfav="' + i + '">' + esc(f.name) + "</button>";
      }).join("") + "</div>";
  }
  function termSplitHtml() {
    const t = ensureTermState();
    const a = t.tabs[t.active] || t.tabs[0];
    const b = t.tabs[t.active + 1] || t.tabs[t.active === 0 ? 1 : 0];
    return '<div class="fw-term-split">'
      + '<div class="fw-term-pane"><div class="fw-term-title" style="cursor:default"><span class="ttl">' + (a.status === "running" ? '<span class="dot"></span>' : "") + esc(a.title) + '</span><span class="meta">' + esc(a.runId || a.status) + "</span></div>"
      + '<div class="fw-term-log' + (t.wrap ? " wrap" : "") + '" id="fwTermLog" style="font-size:' + (t.font || 12) + 'px">' + renderTermLog(a, t) + "</div></div>"
      + '<div class="fw-term-pane"><div class="fw-term-title" style="cursor:default"><span class="ttl">' + (b.status === "running" ? '<span class="dot"></span>' : "") + esc(b.title) + '</span><span class="meta">' + esc(b.runId || b.status) + "</span></div>"
      + '<div class="fw-term-log' + (t.wrap ? " wrap" : "") + '" id="fwTermLog2" style="font-size:' + (t.font || 12) + 'px">' + renderTermLog(b, t) + "</div></div>"
      + "</div>";
  }
  function termHistHtml() {
    const t = ensureTermState();
    return '<aside class="fw-term-hist open"><div class="cap">History</div>'
      + ((t.hist || []).slice(0, 12).map(function (h, i) {
        return '<div class="row' + (i === 0 ? " on" : "") + '" data-thist="' + i + '">' + esc(h.cmd) + '<span class="when">' + esc(h.when || "") + "</span></div>";
      }).join("") || '<div class="row">No commands yet.</div>')
      + "</aside>";
  }
  function termCmdHtml() {
    const t = ensureTermState();
    return '<div class="fw-term-cmd"><span class="pr">❯</span><input id="fwTermCmd" spellcheck="false" autocomplete="off" value="' + esc(t.cmdDraft || "") + '" placeholder="pytest tests/web -m ui"><kbd>↑</kbd> history</div>';
  }
  function termAcHtml() {
    const t = ensureTermState();
    return '<div class="fw-term-ac" id="fwTermAc">' + (t.acItems || []).map(function (it, i) {
      return '<div class="row' + (i === t.acSel ? " on" : "") + '" data-tac="' + i + '"><span>' + esc(it.value) + '</span><span class="kind">' + esc(it.kind) + "</span></div>";
    }).join("") + "</div>";
  }
  function termSettingsHtml() {
    const t = ensureTermState();
    return '<div class="fw-term-pop" id="fwTermPop"><h3>Terminal settings</h3>'
      + '<div class="fr"><span class="lab">Dock position</span><div class="picks">'
      + '<button type="button" class="' + (t.dock === "bottom" ? "on" : "") + '" data-tdock="bottom">Bottom</button>'
      + '<button type="button" class="' + (t.dock === "right" ? "on" : "") + '" data-tdock="right">Right</button>'
      + '<button type="button" class="' + (t.dock === "float" ? "on" : "") + '" data-tdock="float">Float</button></div></div>'
      + '<div class="fr"><span class="lab">Theme</span><div class="picks">'
      + '<button type="button" class="' + (t.theme === "dark" ? "on" : "") + '" data-ttheme="dark">Dark</button>'
      + '<button type="button" class="' + (t.theme === "light" ? "on" : "") + '" data-ttheme="light">Light</button>'
      + '<button type="button" class="' + (t.theme === "follow" ? "on" : "") + '" data-ttheme="follow">Follow app</button></div></div>'
      + '<div class="fr"><label class="sw">Remember layout <button type="button" class="fw-tog' + (t.remember ? " on" : "") + '" data-tact="remember" aria-pressed="' + (t.remember ? "true" : "false") + '"><i></i></button></label></div>'
      + '<div class="fr"><span class="lab">Timeout (minutes)</span><input type="number" min="1" max="1440" id="fwTermTimeout" value="' + esc(t.timeoutMin || 30) + '"></div>'
      + '<div class="fr"><label class="sw">Interactive shell mode (advanced) <button type="button" class="fw-tog' + (t.shell ? " on" : "") + '" data-tact="shell" aria-pressed="' + (t.shell ? "true" : "false") + '"><i></i></button></label>'
      + '<div class="fw-term-warn"><b>Off by default.</b> Turning this on relaxes the command allowlist so you can type shell commands. Commands still run through exec (no shell). It can change files on the runner — leave it off unless you trust this environment.</div></div></div>';
  }
  function termStatusBarHtml() {
    const tab = termActive();
    const t = ensureTermState();
    const live = tab && tab.status === "running";
    const sum = (tab && tab.summary) || {};
    const done = sum.passed != null ? ((sum.passed || 0) + (sum.failed || 0) + (sum.skipped || 0)) : "";
    const label = live
      ? ("Running" + (tab.runId ? " · " + tab.runId : "") + (tab.startedAt ? " · " + elapsedTerm(tab.startedAt) : ""))
      : ((tab && tab.status && tab.status !== "idle") ? (tab.status + (done !== "" ? " · " + (sum.passed || 0) + " passed / " + (sum.failed || 0) + " failed" : "")) : "Terminal idle");
    return '<div class="fw-term-statbar"><span class="dot" style="' + (live ? "" : "background:#8b949e;box-shadow:none") + '"></span>'
      + '<span class="run">' + esc(label) + "</span>"
      + '<span class="meta">' + esc((tab && tab.runId) || "") + (t.envName ? " · " + esc(t.envName) : "") + (t.browser ? " · " + esc(t.browser) + (t.headed ? " headed" : " headless") : "") + "</span>"
      + '<button type="button" class="btn" data-tact="restore" title="Restore the terminal">Restore</button>'
      + '<button type="button" class="btn" data-tact="close" title="Close the terminal">✕ Close</button>'
      + (live ? '<button type="button" class="btn" data-tact="stop">■ Stop</button>' : "") + "</div>";
  }
  function elapsedTerm(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
  }
  function scrollTermLog() {
    const el = $("#fwTermLog");
    if (el) el.scrollTop = el.scrollHeight;
  }
  function updateTermLog() {
    const t = ensureTermState();
    const el = $("#fwTermLog");
    if (el) { el.innerHTML = renderTermLog(termActive(), t); scrollTermLog(); }
    const el2 = $("#fwTermLog2");
    if (el2 && t.tabs.length > 1) {
      const b = t.tabs[t.active + 1] || t.tabs[t.active === 0 ? 1 : 0];
      el2.innerHTML = renderTermLog(b, t);
    }
    const n = $("#fwTermRoot .fw-term-find .n");
    if (n && termActive()) {
      const c = termActive()._findCount || 0;
      n.textContent = c ? (Math.min(t.findIdx + 1, c) + " / " + c) : "0 / 0";
    }
  }
  function bindTermChrome(root) {
    if (!root) return;
    root.querySelectorAll("[data-tact]").forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); termAction(b.getAttribute("data-tact")); };
    });
    root.querySelectorAll("[data-tabi]").forEach(function (b) {
      b.onclick = function () { ensureTermState().active = +b.getAttribute("data-tabi"); paintTerm(); };
    });
    root.querySelectorAll("[data-tfilter]").forEach(function (b) {
      b.onclick = function () { ensureTermState().filter = b.getAttribute("data-tfilter"); paintTerm(); };
    });
    root.querySelectorAll("[data-tfav]").forEach(function (b) {
      b.onclick = function () {
        const t = ensureTermState();
        const f = t.favs[+b.getAttribute("data-tfav")];
        if (f) { t.cmdDraft = f.cmd; startTermCommand(f.cmd, f.name); }
      };
    });
    root.querySelectorAll("[data-thist]").forEach(function (b) {
      b.onclick = function () {
        const t = ensureTermState();
        const h = t.hist[+b.getAttribute("data-thist")];
        if (h) { t.cmdDraft = h.cmd; paintTerm(); const inp = $("#fwTermCmd"); if (inp) inp.focus(); }
      };
    });
    root.querySelectorAll("[data-tac]").forEach(function (b) {
      b.onclick = function () { acceptTermAc(+b.getAttribute("data-tac")); };
    });
    root.querySelectorAll("[data-tdock]").forEach(function (b) {
      b.onclick = function () { const t = ensureTermState(); t.dock = b.getAttribute("data-tdock"); t.collapsed = false; saveTermLayout(); mountTerm(); };
    });
    root.querySelectorAll("[data-ttheme]").forEach(function (b) {
      b.onclick = function () { ensureTermState().theme = b.getAttribute("data-ttheme"); saveTermLayout(); paintTerm(); };
    });
    root.querySelectorAll(".fw-term-link").forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        openTermLink(a.getAttribute("data-tpath"), a.getAttribute("data-tline"));
      };
    });
    const br = $("#fwTermBrowser", root); if (br) br.onchange = function () { ensureTermState().browser = br.value; saveTermLayout(); };
    const hd = $("#fwTermHeaded", root); if (hd) hd.onchange = function () { ensureTermState().headed = hd.value === "1"; saveTermLayout(); };
    const ev = $("#fwTermEnv", root); if (ev) ev.onchange = function () { ensureTermState().envName = ev.value; saveTermLayout(); };
    const to = $("#fwTermTimeout", root); if (to) to.onchange = function () { ensureTermState().timeoutMin = Math.max(1, parseInt(to.value, 10) || 30); saveTermLayout(); };
    const find = $("#fwTermFind", root);
    if (find) {
      find.oninput = function () { ensureTermState().findQ = find.value; updateTermLog(); };
      find.onkeydown = function (e) { if (e.key === "Escape") { ensureTermState().findOpen = false; paintTerm(); } e.stopPropagation(); };
      setTimeout(function () { find.focus(); find.select(); }, 0);
    }
    const cmd = $("#fwTermCmd", root);
    if (cmd) {
      cmd.oninput = function () { ensureTermState().cmdDraft = cmd.value; maybeTermAc(cmd.value); };
      cmd.onkeydown = function (e) { onTermCmdKey(e, cmd); };
      cmd.onfocus = function () { ensureTermState().histIdx = -1; };
    }
    bindTermResize();
    bindTermDrag();
  }
  function termAction(act) {
    const t = ensureTermState();
    if (act === "newtab") { t.tabs.push(newTermTab("Terminal " + (t.tabs.length + 1), "cmd")); t.active = t.tabs.length - 1; paintTerm(); return; }
    if (act === "split") { t.split = !t.split; paintTerm(); return; }
    if (act === "settings") { t.settingsOpen = !t.settingsOpen; paintTerm(); return; }
    if (act === "min") { t.collapsed = true; t.maximized = false; mountTerm(); return; }
    if (act === "max") { t.maximized = !t.maximized; t.collapsed = false; if (t.dock !== "float") t.dock = "float"; mountTerm(); return; }
    if (act === "close") { toggleTerm(false); return; }
    if (act === "restore") { t.collapsed = false; t.open = true; mountTerm(); return; }
    if (act === "hist") { t.histOpen = !t.histOpen; paintTerm(); return; }
    if (act === "find") { t.findOpen = true; paintTerm(); return; }
    if (act === "wrap") { t.wrap = !t.wrap; saveTermLayout(); paintTerm(); return; }
    if (act === "ts") { t.timestamps = !t.timestamps; saveTermLayout(); paintTerm(); return; }
    if (act === "font+") { t.font = Math.min(20, (t.font || 12) + 1); saveTermLayout(); paintTerm(); return; }
    if (act === "font-") { t.font = Math.max(10, (t.font || 12) - 1); saveTermLayout(); paintTerm(); return; }
    if (act === "remember") { t.remember = !t.remember; saveTermLayout(); paintTerm(); return; }
    if (act === "shell") { t.shell = !t.shell; saveTermLayout(); paintTerm(); return; }
    if (act === "copy") { copyTermLog(); return; }
    if (act === "download") { downloadTermLog(); return; }
    if (act === "stop") { stopTermRun(); return; }
    if (act === "runall") { startTermCommand(buildQuickCommand("all"), "Run all"); return; }
    if (act === "runfile") { startTermCommand(buildQuickCommand("file"), "Run file"); return; }
    if (act === "runtc") { startTermCommand(buildQuickCommand("tc"), "Run TC"); return; }
    if (act === "rerun") { startTermCommand(buildQuickCommand("lf"), "Rerun failed"); return; }
    if (act === "runtags") { startTermCommand(buildQuickCommand("tags"), "Run with tags"); return; }
  }
  function termExtraArgs() {
    const t = ensureTermState();
    const parts = [];
    if (t.headed) parts.push("--headed");
    if (t.browser) parts.push("--browser", t.browser);
    return parts;
  }
  function buildQuickCommand(kind) {
    const extra = termExtraArgs();
    if (kind === "all") return ["pytest", "-v", "tests"].concat(extra).join(" ");
    if (kind === "file") {
      const path = FW.path || "";
      if (path && /\.(py|robot|js|ts)$/.test(path)) return ["pytest", "-v", path].concat(extra).join(" ");
      toast("Open a test file first, or type a path in the command box.");
      return "";
    }
    if (kind === "tc") {
      const used = (FW.file && FW.file.used_by) || [];
      const tc = FW.fromTc || (used[0] && (used[0].id || used[0].tc_id || used[0])) || "";
      const id = typeof tc === "string" ? tc : (tc.id || "");
      if (!id) { toast("No test case is selected. Open a linked test or type -k TC-xxxx."); return ""; }
      const tab = termActive();
      if (tab) tab.title = id;
      return ["pytest", "-v", "-k", id].concat(extra).join(" ");
    }
    if (kind === "lf") return ["pytest", "--lf"].concat(extra).join(" ");
    if (kind === "tags") {
      const t = ensureTermState();
      if (!/-m\s/.test(t.cmdDraft || "")) {
        t.cmdDraft = "pytest -m ui";
        paintTerm();
        const inp = $("#fwTermCmd"); if (inp) { inp.focus(); inp.setSelectionRange(10, inp.value.length); }
        toast("Add a -m marker (for example ui) and press Enter, or pick a favorite.");
        return "";
      }
      return t.cmdDraft;
    }
    return "pytest -v tests";
  }
  async function startTermCommand(cmd, title) {
    cmd = String(cmd || "").trim();
    if (!cmd) return;
    const t = ensureTermState();
    if (!t.open) { t.open = true; t.collapsed = false; }
    let tab = termActive();
    if (!tab) { t.tabs = [newTermTab(title || "Run", "cmd")]; t.active = 0; tab = t.tabs[0]; }
    if (title) tab.title = title;
    tab.cmd = cmd;
    tab.log = "";
    tab.lineTimes = [];
    tab.status = "running";
    tab.exitCode = null;
    tab.summary = null;
    tab.startedAt = Date.now();
    t.cmdDraft = cmd;
    t.hist = [{ cmd: cmd, when: istStamp() }].concat((t.hist || []).filter(function (h) { return h.cmd !== cmd; })).slice(0, 30);
    t.histIdx = -1;
    saveTermLayout();
    mountTerm();
    try {
      await ensureFramework();
      const body = {
        framework_id: FW.fid,
        command: cmd,
        env: {},
        env_name: t.envName || "",
        headless: !t.headed,
        browser: t.browser || "chromium",
        timeout: Math.max(5, (t.timeoutMin || 30) * 60),
        shell: !!t.shell,
        stream: true,
        scope: { source: "terminal", env_name: t.envName || "" },
      };
      const r = await fwApi("/runs", { method: "POST", body: body });
      tab.runId = r.run && r.run.id;
      tab.log = "Started " + (tab.runId || "") + "  " + ((r.run && r.run.command) || cmd) + "\n";
      assignLineTimes(tab, tab.log);
      updateTermLog();
      FW.run = r.run;
      streamTermRun(tab);
    } catch (e) {
      tab.status = "failed";
      tab.log = (tab.log || "") + (e.message || String(e)) + "\n";
      updateTermLog();
      paintTerm();
      toast(e.message || String(e));
    }
  }
  function closeTermStream(tab) {
    if (!tab) return;
    if (tab._es) { try { tab._es.close(); } catch (e1) {} tab._es = null; }
    if (tab._ws) { try { tab._ws.close(); } catch (e2) {} tab._ws = null; }
    if (tab._poll) { clearInterval(tab._poll); tab._poll = 0; }
  }
  function applyTermEvent(tab, j) {
    if (!tab || !j) return;
    if (j.log != null) { tab.log = j.log; assignLineTimes(tab, tab.log); }
    if (j.status) tab.status = j.running ? "running" : j.status;
    if (j.summary) tab.summary = j.summary;
    if (j.exit_code != null) tab.exitCode = j.exit_code;
    if (!j.running && j.status && j.status !== "running") {
      tab.status = j.status;
      closeTermStream(tab);
    }
    updateTermLog();
    const stat = $("#fwTermRoot .fw-term-statbar .run") || $("#fwTermRoot .fw-term-tabs .tab.on");
    if (ensureTermState().collapsed) paintTerm();
  }
  function streamTermRun(tab) {
    closeTermStream(tab);
    const id = tab.runId;
    if (!id) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    let usedWs = false;
    try {
      const ws = new WebSocket(proto + "//" + location.host + "/api/automation/runs/" + encodeURIComponent(id) + "/ws");
      tab._ws = ws;
      ws.onopen = function () { usedWs = true; };
      ws.onmessage = function (ev) {
        try { applyTermEvent(tab, JSON.parse(ev.data)); } catch (e) {}
      };
      ws.onerror = function () {
        if (!usedWs) { try { ws.close(); } catch (e1) {} tab._ws = null; startTermSse(tab); }
      };
      ws.onclose = function () {
        if (!usedWs && tab.status === "running") startTermSse(tab);
      };
    } catch (e) {
      startTermSse(tab);
    }
  }
  function startTermSse(tab) {
    const id = tab.runId;
    if (!id) return;
    if (typeof EventSource === "function") {
      try {
        const es = new EventSource("/api/automation/runs/" + encodeURIComponent(id) + "/events");
        tab._es = es;
        es.onmessage = function (ev) {
          try { applyTermEvent(tab, JSON.parse(ev.data)); } catch (e) {}
        };
        es.onerror = function () { es.close(); tab._es = null; startTermPoll(tab); };
        return;
      } catch (e) {}
    }
    startTermPoll(tab);
  }
  function startTermPoll(tab) {
    if (tab._poll) clearInterval(tab._poll);
    tab._poll = setInterval(async function () {
      if (!tab.runId) return;
      try {
        const j = await fwApi("/runs/" + encodeURIComponent(tab.runId));
        applyTermEvent(tab, { log: j.run && j.run.log, status: j.run && j.run.status, summary: j.run && j.run.summary, exit_code: j.run && j.run.exit_code, running: j.run && j.run.status === "running" });
        if (j.run && j.run.status && j.run.status !== "running") closeTermStream(tab);
      } catch (e) { closeTermStream(tab); }
    }, 1000);
  }
  async function stopTermRun() {
    const tab = termActive();
    if (!tab || !tab.runId) return;
    try {
      await fwApi("/runs/" + encodeURIComponent(tab.runId) + "/stop", { method: "POST", body: {} });
      tab.status = "stopped";
      tab.log = (tab.log || "") + "\n[stopped]\n";
      updateTermLog();
    } catch (e) { toast(e.message || String(e)); }
  }
  function copyTermLog() {
    const tab = termActive();
    const text = (tab && tab.log) || "";
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Log copied"); }).catch(function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Log copied"); } catch (e) { toast("Could not copy"); }
    ta.remove();
  }
  function downloadTermLog() {
    const tab = termActive();
    const text = (tab && tab.log) || "";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (tab && tab.runId ? tab.runId : "terminal") + ".log";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  async function openTermLink(path, line) {
    path = String(path || "").replace(/\\/g, "/");
    if (path.startsWith("./")) path = path.slice(2);
    const tree = FW.tree || [];
    let hit = tree.find(function (r) { return r.path === path; });
    if (!hit) hit = tree.find(function (r) { return (r.path || "").endsWith("/" + path) || r.path === path || (r.path || "").endsWith(path); });
    const dest = hit ? hit.path : path;
    FW.revealLine = parseInt(line, 10) || 1;
    try { await openFile(dest); } catch (e) { toast("Could not open " + dest); }
  }
  function onTermCmdKey(e, cmd) {
    const t = ensureTermState();
    if (t.acOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = (t.acItems || []).length;
      if (!n) return;
      t.acSel = (t.acSel + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      paintTerm();
      const inp = $("#fwTermCmd"); if (inp) { inp.focus(); inp.value = t.cmdDraft; }
      return;
    }
    if (t.acOpen && (e.key === "Enter" || e.key === "Tab") && t.acItems && t.acItems[t.acSel]) {
      e.preventDefault();
      acceptTermAc(t.acSel);
      return;
    }
    if (e.key === "Escape") {
      if (t.acOpen) { t.acOpen = false; paintTerm(); e.preventDefault(); return; }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      t.acOpen = false;
      startTermCommand(cmd.value);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!t.hist || !t.hist.length) return;
      e.preventDefault();
      if (t.histIdx < 0) t._draftBak = cmd.value;
      if (e.key === "ArrowUp") t.histIdx = Math.min((t.histIdx < 0 ? 0 : t.histIdx + 1), t.hist.length - 1);
      else t.histIdx = t.histIdx <= 0 ? -1 : t.histIdx - 1;
      t.cmdDraft = t.histIdx < 0 ? (t._draftBak || "") : t.hist[t.histIdx].cmd;
      cmd.value = t.cmdDraft;
      return;
    }
  }
  function acceptTermAc(i) {
    const t = ensureTermState();
    const item = (t.acItems || [])[i];
    if (!item) return;
    const cur = t.cmdDraft || "";
    const parts = cur.split(/\s+/);
    if (parts.length && !cur.endsWith(" ")) parts.pop();
    const next = (parts.join(" ") + " " + item.value).trim();
    t.cmdDraft = next + (item.kind === "flag" && item.value === "-m" ? " " : " ");
    t.acOpen = false;
    paintTerm();
    const inp = $("#fwTermCmd"); if (inp) { inp.focus(); inp.value = t.cmdDraft; inp.selectionStart = inp.selectionEnd = inp.value.length; }
  }
  async function maybeTermAc(q) {
    const t = ensureTermState();
    const token = String(q || "").split(/\s+/).pop() || "";
    if (!token) { t.acOpen = false; const ac = $("#fwTermAc"); if (ac) ac.remove(); return; }
    let items = [];
    TERM_FLAGS.forEach(function (f) { if (f.indexOf(token) === 0 || f.indexOf(token) >= 0) items.push({ value: f, kind: "flag" }); });
    try {
      if (FW.fid) {
        const j = await fwApi("/term/suggest?framework_id=" + encodeURIComponent(FW.fid) + "&q=" + encodeURIComponent(token));
        (j.flags || []).forEach(function (f) { if (!items.some(function (x) { return x.value === f; })) items.push({ value: f, kind: "flag" }); });
        (j.markers || []).forEach(function (m) { items.push({ value: "-m " + m, kind: "marker" }); });
        (j.paths || []).forEach(function (p) { items.push({ value: p, kind: "path" }); });
      }
    } catch (e) {}
    items = items.filter(function (it, i, arr) { return arr.findIndex(function (x) { return x.value === it.value; }) === i; }).slice(0, 12);
    t.acItems = items;
    t.acSel = 0;
    t.acOpen = items.length > 0;
    const cmdVal = t.cmdDraft;
    const had = document.activeElement && document.activeElement.id === "fwTermCmd";
    paintTerm();
    const inp = $("#fwTermCmd");
    if (inp && had) { inp.focus(); inp.value = cmdVal; inp.selectionStart = inp.selectionEnd = inp.value.length; }
  }
  function bindTermResize() {
    const grip = $("#fwTermGrip");
    if (!grip || grip._bound) return;
    grip._bound = true;
    grip.addEventListener("mousedown", function (e) {
      e.preventDefault();
      const t = ensureTermState();
      const startY = e.clientY, startX = e.clientX, h0 = t.height, w0 = t.width, fl = Object.assign({}, t.float);
      function move(ev) {
        if (t.dock === "bottom") {
          t.height = Math.max(140, Math.min(window.innerHeight * 0.7, h0 - (ev.clientY - startY)));
        } else if (t.dock === "right") {
          t.width = Math.max(240, Math.min(window.innerWidth * 0.6, w0 - (ev.clientX - startX)));
        } else if (t.dock === "float") {
          t.float.h = Math.max(180, fl.h + (ev.clientY - startY));
        }
        applyTermLayout();
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        saveTermLayout();
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }
  function bindTermDrag() {
    const title = $("#fwTermTitle");
    const t = ensureTermState();
    if (!title || t.dock !== "float" || t.maximized || title._bound) return;
    title._bound = true;
    title.addEventListener("mousedown", function (e) {
      if (e.target && e.target.closest && e.target.closest("[data-tact]")) return;
      e.preventDefault();
      const fl = Object.assign({}, t.float);
      const sx = e.clientX, sy = e.clientY;
      function move(ev) {
        t.float.left = Math.max(8, fl.left + (ev.clientX - sx));
        t.float.top = Math.max(8, fl.top + (ev.clientY - sy));
        applyTermLayout();
      }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        saveTermLayout();
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }
  function onTermGlobalKey(e) {
    if (!$(".fw-shell")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "`") { e.preventDefault(); toggleTerm(); return; }
    const inTerm = e.target && e.target.closest && e.target.closest("#fwTermRoot");
    if (!inTerm || !ensureTermState().open) return;
    if (mod && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      ensureTermState().findOpen = true;
      paintTerm();
      return;
    }
    if (mod && (e.key === "c" || e.key === "C")) {
      const sel = window.getSelection && String(window.getSelection());
      if (sel) return;
      const tab = termActive();
      if (tab && tab.status === "running") { e.preventDefault(); stopTermRun(); }
    }
  }


})();
