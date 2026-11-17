/* Automation Scripts — generate modal, library, editor, Settings tab (additive). */
"use strict";
(function () {
  const ST = {
    cat: null, prefs: null, gen: null, result: null,
    lib: { folders: [], scripts: [], folder: "", q: "", language: "", type: "", sel: new Set() },
    ed: null, set: { tab: "languages", local: null, prefs: null, orig: "" },
    counts: {}, recs: [],
  };
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  async function loadOptions(force) {
    if (ST.cat && !force) return ST.cat;
    const j = await api("/api/automation/options");
    ST.cat = j;
    ST.prefs = j.prefs || {};
    return j;
  }
  function langById(id) { return ((ST.cat && ST.cat.languages) || []).find((x) => x.id === id || x.name === id) || null; }
  function typeById(id) { return ((ST.cat && ST.cat.types) || []).find((x) => x.id === id || x.name === id) || null; }
  function fwById(id) { return ((ST.cat && ST.cat.frameworks) || []).find((x) => x.id === id || x.name === id) || null; }
  function enabled(list) { return (list || []).filter((x) => x && x.enabled !== false); }
  function fwCompatible(fw, lang, types) {
    if (!fw) return false;
    const langs = fw.languages || [];
    const tps = fw.types || [];
    if (lang && langs.length && langs.indexOf(lang) < 0) return false;
    if (types && types.length && tps.length && !types.some((t) => tps.indexOf(t) >= 0)) return false;
    return true;
  }
  function fwHint(fw, lang, types) {
    if (!fw) return "";
    const bits = [];
    const langs = fw.languages || [];
    const tps = fw.types || [];
    if (lang && langs.length && langs.indexOf(lang) < 0) {
      bits.push("Compatible with " + langs.map((id) => (langById(id) || {}).name || id).join(", "));
    }
    if (types && types.length && tps.length && !types.some((t) => tps.indexOf(t) >= 0)) {
      bits.push("For " + tps.map((id) => (typeById(id) || {}).name || id).join(", "));
    }
    return bits.join(" · ");
  }
  function defaultGenState(cases) {
    const p = ST.prefs || {};
    const langs = enabled(ST.cat.languages);
    let language = p.default_language || (langs[0] && langs[0].id) || "";
    if (!langById(language) || (langById(language).enabled === false)) language = (langs[0] && langs[0].id) || "";
    let types = (p.default_types || []).filter((t) => typeById(t) && typeById(t).enabled !== false);
    if (!types.length) { const t0 = enabled(ST.cat.types)[0]; types = t0 ? [t0.id] : []; }
    let frameworks = (p.default_frameworks || []).filter((f) => {
      const fw = fwById(f); return fw && fw.enabled !== false && fwCompatible(fw, language, types);
    });
    return {
      cases: cases || [], language, types, frameworks,
      ctx: {
        ui_base_url: p.ui_base_url || "", api_base_url: p.api_base_url || "", api_auth: p.api_auth || "none",
        db_type: p.db_type || "", db_connection: p.db_connection || "",
        mobile_platform: p.mobile_platform || "", mobile_device: p.mobile_device || "", mobile_app: p.mobile_app || "",
      },
      use_pom: p.use_pom !== false, include_assertions: p.include_assertions !== false,
      one_file_per_test: !!p.one_file_per_test, additional: "", rid: "",
      provider: (typeof S !== "undefined" && S.run && S.run.model) || (window._prefs && _prefs.default_provider) || "",
      model: (typeof S !== "undefined" && S.run && S.run.model_name) || "",
      err: "", busy: false,
    };
  }
  function pruneFrameworks() {
    const g = ST.gen;
    g.frameworks = (g.frameworks || []).filter((id) => { const fw = fwById(id); return fw && fwCompatible(fw, g.language, g.types); });
  }
  function casePayload(list) {
    return (list || []).map((t) => ({
      id: t.id, name: t.name || t.title || "", description: t.description || "",
      precondition: t.precondition || "", priority: t.priority || "", type: t.type || "",
      steps: (t.steps || []).map((s) => ({ description: s.description || s.step || "", expected: s.expected || "", data: s.data || s.test_data || "" })),
    }));
  }
  function genPayload() {
    const g = ST.gen;
    return {
      test_cases: casePayload(g.cases), language: g.language, types: g.types.slice(), frameworks: g.frameworks.slice(),
      context: Object.assign({}, g.ctx), use_pom: g.use_pom, include_assertions: g.include_assertions,
      one_file_per_test: g.one_file_per_test, additional_context: g.additional || "",
      recording_id: g.rid || "", provider: g.provider || "", model: g.model || "",
    };
  }
  function openWide(html) {
    if (typeof modal === "function") modal(html);
    else { $("#modal").innerHTML = html; $("#modalBg").classList.add("open"); }
    const m = $("#modal"); if (m) m.classList.add("wide", "as-wide");
  }
  function closeWide() {
    const m = $("#modal"); if (m) m.classList.remove("wide", "as-wide");
    if (typeof closeModal === "function") closeModal();
    else $("#modalBg").classList.remove("open");
  }
  async function asOpenGenerate(cases, opts) {
    opts = opts || {};
    cases = (cases || []).filter(Boolean);
    if (!cases.length) { toast("Select at least one test case."); return; }
    try { await loadOptions(); } catch (e) { toast(e.message || "Could not load script options"); return; }
    ST.gen = defaultGenState(cases);
    if (opts.language) ST.gen.language = opts.language;
    if (opts.types) ST.gen.types = opts.types.slice();
    if (opts.frameworks) ST.gen.frameworks = opts.frameworks.slice();
    pruneFrameworks();
    ST.result = null;
    try { const r = await api("/api/automation/recordings"); ST.recs = r.recordings || []; }
    catch (e) { ST.recs = []; }
    renderGenerate();
  }
  function modes() { return (ST.cat && ST.cat.modes) || { language: "single", type: "multi", framework: "multi" }; }
  function chipsHtml(kind, items, selected, lang, types) {
    const multi = modes()[kind] !== "single";
    return '<div class="as-chips" data-kind="' + esc(kind) + '">' + items.map((it) => {
      const on = multi ? selected.indexOf(it.id) >= 0 : selected === it.id;
      let dis = false, hint = "";
      if (kind === "framework") { dis = !fwCompatible(it, lang, types); hint = dis ? fwHint(it, lang, types) : (it.hint || ""); }
      return '<button type="button" class="as-chip' + (on ? " on" : "") + (dis ? " dis" : "") + '" data-id="' + esc(it.id) + '"' + (dis ? " disabled" : "") + (hint ? ' title="' + esc(hint) + '"' : "") + ">" + esc(it.name) + "</button>";
    }).join("") + "</div>";
  }
  function ctxCard(id, title, body, open) {
    return '<div class="as-ctx" data-ctx="' + id + '"><h4 data-act="toggle">' + esc(title) + " <span>" + (open ? "v" : ">") + "</span></h4><div class=\"body\"" + (open ? "" : " hidden") + ">" + body + "</div></div>";
  }
  function renderGenerate() {
    const g = ST.gen;
    const langs = enabled(ST.cat.languages);
    const types = enabled(ST.cat.types);
    const fws = enabled(ST.cat.frameworks);
    const ids = g.cases.map((c) => c.id).filter(Boolean);
    const ctxs = [];
    if (g.types.indexOf("ui") >= 0) {
      ctxs.push(ctxCard("ui", "UI context", '<label>Base URL</label><input data-k="ui_base_url" value="' + esc(g.ctx.ui_base_url) + '" placeholder="https://staging.example.com">', true));
    }
    if (g.types.indexOf("api") >= 0) {
      const opts = ["none", "bearer", "basic", "apikey"].map((a) => '<option value="' + a + '"' + (g.ctx.api_auth === a ? " selected" : "") + ">" + a + "</option>").join("");
      ctxs.push(ctxCard("api", "API context", '<div class="row2"><div><label>Base URL</label><input data-k="api_base_url" value="' + esc(g.ctx.api_base_url) + '" placeholder="https://api.example.com"></div><div><label>Auth type</label><select data-k="api_auth">' + opts + "</select></div></div>", true));
    }
    if (g.types.indexOf("database") >= 0) {
      ctxs.push(ctxCard("db", "Database context", '<div class="row2"><div><label>Database type</label><input data-k="db_type" value="' + esc(g.ctx.db_type) + '" placeholder="PostgreSQL / MySQL / SQL Server"></div><div><label>Connection placeholder</label><input data-k="db_connection" value="' + esc(g.ctx.db_connection) + '" placeholder="postgresql://user:pass@host:5432/db"></div></div>', true));
    }
    if (g.types.indexOf("mobile") >= 0) {
      ctxs.push(ctxCard("mobile", "Mobile context", '<div class="row2"><div><label>Platform</label><input data-k="mobile_platform" value="' + esc(g.ctx.mobile_platform) + '" placeholder="Android / iOS"></div><div><label>Device</label><input data-k="mobile_device" value="' + esc(g.ctx.mobile_device) + '" placeholder="Pixel 8 / iPhone 15"></div></div><label style="margin-top:6px">App / package</label><input data-k="mobile_app" value="' + esc(g.ctx.mobile_app) + '" placeholder="com.example.app">', true));
    }
    const recOpts = (ST.recs || []).map((r) => '<option value="' + esc(r.rid) + '"' + (g.rid === r.rid ? " selected" : "") + ">" + esc(r.name || r.rid) + (r.source === "current-run" ? " (current run)" : "") + "</option>").join("");
    openWide('<div class="as-modal"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div><h2>Generate Automation Script</h2><div class="sub">' + (ids.map((id) => '<span class="tid">' + esc(id) + "</span>").join(" ") || esc(g.cases.length + " test case(s)")) + '</div></div><button type="button" class="btn g sm" id="asGenX" title="Close">X</button></div>'
      + (g.err ? '<div class="as-gen-err">' + esc(g.err) + "</div>" : "")
      + (g.busy ? '<div class="as-busy">Generating scripts… this may take a minute.</div>' : "")
      + '<div class="as-sec"><h3>Language</h3>' + chipsHtml("language", langs, g.language) + "</div>"
      + '<div class="as-sec"><h3>Type</h3>' + chipsHtml("type", types, g.types) + "</div>"
      + '<div class="as-sec"><h3>Framework</h3>' + chipsHtml("framework", fws, g.frameworks, g.language, g.types) + '<div class="as-hint">Incompatible frameworks are greyed out. Hover a grey chip for why.</div></div>'
      + (ctxs.length ? '<div class="as-ctxs">' + ctxs.join("") + "</div>" : "")
      + '<div class="as-flags"><label><input type="checkbox" data-flag="use_pom"' + (g.use_pom ? " checked" : "") + '> Page Object Model</label><label><input type="checkbox" data-flag="include_assertions"' + (g.include_assertions ? " checked" : "") + '> Include assertions</label><label><input type="checkbox" data-flag="one_file_per_test"' + (g.one_file_per_test ? " checked" : "") + "> One file per test</label></div>"
      + (recOpts ? '<div class="as-sec"><h3>Recorder locators (optional)</h3><select id="asRid"><option value="">Do not use a recording</option>' + recOpts + "</select></div>" : "")
      + '<div class="as-add"><label>Additional context</label><textarea id="asAdd" placeholder="Environment notes, naming conventions, existing helpers…">' + esc(g.additional) + "</textarea></div>"
      + '<div class="as-foot"><div class="as-est" id="asEst"><div class="tc-chip"><span>Estimating…</span></div></div><button type="button" class="btn g" id="asPick">AI model' + (g.provider || g.model ? ": " + esc((g.provider || "") + (g.model ? " / " + g.model : "")) : "") + '</button><button type="button" class="btn" id="asGo"' + (g.busy ? " disabled" : "") + ">Generate</button></div></div>");
    bindGenerate();
    refreshEstimate();
  }
  function bindGenerate() {
    const root = $("#modal"); const g = ST.gen;
    $("#asGenX", root).onclick = function () { closeWide(); };
    $$(".as-chip", root).forEach((b) => {
      b.onclick = function () {
        if (b.classList.contains("dis") || b.disabled) return;
        const kind = b.closest("[data-kind]").dataset.kind;
        const id = b.dataset.id;
        const multi = modes()[kind] !== "single";
        if (kind === "language") { g.language = id; pruneFrameworks(); }
        else if (kind === "type") {
          if (multi) { const i = g.types.indexOf(id); if (i >= 0) { if (g.types.length > 1) g.types.splice(i, 1); } else g.types.push(id); }
          else g.types = [id];
          pruneFrameworks();
        } else {
          if (multi) { const i = g.frameworks.indexOf(id); if (i >= 0) g.frameworks.splice(i, 1); else g.frameworks.push(id); }
          else g.frameworks = [id];
        }
        renderGenerate();
      };
    });
    $$("[data-k]", root).forEach((el) => { el.oninput = el.onchange = function () { g.ctx[el.dataset.k] = el.value; refreshEstimate(); }; });
    $$("[data-flag]", root).forEach((el) => { el.onchange = function () { g[el.dataset.flag] = el.checked; refreshEstimate(); }; });
    $$("[data-act=toggle]", root).forEach((h) => {
      h.onclick = function () {
        const card = h.closest(".as-ctx"); const body = $(".body", card);
        const open = body.hidden; body.hidden = !open; h.querySelector("span").textContent = open ? "v" : ">";
      };
    });
    const add = $("#asAdd", root);
    if (add) add.oninput = function () { g.additional = add.value; clearTimeout(bindGenerate._t); bindGenerate._t = setTimeout(refreshEstimate, 300); };
    const rid = $("#asRid", root); if (rid) rid.onchange = function () { g.rid = rid.value; };
    $("#asPick", root).onclick = function () { pickModel(false); };
    $("#asGo", root).onclick = function () { startGenerate(); };
  }
  function refreshEstimate() {
    const el = $("#asEst");
    if (!el || typeof bindLiveEstimate !== "function") return;
    const g = ST.gen;
    bindLiveEstimate({
      el, kind: "automation", compose: true, expected: 2400,
      provider: function () { return g.provider; }, model: function () { return g.model; },
      extra: {
        language: function () { return g.language; },
        types: function () { return g.types.slice(); },
        frameworks: function () { return g.frameworks.slice(); },
        additional_context: function () { return g.additional || ""; },
        context: function () { return Object.assign({}, g.ctx, { use_pom: g.use_pom, include_assertions: g.include_assertions, one_file_per_test: g.one_file_per_test }); },
        use_pom: function () { return g.use_pom; },
        include_assertions: function () { return g.include_assertions; },
        one_file_per_test: function () { return g.one_file_per_test; },
        test_cases: function () { return casePayload(g.cases); },
      },
    });
  }
  function pickModel(thenGenerate) {
    const g = ST.gen;
    if (typeof openAiPicker !== "function") { if (thenGenerate) doGenerate(); return; }
    openAiPicker({
      title: "Select AI provider and model",
      sub: "Used to generate the automation scripts. Nothing is sent until you confirm.",
      kind: "automation", compose: true, expected: 2400, provider: g.provider, model: g.model,
      confirmLabel: thenGenerate ? "Generate" : "Use this model",
      extra: {
        language: function () { return g.language; }, types: function () { return g.types.slice(); },
        frameworks: function () { return g.frameworks.slice(); }, additional_context: function () { return g.additional || ""; },
        context: function () { return Object.assign({}, g.ctx); }, test_cases: function () { return casePayload(g.cases); },
      },
      onConfirm: function (picked) { g.provider = picked.provider; g.model = picked.model; if (thenGenerate) doGenerate(); else renderGenerate(); },
    });
  }
  function startGenerate() {
    const g = ST.gen; g.err = "";
    if (!g.language) { g.err = "Select a language."; renderGenerate(); return; }
    if (!g.types.length) { g.err = "Select at least one type."; renderGenerate(); return; }
    if (!g.frameworks.length) { g.err = "Select at least one compatible framework."; renderGenerate(); return; }
    if (!g.provider && typeof openAiPicker === "function") { pickModel(true); return; }
    doGenerate();
  }
  async function doGenerate() {
    const g = ST.gen; g.busy = true; g.err = ""; renderGenerate();
    try {
      const r = await api("/api/automation/generate", { method: "POST", body: genPayload() });
      ST.result = r; g.busy = false; renderResult();
    } catch (e) { g.busy = false; g.err = e.message || "Generation failed."; renderGenerate(); }
  }
  function resultFiles() {
    const r = ST.result || {};
    if (r.files_map && typeof r.files_map === "object") return r.files_map;
    const map = {};
    (r.files || []).forEach((f) => { if (f && f.path) map[f.path] = f.content || ""; });
    return map;
  }
  function groupPaths(files) {
    const groups = {};
    Object.keys(files).sort().forEach((p) => {
      const i = p.indexOf("/");
      const g = i > 0 ? p.slice(0, i) : "(root)";
      (groups[g] = groups[g] || []).push(p);
    });
    return groups;
  }
  function renderResult() {
    const r = ST.result;
    const files = resultFiles();
    const paths = Object.keys(files);
    if (!ST.result._file) ST.result._file = paths[0] || "";
    const cur = ST.result._file;
    const groups = groupPaths(files);
    const tree = Object.keys(groups).map((g) => '<div class="grp">' + esc(g) + "</div>" + groups[g].map((p) => '<a data-p="' + esc(p) + '" class="' + (p === cur ? "on" : "") + '">' + esc(p) + "</a>").join("")).join("");
    const mapping = (r.mapping || []).map((m) => "<tr><td><span class=\"tid\">" + esc(m.tc_id || m.id || "") + "</span></td><td>" + esc(m.function || m.name || "") + "</td><td>" + esc(m.file || "") + "</td></tr>").join("");
    const warns = (r.warnings || []).filter(Boolean);
    openWide('<div class="as-modal as-result"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div><h2>Generated scripts</h2><div class="sub">' + esc(r.language || "") + " · " + (r.types || []).map(esc).join(", ") + " · " + (r.frameworks || []).map(esc).join(", ") + (r.model ? " · " + esc((r.provider || "") + " / " + r.model) : "") + '</div></div><button type="button" class="btn g sm" id="asResX">X</button></div><div class="as-files"><div class="as-ftree">' + (tree || '<div class="sub">No files</div>') + '</div><div class="as-codewrap"><textarea id="asCode" readonly>' + esc(files[cur] || "") + "</textarea></div></div>"
      + (mapping ? '<div class="as-map"><h3 style="margin:10px 0 4px;font-size:13px">Test case mapping</h3><table><tr><th>Case</th><th>Function</th><th>File</th></tr>' + mapping + "</table></div>" : "")
      + (warns.length ? '<div class="as-warns"><b>Warnings</b><ul style="margin:4px 0 0 18px">' + warns.map((w) => "<li>" + esc(w) + "</li>").join("") + "</ul></div>" : "")
      + '<div class="as-acts"><button type="button" class="btn g" id="asCopy">Copy file</button><button type="button" class="btn g" id="asDlFile">Download file</button><button type="button" class="btn g" id="asDlZip">Download .zip</button><button type="button" class="btn" id="asSaveLib">Save to Script Library</button><button type="button" class="btn g" id="asBack">Back</button></div></div>');
    const root = $("#modal");
    $("#asResX", root).onclick = function () { closeWide(); };
    $$(".as-ftree a", root).forEach((a) => { a.onclick = function () { ST.result._file = a.dataset.p; renderResult(); }; });
    $("#asCopy", root).onclick = async function () {
      try { await navigator.clipboard.writeText(files[cur] || ""); toast("Copied " + (cur || "file")); }
      catch (e) { toast("Could not copy"); }
    };
    $("#asDlFile", root).onclick = function () { downloadText(cur || "script.txt", files[cur] || ""); };
    $("#asDlZip", root).onclick = function () { downloadZip(files, "automation-scripts.zip"); };
    $("#asSaveLib", root).onclick = function () { openSaveDialog(); };
    $("#asBack", root).onclick = function () { renderGenerate(); };
  }
  function downloadText(name, content) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    a.download = (name.split("/").pop()) || "file.txt";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function downloadZip(files, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(makeZipBlob(files));
    a.download = name || "scripts.zip";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function makeZipBlob(files) {
    function crc32(buf) {
      let c = ~0;
      for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
      return ~c >>> 0;
    }
    function u16(n) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
    function u32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
    const enc = new TextEncoder();
    const parts = []; const central = [];
    let offset = 0, count = 0;
    Object.keys(files).forEach((path) => {
      const name = path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!name || name.indexOf("..") >= 0) return;
      const data = enc.encode(files[path] || "");
      const n = enc.encode(name);
      const crc = crc32(data);
      const local = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(n.length), ...u16(0)]);
      const rec = new Uint8Array(local.length + n.length + data.length);
      rec.set(local, 0); rec.set(n, local.length); rec.set(data, local.length + n.length);
      parts.push(rec);
      const cen = new Uint8Array([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]);
      const cfull = new Uint8Array(cen.length + n.length);
      cfull.set(cen, 0); cfull.set(n, cen.length);
      central.push(cfull);
      offset += rec.length; count += 1;
    });
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, ...u16(count), ...u16(count), ...u32(csize), ...u32(offset), ...u16(0)]);
    const out = new Uint8Array(offset + csize + end.length);
    let p = 0;
    parts.concat(central, [end]).forEach((x) => { out.set(x, p); p += x.length; });
    return new Blob([out], { type: "application/zip" });
  }
  function folderPickerHtml(folders, sel) {
    const byP = {};
    (folders || []).forEach((f) => { const p = f.parent || ""; (byP[p] = byP[p] || []).push(f); });
    Object.keys(byP).forEach((k) => byP[k].sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name)));
    let html = '<a data-f="__unfiled" class="' + (sel ? "" : "on") + '">Unfiled</a>';
    function walk(pid, lvl) {
      (byP[pid] || []).forEach((f) => {
        html += '<a data-f="' + esc(f.id) + '" class="l' + Math.min(lvl + 1, 4) + (sel === f.id ? " on" : "") + '">' + esc(f.name) + ' <span class="c">' + (f.count || 0) + "</span></a>";
        walk(f.id, lvl + 1);
      });
    }
    walk("", 0);
    return html;
  }
  async function openSaveDialog() {
    const r = ST.result || {};
    let folders = [];
    try { const j = await api("/api/automation/folders"); folders = j.folders || []; } catch (e) {}
    const defName = ((r.linked_ids || [])[0] || "script") + " " + (r.language || "") + " scripts";
    openWide('<div class="as-modal as-save"><h2>Save to Script Library</h2><div class="sub">A new script is created, or you can overwrite an existing one as a new version.</div><label>Name</label><input id="asSvName" value="' + esc(defName) + '"><label style="margin-top:8px">Folder</label><div class="fpick"><div class="tree" id="asSvTree">' + folderPickerHtml(folders, "") + '</div></div><div style="display:flex;gap:8px;margin:0 0 8px"><button type="button" class="btn g sm" id="asSvNewF">New folder</button><button type="button" class="btn g sm" id="asSvMirror">Mirror Test Case Repo folders</button></div><label>Tags (comma-separated)</label><input id="asSvTags" placeholder="smoke, login"><label class="row" style="display:flex;align-items:center;gap:8px;margin:10px 0;font-weight:600"><input type="checkbox" id="asSvOver" style="width:auto"> Overwrite an existing script as a new version</label><div id="asSvExist" hidden><label>Existing script</label><select id="asSvSid"></select></div><div class="as-acts"><button type="button" class="btn g" id="asSvNo">Cancel</button><button type="button" class="btn" id="asSvGo">Save</button></div></div>');
    const root = $("#modal");
    let folderId = "";
    const paintSel = function () { $$("#asSvTree a", root).forEach((a) => a.classList.toggle("on", a.dataset.f === folderId)); };
    $("#asSvTree", root).onclick = function (e) {
      const a = e.target.closest("a[data-f]"); if (!a) return;
      folderId = a.dataset.f === "__unfiled" ? "" : a.dataset.f; paintSel();
    };
    $("#asSvNewF", root).onclick = async function () {
      const name = prompt("New folder name"); if (!name) return;
      try {
        const j = await api("/api/automation/folders", { method: "POST", body: { name, parent: folderId } });
        folderId = j.folder.id;
        const f2 = await api("/api/automation/folders");
        $("#asSvTree", root).innerHTML = folderPickerHtml(f2.folders || [], folderId);
      } catch (e) { toast(e.message); }
    };
    $("#asSvMirror", root).onclick = async function () {
      let body;
      if (typeof RP !== "undefined" && RP.folder) body = { folder_id: RP.folder };
      else {
        const names = prompt("Repo folder path (e.g. CX Portal / Login)"); if (!names) return;
        body = { path: names.split("/").map((x) => x.trim()).filter(Boolean) };
      }
      try {
        const j = await api("/api/automation/folders/mirror", { method: "POST", body });
        folderId = j.folder_id || "";
        const f2 = await api("/api/automation/folders");
        $("#asSvTree", root).innerHTML = folderPickerHtml(f2.folders || [], folderId);
        toast("Folders mirrored");
      } catch (e) { toast(e.message); }
    };
    const over = $("#asSvOver", root);
    over.onchange = async function () {
      $("#asSvExist", root).hidden = !over.checked;
      if (over.checked) {
        try {
          const j = await api("/api/automation/scripts");
          $("#asSvSid", root).innerHTML = (j.scripts || []).map((s) => '<option value="' + esc(s.id) + '">' + esc(s.id) + " · " + esc(s.name) + "</option>").join("");
        } catch (e) { toast(e.message); }
      }
    };
    $("#asSvNo", root).onclick = function () { renderResult(); };
    $("#asSvGo", root).onclick = async function () {
      const name = $("#asSvName", root).value.trim(); if (!name) { toast("Name is required"); return; }
      const tags = $("#asSvTags", root).value.split(",").map((x) => x.trim()).filter(Boolean);
      const body = { name, folder_id: folderId, tags, files: resultFiles(), mapping: r.mapping || [], warnings: r.warnings || [], language: r.language || "", types: r.types || [], frameworks: r.frameworks || [], linked_ids: r.linked_ids || [], provider: r.provider || "", model: r.model || "" };
      try {
        if (over.checked) {
          const sid = $("#asSvSid", root).value; if (!sid) { toast("Pick a script to overwrite"); return; }
          await api("/api/automation/scripts/" + encodeURIComponent(sid), { method: "PUT", body: Object.assign({}, body, { new_version: true, version_note: "Generated overwrite" }) });
          toast("Saved as a new version of " + sid);
        } else {
          const j = await api("/api/automation/scripts", { method: "POST", body });
          toast("Saved " + j.script.id);
        }
        closeWide(); refreshCounts();
      } catch (e) { toast(e.message); }
    };
  }
  async function viewScripts(v) {
    const hash = String((typeof S !== "undefined" && S.view) || location.hash.slice(1) || "scripts");
    const m = hash.match(/^scripts\/([^/?]+)/);
    if (m) return viewEditor(v, decodeURIComponent(m[1]));
    v.innerHTML = '<div class="asv"><div class="as-head"><div><h1>Automation Scripts</h1><div class="sub" style="margin:0">Store generated scripts in folders, edit them, and keep version history.</div></div><button type="button" class="btn" id="asNewHint">Generate from cases</button></div><div id="asLib">Loading…</div></div>';
    $("#asNewHint").onclick = function () {
      toast("Select test cases in Review or the Test Case Repo, then click Generate Automation Script.");
      if (typeof go === "function") go("review");
    };
    await renderLibrary($("#asLib"));
  }
  async function renderLibrary(host) {
    const L = ST.lib;
    let folders = [], scripts = [], unfiled = 0;
    try {
      const f = await api("/api/automation/folders");
      folders = f.folders || []; unfiled = f.unfiled || 0;
      const params = new URLSearchParams();
      if (L.q) params.set("q", L.q);
      if (L.folder) params.set("folder", L.folder);
      if (L.language) params.set("language", L.language);
      const tc = (String((typeof S !== "undefined" && S.view) || "").split("tc=")[1] || "").split("&")[0];
      if (tc && !L.q) params.set("tc", decodeURIComponent(tc));
      const s = await api("/api/automation/scripts?" + params.toString());
      scripts = s.scripts || [];
    } catch (e) { host.innerHTML = '<div class="error">' + esc(e.message) + "</div>"; return; }
    L.folders = folders; L.scripts = scripts;
    const langs = [...new Set(scripts.map((s) => s.language).filter(Boolean))];
    host.innerHTML = '<div class="g2"><div class="card" style="margin:0;padding:10px"><div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 6px"><b>Folders</b><button type="button" class="btn g sm" id="asFNew">New folder</button></div><div class="tree" id="asTree">' + treeHtml(folders, unfiled, L.folder) + '</div></div><div><div class="as-crumb" id="asCrumb">' + crumbHtml(folders, L.folder) + '</div><div class="as-tools"><input id="asQ" placeholder="Search" value="' + esc(L.q) + '" style="width:200px"><select id="asLangF"><option value="">All languages</option>' + langs.map((x) => "<option" + (L.language === x ? " selected" : "") + ">" + esc(x) + "</option>").join("") + '</select><span style="flex:1"></span><span class="sub" style="margin:0">' + scripts.length + " script" + (scripts.length === 1 ? "" : "s") + '</span></div><div id="asList">' + listHtml(scripts) + "</div></div></div>";
    bindLibrary(host);
  }
  function treeHtml(folders, unfiled, sel) {
    const byP = {};
    (folders || []).forEach((f) => { (byP[f.parent || ""] = byP[f.parent || ""] || []).push(f); });
    Object.keys(byP).forEach((k) => byP[k].sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name)));
    let html = '<a data-f="" class="' + (sel ? "" : "a") + '" data-drop="">All scripts</a>';
    html += '<a data-f="__unfiled" class="' + (sel === "__unfiled" ? "a" : "") + '" data-drop="__unfiled">Unfiled <span class="c">' + unfiled + "</span></a>";
    function walk(pid, lvl) {
      (byP[pid] || []).forEach((f) => {
        const kids = byP[f.id] || [];
        html += '<a data-f="' + esc(f.id) + '" data-drop="' + esc(f.id) + '" draggable="true" class="l' + Math.min(lvl + 1, 4) + (sel === f.id ? " a" : "") + '"><span class="dh">::</span>' + (kids.length ? '<span class="caret">v</span>' : '<span class="caret"></span>') + " " + esc(f.name) + ' <span class="c">' + (f.count || 0) + '</span><span class="mn" data-menu="' + esc(f.id) + '">...</span></a>';
        walk(f.id, lvl + 1);
      });
    }
    walk("", 0);
    return html;
  }
  function crumbHtml(folders, fid) {
    if (!fid) return "All scripts";
    if (fid === "__unfiled") return "Unfiled";
    const map = {}; (folders || []).forEach((f) => { map[f.id] = f; });
    const parts = []; let cur = fid, guard = 0;
    while (cur && map[cur] && guard++ < 12) { parts.push(map[cur]); cur = map[cur].parent || ""; }
    parts.reverse();
    return '<a data-g="">All</a>' + parts.map((f) => ' / <a data-g="' + esc(f.id) + '">' + esc(f.name) + "</a>").join("");
  }
  function listHtml(scripts) {
    if (!scripts.length) return '<div class="card"><div class="sub" style="margin:0">No scripts in this folder.</div></div>';
    return '<table class="rt"><tr><th></th><th>ID</th><th>Name</th><th>Language</th><th>Types</th><th>Frameworks</th><th>Linked</th><th>Ver</th><th></th></tr>' + scripts.map((s) => '<tr class="clk" data-id="' + esc(s.id) + '"><td><input type="checkbox" class="asCk"' + (ST.lib.sel.has(s.id) ? " checked" : "") + '></td><td><b style="color:#4361ee">' + esc(s.id) + "</b></td><td>" + esc(s.name) + "</td><td>" + esc(s.language || "-") + "</td><td>" + (s.types || []).map((t) => '<span class="as-pill">' + esc(t) + "</span>").join("") + "</td><td>" + (s.frameworks || []).map((t) => '<span class="as-pill">' + esc(t) + "</span>").join(" ") + "</td><td>" + (s.linked_ids || []).map((t) => '<span class="tid">' + esc(t) + "</span>").join(" ") + "</td><td>v" + (s.version || 1) + '</td><td><button type="button" class="ib" data-row="' + esc(s.id) + '" title="Actions">...</button></td></tr>').join("") + "</table>";
  }
  function bindLibrary(host) {
    const L = ST.lib;
    const reload = function () { renderLibrary(host); };
    $("#asFNew", host).onclick = async function () {
      const name = prompt("New folder name"); if (!name) return;
      try { await api("/api/automation/folders", { method: "POST", body: { name, parent: (L.folder && L.folder !== "__unfiled") ? L.folder : "" } }); toast("Folder created"); reload(); }
      catch (e) { toast(e.message); }
    };
    $$("#asTree a[data-f]", host).forEach((a) => { a.onclick = function (e) { if (e.target.closest("[data-menu]")) return; L.folder = a.dataset.f || ""; reload(); }; });
    $$("#asCrumb a[data-g]", host).forEach((a) => { a.onclick = function () { L.folder = a.dataset.g || ""; reload(); }; });
    const q = $("#asQ", host);
    if (q) q.oninput = function () { L.q = q.value; clearTimeout(bindLibrary._t); bindLibrary._t = setTimeout(reload, 200); };
    const lf = $("#asLangF", host);
    if (lf) lf.onchange = function () { L.language = lf.value; reload(); };
    $$("#asList tr.clk", host).forEach((tr) => {
      tr.onclick = function (e) { if (e.target.closest("input,button,[data-row]")) return; openEditor(tr.dataset.id); };
      tr.draggable = true;
      tr.ondragstart = function (e) { e.dataTransfer.setData("text/script-id", tr.dataset.id); };
    });
    $$(".asCk", host).forEach((ck) => { ck.onclick = function (e) { e.stopPropagation(); const id = ck.closest("tr").dataset.id; if (ck.checked) L.sel.add(id); else L.sel.delete(id); }; });
    $$("[data-row]", host).forEach((b) => { b.onclick = function (e) { e.stopPropagation(); rowMenu(b, b.dataset.row); }; });
    $$("#asTree [data-menu]", host).forEach((b) => { b.onclick = function (e) { e.stopPropagation(); folderMenu(b, b.dataset.menu); }; });
    $$("#asTree a[data-drop]", host).forEach((a) => {
      a.ondragover = function (e) { e.preventDefault(); a.style.background = "#e0e7ff"; };
      a.ondragleave = function () { a.style.background = ""; };
      a.ondrop = async function (e) {
        e.preventDefault(); a.style.background = "";
        const sid = e.dataTransfer.getData("text/script-id"); if (!sid) return;
        const dest = a.dataset.drop === "__unfiled" || !a.dataset.drop ? "" : a.dataset.drop;
        try { await api("/api/automation/scripts/" + encodeURIComponent(sid), { method: "PUT", body: { folder_id: dest } }); toast("Moved " + sid); reload(); }
        catch (err) { toast(err.message); }
      };
    });
  }
  function closeFm() { const m = $("#asFm"); if (m) m.remove(); }
  document.addEventListener("mousedown", function (e) { if (!e.target.closest || !e.target.closest("#asFm")) closeFm(); }, true);
  function folderMenu(anchor, fid) {
    closeFm();
    const tree = $("#asTree"); const r = anchor.getBoundingClientRect(); const t = tree.getBoundingClientRect();
    tree.insertAdjacentHTML("beforeend", '<div class="tr-fm" id="asFm" style="top:' + (r.bottom - t.top) + "px;left:" + Math.min(r.right - t.left - 20, t.width - 180) + 'px"><div data-a="rename">Rename</div><div data-a="new">New subfolder</div><div data-a="move">Move</div><div data-a="del" class="danger">Delete</div></div>');
    $$("#asFm div[data-a]").forEach((x) => {
      x.onclick = async function () {
        const a = x.dataset.a; closeFm();
        try {
          if (a === "rename") { const name = prompt("Rename folder"); if (!name) return; await api("/api/automation/folders/" + encodeURIComponent(fid), { method: "PUT", body: { name } }); }
          else if (a === "new") { const name = prompt("Subfolder name"); if (!name) return; await api("/api/automation/folders", { method: "POST", body: { name, parent: fid } }); }
          else if (a === "move") { const dest = prompt("Move under folder id (blank for root)"); if (dest === null) return; await api("/api/automation/folders/" + encodeURIComponent(fid), { method: "PUT", body: { parent: dest || "" } }); }
          else if (a === "del") {
            if (!confirm("Delete this folder? Scripts can be moved to Unfiled.")) return;
            try { await api("/api/automation/folders/" + encodeURIComponent(fid), { method: "DELETE" }); }
            catch (err) {
              if (!confirm("Folder is not empty. Move scripts to Unfiled and delete?")) return;
              const all = await api("/api/automation/scripts?folder=" + encodeURIComponent(fid));
              for (const s of (all.scripts || [])) await api("/api/automation/scripts/" + encodeURIComponent(s.id), { method: "PUT", body: { folder_id: "" } });
              await api("/api/automation/folders/" + encodeURIComponent(fid) + "?recursive=1", { method: "DELETE" });
            }
          }
          await renderLibrary($("#asLib") || $("#view"));
        } catch (e) { toast(e.message); }
      };
    });
  }
  function rowMenu(anchor, sid) {
    closeFm();
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.id = "asFm"; menu.className = "as-fm";
    menu.style.cssText = "position:fixed;top:" + (r.bottom + 4) + "px;left:" + Math.max(8, r.right - 180) + "px";
    menu.innerHTML = '<div data-a="open">Open</div><div data-a="dl">Download zip</div><div data-a="dup">Duplicate</div><div data-a="regen">Regenerate</div><div data-a="del" class="danger">Delete</div>';
    document.body.appendChild(menu);
    $$("div[data-a]", menu).forEach((x) => {
      x.onclick = async function () {
        const a = x.dataset.a; closeFm();
        try {
          if (a === "open") openEditor(sid);
          else if (a === "dl") window.location = "/api/automation/scripts/" + encodeURIComponent(sid) + "/download";
          else if (a === "dup") { const j = await api("/api/automation/scripts/" + encodeURIComponent(sid) + "/duplicate", { method: "POST", body: {} }); toast("Duplicated as " + j.script.id); await renderLibrary($("#asLib") || $("#view")); }
          else if (a === "regen") {
            const s = await api("/api/automation/scripts/" + encodeURIComponent(sid));
            const cases = await resolveCases((s.script.linked_ids) || []);
            if (!cases.length) { toast("No linked test cases are available to regenerate from."); return; }
            asOpenGenerate(cases, { language: s.script.language, types: s.script.types, frameworks: s.script.frameworks });
          } else if (a === "del") {
            if (!confirm("Delete " + sid + "? This cannot be undone.")) return;
            await api("/api/automation/scripts/" + encodeURIComponent(sid), { method: "DELETE" });
            toast("Deleted " + sid); await renderLibrary($("#asLib") || $("#view"));
          }
        } catch (e) { toast(e.message); }
      };
    });
  }
  function openEditor(sid) {
    if (typeof go === "function") go("scripts/" + sid);
    else { location.hash = "scripts/" + sid; viewEditor($("#view"), sid); }
  }
  async function viewEditor(v, sid) {
    v.innerHTML = '<div class="asv as-ed"><div class="sub">Loading ' + esc(sid) + "</div></div>";
    try {
      const j = await api("/api/automation/scripts/" + encodeURIComponent(sid));
      const vers = await api("/api/automation/scripts/" + encodeURIComponent(sid) + "/versions");
      ST.ed = { script: j.script, versions: vers.versions || [], file: Object.keys(j.script.files || {})[0] || "", showDiff: null };
      paintEditor(v);
    } catch (e) {
      v.innerHTML = '<div class="asv"><div class="error">' + esc(e.message) + '</div><button type="button" class="btn g" id="asBackLib">Library</button></div>';
      $("#asBackLib").onclick = function () { go("scripts"); };
    }
  }
  function paintEditor(v) {
    const s = ST.ed.script;
    const files = s.files || {};
    const paths = Object.keys(files).sort();
    if (!ST.ed.file || files[ST.ed.file] === undefined) ST.ed.file = paths[0] || "";
    const groups = groupPaths(files);
    const tree = Object.keys(groups).map((g) => '<div class="grp">' + esc(g) + "</div>" + groups[g].map((p) => '<a data-p="' + esc(p) + '" class="' + (p === ST.ed.file ? "on" : "") + '">' + esc(p) + "</a>").join("")).join("");
    const vers = (ST.ed.versions || []).map((x) => '<li data-v="' + x.version + '" class="' + (ST.ed.showDiff === x.version ? "on" : "") + '">v' + x.version + " · " + esc(x.created || "") + '<div class="sub" style="margin:0">' + esc(x.note || "") + "</div></li>").join("");
    v.innerHTML = '<div class="asv as-ed"><div class="as-ed-head"><div><button type="button" class="btn g sm" id="asBackLib">Library</button><h1 style="display:inline;margin-left:8px">' + esc(s.name) + '</h1><div class="sub" style="margin:4px 0 0">' + esc(s.id) + " · " + esc(s.language || "") + " · v" + (s.version || 1) + " " + (s.linked_ids || []).map((t) => '<span class="tid">' + esc(t) + "</span>").join(" ") + '</div></div><div class="as-ed-meta"><span class="as-ind" data-as="script" hidden></span><button type="button" class="btn g" id="asEdSave">Save as new version</button><button type="button" class="btn g" id="asEdZip">Download zip</button><button type="button" class="btn g" id="asEdRegen">Regenerate</button></div></div><div class="as-ed-body"><div class="as-ftree">' + (tree || '<div class="sub">No files</div>') + '</div><div class="as-codewrap"><textarea id="asEdCode" class="as-ed-code">' + esc(files[ST.ed.file] || "") + '</textarea></div><div class="as-side"><div class="card"><h3>Notes</h3><textarea id="asEdNotes" rows="4">' + esc(s.notes || "") + '</textarea></div><div class="card" style="margin-top:10px"><h3>Linked cases</h3><div>' + ((s.linked_ids || []).map((t) => '<span class="tid">' + esc(t) + "</span>").join(" ") || '<span class="sub">None</span>') + '</div></div><div class="card" style="margin-top:10px"><h3>Version history</h3><ul class="as-ver">' + (vers || '<li class="sub">No snapshots yet</li>') + '</ul><div id="asDiff" style="margin-top:8px"></div></div></div></div></div>';
    $("#asBackLib").onclick = function () { if (typeof go === "function") go("scripts"); };
    $$(".as-ftree a").forEach((a) => { a.onclick = function () { flushEditorFile(); ST.ed.file = a.dataset.p; paintEditor(v); }; });
    const ta = $("#asEdCode");
    ta.oninput = function () { s.files[ST.ed.file] = ta.value; scheduleScriptSave(); };
    $("#asEdNotes").oninput = function (e) { s.notes = e.target.value; scheduleScriptSave(); };
    $("#asEdSave").onclick = function () { saveNewVersion(); };
    $("#asEdZip").onclick = function () { window.location = "/api/automation/scripts/" + encodeURIComponent(s.id) + "/download"; };
    $("#asEdRegen").onclick = async function () {
      const cases = await resolveCases(s.linked_ids || []);
      if (!cases.length) { toast("No linked test cases are available to regenerate from."); return; }
      asOpenGenerate(cases, { language: s.language, types: s.types, frameworks: s.frameworks });
    };
    $$(".as-ver li[data-v]").forEach((li) => { li.onclick = function () { showDiff(v, +li.dataset.v); }; });
    if (ST.ed.showDiff) showDiff(v, ST.ed.showDiff);
  }
  function flushEditorFile() {
    const ta = $("#asEdCode");
    if (ta && ST.ed && ST.ed.script && ST.ed.file) ST.ed.script.files[ST.ed.file] = ta.value;
  }
  function scheduleScriptSave() {
    if (typeof autosaveSchedule !== "function") return;
    const s = ST.ed && ST.ed.script; if (!s) return;
    autosaveSchedule("script:" + s.id, async function () {
      flushEditorFile();
      const j = await api("/api/automation/scripts/" + encodeURIComponent(s.id), { method: "PUT", body: { files: s.files, notes: s.notes, name: s.name } });
      ST.ed.script.updated = j.script.updated;
      ST.ed.script.version = j.script.version;
    });
  }
  async function saveNewVersion() {
    const s = ST.ed.script; flushEditorFile();
    const note = prompt("Version note (optional)", "Manual edit") || "";
    try {
      if (typeof autosaveFlush === "function") await autosaveFlush({ reason: "manual" });
      const j = await api("/api/automation/scripts/" + encodeURIComponent(s.id) + "/versions", { method: "POST", body: { files: s.files, notes: s.notes, version_note: note } });
      ST.ed.script = j.script;
      const vers = await api("/api/automation/scripts/" + encodeURIComponent(s.id) + "/versions");
      ST.ed.versions = vers.versions || [];
      toast("Saved v" + j.script.version);
      paintEditor($("#view"));
    } catch (e) { toast(e.message); }
  }
  async function showDiff(v, n) {
    ST.ed.showDiff = n;
    $$(".as-ver li").forEach((li) => li.classList.toggle("on", +li.dataset.v === n));
    const box = $("#asDiff"); if (!box) return;
    box.innerHTML = '<div class="sub">Loading v' + n + "</div>";
    try {
      const j = await api("/api/automation/scripts/" + encodeURIComponent(ST.ed.script.id) + "/versions/" + n);
      const cur = ST.ed.script.files || {}; const old = j.files || {};
      const paths = [...new Set([...Object.keys(cur), ...Object.keys(old)])].sort();
      let html = "";
      paths.forEach((p) => {
        html += '<div class="sub" style="margin:6px 0 2px">' + esc(p) + '</div><div class="as-diff">' + lineDiff(String(old[p] || "").split("\n"), String(cur[p] || "").split("\n")) + "</div>";
      });
      box.innerHTML = html || '<div class="sub">No differences vs current.</div>';
    } catch (e) { box.innerHTML = '<div class="error">' + esc(e.message) + "</div>"; }
  }
  function lineDiff(a, b) {
    const n = a.length, m = b.length;
    const dp = Array(n + 1);
    for (let i = 0; i <= n; i++) dp[i] = Array(m + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push('<div class="ctx">  ' + esc(a[i]) + "</div>"); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push('<div class="del">- ' + esc(a[i]) + "</div>"); i++; }
      else { out.push('<div class="add">+ ' + esc(b[j]) + "</div>"); j++; }
    }
    while (i < n) { out.push('<div class="del">- ' + esc(a[i++]) + "</div>"); }
    while (j < m) { out.push('<div class="add">+ ' + esc(b[j++]) + "</div>"); }
    return out.join("") || '<div class="ctx">  (empty)</div>';
  }
  async function resolveCases(ids) {
    ids = ids || [];
    const fromRun = (typeof S !== "undefined" && (S.cases || (S.run && S.run.test_cases))) || [];
    const found = []; const missing = [];
    ids.forEach((id) => { const t = fromRun.find((c) => c.id === id); if (t) found.push(t); else missing.push(id); });
    if (missing.length) {
      try {
        const repo = await api("/api/repo");
        (repo.cases || (repo.repo && repo.repo.cases) || []).forEach((c) => {
          if (missing.indexOf(c.id) >= 0) {
            found.push({ id: c.id, name: c.title || c.name, description: c.description, precondition: c.precondition, priority: c.priority, type: c.type, steps: (c.steps || []).map((s) => ({ description: s.step || s.description, expected: s.expected, data: s.data })) });
          }
        });
      } catch (e) {}
    }
    return found;
  }
  function asRenderScriptOptions(pane) {
    if (!pane) return;
    const wrap = document.createElement("div");
    wrap.className = "as-set"; wrap.id = "asSetPane"; pane.appendChild(wrap);
    loadOptions(true).then(function () {
      ST.set.local = JSON.parse(JSON.stringify({ languages: ST.cat.languages, types: ST.cat.types, frameworks: ST.cat.frameworks, modes: ST.cat.modes, removed: ST.cat.removed }));
      ST.set.orig = JSON.stringify(ST.set.local);
      paintSet();
    }).catch(function (e) { wrap.innerHTML = '<div class="error">' + esc(e.message) + "</div>"; });
  }
  function paintSet() {
    const wrap = $("#asSetPane"); if (!wrap) return;
    const loc = ST.set.local; const tab = ST.set.tab || "languages";
    wrap.innerHTML = '<div class="sub" style="margin:0 0 8px">These options drive the Generate Automation Script chips. Deleting a built-in option hides it from Generate; saved scripts keep their stored value.</div><div class="modebar">Selection mode: '
      + ["language", "type", "framework"].map((k) => "<label>" + esc(k) + ' <select data-mode="' + k + '"><option value="single"' + (loc.modes[k] === "single" ? " selected" : "") + '>single</option><option value="multi"' + (loc.modes[k] === "multi" ? " selected" : "") + ">multi</option></select></label>").join("")
      + '<span style="flex:1"></span><button type="button" class="btn g sm" id="asResetDef">Reset to defaults</button></div><div class="set-subtabs" role="tablist"><button type="button" data-stab="languages" class="' + (tab === "languages" ? "a" : "") + '">Languages</button><button type="button" data-stab="types" class="' + (tab === "types" ? "a" : "") + '">Types</button><button type="button" data-stab="frameworks" class="' + (tab === "frameworks" ? "a" : "") + '">Frameworks</button></div><div id="asSetTbl"></div><div style="margin-top:8px"><button type="button" class="btn g sm" id="asAddOpt">Add ' + esc(tab.replace(/s$/, "")) + "</button></div>";
    $$("[data-stab]", wrap).forEach((b) => { b.onclick = function () { ST.set.tab = b.dataset.stab; paintSet(); }; });
    $$("[data-mode]", wrap).forEach((s) => { s.onchange = function () { loc.modes[s.dataset.mode] = s.value; markSetDirty(); }; });
    $("#asResetDef", wrap).onclick = function () {
      if (!confirm("Reset languages, types, and frameworks to the built-in defaults? Custom options will be removed.")) return;
      api("/api/automation/options/reset", { method: "POST", body: {} }).then(function (j) {
        ST.cat = j; ST.prefs = j.prefs || ST.prefs;
        ST.set.local = JSON.parse(JSON.stringify({ languages: j.languages, types: j.types, frameworks: j.frameworks, modes: j.modes, removed: j.removed }));
        ST.set.orig = JSON.stringify(ST.set.local);
        paintSet(); if (typeof setUpdateDirty === "function") setUpdateDirty(); toast("Script options reset to defaults");
      }).catch(function (e) { toast(e.message); });
    };
    $("#asAddOpt", wrap).onclick = function () { editOption(tab, null); };
    paintSetTable(tab);
    if (typeof setUpdateDirty === "function") setUpdateDirty();
  }
  function paintSetTable(tab) {
    const host = $("#asSetTbl"); if (!host) return;
    const rows = ST.set.local[tab] || [];
    if (tab === "languages") {
      host.innerHTML = "<table><tr><th></th><th>Name</th><th>Code</th><th>Ext</th><th>Default runner</th><th>Enabled</th><th>Default</th><th></th></tr>" + rows.map((r, i) => '<tr data-i="' + i + '"><td class="drag" draggable="true">::</td><td>' + esc(r.name) + (r.custom ? ' <span class="as-pill">custom</span>' : "") + "</td><td>" + esc(r.code || "") + "</td><td>" + esc(r.ext || "") + "</td><td>" + esc(r.default_runner || "-") + '</td><td><input type="checkbox" class="tgl" data-en="' + i + '"' + (r.enabled !== false ? " checked" : "") + '></td><td><button type="button" class="btn g sm" data-def="' + esc(r.id) + '"' + (((ST.set.prefs || ST.prefs || {}).default_language === r.id) ? " disabled" : "") + '>Set default</button></td><td><button type="button" class="ib" data-ed="' + i + '">Edit</button> <button type="button" class="ib" data-del="' + i + '">Del</button></td></tr>').join("") + "</table>";
    } else if (tab === "types") {
      host.innerHTML = "<table><tr><th></th><th>Name</th><th>Icon</th><th>Color</th><th>Enabled</th><th></th></tr>" + rows.map((r, i) => '<tr data-i="' + i + '"><td class="drag" draggable="true">::</td><td>' + esc(r.name) + (r.custom ? ' <span class="as-pill">custom</span>' : "") + "</td><td>" + esc(r.icon || "") + '</td><td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:' + esc(r.color || "#ccc") + '"></span> ' + esc(r.color || "") + '</td><td><input type="checkbox" class="tgl" data-en="' + i + '"' + (r.enabled !== false ? " checked" : "") + '></td><td><button type="button" class="ib" data-ed="' + i + '">Edit</button> <button type="button" class="ib" data-del="' + i + '">Del</button></td></tr>').join("") + "</table>";
    } else {
      host.innerHTML = "<table><tr><th></th><th>Name</th><th>Languages</th><th>Types</th><th>Category</th><th>AI prompt hint</th><th>Enabled</th><th></th></tr>" + rows.map((r, i) => '<tr data-i="' + i + '"><td class="drag" draggable="true">::</td><td>' + esc(r.name) + (r.custom ? ' <span class="as-pill">custom</span>' : "") + "</td><td>" + (r.languages || []).map((x) => '<span class="as-pill">' + esc((langById(x) || {}).name || x) + "</span>").join("") + "</td><td>" + (r.types || []).map((x) => '<span class="as-pill">' + esc((typeById(x) || {}).name || x) + "</span>").join("") + "</td><td>" + esc(r.category || "") + '</td><td class="hint" title="' + esc(r.hint || "") + '">' + esc((r.hint || "").slice(0, 80)) + ((r.hint || "").length > 80 ? "..." : "") + '</td><td><input type="checkbox" class="tgl" data-en="' + i + '"' + (r.enabled !== false ? " checked" : "") + '></td><td><button type="button" class="ib" data-ed="' + i + '">Edit</button> <button type="button" class="ib" data-del="' + i + '">Del</button></td></tr>').join("") + "</table>";
    }
    $$("[data-en]", host).forEach((el) => { el.onchange = function () { rows[+el.dataset.en].enabled = el.checked; markSetDirty(); }; });
    $$("[data-ed]", host).forEach((el) => { el.onclick = function () { editOption(tab, rows[+el.dataset.ed], +el.dataset.ed); }; });
    $$("[data-del]", host).forEach((el) => { el.onclick = function () { deleteOption(tab, +el.dataset.del); }; });
    $$("[data-def]", host).forEach((el) => { el.onclick = function () { ST.set.prefs = Object.assign({}, ST.prefs, ST.set.prefs, { default_language: el.dataset.def }); markSetDirty(); paintSet(); }; });
    let dragI = -1;
    $$("td.drag", host).forEach((td) => {
      const tr = td.parentElement;
      td.ondragstart = function () { dragI = +tr.dataset.i; };
      tr.ondragover = function (e) { e.preventDefault(); };
      tr.ondrop = function (e) {
        e.preventDefault(); const to = +tr.dataset.i; if (dragI < 0 || to === dragI) return;
        const item = rows.splice(dragI, 1)[0]; rows.splice(to, 0, item); markSetDirty(); paintSetTable(tab);
      };
    });
  }
  function markSetDirty() { if (typeof setUpdateDirty === "function") setUpdateDirty(); }
  function editOption(tab, row, idx) {
    const isFw = tab === "frameworks"; const isTy = tab === "types";
    const r = row ? JSON.parse(JSON.stringify(row)) : { id: "", name: "", enabled: true, custom: true, languages: [], types: [], category: "library", hint: "", code: "", ext: "", default_runner: "", icon: "", color: "#2563eb" };
    const langs = (ST.set.local.languages || ST.cat.languages || []);
    const types = (ST.set.local.types || ST.cat.types || []);
    let extra = "";
    if (!isFw && !isTy) extra = '<div class="row2" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px"><div><label>Short code</label><input id="asOpCode" value="' + esc(r.code || "") + '"></div><div><label>Extension</label><input id="asOpExt" value="' + esc(r.ext || "") + '" placeholder=".py"></div><div><label>Default runner</label><input id="asOpRun" value="' + esc(r.default_runner || "") + '"></div></div>';
    if (isTy) extra = '<div class="row2" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px"><div><label>Icon</label><input id="asOpIcon" value="' + esc(r.icon || "") + '"></div><div><label>Colour</label><input id="asOpColor" value="' + esc(r.color || "") + '"></div></div>';
    if (isFw) extra = '<div style="margin-top:8px"><label>Compatible languages</label><div class="as-chips" id="asOpLangs">' + langs.map((l) => '<button type="button" class="as-chip' + ((r.languages || []).indexOf(l.id) >= 0 ? " on" : "") + '" data-id="' + esc(l.id) + '">' + esc(l.name) + "</button>").join("") + '</div><label style="margin-top:8px">Compatible types</label><div class="as-chips" id="asOpTypes">' + types.map((t) => '<button type="button" class="as-chip' + ((r.types || []).indexOf(t.id) >= 0 ? " on" : "") + '" data-id="' + esc(t.id) + '">' + esc(t.name) + "</button>").join("") + '</div><label style="margin-top:8px">Category</label><select id="asOpCat">' + ["library", "runner", "bdd", "robot"].map((c) => "<option" + (r.category === c ? " selected" : "") + ">" + c + "</option>").join("") + '</select><label style="margin-top:8px">AI prompt hint</label><textarea id="asOpHint" rows="4">' + esc(r.hint || "") + "</textarea></div>";
    openWide('<div class="as-modal as-save"><h2>' + (row ? "Edit" : "Add") + " " + esc(tab.replace(/s$/, "")) + '</h2><label>Name *</label><input id="asOpName" value="' + esc(r.name) + '">' + extra + '<div class="as-acts"><button type="button" class="btn g" id="asOpNo">Cancel</button><button type="button" class="btn" id="asOpGo">Save</button></div></div>');
    const root = $("#modal");
    function toggle(box, arr) { $$(".as-chip", box).forEach((b) => { b.onclick = function () { const id = b.dataset.id; const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); b.classList.toggle("on", arr.indexOf(id) >= 0); }; }); }
    if (isFw) { r.languages = r.languages || []; r.types = r.types || []; toggle($("#asOpLangs", root), r.languages); toggle($("#asOpTypes", root), r.types); }
    $("#asOpNo", root).onclick = function () { closeWide(); };
    $("#asOpGo", root).onclick = function () {
      const name = $("#asOpName", root).value.trim(); if (!name) { toast("Name is required"); return; }
      r.name = name;
      if (!r.id) r.id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
      r.custom = row ? !!row.custom : true;
      if (!isFw && !isTy) { r.code = $("#asOpCode", root).value.trim(); r.ext = $("#asOpExt", root).value.trim(); r.default_runner = $("#asOpRun", root).value.trim(); }
      if (isTy) { r.icon = $("#asOpIcon", root).value; r.color = $("#asOpColor", root).value; }
      if (isFw) { r.category = $("#asOpCat", root).value; r.hint = $("#asOpHint", root).value; }
      if (idx >= 0) ST.set.local[tab][idx] = r; else ST.set.local[tab].push(r);
      closeWide(); markSetDirty(); paintSet();
    };
  }
  function deleteOption(tab, idx) {
    const row = ST.set.local[tab][idx]; if (!row) return;
    const used = (ST.lib.scripts || []).filter((s) => {
      if (tab === "languages") return s.language === row.id || s.language === row.name;
      if (tab === "types") return (s.types || []).indexOf(row.id) >= 0;
      return (s.frameworks || []).indexOf(row.id) >= 0 || (s.frameworks || []).indexOf(row.name) >= 0;
    }).length;
    const msg = used ? ("Used by " + used + " saved script(s) — scripts keep their stored value; option hidden from Generate. Delete “" + row.name + "”?") : ("Delete “" + row.name + "”?");
    if (!confirm(msg)) return;
    ST.set.local[tab].splice(idx, 1);
    if (!row.custom) {
      const rem = ST.set.local.removed || (ST.set.local.removed = { languages: [], types: [], frameworks: [] });
      (rem[tab] = rem[tab] || []);
      if (rem[tab].indexOf(row.id) < 0) rem[tab].push(row.id);
    }
    markSetDirty(); paintSet();
  }
  function asScriptOptionsDirty() {
    if (!ST.set.local) return false;
    if (JSON.stringify(ST.set.local) !== (ST.set.orig || "")) return true;
    if (ST.set.prefs && JSON.stringify(ST.set.prefs) !== JSON.stringify(ST.prefs || {})) return true;
    return false;
  }
  async function asSaveScriptOptions() {
    if (!ST.set.local && !ST.set.prefs) return;
    const body = { prefs: {} };
    if (ST.set.local) body.prefs.script_options = ST.set.local;
    if (ST.set.prefs) body.prefs.automation_prefs = Object.assign({}, ST.prefs || {}, ST.set.prefs || {});
    if (!Object.keys(body.prefs).length) return;
    await api("/api/settings/prefs", { method: "PUT", body });
    if (ST.set.local) { ST.set.orig = JSON.stringify(ST.set.local); ST.cat = Object.assign({}, ST.cat || {}, ST.set.local); }
    if (ST.set.prefs) ST.prefs = Object.assign({}, ST.prefs || {}, ST.set.prefs || {});
  }
  function asRenderPrefsCard(pane) {
    if (!pane || $("#asPrefCard", pane)) return;
    const card = document.createElement("div");
    card.className = "card"; card.id = "asPrefCard"; card.style.marginTop = "14px";
    card.innerHTML = '<h3>Automation script defaults</h3><div class="sub">Used when you open Generate Automation Script. Manage the catalogue on the Script options tab.</div><div id="asPrefBody">Loading…</div>';
    pane.appendChild(card);
    loadOptions().then(function () {
      const p = ST.prefs || {};
      const langs = enabled(ST.cat.languages); const types = enabled(ST.cat.types); const fws = enabled(ST.cat.frameworks);
      $("#asPrefBody", card).innerHTML = '<label>Default language</label><select data-pkey="default_language">' + langs.map((l) => '<option value="' + esc(l.id) + '"' + (p.default_language === l.id ? " selected" : "") + ">" + esc(l.name) + "</option>").join("") + '</select><label style="margin-top:8px">Default types</label><div class="as-chips" id="asPrefTypes">' + types.map((t) => '<button type="button" class="as-chip' + ((p.default_types || []).indexOf(t.id) >= 0 ? " on" : "") + '" data-id="' + esc(t.id) + '">' + esc(t.name) + "</button>").join("") + '</div><label style="margin-top:8px">Default frameworks</label><div class="as-chips" id="asPrefFws">' + fws.map((t) => '<button type="button" class="as-chip' + ((p.default_frameworks || []).indexOf(t.id) >= 0 ? " on" : "") + '" data-id="' + esc(t.id) + '">' + esc(t.name) + "</button>").join("") + '</div><div class="row2" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><div><label>UI base URL</label><input data-pkey="ui_base_url" value="' + esc(p.ui_base_url || "") + '"></div><div><label>API base URL</label><input data-pkey="api_base_url" value="' + esc(p.api_base_url || "") + '"></div></div><label style="margin-top:8px">Output folder hint</label><input data-pkey="output_folder_hint" value="' + esc(p.output_folder_hint || "") + '" placeholder="tests/">';
      ST.set.prefs = Object.assign({}, p);
      $$("[data-pkey]", card).forEach((el) => { el.oninput = el.onchange = function () { ST.set.prefs[el.dataset.pkey] = el.value; markSetDirty(); }; });
      function chipGroup(box, key) {
        $$(".as-chip", box).forEach((b) => { b.onclick = function () { const arr = ST.set.prefs[key] || (ST.set.prefs[key] = []); const i = arr.indexOf(b.dataset.id); if (i >= 0) arr.splice(i, 1); else arr.push(b.dataset.id); b.classList.toggle("on", arr.indexOf(b.dataset.id) >= 0); markSetDirty(); }; });
      }
      chipGroup($("#asPrefTypes", card), "default_types");
      chipGroup($("#asPrefFws", card), "default_frameworks");
    }).catch(function (e) { $("#asPrefBody", card).innerHTML = '<div class="error">' + esc(e.message) + "</div>"; });
  }
  async function refreshCounts(ids) {
    try {
      const q = ids && ids.length ? ("?ids=" + encodeURIComponent(ids.join(","))) : "";
      const j = await api("/api/automation/counts" + q);
      Object.assign(ST.counts, j.counts || {});
      $$(".as-sc[data-tc]").forEach((el) => {
        const n = ST.counts[el.dataset.tc] || 0;
        el.textContent = "Scripts (" + n + ")";
        el.classList.toggle("zero", !n);
      });
    } catch (e) {}
  }
  function badgeHtml(tcId) {
    if (!tcId) return "";
    const n = ST.counts[tcId] || 0;
    return '<a class="as-sc' + (n ? "" : " zero") + '" data-tc="' + esc(tcId) + '" title="Open scripts linked to ' + esc(tcId) + '">Scripts (' + n + ")</a>";
  }
  function asHookReview() {
    const row = $(".rv-actions");
    if (row && !$("#asRevBtn", row)) {
      const b = document.createElement("button");
      b.className = "btn g"; b.id = "asRevBtn"; b.textContent = "Generate Automation Script";
      const after = $("#aiRev", row);
      if (after && after.nextSibling) row.insertBefore(b, after.nextSibling); else row.appendChild(b);
      b.onclick = function () {
        const all = (typeof S !== "undefined" && S.cases) || [];
        const sel = (typeof RV !== "undefined" && RV.sel && RV.sel.size) ? all.filter((t) => RV.sel.has(t._k)) : all;
        asOpenGenerate(sel.length ? sel : all);
      };
    }
    const bulk = $("#rvBulk .bulk");
    if (bulk && !$("#asRevBulk", bulk)) {
      const b = document.createElement("button");
      b.className = "btn sm"; b.id = "asRevBulk";
      b.style.cssText = "background:#fff;color:#1e3a8a;border-color:#fff";
      b.textContent = "Generate Automation Script";
      const del = $("[data-b=delete]", bulk);
      if (del) bulk.insertBefore(b, del); else bulk.appendChild(b);
      b.onclick = function () {
        const all = (typeof S !== "undefined" && S.cases) || [];
        asOpenGenerate(all.filter((t) => RV.sel.has(t._k)));
      };
    }
    $$(".tc").forEach((card) => {
      if (card.querySelector(".as-sc")) return;
      const t = ((typeof S !== "undefined" && S.cases) || []).find((x) => String(x._k) === card.dataset.k);
      if (!t) return;
      const title = card.querySelector(".tc-title") || card.querySelector(".tc-meta") || card.querySelector(".tc-h");
      if (title) title.insertAdjacentHTML("beforeend", badgeHtml(t.id));
    });
    $$(".as-sc[data-tc]").forEach((el) => { el.onclick = function (e) { e.preventDefault(); e.stopPropagation(); go("scripts?tc=" + encodeURIComponent(el.dataset.tc)); }; });
    const ids = ((typeof S !== "undefined" && S.cases) || []).map((t) => t.id).filter(Boolean);
    if (ids.length) refreshCounts(ids);
  }
  function asHookRepo() {
    const bulk = $("#trBulk .fl") || $("#trBulk");
    if (bulk && !$("#asRepoBulk")) {
      const b = document.createElement("button");
      b.className = "btn g sm"; b.id = "asRepoBulk"; b.textContent = "Generate Automation Script";
      const after = $("#trBReview", bulk);
      if (after && after.nextSibling) bulk.insertBefore(b, after.nextSibling); else if (bulk) bulk.appendChild(b);
      b.onclick = async function () {
        const ids = (typeof RP !== "undefined" && RP.sel) ? [...RP.sel] : [];
        asOpenGenerate(await resolveCases(ids));
      };
    }
    const table = $("#trRepoT");
    if (table && !table.dataset.asCol) {
      table.dataset.asCol = "1";
      const head = table.querySelector("tr");
      if (head && !head.querySelector(".as-th")) {
        const th = document.createElement("th"); th.className = "as-th"; th.textContent = "Scripts";
        const src = head.children[6] || head.lastElementChild;
        head.insertBefore(th, src ? src.nextSibling : null);
      }
      $$("#trRepoT tr.clk").forEach((tr) => {
        if (tr.querySelector(".as-sc") || tr.querySelector(".as-td")) return;
        const id = tr.dataset.id;
        const td = document.createElement("td"); td.className = "as-td";
        td.innerHTML = badgeHtml(id) + ' <button type="button" class="ib" data-asrow="' + esc(id) + '" title="More">...</button>';
        const src = tr.children[6] || tr.lastElementChild;
        tr.insertBefore(td, src ? src.nextSibling : null);
      });
      $$("[data-asrow]").forEach((b) => {
        b.onclick = function (e) {
          e.stopPropagation(); closeFm();
          const r = b.getBoundingClientRect();
          const menu = document.createElement("div");
          menu.id = "asFm"; menu.className = "as-fm";
          menu.style.cssText = "position:fixed;top:" + (r.bottom + 4) + "px;left:" + Math.max(8, r.right - 220) + "px;z-index:30";
          menu.innerHTML = '<div data-a="gen">Generate Automation Script</div><div data-a="open">Open scripts</div>';
          document.body.appendChild(menu);
          $$("div[data-a]", menu).forEach((x) => {
            x.onclick = async function () {
              const a = x.dataset.a; closeFm();
              if (a === "gen") asOpenGenerate(await resolveCases([b.dataset.asrow]));
              else go("scripts?tc=" + encodeURIComponent(b.dataset.asrow));
            };
          });
        };
      });
      $$(".as-sc[data-tc]").forEach((el) => { el.onclick = function (e) { e.preventDefault(); e.stopPropagation(); go("scripts?tc=" + encodeURIComponent(el.dataset.tc)); }; });
      const ids = $$("#trRepoT tr.clk").map((tr) => tr.dataset.id).filter(Boolean);
      if (ids.length) refreshCounts(ids);
    }
  }
  const mo = new MutationObserver(function () {
    if ($(".rv-actions") || $("#rvBulk")) asHookReview();
    if ($("#trRepoT") || $("#trBulk")) asHookRepo();
  });
  if (document.getElementById("view")) mo.observe(document.getElementById("view"), { childList: true, subtree: true });

  window.viewScripts = viewScripts;
  window.asOpenGenerate = asOpenGenerate;
  window.asReviewBadge = badgeHtml;
  window.asHookReview = asHookReview;
  window.asHookRepo = asHookRepo;
  window.asRenderScriptOptions = asRenderScriptOptions;
  window.asScriptOptionsDirty = asScriptOptionsDirty;
  window.asSaveScriptOptions = asSaveScriptOptions;
  window.asRenderPrefsCard = asRenderPrefsCard;
  window.asRefreshCounts = refreshCounts;
})();
