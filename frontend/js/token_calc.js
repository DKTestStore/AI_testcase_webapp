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
.tc-tok i{font-style:normal;padding:1px 4px;border-radius:4px;white-space:pre-wrap}
.tc-tok i .n{font-size:9px;opacity:.7;margin-right:2px}
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
  function tcEnabled(pid) {
    const p = tcProvider(pid);
    return ((p && p.models) || []).filter((m) => m && m.enabled !== false);
  }
  function tcDefaultId(pid) {
    const p = tcProvider(pid);
    const models = (p && p.models) || [];
    const star = models.find((m) => m.default && m.enabled !== false) || models.find((m) => m.enabled !== false);
    return star ? star.id : "";
  }
  function tcModelOpts(pid, selected, all) {
    const list = all ? ((tcProvider(pid) || {}).models || []) : tcEnabled(pid);
    const sel = selected || tcDefaultId(pid);
    if (!list.length) return `<option value="">(Settings / env default)</option>`;
    return list.map((m) => `<option value="${esc(m.id)}" ${m.id === sel ? "selected" : ""}>${esc(m.id)}${m.default ? " ★" : ""}${m.enabled === false ? " (off)" : ""}</option>`).join("");
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
      `<i style="background:${PAL[i % PAL.length]}">${showIds ? `<span class="n">${p.i}</span>` : ""}${esc(p.t)}</i>`).join("")}</div>`;
  }
  function tcCalcHref(q) {
    const qs = q ? "?" + new URLSearchParams(q).toString() : "";
    return "#tokens/calculator" + qs;
  }

  async function bindLiveEstimate(opts) {
    const out = typeof opts.el === "string" ? document.querySelector(opts.el) : opts.el;
    if (!out) return;
    const run = async () => {
      try {
        const provider = typeof opts.provider === "function" ? opts.provider() : opts.provider;
        const model_name = typeof opts.model === "function" ? opts.model() : opts.model;
        const text = typeof opts.text === "function" ? opts.text() : (opts.text || "");
        const est = await tcEstimate({ kind: opts.kind || "generate", provider, model_name, text,
          expected_output: opts.expected, source: opts.source });
        const link = `<a href="${tcCalcHref({ provider: provider || "", model: model_name || "" })}" style="margin-left:auto">Open in calculator</a>`;
        tcPaint(out, est, link);
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
    const seed = params.get("text") || run.feature_text || "";
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
    const runCount = async () => {
      const provider = $("#tcProv").value, model_name = $("#tcModel").value;
      const text = $("#tcText").value, expected_output = +$("#tcOut").value || 0;
      let j;
      try { j = await tcEstimate({ kind: "generate", provider, model_name, text, expected_output }); }
      catch (e) { $("#tcEst").innerHTML = `<div class="warn">${esc(e.message)}</div>`; return; }
      tcPaint($("#tcEst"), j);
      $("#tcView").innerHTML = tcTokenHtml(text, j.est_input || j.tokens, $("#tcIds").checked);
      $("#tcOver").innerHTML = j.fits === false
        ? `<div class="tc-over">This prompt + expected output is over the ${fmt(j.ctx)}-token context window (${j.fit_pct}%). Shorten the input or pick a larger-context model.</div>`
        : "";
    };
    $("#tcGo").onclick = runCount;
    $("#tcIds").onchange = runCount;
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
          rows.push(`<tr class="${over ? "over" : ""}"><td>${esc(m.id)}${m.default ? " ★" : ""}</td>
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

  // ---------- Settings cards ----------
  function tokenCalcRenderSettings(pane) {
    if (!pane || $("#tcRegCard")) return;
    pane.insertAdjacentHTML("beforeend", `<div class="card" id="tcRegCard" style="margin-top:14px">
      <h3>Model registry (per provider)</h3>
      <p class="sub" style="margin:0 0 10px">One or more models per provider, with example rates and a context window. The starred model is the default in Generate, AI Review, Regenerate and Help. Disabled models stay in the registry but are hidden from dropdowns. Existing Settings provider model fields (and env) still work as a fallback. Seeded from the model already configured for each provider — this does not change <span class="mono">.env</span>.</p>
      <div class="tc-reg" id="tcReg"></div>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn" id="tcRegSave">Save registry</button>
        <span class="sub" id="tcRegHint" style="margin:0"></span>
      </div>
      <div style="margin-top:12px;border-top:1px solid #eef1f7;padding-top:10px">
        <label class="sw" style="margin:0 0 6px;text-transform:none;font-size:13px;font-weight:400"><input type="checkbox" id="tcTik"><span class="t"></span> Use tiktoken when installed (OpenAI / Codex only; optional package)</label>
        <label class="sw" style="margin:0;text-transform:none;font-size:13px;font-weight:400"><input type="checkbox" id="tcApi"><span class="t"></span> Call provider count APIs (uses quota; off by default)</label>
      </div>
    </div>
    <div class="card tc-lim" id="tcLimCard" style="margin-top:14px">
      <h3>Daily token &amp; cost limits (per provider)</h3>
      <p class="sub" style="margin:0 0 10px">Leave a field blank for no warning. When a limit is set, the Dashboard and Token Usage show a banner at 80% of that day’s usage. This is separate from the workspace-wide daily token limit and global $ / 1M rates on the Token Usage page.</p>
      <div id="tcLimTbl"></div>
      <div class="row" style="gap:8px;margin-top:10px;align-items:center">
        <button type="button" class="btn" id="tcLimSave">Save limits</button>
        <span class="sub" id="tcLimHint" style="margin:0"></span>
      </div>
    </div>`);
    const draw = (prefs) => {
      const providers = (prefs.token_registry && prefs.token_registry.providers) || [];
      $("#tcReg").innerHTML = providers.map((p) => {
        const models = p.models || [];
        const rows = models.map((m, i) => `<tr data-p="${esc(p.id)}" data-i="${i}">
          <td><input type="text" data-f="id" value="${esc(m.id)}"></td>
          <td><input type="number" data-f="inn" min="0" step="0.01" value="${m.inn ?? ""}"></td>
          <td><input type="number" data-f="out" min="0" step="0.01" value="${m.out ?? ""}"></td>
          <td><input type="number" data-f="ctx" min="0" step="1" value="${m.ctx ?? ""}"></td>
          <td style="text-align:center"><input type="radio" name="tcDef-${esc(p.id)}" data-f="default" ${m.default ? "checked" : ""}></td>
          <td style="text-align:center"><input type="checkbox" data-f="enabled" ${m.enabled !== false ? "checked" : ""}></td>
          <td><button type="button" class="btn g sm" data-act="rm">Remove</button></td>
        </tr>`).join("");
        return `<div class="prov" data-p="${esc(p.id)}"><div class="hd" data-act="tog"><b>${esc(p.name || p.id)}</b><span class="sub" style="margin:0">${models.length} model${models.length === 1 ? "" : "s"} · default ${esc((models.find((m) => m.default) || {}).id || "—")}</span><button type="button" class="btn g sm" data-act="add">Add model</button></div>
          <div class="body"><table><tr><th>Model id</th><th>$ / 1M in</th><th>$ / 1M out</th><th>Context</th><th>Default</th><th>On</th><th></th></tr>${rows}</table></div></div>`;
      }).join("");
      const lim = prefs.token_limits || {};
      $("#tcLimTbl").innerHTML = `<table><tr><th>Provider</th><th>Daily tokens</th><th>Daily cost (USD)</th></tr>${providers.map((p) => {
        const L = lim[p.id] || {};
        return `<tr data-p="${esc(p.id)}"><td>${esc(p.name || p.id)}</td>
          <td><input type="number" data-f="daily_tokens" min="0" step="1" placeholder="no limit" value="${L.daily_tokens ?? ""}"></td>
          <td><input type="number" data-f="daily_cost" min="0" step="0.0001" placeholder="no limit" value="${L.daily_cost ?? ""}"></td></tr>`;
      }).join("")}</table>`;
      const cp = prefs.calc_prefs || {};
      $("#tcTik").checked = cp.tiktoken !== false;
      $("#tcApi").checked = !!cp.provider_count_api;
    };
    const collectReg = () => {
      const providers = [];
      $$("#tcReg .prov").forEach((el) => {
        const id = el.dataset.p;
        const models = [];
        $$("tr[data-i]", el).forEach((tr) => {
          const idv = ($("[data-f=id]", tr).value || "").trim();
          if (!idv) return;
          models.push({
            id: idv,
            inn: +$("[data-f=inn]", tr).value || 0,
            out: +$("[data-f=out]", tr).value || 0,
            ctx: +$("[data-f=ctx]", tr).value || 0,
            default: $("[data-f=default]", tr).checked,
            enabled: $("[data-f=enabled]", tr).checked,
          });
        });
        providers.push({ id, name: (tcProvider(id) || {}).name || id, models });
      });
      return { providers };
    };
    $("#tcReg").onclick = (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === "add") {
        const prov = e.target.closest(".prov");
        const tbl = $("table", prov);
        const i = $$("tr[data-i]", prov).length;
        const tr = document.createElement("tr");
        tr.dataset.p = prov.dataset.p; tr.dataset.i = String(i);
        tr.innerHTML = `<td><input type="text" data-f="id" placeholder="model-id"></td>
          <td><input type="number" data-f="inn" min="0" step="0.01" value="0"></td>
          <td><input type="number" data-f="out" min="0" step="0.01" value="0"></td>
          <td><input type="number" data-f="ctx" min="0" step="1" value="0"></td>
          <td style="text-align:center"><input type="radio" name="tcDef-${esc(prov.dataset.p)}" data-f="default"></td>
          <td style="text-align:center"><input type="checkbox" data-f="enabled" checked></td>
          <td><button type="button" class="btn g sm" data-act="rm">Remove</button></td>`;
        tbl.appendChild(tr);
      }
      if (act === "rm") {
        const tr = e.target.closest("tr");
        if (tr) tr.remove();
      }
    };
    $("#tcRegSave").onclick = () => guarded($("#tcRegSave"), async () => {
      const j = await api("/api/settings/prefs", { method: "PUT", body: {
        token_registry: collectReg(),
        calc_prefs: { tiktoken: $("#tcTik").checked, provider_count_api: $("#tcApi").checked },
      }});
      window._prefs = j.prefs || _prefs;
      draw(_prefs);
      $("#tcRegHint").textContent = "Saved.";
    });
    $("#tcLimSave").onclick = () => guarded($("#tcLimSave"), async () => {
      const token_limits = {};
      $$("#tcLimTbl tr[data-p]").forEach((tr) => {
        token_limits[tr.dataset.p] = {
          daily_tokens: $("[data-f=daily_tokens]", tr).value,
          daily_cost: $("[data-f=daily_cost]", tr).value,
        };
      });
      const j = await api("/api/settings/prefs", { method: "PUT", body: { token_limits } });
      window._prefs = j.prefs || _prefs;
      draw(_prefs);
      $("#tcLimHint").textContent = "Saved.";
    });
    tcPrefs().then((p) => draw(p || {}));
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
    const bar = prov.length ? `<div class="card" style="margin:0 0 14px"><h3>Usage by provider / model</h3>
      <div class="db-tl-bar">${prov.map((p, i) => `<i style="flex:${Math.max(p.total, 1)} 0 0;background:${PAL[i % PAL.length].replace("ff", "aa")}" title="${esc(p.provider)}: ${p.pct}%"></i>`).join("")}</div>
      ${prov.map((p) => `<div style="margin:8px 0 4px"><a href="#tokens?provider=${encodeURIComponent(p.provider)}"><b>${esc(p.provider)}</b></a> · ${p.pct}% · ${fmt(p.total)} · ${tcMoney(p.cost)}</div>
        ${(p.models || []).map((m) => `<div class="tu-s" style="padding-left:12px"><a href="#tokens?provider=${encodeURIComponent(p.provider)}&model=${encodeURIComponent(m.model)}">${esc(m.model || "(no model)")}</a> · ${m.pct}% · ${fmt(m.total)}</div>`).join("")}`).join("")}
      <p class="tu-s" style="margin-top:8px">${esc(ts.note || "Example prices — edit in Settings.")}</p></div>` : "";
    return banner + cards + bar;
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
  window.tokenSummaryHtml = tokenSummaryHtml;
  window.tcCalcHref = tcCalcHref;
  window.tcMoney = tcMoney;
})();
