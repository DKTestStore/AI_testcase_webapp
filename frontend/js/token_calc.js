/* Shared token calculator: model registry helpers, estimate chips, Calculator tab, Settings cards. */
"use strict";
(function () {
  const st = document.createElement("style");
  st.textContent = `
.tc-tabs{display:flex;gap:0;margin:0 0 14px;border-bottom:1px solid #e3e7f0}
.tc-tabs a{padding:8px 14px;font-size:13px;color:#445;text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px}
.tc-tabs a.a{border-bottom-color:#4361ee;color:#3046c4;font-weight:600}
.tc-chip{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;font-size:12.5px;color:#334;background:#f4f6ff;border:1px solid #e0e6f5;border-radius:8px;padding:6px 10px;margin-top:8px}
.tc-chip .tc-k{color:#6b7385;font-size:11px;text-transform:uppercase;letter-spacing:.02em}
.tc-chip b{font-variant-numeric:tabular-nums}
.tc-chip.warn{background:#fff7ed;border-color:#fed7aa;color:#9a3412}
.tc-chip.none{background:#f3f4f6;border-color:#e5e7eb;color:#4b5563}
.tc-tok{display:flex;flex-wrap:wrap;gap:3px;line-height:1.8;font-family:ui-monospace,Consolas,monospace;font-size:12px;max-height:280px;overflow:auto;padding:8px;background:#fafbff;border:1px solid #eef1f7;border-radius:8px}
.tc-tok i{font-style:normal;padding:1px 4px;border-radius:4px;white-space:pre-wrap;display:inline-flex;align-items:center;gap:3px}
.tc-tok i .n{font-size:9px;opacity:.7;margin-right:2px}
.tc-tok i .tid{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:14px;padding:0 3px;border-radius:3px;background:#1e293b;color:#fff;font-size:9px;font-weight:700;line-height:14px;opacity:1;margin-right:2px}
.tc-cmp{width:100%;border-collapse:collapse;font-size:12.5px}
.tc-cmp th,.tc-cmp td{padding:6px 8px;border-bottom:1px solid #eef1f7;text-align:left}
.tc-cmp th{font-size:11px;color:#6b7385;background:#f7f9fc}
.tc-cmp .over{color:#b91c1c;font-weight:600}
.tc-cmp .ok{color:#15803d}
.tc-grp{background:#f7f9fc;font-weight:600}
.tc-over{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13px}
.tc-reg .prov{border:1px solid #e3e7f0;border-radius:8px;margin:0 0 8px}
.tc-reg .hd{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;background:#f7f9fc}
.tc-reg table{width:100%;border-collapse:collapse;font-size:12.5px}
.tc-reg td,.tc-reg th{padding:4px 6px;border-bottom:1px solid #eef1f7}
.tc-reg input[type=text],.tc-reg input[type=number]{width:100%;padding:4px 6px;border:1px solid #d5dbe8;border-radius:6px;font-size:12.5px}
.tc-lim table{width:100%;border-collapse:collapse;font-size:13px}
.tc-lim th,.tc-lim td{padding:6px 8px;border-bottom:1px solid #eef1f7;text-align:left}
.tc-lim input{width:140px;padding:6px 8px;border:1px solid #d5dbe8;border-radius:6px}
.db-tl-banner{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:10px 14px;margin:0 0 14px;font-size:13px}
.db-tl-banner a{color:#9a3412;font-weight:600}
.db-tl-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 14px}
.db-tl-cards .card{margin:0}
.db-tl-bar{display:flex;height:14px;border-radius:8px;overflow:hidden;background:#e8ecf5;margin:8px 0}
.db-tl-bar i{display:block;height:100%}
`;
  document.head.appendChild(st);

  const PAL = ["#dbe4ff", "#c7f0e0", "#ffe8c2", "#fde2e2", "#e4d7ff", "#ccecff", "#f5e6c8", "#e2f0c9"];
  const TC_NVIDIA_NOTE = "NVIDIA free trial — enter rates if billed";
  const TC_SEED_MODELS = {
    nvidia: [
      { id: "nvidia/nemotron-3.5-super-vl-120b-a12b", inn: 0, out: 0, ctx: 262144, default: true, enabled: true, note: TC_NVIDIA_NOTE },
      { id: "mistralai/mistral-large-4-1t-a52b", inn: 0, out: 0, ctx: 262144, enabled: true, note: TC_NVIDIA_NOTE },
      { id: "z-ai/glm-5.3-flash", inn: 0, out: 0, ctx: 1048576, enabled: true, note: TC_NVIDIA_NOTE },
      { id: "minimaxai/minimax-m3.1-flash", inn: 0, out: 0, ctx: 262144, enabled: true, note: TC_NVIDIA_NOTE },
      { id: "nvidia/nemotron-3.5-lightning-30b-a3b", inn: 0, out: 0, ctx: 1048576, enabled: true, note: TC_NVIDIA_NOTE },
      { id: "nvidia/nemotron-3.5-bolt-e4b", inn: 0, out: 0, ctx: 65536, enabled: true, note: TC_NVIDIA_NOTE },
      { id: "openai/gpt-oss-20b", inn: 0, out: 0, ctx: 131072, enabled: true, note: TC_NVIDIA_NOTE }
    ]
  };

  async function tcPrefs(force) {
    if (!force && window._prefs && _prefs.token_registry) return _prefs;
    if (typeof window.tdLoadPrefs === "function") return await tdLoadPrefs();
    try {
      const j = await api("/api/settings/prefs");
      window._prefs = j.prefs || {};
      return _prefs;
    } catch (e) { return window._prefs || {}; }
  }
  function tcRegistry() {
    const r = (window._prefs && _prefs.token_registry) || { providers: [] };
    return r.providers || [];
  }
  function tcProvider(pid) {
    pid = String(pid || "").toLowerCase();
    return tcRegistry().find((p) => p.id === pid) || null;
  }
  function tcSeedModels(pid) {
    return TC_SEED_MODELS[String(pid || "").toLowerCase()] || [];
  }
  function tcEnabled(pid) {
    const p = tcProvider(pid);
    const models = ((p && p.models) || []).filter((m) => m && m.enabled !== false);
    if (models.length) return models;
    // Fallback only when the provider is missing or has no rows yet — not when the
    // user cleared the list (empty models + a removed list).
    if (p && Array.isArray(p.models) && (p.removed || []).length) return [];
    const seed = tcSeedModels(pid);
    return seed.filter((m) => m && m.enabled !== false);
  }
  function tcDefaultId(pid) {
    const p = tcProvider(pid);
    let models = (p && p.models) || [];
    if (!models.length && !(p && (p.removed || []).length)) models = tcSeedModels(pid);
    const star = models.find((m) => (m.default || m.star) && m.enabled !== false) || models.find((m) => m.enabled !== false);
    return star ? star.id : "";
  }
  function tcModelOpts(pid, selected, all) {
    const p = tcProvider(pid);
    let list = all ? ((p && p.models) || []) : tcEnabled(pid);
    if (all && !list.length && !(p && (p.removed || []).length)) list = tcSeedModels(pid);
    const sel = selected || tcDefaultId(pid);
    if (!list.length) return `<option value="">(Settings / env default)</option>`;
    return list.map((m) => `<option value="${esc(m.id)}" ${m.id === sel ? "selected" : ""}>${esc(m.id)}${(m.default || m.star) ? " ★" : ""}${m.enabled === false ? " (off)" : ""}</option>`).join("");
  }
  function tcSelectHtml(pid, mid, pId, mId) {
    return `<select id="${pId}"></select>`.replace("</select>", "") && "" +
      `<select id="${esc(mId)}">${tcModelOpts(pid, mid)}</select>`;
  }
  function tcMoney(n) {
    n = Number(n) || 0;
    if (!n) return "$0";
    if (n < 0.0001) return "$" + n.toFixed(6);
    if (n < 0.01) return "$" + n.toFixed(4);
    return "$" + n.toFixed(4);
  }
  async function tcEstimate(body) {
    return await api("/api/tokens/estimate", { method: "POST", body: body || {} });
  }
  function tcChipHtml(est, extra) {
    if (!est) return `<div class="tc-chip"><span>Estimating…</span></div>`;
    if (est.no_ai) return `<div class="tc-chip none"><span>No AI call · 0 tokens</span>${extra || ""}</div>`;
    const over = est.fits === false;
    return `<div class="tc-chip${over ? " warn" : ""}">
      <span><span class="tc-k">Est. in</span> <b>${fmt(est.est_input || est.tokens || 0)}</b></span>
      <span><span class="tc-k">Est. out</span> <b>${fmt(est.est_output || 0)}</b></span>
      <span><span class="tc-k">Cost</span> <b>${tcMoney(est.est_cost)}</b></span>
      <span><span class="tc-k">Fit</span> <b>${est.ctx ? (est.fit_pct + "% of " + fmt(est.ctx)) : "—"}</b></span>
      <span class="sub" style="margin:0">${esc(est.method || "estimate")}${est.example_prices ? " · example prices" : ""}</span>
      ${over ? "<span><b>Over context limit</b></span>" : ""}
      ${extra || ""}
    </div>`;
  }
  function tcPaint(el, est, extra) { if (el) el.innerHTML = tcChipHtml(est, extra); }
  function tcPieces(text, tokens) {
    const s = String(text || "");
    const n = Math.max(1, Number(tokens) || Math.max(1, Math.round(s.length / 4)));
    const size = Math.max(1, Math.ceil(s.length / n));
    const out = [];
    for (let i = 0, k = 1; i < s.length; i += size, k++) out.push({ i: k, t: s.slice(i, i + size) });
    return out;
  }
  function tcTokenHtml(text, tokens, showIds) {
    const parts = tcPieces(text, tokens);
    return `<div class="tc-tok">${parts.map((p, i) =>
      `<i style="background:${PAL[i % PAL.length]}">${showIds ? `<span class="tid">${p.i}</span>` : ""}${esc(p.t)}</i>`).join("")}</div>`;
  }
  function tcCalcHref(q) {
    const qs = q ? "?" + new URLSearchParams(q).toString() : "";
    return "#tokens/calculator" + qs;
  }

  function tcEval(v) { return typeof v === "function" ? v() : v; }
  function tcSeedCalc(seed) {
    try { sessionStorage.setItem("atg_calc_seed", JSON.stringify(seed || {})); } catch (e) {}
  }
  async function bindLiveEstimate(opts) {
    const out = typeof opts.el === "string" ? document.querySelector(opts.el) : opts.el;
    if (!out) return;
    const run = async () => {
      try {
        const provider = tcEval(opts.provider);
        const model_name = tcEval(opts.model);
        const body = { kind: opts.kind || "generate", provider, model_name,
          expected_output: opts.expected, source: tcEval(opts.source) };
        if (opts.compose) body.compose = true;
        if (opts.text !== undefined) body.text = tcEval(opts.text);
        const extra = opts.extra || {};
        Object.keys(extra).forEach((k) => {
          const v = tcEval(extra[k]);
          if (v !== undefined) body[k] = v;
        });
        ["prompt_mode", "custom_prompt", "template_ids", "run_reviewer", "instruction", "test_case", "test_cases", "feature_text"].forEach((k) => {
          if (opts[k] !== undefined && body[k] === undefined) {
            const v = tcEval(opts[k]);
            if (v !== undefined) body[k] = v;
          }
        });
        const est = await tcEstimate(body);
        const seed = { provider: provider || "", model: model_name || "", text: est.text || body.text || "" };
        const note = (est.calls > 1 ? ` · ${est.calls} calls` : "") + (est.review_included ? " + reviewer" : "");
        const link = `<a class="tc-open-calc" href="${tcCalcHref({ provider: seed.provider, model: seed.model })}" style="margin-left:auto">Open in calculator</a>`;
        tcPaint(out, est, link + (note ? `<span class="sub" style="margin:0">${esc(note.trim())}</span>` : ""));
        const a = out.querySelector(".tc-open-calc");
        if (a) a.addEventListener("click", () => tcSeedCalc(seed));
        return est;
      } catch (e) {
        out.innerHTML = `<div class="tc-chip"><span class="sub" style="margin:0">${esc(e.message || "Estimate unavailable")}</span></div>`;
      }
    };
    await run();
    return run;
  }

  // ---------- Calculator tab ----------
  async function viewTokenCalculator(host) {
    await tcPrefs();
    const providers = tcRegistry();
    const run = (typeof S !== "undefined" && S.run) || {};
    const params = new URLSearchParams(String(S.view || location.hash.slice(1)).split("?")[1] || "");
    let pid = params.get("provider") || run.model || (typeof defaultProvider === "function" ? defaultProvider() : "gemini");
    let mid = params.get("model") || run.model_name || tcDefaultId(pid);
    let seed = params.get("text") || run.feature_text || "";
    try {
      const st = JSON.parse(sessionStorage.getItem("atg_calc_seed") || "null");
      if (st) {
        if (!params.get("provider") && st.provider) pid = st.provider;
        if (!params.get("model") && st.model) mid = st.model;
        if (st.text && !params.get("text")) seed = st.text;
        sessionStorage.removeItem("atg_calc_seed");
      }
    } catch (e) {}
    host.innerHTML = `<div class="card" id="tcCalc">
      <h3>Token calculator</h3>
      <p class="sub" style="margin:0 0 10px">Counts are characters ÷ 4 (or the model’s divisor) unless tiktoken is installed for OpenAI/Codex. Provider count APIs are off by default. Prices are examples until you edit them in Settings.</p>
      <div class="tu-flt">
        <label>Provider <select id="tcProv">${providers.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? "selected" : ""}>${esc(p.name || p.id)}</option>`).join("")}</select></label>
        <label>Model <select id="tcModel">${tcModelOpts(pid, mid)}</select></label>
        <label>Expected output tokens <input id="tcOut" type="number" min="0" step="1" value="800" style="width:110px"></label>
      </div>
      <label style="display:block;margin:10px 0 4px;font-size:12px;color:#6b7385">Text to count</label>
      <textarea id="tcText" rows="8" style="width:100%;padding:8px;border:1px solid #d5dbe8;border-radius:8px;font:13px/1.45 ui-monospace,Consolas,monospace">${esc(seed)}</textarea>
      <div class="row" style="gap:8px;margin:10px 0;flex-wrap:wrap">
        <button type="button" class="btn" id="tcGo">Count &amp; estimate</button>
        <label class="sw" style="margin:0;text-transform:none;font-size:13px;font-weight:400"><input type="checkbox" id="tcIds"><span class="t"></span> Token IDs</label>
        <button type="button" class="btn g" id="tcCmp">Compare enabled models</button>
      </div>
      <div id="tcEst"></div>
      <div id="tcView" style="margin-top:10px"></div>
      <div id="tcOver"></div>
      <div id="tcCompare" style="margin-top:14px"></div>
    </div>`;
    const syncModels = () => { $("#tcModel").innerHTML = tcModelOpts($("#tcProv").value, ""); };
    $("#tcProv").onchange = syncModels;
    let lastText = seed || "", lastTok = 0;
    const paintIds = () => {
      const text = lastText || ($("#tcText") && $("#tcText").value) || "";
      if (!text) { $("#tcView").innerHTML = ""; return; }
      $("#tcView").innerHTML = tcTokenHtml(text, lastTok || Math.max(1, Math.round(text.length / 4)), $("#tcIds").checked);
    };
    const runCount = async () => {
      const provider = $("#tcProv").value, model_name = $("#tcModel").value;
      const text = $("#tcText").value, expected_output = +$("#tcOut").value || 0;
      let j;
      try { j = await tcEstimate({ kind: "generate", provider, model_name, text, expected_output }); }
      catch (e) { $("#tcEst").innerHTML = `<div class="warn">${esc(e.message)}</div>`; return; }
      lastText = text; lastTok = j.est_input || j.tokens;
      tcPaint($("#tcEst"), j);
      paintIds();
      $("#tcOver").innerHTML = j.fits === false
        ? `<div class="tc-over">This prompt + expected output is over the ${fmt(j.ctx)}-token context window (${j.fit_pct}%). Shorten the input or pick a larger-context model.</div>`
        : "";
    };
    $("#tcGo").onclick = runCount;
    $("#tcIds").onchange = paintIds;
    $("#tcText").addEventListener("change", runCount);
    $("#tcOut").addEventListener("change", runCount);
    $("#tcCmp").onclick = async () => {
      const text = $("#tcText").value, expected = +$("#tcOut").value || 0;
      const rows = [];
      for (const p of tcRegistry()) {
        const models = (p.models || []).filter((m) => m.enabled !== false);
        if (!models.length) continue;
        rows.push(`<tr class="tc-grp"><td colspan="7">${esc(p.name || p.id)}</td></tr>`);
        for (const m of models) {
          let j;
          try { j = await tcEstimate({ provider: p.id, model_name: m.id, text, expected_output: expected }); }
          catch (e) { j = { error: e.message }; }
          const over = j.fits === false;
          rows.push(`<tr class="${over ? "over" : ""}"><td>${esc(m.id)}${(m.default || m.star) ? " ★" : ""}</td>
            <td class="tu-r">${fmt(j.est_input || 0)}</td><td class="tu-r">${fmt(j.est_output || 0)}</td>
            <td class="tu-r">${tcMoney(j.est_cost)}</td><td>${j.ctx ? fmt(j.ctx) : "—"}</td>
            <td class="${over ? "over" : "ok"}">${j.ctx ? (over ? "Over limit" : "Fits " + j.fit_pct + "%") : "—"}</td>
            <td>${esc(j.method || j.error || "")}</td></tr>`);
        }
      }
      $("#tcCompare").innerHTML = `<h3>Compare enabled models</h3>
        <table class="tc-cmp"><tr><th>Model</th><th class="tu-r">Est. in</th><th class="tu-r">Est. out</th><th class="tu-r">Cost</th><th>Context</th><th>Fit</th><th>Method</th></tr>${rows.join("")}</table>
        <p class="tu-s">Example prices — edit in Settings. Grouped by provider; disabled models are hidden.</p>`;
    };
    if (seed) runCount();
  }

  // ---------- Settings cards (per-provider Models / Limits + Preferences calc prefs) ----------
  function tokenCalcPidFromGroup(name) {
    const n = String(name || "").toLowerCase();
    if (n.indexOf("gemini") >= 0) return "gemini";
    if (n.indexOf("nvidia") >= 0) return "nvidia";
    if (n.indexOf("groq") >= 0) return "groq";
    if (n.indexOf("grok") >= 0 || n.indexOf("xai") >= 0) return "grok";
    if (n.indexOf("claude") >= 0) return "claude";
    if (n.indexOf("codex") >= 0) return "codex";
    if (n.indexOf("openai") >= 0) return "openai";
    if (n.indexOf("ollama") >= 0) return "ollama";
    return n.split(/\s+/)[0];
  }
  function tokenCalcCollectProvider(el, pid) {
    const models = [];
    if (!el) return models;
    $$("tr[data-i]", el).forEach((tr) => {
      const idv = (($("[data-f=id]", tr) || {}).value || "").trim();
      if (!idv) return;
      const note = (($("[data-f=note]", tr) || {}).value || "").trim();
      models.push({
        id: idv,
        inn: +$("[data-f=inn]", tr).value || 0,
        out: +$("[data-f=out]", tr).value || 0,
        ctx: +$("[data-f=ctx]", tr).value || 0,
        default: $("[data-f=default]", tr).checked,
        enabled: $("[data-f=enabled]", tr).checked,
        ...(note ? { note: note } : {}),
      });
    });
    return models;
  }
  function tcExampleCtx(pid) {
    const seed = tcSeedModels(pid);
    const hit = seed.find((m) => Number(m && m.ctx) > 0);
    return hit ? Number(hit.ctx) : 128000;
  }
  function tokenCalcModelsSig(models) {
    return (models || []).map((m) => [
      String(m.id || ""),
      Number(m.inn) || 0,
      Number(m.out) || 0,
      Number(m.ctx) || 0,
      !!(m.default || m.star),
      m.enabled !== false,
      String(m.note || ""),
    ]);
  }
  function tokenCalcLimSig(v) {
    v = v || {};
    const t = v.daily_tokens == null ? "" : String(v.daily_tokens);
    const c = v.daily_cost == null ? "" : String(v.daily_cost);
    return [t, c];
  }
  function tokenCalcCollectAll(root) {
    root = root || (typeof $ === "function" ? $("#sbody") : null);
    const current = JSON.parse(JSON.stringify(((window._prefs && _prefs.token_registry && _prefs.token_registry.providers) || [])));
    const limits = Object.assign({}, ((window._prefs && _prefs.token_limits) || {}));
    if (!root) return { token_registry: { providers: current }, token_limits: limits };
    $$(".tc-prov-models", root).forEach((el) => {
      const pid = el.dataset.pid;
      if (!pid || !$("table", el)) return;
      const modelsNew = tokenCalcCollectProvider(el, pid);
      const i = current.findIndex((p) => p.id === pid);
      const name = (i >= 0 && current[i].name) || (tcProvider(pid) || {}).name || pid;
      const row = { id: pid, name: name, models: modelsNew };
      if (i >= 0) current[i] = { ...current[i], ...row };
      else current.push(row);
    });
    $$(".tc-prov-limits", root).forEach((el) => {
      const pid = el.dataset.pid;
      const tok = pid ? $("[data-f=daily_tokens]", el) : null;
      const cost = pid ? $("[data-f=daily_cost]", el) : null;
      if (!pid || (!tok && !cost)) return;
      limits[pid] = { daily_tokens: (tok || {}).value, daily_cost: (cost || {}).value };
    });
    return { token_registry: { providers: current }, token_limits: limits };
  }
  function tokenCalcSubmittedIds(root) {
    const out = {};
    if (!root) return out;
    $$(".tc-prov-models", root).forEach((el) => {
      const pid = el.dataset.pid;
      if (!pid || !$("table", el)) return;
      out[pid] = tokenCalcCollectProvider(el, pid).map((m) => m.id).filter(Boolean);
    });
    return out;
  }
  function tokenCalcMissingIds(prefs, submitted) {
    const missing = [];
    const providers = ((prefs && prefs.token_registry && prefs.token_registry.providers) || []);
    Object.keys(submitted || {}).forEach((pid) => {
      const saved = (providers.find((p) => p.id === pid) || {}).models || [];
      const ids = new Set(saved.map((m) => m.id));
      (submitted[pid] || []).forEach((id) => { if (!ids.has(id)) missing.push(id); });
    });
    return missing;
  }
  function tokenCalcIsDirty(root) {
    root = root || (typeof $ === "function" ? $("#sbody") : null);
    if (!root || !root.querySelector) return false;
    const prefs = window._prefs || {};
    for (const el of $$(".tc-prov-models", root)) {
      const pid = el.dataset.pid;
      if (!pid || !$("table", el)) continue;
      const draft = $$("tr[data-i]", el).some((tr) => !((($("[data-f=id]", tr) || {}).value || "").trim()));
      if (draft) return true;
      const now = tokenCalcCollectProvider(el, pid);
      const prev = (((prefs.token_registry || {}).providers || []).find((p) => p.id === pid) || {}).models || [];
      if (JSON.stringify(tokenCalcModelsSig(now)) !== JSON.stringify(tokenCalcModelsSig(prev))) return true;
    }
    for (const el of $$(".tc-prov-limits", root)) {
      const pid = el.dataset.pid;
      const tok = pid ? $("[data-f=daily_tokens]", el) : null;
      const cost = pid ? $("[data-f=daily_cost]", el) : null;
      if (!pid || (!tok && !cost)) continue;
      const now = { daily_tokens: (tok || {}).value, daily_cost: (cost || {}).value };
      const prev = (prefs.token_limits || {})[pid] || {};
      if (JSON.stringify(tokenCalcLimSig(now)) !== JSON.stringify(tokenCalcLimSig(prev))) return true;
    }
    return false;
  }
  async function tokenCalcSaveRegistry(root) {
    root = root || (typeof $ === "function" ? $("#sbody") : null);
    if (!root || !root.querySelector || !root.querySelector(".tc-prov-models table")) return null;
    const submitted = tokenCalcSubmittedIds(root);
    const body = tokenCalcCollectAll(root);
    const j = await api("/api/settings/prefs", { method: "PUT", body: body });
    window._prefs = j.prefs || _prefs;
    tokenCalcRenderAllProviders(root, window._prefs || {});
    const missing = tokenCalcMissingIds(window._prefs, submitted);
    if (missing.length) throw new Error("These model IDs were not saved: " + missing.join(", "));
    return j;
  }
  function tokenCalcTouchDirty() {
    if (typeof setUpdateDirty === "function") setUpdateDirty();
  }
  function tokenCalcModelRow(pid, m, i) {
    m = m || {};
    const note = m.note || "";
    return `<tr data-p="${esc(pid)}" data-i="${i}">
      <td><input type="text" data-f="id" value="${esc(m.id || "")}" placeholder="model-id">${note ? `<div class="sub" style="margin:4px 0 0">${esc(note)}</div><input type="hidden" data-f="note" value="${esc(note)}">` : ""}</td>
      <td><input type="number" data-f="inn" min="0" step="0.01" value="${m.inn ?? ""}"></td>
      <td><input type="number" data-f="out" min="0" step="0.01" value="${m.out ?? ""}"></td>
      <td><input type="number" data-f="ctx" min="0" step="1" value="${m.ctx ?? ""}"></td>
      <td style="text-align:center"><input type="radio" name="tcDef-${esc(pid)}" data-f="default" ${(m.default || m.star) ? "checked" : ""}></td>
      <td style="text-align:center"><input type="checkbox" data-f="enabled" ${m.enabled !== false ? "checked" : ""}></td>
      <td><button type="button" class="btn g sm" data-act="rm">Remove</button></td>
    </tr>`;
  }
  function tokenCalcRenderProvider(pid, modelsHost, limitsHost, prefs) {
    if (!pid || !modelsHost) return;
    prefs = prefs || window._prefs || {};
    const prov = ((prefs.token_registry && prefs.token_registry.providers) || []).find((p) => p.id === pid)
      || { id: pid, name: pid, models: [] };
    let models = prov.models || [];
    if (!models.length && !(prov.removed || []).length && tcSeedModels(pid).length) models = tcSeedModels(pid);
    const nvidiaHint = pid === "nvidia" ? " Seeded NVIDIA catalog prices are 0 (NVIDIA free trial — enter rates if billed). Nemotron Super 120B stays the default." : "";
    modelsHost.innerHTML = `<p class="sub" style="margin:0 0 10px">Models for <b>${esc(prov.name || pid)}</b> only. The starred model is the default in Generate, Review, Regenerate and Help. Disabled models stay here but are hidden from dropdowns. Example prices — edit as needed. Seeded from the Connection model ID — does not change <span class="mono">.env</span>.${nvidiaHint}</p>
      <div class="tc-reg"><table><tr><th>Model id</th><th>$ / 1M in</th><th>$ / 1M out</th><th>Context</th><th>Default</th><th>On</th><th></th></tr>${models.map((m, i) => tokenCalcModelRow(pid, m, i)).join("")}</table></div>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn g sm" data-act="add">+ Add model</button>
        <button type="button" class="btn sm" data-act="save-models">Save models</button>
        <span class="sub" data-role="hint" style="margin:0"></span>
      </div>`;
    modelsHost.onclick = (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === "add") {
        const tbl = $("table", modelsHost);
        if (!tbl) return;
        const body = tbl.tBodies[0] || tbl.createTBody();
        const i = $$("tr[data-i]", modelsHost).length;
        body.insertAdjacentHTML("beforeend", tokenCalcModelRow(pid, { id: "", inn: 0, out: 0, ctx: tcExampleCtx(pid), enabled: true }, i));
        tokenCalcTouchDirty();
      }
      if (act === "rm") {
        const tr = e.target.closest("tr");
        if (tr) tr.remove();
        tokenCalcTouchDirty();
      }
      if (act === "save-models") {
        guarded(e.target, async () => {
          const submitted = { [pid]: tokenCalcCollectProvider(modelsHost, pid).map((m) => m.id).filter(Boolean) };
          await tokenCalcSaveRegistry(modelsHost.closest("#sbody") || modelsHost);
          const hint = $("[data-role=hint]", modelsHost);
          const missing = tokenCalcMissingIds(window._prefs, submitted);
          if (missing.length) {
            if (hint) hint.textContent = "Not saved: " + missing.join(", ");
            throw new Error("These model IDs were not saved: " + missing.join(", "));
          }
          if (hint) hint.textContent = "Saved.";
          tokenCalcTouchDirty();
        });
      }
    };
    if (!limitsHost) return;
    const L = (prefs.token_limits || {})[pid] || {};
    limitsHost.innerHTML = `<p class="sub" style="margin:0 0 10px">Daily caps for <b>${esc(prov.name || pid)}</b> only. Leave a field blank for no warning. The Dashboard banner appears at 80% of a limit you set. This is separate from the workspace-wide daily token limit on Token Usage.</p>
      <div class="row" style="align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <label>Daily tokens <input type="number" data-f="daily_tokens" min="0" step="1" placeholder="no limit" value="${L.daily_tokens ?? ""}" style="width:160px"></label>
        <label>Daily cost (USD) <input type="number" data-f="daily_cost" min="0" step="0.0001" placeholder="no limit" value="${L.daily_cost ?? ""}" style="width:160px"></label>
        <button type="button" class="btn sm" data-act="save-limits">Save limits</button>
        <span class="sub" data-role="hint" style="margin:0"></span>
      </div>
      <div class="sub" data-role="today" style="margin:0">Loading today’s usage…</div>`;
    limitsHost.onclick = (e) => {
      if (!(e.target.dataset && e.target.dataset.act === "save-limits")) return;
      guarded(e.target, async () => {
        const limits = Object.assign({}, (window._prefs && _prefs.token_limits) || {});
        limits[pid] = {
          daily_tokens: ($("[data-f=daily_tokens]", limitsHost) || {}).value,
          daily_cost: ($("[data-f=daily_cost]", limitsHost) || {}).value,
        };
        const j = await api("/api/settings/prefs", { method: "PUT", body: { token_limits: limits } });
        window._prefs = j.prefs || _prefs;
        const hint = $("[data-role=hint]", limitsHost);
        if (hint) hint.textContent = "Saved.";
      });
    };
    const todayEl = $("[data-role=today]", limitsHost);
    const today = new Date();
    const iso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    api("/api/tokens?" + new URLSearchParams({ provider: pid, from: iso, to: iso, page: "1", page_size: "1" })).then((j) => {
      if (!todayEl) return;
      const tot = (j.today && j.today.total) || 0;
      const cap = Number(L.daily_tokens) || 0;
      const pct = cap ? Math.round(tot * 1000 / cap) / 10 : 0;
      todayEl.textContent = cap
        ? `Today so far: ${fmt(tot)} tokens · ${pct}% of ${fmt(cap)}${pct >= 80 ? " — warn at 80%." : "."}`
        : `Today so far: ${fmt(tot)} tokens (no daily token cap set).`;
    }).catch(() => { if (todayEl) todayEl.textContent = ""; });
  }
  function tokenCalcRenderAllProviders(root, prefs) {
    if (!root) return;
    $$(".tc-prov-models", root).forEach((el) => {
      const pid = el.dataset.pid;
      const lim = root.querySelector(`.tc-prov-limits[data-pid="${pid}"]`);
      tokenCalcRenderProvider(pid, el, lim, prefs);
    });
  }
  function tokenCalcRenderSettings(pane) {
    if (!pane) return;
    // Preferences: calculator prefs only (registry + limits moved under AI Providers).
    if (pane.matches && pane.matches('[data-pane="preferences"]') && !$("#tcCalcPrefsCard")) {
      pane.insertAdjacentHTML("beforeend", `<div class="card" id="tcCalcPrefsCard" style="margin-top:14px">
        <h3>Token calculator options</h3>
        <p class="sub" style="margin:0 0 10px">Model registry and daily token &amp; cost limits now live under <b>Settings → AI Providers</b> — open a provider and use the <b>Models</b> or <b>Limits</b> sub-tab. These two options still apply to every provider.</p>
        <label class="sw" style="margin:0 0 6px;text-transform:none;font-size:13px;font-weight:400"><input type="checkbox" id="tcTik"><span class="t"></span> Use tiktoken when installed (OpenAI / Codex only; optional package)</label>
        <label class="sw" style="margin:0;text-transform:none;font-size:13px;font-weight:400"><input type="checkbox" id="tcApi"><span class="t"></span> Call provider count APIs (uses quota; off by default)</label>
        <div class="row" style="gap:8px;margin-top:10px;align-items:center">
          <button type="button" class="btn sm" id="tcCalcPrefSave">Save options</button>
          <span class="sub" id="tcCalcPrefHint" style="margin:0"></span>
        </div>
      </div>`);
      tcPrefs().then((prefs) => {
        const cp = (prefs && prefs.calc_prefs) || {};
        if ($("#tcTik")) $("#tcTik").checked = cp.tiktoken !== false;
        if ($("#tcApi")) $("#tcApi").checked = !!cp.provider_count_api;
      });
      if ($("#tcCalcPrefSave")) $("#tcCalcPrefSave").onclick = () => guarded($("#tcCalcPrefSave"), async () => {
        const j = await api("/api/settings/prefs", { method: "PUT", body: {
          calc_prefs: { tiktoken: $("#tcTik").checked, provider_count_api: $("#tcApi").checked },
        }});
        window._prefs = j.prefs || _prefs;
        $("#tcCalcPrefHint").textContent = "Saved.";
      });
    }
    const providersRoot = pane.closest ? (pane.closest("#sbody") || pane) : pane;
    if (providersRoot && providersRoot.querySelector(".tc-prov-models")) {
      tcPrefs().then((prefs) => tokenCalcRenderAllProviders(providersRoot, prefs || {}));
    }
  }

  function tokenSummaryHtml(ts) {
    if (!ts) return "";
    const per = ts.period || {};
    const prov = per.providers || [];
    const banner = (ts.near_limit || []).map((n) =>
      `<div class="db-tl-banner"><b>${esc(n.provider)}</b> is at ${n.pct}% of today’s ${n.metric === "cost" ? "cost" : "token"} limit
        (${n.metric === "cost" ? tcMoney(n.used) + " of " + tcMoney(n.limit) : fmt(n.used) + " of " + fmt(n.limit)}).
        <a href="${esc(n.href || "#tokens")}">Open Token Usage</a></div>`).join("");
    const cards = `<div class="db-tl-cards">
      <div class="card"><div class="tu-k">Tokens (${esc(ts.from)} – ${esc(ts.to)})</div><div class="tu-v">${fmt(per.total || 0)}</div>
        <div class="tu-s">${fmt(per.calls || 0)} calls · in ${fmt(per.input || 0)} / out ${fmt(per.output || 0)}</div></div>
      <div class="card"><div class="tu-k">Estimated cost (per-model rates)</div><div class="tu-v">${tcMoney(per.cost)}</div>
        <div class="tu-s">Example prices — edit in Settings. Existing AI cost tile still uses global rates.</div></div>
      <div class="card"><div class="tu-k">Today</div><div class="tu-v">${fmt((ts.today_usage || {}).total || 0)}</div>
        <div class="tu-s">${tcMoney((ts.today_usage || {}).cost)} at per-model rates</div></div>
      <div class="card"><div class="tu-k">By provider</div>${prov.slice(0, 4).map((p) =>
        `<div class="tu-s"><a href="#tokens?provider=${encodeURIComponent(p.provider)}">${esc(p.provider)}</a> ${p.pct}% · ${fmt(p.total)}</div>`).join("") || '<div class="tu-s">No usage in this range.</div>'}</div>
    </div>`;
    return banner + cards;
  }

  window.tcPrefs = tcPrefs;
  window.tcRegistry = tcRegistry;
  window.tcEnabled = tcEnabled;
  window.tcDefaultId = tcDefaultId;
  window.tcModelOpts = tcModelOpts;
  window.tcEstimate = tcEstimate;
  window.tcChipHtml = tcChipHtml;
  window.tcPaint = tcPaint;
  window.bindLiveEstimate = bindLiveEstimate;
  window.viewTokenCalculator = viewTokenCalculator;
  window.tokenCalcRenderSettings = tokenCalcRenderSettings;
  window.tokenCalcRenderProvider = tokenCalcRenderProvider;
  window.tokenCalcRenderAllProviders = tokenCalcRenderAllProviders;
  window.tokenCalcPidFromGroup = tokenCalcPidFromGroup;
  window.tokenCalcCollectAll = tokenCalcCollectAll;
  window.tokenCalcIsDirty = tokenCalcIsDirty;
  window.tokenCalcSaveRegistry = tokenCalcSaveRegistry;
  window.tcExampleCtx = tcExampleCtx;
  window.tokenSummaryHtml = tokenSummaryHtml;
  window.tcCalcHref = tcCalcHref;
  window.tcSeedCalc = tcSeedCalc;
  window.tcMoney = tcMoney;
})();
