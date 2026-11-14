/* Test data generator, Edge value library, Boost coverage, Gherkin export, provider badge.
   Additive Review / Settings hooks. Existing Save / Excel / qTest flows stay intact. */
(function () {
  const PROVIDERS = [
    ["gemini", "Gemini"], ["grok", "Grok"], ["groq", "Groq"], ["claude", "Claude"],
    ["openai", "OpenAI"], ["codex", "Codex (OpenAI)"], ["ollama", "Ollama (local)"],
  ];
  const TYPES = ["Positive", "Negative", "Boundary", "Security"];
  window._prefs = window._prefs || {};

  function prettyProvider(id) {
    const map = { gemini: "Gemini", grok: "Grok", groq: "Groq", claude: "Claude", openai: "OpenAI",
      codex: "Codex", ollama: "Ollama", none: "Docs search only" };
    return map[String(id || "").toLowerCase()] || (id ? String(id) : "");
  }
  function defaultProvider() {
    try {
      if (window._prefs && _prefs.default_provider) return String(_prefs.default_provider).toLowerCase();
      const p = JSON.parse(localStorage.getItem("atg.prefs.defaultProvider") || '""');
      if (p) return String(p).toLowerCase();
    } catch (e) { /* ignore */ }
    return "gemini";
  }
  function resolvedRunProvider() {
    try {
      if (typeof S !== "undefined" && S && S.run && S.run.model) return String(S.run.model).toLowerCase();
    } catch (e) { /* ignore */ }
    return defaultProvider();
  }
  function resolvedRunModelName() {
    try {
      if (typeof S !== "undefined" && S && S.run && S.run.model_name) return S.run.model_name;
    } catch (e) { /* ignore */ }
    return "";
  }
  function runHasProvider() {
    try { return !!(S && S.run && S.run.model); } catch (e) { return false; }
  }
  window.prettyProvider = prettyProvider;
  window.defaultProvider = defaultProvider;
  window.resolvedRunProvider = resolvedRunProvider;
  window.resolvedRunModelName = resolvedRunModelName;

  async function loadPrefs() {
    try {
      const j = await api("/api/settings/prefs");
      window._prefs = j.prefs || {};
      if (_prefs.default_provider) {
        try { localStorage.setItem("atg.prefs.defaultProvider", JSON.stringify(_prefs.default_provider)); } catch (e) { /* ignore */ }
      }
      return _prefs;
    } catch (e) { return window._prefs || {}; }
  }
  window.tdLoadPrefs = loadPrefs;
  loadPrefs();

  function formatTD(td) {
    if (!td) return "";
    if (typeof td === "string") return td;
    const parts = [];
    [["Valid", "valid"], ["Invalid", "invalid"], ["Boundary", "boundary"]].forEach(([lab, k]) => {
      const col = td[k] || [];
      if (col[0] && (col[0].v || col[0])) parts.push(lab + ": " + (col[0].v || col[0]));
    });
    return parts.join(" · ");
  }
  function firstSrc(td) {
    if (!td || typeof td !== "object") return "";
    for (const k of ["valid", "invalid", "boundary"]) {
      const it = (td[k] || [])[0];
      if (it && it.src) return it.src === "lib" || it.src === "library" ? "lib" : (it.src === "ai" ? "ai" : "");
    }
    return "";
  }
  function coverageType(tc) {
    const t = tc && tc.type;
    if (t === "Edge") return "Boundary";
    if (TYPES.indexOf(t) >= 0) return t;
    const blob = ((tc && (tc.name || "")) + " " + ((tc && tc.description) || "")).toLowerCase();
    if (/(sql\s*injection|sqli|xss|lockout|brute)/.test(blob)) return "Security";
    if (/(boundary|edge|minimum|maximum|limit|exactly)/.test(blob)) return "Boundary";
    if (/(invalid|reject|error|empty|mismatch|unregistered|fail)/.test(blob)) return "Negative";
    return "Positive";
  }
  function counts(list) {
    const c = { Positive: 0, Negative: 0, Boundary: 0, Security: 0 };
    (list || []).forEach((t) => { const k = coverageType(t); c[k] = (c[k] || 0) + 1; });
    return c;
  }

  // ------------------------------------------------------------------ Review injection
  function providerBadge() {
    const has = runHasProvider();
    const p = prettyProvider(resolvedRunProvider());
    const mn = resolvedRunModelName();
    if (has) {
      return `<span class="td-prov" id="tdProv" title="Provider used for Generate, kept for this run">Provider: ${esc(p)}${mn ? " · " + esc(mn) : ""}</span>`;
    }
    return `<span class="td-prov warn" id="tdProv" title="This run has no saved provider (Repo or Excel). Settings default is used.">No saved provider · Settings default: ${esc(p)}${mn ? " · " + esc(mn) : ""} <a href="#settings" data-td="prefs" style="color:inherit;margin-left:4px">Change default…</a></span>`;
  }
  function chipsHtml() {
    const c = counts((typeof S !== "undefined" && S.cases) || []);
    return `<div class="td-chips" id="tdChips">${TYPES.map((k) => `<span class="td-chip"><span class="td-type ${k}">${k}</span><b>${c[k] || 0}</b></span>`).join("")}</div>`;
  }
  function injectToolbar() {
    const acts = $("#rvToolbar") ? $(".rv-actions") : $(".rv-actions");
    if (!acts || $("#tdGenAll")) return;
    const ai = $("#aiRev");
    if (ai && !ai.closest(".td-split")) {
      const wrap = document.createElement("span");
      wrap.className = "td-split";
      ai.parentNode.insertBefore(wrap, ai);
      wrap.appendChild(ai);
      wrap.insertAdjacentHTML("beforeend", `<button class="btn g caret" id="aiRevMenu" title="Choose a provider for this AI Review only">▾</button>`);
    }
    const dl = $("#dlExcel") || acts.lastElementChild;
    const html = `<button class="btn g" id="tdGenAll" title="Generate Valid / Invalid / Boundary values for Review steps">Generate test data</button>` +
      `<button class="btn g" id="tdBoost" title="Suggest missing Negative, Boundary and Security cases (Edge library, no AI)">Boost coverage</button>`;
    if (dl) dl.insertAdjacentHTML("beforebegin", html);
    else acts.insertAdjacentHTML("beforeend", html);
  }
  function injectHeader() {
    const sub = $("#rvSub");
    if (sub && !$("#tdProv")) {
      sub.insertAdjacentHTML("afterend", `<div style="margin:6px 0 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center">${providerBadge()}</div>`);
    }
    const unsaved = $("#unsavedBar");
    const host = unsaved ? unsaved : $("#rvToolbar");
    if (host && !$("#tdChips")) host.insertAdjacentHTML("beforebegin", chipsHtml());
    else if ($("#tdChips")) $("#tdChips").outerHTML = chipsHtml();
  }
  function bindToolbar() {
    const gen = $("#tdGenAll");
    if (gen) gen.onclick = () => openTestdataPanel(null);
    const boost = $("#tdBoost");
    if (boost) boost.onclick = () => openBoost();
    const menu = $("#aiRevMenu");
    if (menu) menu.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      openOverrideMenu(menu, async (model, model_name) => {
        const v = $("#review") || document.body;
        if (S.localDirty) await saveCases();
        $("#reviewPanel").innerHTML = `<div class="card"><div class="bar ind"><div></div></div><div class="sub" style="margin:6px 0 0">AI Reviewer is checking the test cases…</div></div>`;
        try { await api("/api/review/ai", { method: "POST", body: { model: model, model_name: model_name || undefined } }); }
        catch (err) { $("#reviewPanel").innerHTML = `<div class="error">${esc(err.message)}</div>`; throw err; }
        viewReview(document.getElementById("view") || document.body);
      });
    };
    const link = document.querySelector("[data-td=prefs]");
    if (link) link.onclick = (e) => { e.preventDefault(); go("settings"); };
  }
  function openOverrideMenu(anchor, onPick) {
    if (typeof openPop !== "function") return;
    const cur = resolvedRunProvider();
    const groups = PROVIDERS.map(([id, lab]) => {
      const models = (typeof tcEnabled === "function" ? tcEnabled(id) : []);
      const opts = models.length
        ? models.map((m) => `<div class="pi" data-model="${id}" data-model-name="${esc(m.id)}">${esc(lab)} · ${esc(m.id)}${id === cur && m.default ? " · current" : ""}</div>`).join("")
        : `<div class="pi" data-model="${id}">${lab}${id === cur ? " · current" : ""}</div>`;
      return opts;
    }).join("");
    const p = openPop(anchor, `<div class="sub" style="margin:0 0 6px;padding:0 8px">Provider and model for this call only</div>${groups}`, 280, true);
    p.addEventListener("click", (e) => {
      const d = e.target.closest("[data-model]"); if (!d) return;
      closePop(); guarded(anchor, () => onPick(d.dataset.model, d.dataset.modelName || ""));
    });
  }

  window.tdStepCell = function (s) {
    const td = s.test_data || null;
    const text = s.data || formatTD(td);
    const src = firstSrc(td);
    if (!text) {
      return `<div class="td-cell" data-f="testdata"><span class="td-empty">—</span>
        <div class="td-acts"><button class="ib" data-act="tdedit" title="Edit test data">Edit</button>
        <button class="ib" data-act="tdregen" title="Regenerate this step">↻</button>
        <button class="ib td-zap" data-act="tdlib" title="Insert from Edge value library">⚡</button></div></div>`;
    }
    return `<div class="td-cell" data-f="testdata"><div class="td-line" title="${esc(text)}">${esc(text)}${src ? `<span class="td-src ${src}">${src === "lib" ? "Library" : "AI"}</span>` : ""}</div>
      <div class="td-acts"><button class="ib" data-act="tdedit" title="Edit test data">Edit</button>
      <button class="ib" data-act="tdregen" title="Regenerate this step">↻</button>
      <button class="ib td-zap" data-act="tdlib" title="Insert from Edge value library">⚡</button></div></div>`;
  };
  window.tdTypeBadges = function (t) {
    const typ = t.type || coverageType(t);
    return `${t.added ? '<span class="td-new" title="Added by Boost coverage">NEW</span>' : ""}` +
      (typ ? `<span class="td-type ${esc(typ)}" title="Case type">${esc(typ === "Edge" ? "Boundary" : typ)}</span>` : "");
  };

  function tdInject() {
    injectToolbar();
    injectHeader();
    bindToolbar();
    if (typeof renderList === "function") { /* chips refresh after list */ }
  }
  window.tdInject = tdInject;
  const _vr = window.viewReview;
  if (typeof _vr === "function") {
    window.viewReview = function (v) {
      _vr(v);
      try { tdInject(); } catch (e) { console.warn(e); }
    };
  }
  const _rl = window.renderList;
  if (typeof _rl === "function") {
    window.renderList = function () {
      _rl();
      const el = $("#tdChips"); if (el) el.outerHTML = chipsHtml();
    };
  }

  // Intercept list clicks for test-data actions (review.js already listens on #rvList)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (!/^td/.test(act)) return;
    const card = btn.closest(".tc"); if (!card) return;
    const t = (S.cases || []).find((x) => String(x._k) === card.dataset.k);
    if (!t) return;
    const sr = btn.closest(".sr");
    const si = sr ? +sr.dataset.s : -1;
    e.preventDefault(); e.stopPropagation();
    if (act === "tdlib") return openPicker(btn, t, si);
    if (act === "tdedit") return openEdit(btn, t, si);
    if (act === "tdregen") return openTestdataPanel(t);
    if (act === "tdgenone") return openTestdataPanel(t);
  }, true);

  // ------------------------------------------------------------------ Test data panel
  function overlay(html, id) {
    closeOverlay();
    const el = document.createElement("div");
    el.className = "td-modal";
    el.id = id || "tdModal";
    el.innerHTML = html;
    el.addEventListener("click", (e) => { if (e.target === el) closeOverlay(); });
    document.body.appendChild(el);
    return el;
  }
  function closeOverlay() { const el = $(".td-modal"); if (el) el.remove(); closePicker(); }
  window.tdClose = closeOverlay;

  async function openTestdataPanel(one) {
    if (S.localDirty) { try { await saveCases(); } catch (e) { /* keep going */ } }
    const body = { test_cases: one ? [one] : S.cases, source: "both" };
    if (one) body.case_id = one.id;
    let data;
    try { data = await api("/api/review/testdata", { method: "POST", body: body }); }
    catch (e) { toast(e.message, true); return; }
    const fields = data.fields || [];
    const srcState = {};
    fields.forEach((f) => { srcState[f.key] = f.source || "both"; });
    const box = overlay(`<div class="td-box"><div class="td-hd"><div><h2>Generate test data</h2>
      <div class="sub" style="margin:4px 0 0">${one ? "For " + esc(one.id) : "All test cases in this run"} · values can come from a heuristic (AI-style) sample, the Edge value library, or both. The library works offline.</div></div>
      <button class="btn g sm" data-td="x">✕</button></div>
      <div class="td-bd" id="tdFields"></div>
      <div class="td-ft"><span class="sub" style="margin:0">Accept writes the Test Data column. You can edit or insert library values after.</span>
      <span class="sub" style="margin:0;margin-right:auto">No AI call · 0 tokens</span><span><button class="btn g" data-td="x">Cancel</button> <button class="btn" id="tdAccept">Accept &amp; insert</button></span></div></div>`);
    box.querySelector("[data-td=x]").onclick = closeOverlay;
    box.querySelectorAll("[data-td=x]").forEach((b) => (b.onclick = closeOverlay));
    const render = () => {
      $("#tdFields").innerHTML = fields.map((f) => {
        const src = srcState[f.key] || "both";
        const vals = f.values || {};
        const matched = (f.matched || []).join(", ") || "—";
        return `<div class="td-field" data-fk="${esc(f.key)}"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div><h3>${esc(f.label || f.key)}</h3><div class="sub" style="margin:0">${esc(f.rule || "")}${src !== "ai" ? " · matched: " + esc(matched) : ""}</div></div>
          <div class="td-srcseg">${[["ai", "AI"], ["library", "Edge library"], ["both", "Both"]].map(([k, l]) =>
            `<button type="button" class="${src === k ? "a" : ""}" data-src="${k}" data-fk="${esc(f.key)}">${l}</button>`).join("")}</div></div>
          <div class="td-cols">${["valid", "invalid", "boundary"].map((k) =>
            `<div class="td-col"><div class="k">${k}</div>${(vals[k] || []).map((it) =>
              `<div class="td-val">${esc(it.v || "")}${it.src === "lib" ? '<span class="td-src lib">Library</span>' : (it.src === "ai" ? '<span class="td-src ai">AI</span>' : "")}${it.testing_only ? ' <span class="td-to">testing only</span>' : ""}</div>`
            ).join("") || '<div class="td-empty">—</div>'}</div>`).join("")}</div></div>`;
      }).join("") || `<div class="sub">No input fields could be inferred from the steps.</div>`;
    };
    render();
    $("#tdFields").onclick = async (e) => {
      const b = e.target.closest("[data-src]"); if (!b) return;
      srcState[b.dataset.fk] = b.dataset.src;
      const body2 = { test_cases: one ? [one] : S.cases, source: "both", sources: srcState };
      if (one) body2.case_id = one.id;
      try {
        const j = await api("/api/review/testdata", { method: "POST", body: body2 });
        (j.fields || []).forEach((f) => {
          const i = fields.findIndex((x) => x.key === f.key);
          if (i >= 0) fields[i] = f; else fields.push(f);
        });
        data = j;
        render();
      } catch (err) { toast(err.message, true); }
    };
    $("#tdAccept").onclick = () => guarded($("#tdAccept"), async () => {
      const proposed = data.test_cases || [];
      const byId = {};
      proposed.forEach((c) => { byId[c.id] = c; });
      (one ? [one] : S.cases).forEach((t) => {
        const p = byId[t.id]; if (!p) return;
        (t.steps || []).forEach((s, i) => {
          const ps = (p.steps || [])[i];
          if (!ps) return;
          if (ps.test_data) { s.test_data = ps.test_data; s.data = ps.data || formatTD(ps.test_data); }
        });
      });
      markDirty();
      await saveCases();
      closeOverlay();
      toast("Test data inserted");
      if (typeof renderList === "function") renderList();
    });
  }

  function openEdit(anchor, t, si) {
    const s = (t.steps || [])[si]; if (!s) return;
    const td = s.test_data || { valid: [], invalid: [], boundary: [] };
    const val = (k) => ((td[k] || []).map((x) => x.v || x).join("\n"));
    const p = (typeof openPop === "function")
      ? openPop(anchor, `<div class="sub" style="margin:0 0 6px">Edit test data for step ${si + 1}</div>
        ${["valid", "invalid", "boundary"].map((k) => `<label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin:6px 0 2px">${k}</label><textarea data-k="${k}" rows="2" style="width:260px">${esc(val(k))}</textarea>`).join("")}
        <div style="margin-top:8px;text-align:right"><button class="btn g sm" data-x="1">Cancel</button> <button class="btn sm" id="tdEditGo">Save</button></div>`, 300, true)
      : null;
    if (!p) return;
    p.querySelector("[data-x]").onclick = () => closePop();
    p.querySelector("#tdEditGo").onclick = () => {
      const next = { valid: [], invalid: [], boundary: [] };
      p.querySelectorAll("textarea[data-k]").forEach((ta) => {
        next[ta.dataset.k] = ta.value.split("\n").map((v) => v.trim()).filter(Boolean).map((v) => ({ v: v, src: "" }));
      });
      s.test_data = next;
      s.data = formatTD(next);
      markDirty();
      closePop();
      if (typeof renderList === "function") renderList();
    };
  }

  // ------------------------------------------------------------------ Edge library picker
  let LIB = null;
  async function getLib() {
    if (LIB) return LIB;
    const j = await api("/api/testdata/library");
    LIB = j.library;
    return LIB;
  }
  function closePicker() { const el = $("#tdPick"); if (el) el.remove(); }
  async function openPicker(anchor, t, si) {
    closePicker();
    let lib;
    try { lib = await getLib(); } catch (e) { toast(e.message, true); return; }
    if (!lib.enabled) { toast("Edge value library is turned off in Settings → Preferences."); return; }
    const box = document.createElement("div");
    box.className = "td-pick";
    box.id = "tdPick";
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 660));
    const top = Math.min(r.bottom + 6, window.innerHeight - 80);
    box.style.left = left + "px";
    box.style.top = top + "px";
    const cats = (lib.categories || []).filter((c) => c.enabled);
    box.innerHTML = `<input type="search" id="tdPq" placeholder="Search values…">
      <div class="td-pick-grid" id="tdPg"></div>
      <div class="sub" style="margin:6px 0 0">Security payloads are for testing only. Built-in catalog (Bug Magnet-style, our own values).</div>`;
    const draw = () => {
      const q = ($("#tdPq", box).value || "").toLowerCase();
      $("#tdPg", box).innerHTML = cats.map((c) => {
        const items = (c.items || []).filter((it) => !q || (it.v || "").toLowerCase().includes(q) || (it.lab || "").toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q));
        if (!items.length) return "";
        return `<div><div class="td-pcat">${esc(c.name)}${c.testing_only ? ' <span class="td-to">testing only</span>' : ""}</div>${items.map((it) =>
          `<button type="button" class="td-pi" data-v="${esc(it.v)}" data-kind="${esc(it.kind || "")}">${esc(it.lab || it.v || "(empty)")}${it.testing_only || c.testing_only ? ' <span class="td-to">testing only</span>' : ""}</button>`
        ).join("")}</div>`;
      }).join("") || `<div class="sub">No matching values.</div>`;
    };
    document.body.appendChild(box);
    draw();
    $("#tdPq", box).oninput = draw;
    box.onclick = (e) => {
      const b = e.target.closest("[data-v]"); if (!b) return;
      const s = (t.steps || [])[si]; if (!s) return;
      const kind = b.dataset.kind || "boundary";
      const key = kind === "invalid" ? "invalid" : (kind === "valid" ? "valid" : "boundary");
      const td = s.test_data && typeof s.test_data === "object" ? s.test_data : { valid: [], invalid: [], boundary: [] };
      td[key] = [{ v: b.dataset.v, src: "lib" }].concat(td[key] || []).slice(0, 8);
      s.test_data = td;
      s.data = formatTD(td);
      markDirty();
      closePicker();
      if (typeof renderList === "function") renderList();
    };
    setTimeout(() => {
      const on = (ev) => { if (!box.contains(ev.target) && ev.target !== anchor) { closePicker(); document.removeEventListener("mousedown", on, true); } };
      document.addEventListener("mousedown", on, true);
    }, 0);
  }

  // ------------------------------------------------------------------ Boost coverage
  async function openBoost() {
    if (S.localDirty) { try { await saveCases(); } catch (e) { /* keep */ } }
    let j;
    try { j = await api("/api/review/boost", { method: "POST", body: { test_cases: S.cases } }); }
    catch (e) { toast(e.message, true); return; }
    const sel = new Set((j.suggestions || []).map((s) => s.id));
    const cur = j.current || {}, nxt = j.next || {}, add = j.add || {};
    const box = overlay(`<div class="td-box"><div class="td-hd"><div><h2>Boost coverage</h2>
      <div class="sub" style="margin:4px 0 0">Suggested Negative, Boundary and Security cases. Boundary and Security values come from the Edge library (offline — no extra AI call).</div></div>
      <button class="btn g sm" data-td="x">✕</button></div>
      <div class="td-bd" id="tdBoostBd"></div>
      <div class="td-ft"><span class="sub" style="margin:0" id="tdBoostSum"></span>
      <span class="sub" style="margin:0;margin-right:auto">No AI call · 0 tokens</span><span><button class="btn g" data-td="x">Cancel</button> <button class="btn" id="tdBoostGo">Add selected</button></span></div></div>`);
    box.querySelectorAll("[data-td=x]").forEach((b) => (b.onclick = closeOverlay));
    const render = () => {
      const n = sel.size;
      $("#tdBoostSum").textContent = n ? `${n} selected` : "None selected";
      $("#tdBoostGo").textContent = n ? `Add selected (${n})` : "Add selected";
      $("#tdBoostGo").disabled = !n;
      const chip = (k) => `<span class="td-chip"><span class="td-type ${k}">${k}</span><b>${cur[k] || 0}</b>${add[k] ? `<span class="up">→ ${nxt[k] || 0}</span>` : ""}</span>`;
      $("#tdBoostBd").innerHTML = `<div class="td-chips">${TYPES.map(chip).join("")}<span class="sub" style="margin:0">Edge library · offline</span></div>` +
        (j.groups || []).map((g) => `<div style="margin:14px 0 6px"><b>${esc(g.title)}</b>${g.type !== "Negative" ? ' <span class="sub" style="margin:0 0 0 6px">values from Edge library</span>' : ""}</div>` +
          (g.items || []).map((it) => `<div class="td-item"><label><input type="checkbox" data-id="${esc(it.id)}" ${sel.has(it.id) ? "checked" : ""}>
            <span><b>${esc(it.name)}</b> <span class="td-type ${esc(it.type)}">${esc(it.type)}</span> <span class="sub">${esc(it.priority || "")}</span>
            <div class="td-why">${esc(it.why || "")}</div></span></label></div>`).join("")
        ).join("");
    };
    render();
    $("#tdBoostBd").onchange = (e) => {
      const cb = e.target.closest("[data-id]"); if (!cb) return;
      if (cb.checked) sel.add(cb.dataset.id); else sel.delete(cb.dataset.id);
      render();
    };
    $("#tdBoostGo").onclick = () => guarded($("#tdBoostGo"), async () => {
      const r = await api("/api/review/boost", { method: "POST", body: { confirm: true, ids: [...sel], test_cases: S.cases } });
      (r.test_cases || []).forEach((c) => { c.added = true; S.cases.push(typeof normCase === "function" ? normCase(c) : c); });
      if (typeof renumber === "function") renumber();
      markDirty();
      await saveCases();
      closeOverlay();
      toast(`Added ${r.count || 0} test case${(r.count || 0) === 1 ? "" : "s"}`);
      if (typeof renderList === "function") renderList();
    });
  }

  // ------------------------------------------------------------------ Gherkin export UI (rt.js hook)
  window.tdGherkinPreview = async function (opts) {
    opts = opts || {};
    const q = new URLSearchParams({
      fmt: "feature",
      outline: opts.outline ? "1" : "0",
      tags: opts.tags === false ? "0" : "1",
      background: opts.background === false ? "0" : "1",
    });
    if (opts.stories) q.set("stories", opts.stories);
    if (opts.item) q.set("item", opts.item);
    const url = "/api/export?" + q.toString();
    let text = "", fname = "tests.feature", zip = false;
    try {
      const r = await fetch(url, { credentials: "same-origin" });
      if (!r.ok) {
        let msg = "Export failed";
        try { const j = await r.json(); msg = j.error || msg; } catch (e) { /* ignore */ }
        throw new Error(msg);
      }
      const dispo = r.headers.get("Content-Disposition") || "";
      const m = /filename="([^"]+)"/.exec(dispo);
      if (m) fname = m[1];
      zip = (r.headers.get("Content-Type") || "").indexOf("zip") >= 0 || /\.zip$/i.test(fname);
      if (zip) {
        const blob = await r.blob();
        closeOverlay();
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fname;
        document.body.appendChild(a); a.click(); a.remove();
        toast("Downloaded " + fname);
        return;
      }
      text = await r.text();
    } catch (e) { toast(e.message, true); return; }
    const hl = (s) => esc(s).replace(/(@[A-Za-z0-9_-]+)/g, '<span class="tg">$1</span>')
      .replace(/\b(Feature|Background|Scenario Outline|Scenario|Examples|Given|When|Then|And):/g, '<span class="kw">$1:</span>')
      .replace(/\b(Given|When|Then|And) /g, '<span class="kw">$1</span> ');
    overlay(`<div class="td-box"><div class="td-hd"><div><h2>Export Gherkin</h2>
      <div class="sub" style="margin:4px 0 0">${esc(fname)} · Scenario${opts.outline ? " Outline + Examples" : "s"} from the current run.</div></div>
      <button class="btn g sm" data-td="x">✕</button></div>
      <div class="td-bd"><pre class="td-gh">${hl(text)}</pre></div>
      <div class="td-ft"><span class="sub" style="margin:0">Tags include @jira-{story} and @negative / @boundary / @security when present.</span>
      <span><button class="btn g" data-td="x">Close</button>
      <button class="btn g" id="tdGhOutline">${opts.outline ? "Show scenarios" : "Scenario Outline + Examples"}</button>
      <button class="btn g" id="tdGhCopy">Copy</button>
      <button class="btn" id="tdGhDl">Download .feature</button></span></div></div>`);
    document.querySelectorAll("#tdModal [data-td=x], .td-modal [data-td=x]").forEach((b) => (b.onclick = closeOverlay));
    const outBtn = document.getElementById("tdGhOutline");
    if (outBtn) outBtn.onclick = () => { closeOverlay(); tdGherkinPreview(Object.assign({}, opts, { outline: !opts.outline })); };
    $("#tdGhCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(text); toast("Copied"); }
      catch (e) { toast("Could not copy", true); }
    };
    $("#tdGhDl").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    };
  };

  // ------------------------------------------------------------------ Settings → Preferences
  window.testdataRenderSettings = function (pane) {
    if (!pane || $("#tdPrefCard")) return;
    const opts = PROVIDERS.map(([id, lab]) => `<option value="${id}">${lab}</option>`).join("");
    pane.insertAdjacentHTML("beforeend", `<div class="card" id="tdPrefCard" style="margin-top:14px"><h3>Default provider</h3>
      <label for="tdDefProv">Used when a run has no saved provider (Repo or Excel open)</label>
      <div class="row" style="align-items:center;gap:10px"><select id="tdDefProv" style="width:220px;flex:none">${opts}</select>
      <button type="button" class="btn" id="tdSaveProv" style="flex:none">Save default</button>
      <span class="sub" id="tdProvHint" style="margin:0;flex:none"></span></div>
      <div class="sub" style="margin:8px 0 0">Generate still stores the provider you pick on that run. Regenerate and AI Review use the run provider, or this default when the run has none. You can override a single call from the Review menu.</div></div>
      <div class="card" id="tdLibCard" style="margin-top:14px"><h3>⚡ Edge value library</h3>
        <label class="sw" style="margin:0 0 8px;text-transform:none;font-size:13px;color:#1e2433;font-weight:400"><input type="checkbox" id="tdLibOn"><span class="t"></span> Enable built-in edge values (works offline, no AI)</label>
        <div class="td-cats" id="tdLibCats"></div>
        <div class="row" style="align-items:center;gap:8px;margin-top:8px">
          <input id="tdLibCustom" placeholder="Add a custom value…" style="flex:1">
          <button type="button" class="btn g" id="tdLibAdd" style="flex:none">Add</button>
        </div>
        <div id="tdLibCustomList" class="sub" style="margin:8px 0 0"></div>
        <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
          <button type="button" class="btn g sm" id="tdLibExport">Export JSON</button>
          <button type="button" class="btn g sm" id="tdLibImport">Import JSON</button>
          <input type="file" id="tdLibFile" accept="application/json" hidden>
          <button type="button" class="btn g sm" id="tdLibReset">Reset to built-in</button>
          <button type="button" class="btn sm" id="tdLibSave">Save library</button>
        </div>
        <div class="sub" style="margin:8px 0 0">Bug Magnet-style catalog with our own values (not a copy of Bug Magnet’s exact list). Security payloads are for testing only.</div>
      </div>`);
    const apply = (prefs) => {
      const p = (prefs && prefs.default_provider) || defaultProvider();
      const sel = $("#tdDefProv"); if (sel) sel.value = p;
      const hint = $("#tdProvHint"); if (hint) hint.textContent = "Current: " + prettyProvider(p);
      const lib = (prefs && prefs.edge_library) || { enabled: true, disabled: [], custom: [] };
      const on = $("#tdLibOn"); if (on) on.checked = lib.enabled !== false;
      drawCats(lib);
    };
    const drawCats = (lib) => {
      const disabled = new Set(lib.disabled || []);
      const host = $("#tdLibCats"); if (!host) return;
      const cats = (window._tdLibCats || []);
      host.innerHTML = cats.map((c) => `<label class="td-catrow"><span><input type="checkbox" data-cat="${esc(c.id)}" ${disabled.has(c.id) ? "" : "checked"}> ${esc(c.name)}${c.testing_only ? ' <span class="td-to">testing only</span>' : ""}</span><span class="n">${c.count || 0}</span></label>`).join("") || `<div class="sub">Loading categories…</div>`;
      const cl = $("#tdLibCustomList");
      const custom = lib.custom || [];
      if (cl) cl.innerHTML = custom.length ? custom.map((x, i) => `<div>${esc(x.value || x.v || "")} <button type="button" class="ib" data-cdel="${i}">×</button></div>`).join("") : "No custom values yet.";
    };
    const collectLib = () => {
      const disabled = [];
      $$("#tdLibCats [data-cat]").forEach((cb) => { if (!cb.checked) disabled.push(cb.dataset.cat); });
      const cur = ((_prefs.edge_library) || {});
      return { enabled: $("#tdLibOn").checked, disabled: disabled, custom: cur.custom || [], custom_categories: cur.custom_categories || [] };
    };
    api("/api/testdata/library").then((j) => {
      window._tdLibCats = (j.library && j.library.categories) || [];
      LIB = j.library;
      loadPrefs().then(apply);
    }).catch(() => loadPrefs().then(apply));
    $("#tdSaveProv").onclick = () => guarded($("#tdSaveProv"), async () => {
      const v = $("#tdDefProv").value;
      const j = await api("/api/settings/prefs", { method: "PUT", body: { default_provider: v } });
      window._prefs = j.prefs || _prefs;
      try { localStorage.setItem("atg.prefs.defaultProvider", JSON.stringify(v)); } catch (e) { /* ignore */ }
      $("#tdProvHint").textContent = "Current: " + prettyProvider(v);
      toast("Default provider saved: " + prettyProvider(v));
    });
    $("#tdLibSave").onclick = () => guarded($("#tdLibSave"), async () => {
      const edge_library = collectLib();
      const j = await api("/api/settings/prefs", { method: "PUT", body: { edge_library: edge_library } });
      window._prefs = j.prefs || _prefs;
      LIB = null;
      toast("Edge library preferences saved");
      apply(j.prefs);
    });
    $("#tdLibAdd").onclick = () => {
      const v = ($("#tdLibCustom").value || "").trim(); if (!v) return;
      _prefs.edge_library = _prefs.edge_library || { enabled: true, disabled: [], custom: [] };
      _prefs.edge_library.custom = (_prefs.edge_library.custom || []).concat([{ value: v, label: v }]);
      $("#tdLibCustom").value = "";
      drawCats(_prefs.edge_library);
    };
    $("#tdLibCustomList").onclick = (e) => {
      const b = e.target.closest("[data-cdel]"); if (!b) return;
      const i = +b.dataset.cdel;
      (_prefs.edge_library.custom || []).splice(i, 1);
      drawCats(_prefs.edge_library);
    };
    $("#tdLibExport").onclick = async () => {
      try {
        const lib = await getLib();
        const blob = new Blob([JSON.stringify({ edge_library: collectLib(), catalog_name: lib.name }, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "edge-library-prefs.json";
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { toast(e.message, true); }
    };
    $("#tdLibImport").onclick = () => $("#tdLibFile").click();
    $("#tdLibFile").onchange = async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      try {
        const raw = JSON.parse(await f.text());
        const edge = raw.edge_library || raw;
        const j = await api("/api/settings/prefs", { method: "PUT", body: { edge_library: edge } });
        window._prefs = j.prefs || _prefs;
        LIB = null;
        toast("Library preferences imported");
        apply(j.prefs);
      } catch (err) { toast(err.message || "Invalid JSON", true); }
    };
    $("#tdLibReset").onclick = () => guarded($("#tdLibReset"), async () => {
      const edge_library = { enabled: true, disabled: [], custom: [], custom_categories: [] };
      const j = await api("/api/settings/prefs", { method: "PUT", body: { edge_library: edge_library } });
      window._prefs = j.prefs || _prefs;
      LIB = null;
      toast("Edge library reset to built-in");
      apply(j.prefs);
    });
  };
})();
