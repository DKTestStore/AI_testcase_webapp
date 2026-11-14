/* Shared AI provider + model picker modal (Review, Repo Review, Repo / Review regenerate). */
"use strict";
(function () {
  const st = document.createElement("style");
  st.textContent = `
.ai-ov{position:fixed;inset:0;background:#0b102066;display:flex;align-items:center;justify-content:center;z-index:80;padding:16px}
.ai-md{width:560px;max-width:100%;max-height:min(640px,calc(100vh - 32px));background:#fff;border-radius:14px;padding:14px 16px 12px;box-shadow:0 20px 50px #0005;display:flex;flex-direction:column}
.ai-md h1{font-size:18px;margin:0 0 4px}
.ai-md .sub{margin:0 0 8px}
.ai-md .msearch{width:100%;margin:6px 0 8px;padding:8px 10px;border:1px solid #d5dbe8;border-radius:8px;font:13px inherit}
.ai-md .mlist{border:1px solid #e3e7f0;border-radius:10px;overflow-y:auto;max-height:280px;flex:1;scrollbar-width:thin}
.ai-md .mgrp{background:#f7f9fc;padding:4px 10px;font-size:11.5px;font-weight:700;color:#445;position:sticky;top:0;border-bottom:1px solid #eef1f7}
.ai-md .mi{display:flex;align-items:center;gap:8px;padding:5px 10px;cursor:pointer;border:0;background:#fff;width:100%;text-align:left;font:inherit;border-bottom:1px solid #f4f6fb}
.ai-md .mi:hover{background:#f7f9ff}.ai-md .mi.on{background:#eef2ff}
.ai-md .mi .id{font-family:ui-monospace,Consolas,monospace;font-size:12px}
.ai-md .mark{font-size:11px;color:#3046c4;font-weight:700}
.ai-md .mest{background:#f7f9fc;border:1px solid #eef1f7;border-radius:10px;padding:6px 10px;margin:8px 0}
.ai-md .macts{display:flex;justify-content:flex-end;gap:8px}
.ai-md label{display:block;font-size:12px;color:#6b7385;margin:0 0 4px}
.ai-md textarea{width:100%;padding:8px;border:1px solid #d5dbe8;border-radius:8px;font:13px inherit;margin:0 0 8px;min-height:36px;resize:vertical}
`;
  document.head.appendChild(st);

  let _onKey = null;

  function prettyName(pid) {
    if (typeof prettyProvider === "function") return prettyProvider(pid);
    const map = { gemini: "Gemini", grok: "Grok", groq: "Groq", claude: "Claude", openai: "OpenAI", codex: "Codex (OpenAI)", ollama: "Ollama" };
    return map[String(pid || "").toLowerCase()] || pid || "";
  }
  function registry() {
    return (typeof tcRegistry === "function" ? tcRegistry() : []) || [];
  }
  function defaultId(pid) {
    return (typeof tcDefaultId === "function" ? tcDefaultId(pid) : "") || "";
  }
  function listHtml(q, selected, currentProv) {
    q = String(q || "").toLowerCase();
    let html = "";
    registry().forEach((p) => {
      const rows = ((p.models || []).filter((m) => m && m.enabled !== false)).filter((m) =>
        !q || String(m.id).toLowerCase().includes(q) || String(p.name || p.id).toLowerCase().includes(q));
      if (!rows.length) return;
      html += `<div class="mgrp">${esc(p.name || prettyName(p.id) || p.id)}</div>`;
      rows.forEach((m) => {
        const isSel = selected === m.id && (!currentProv || currentProv === p.id);
        const marks = [m.default ? "★ default" : "", (currentProv === p.id && m.default) ? "current" : ""].filter(Boolean).join(" · ");
        html += `<button type="button" class="mi${isSel ? " on" : ""}" data-pid="${esc(p.id)}" data-mid="${esc(m.id)}"><span class="id">${esc(m.id)}</span>${marks ? `<span class="mark">${esc(marks)}</span>` : ""}</button>`;
      });
    });
    return html || `<div class="sub" style="padding:10px">No enabled models match.</div>`;
  }

  function closeAiPicker() {
    const ov = document.getElementById("aiPickerOv");
    if (ov) ov.remove();
    if (_onKey) { document.removeEventListener("keydown", _onKey); _onKey = null; }
  }

  function openAiPicker(opts) {
    opts = opts || {};
    closeAiPicker();
    if (typeof tcPrefs === "function" && !(window._prefs && _prefs.token_registry)) {
      return tcPrefs().then(() => openAiPickerReady(opts));
    }
    return openAiPickerReady(opts);
  }
  function openAiPickerReady(opts) {
    opts = opts || {};
    const currentProv = opts.provider || (typeof resolvedRunProvider === "function" && resolvedRunProvider()) || (typeof S !== "undefined" && S.run && S.run.model) || "";
    const currentModel = opts.model || (currentProv && defaultId(currentProv)) || (typeof S !== "undefined" && S.run && S.run.model_name) || "";
    let selProv = currentProv, selModel = currentModel;
    const ins = opts.instruction === true || (opts.instruction && typeof opts.instruction === "object");
    const insVal = (opts.instruction && opts.instruction.value) || opts.instructionValue || "";
    const insPh = (opts.instruction && opts.instruction.placeholder) || "e.g. Make steps more concrete";
    const ov = document.createElement("div");
    ov.id = "aiPickerOv";
    ov.className = "ai-ov";
    ov.innerHTML = `<div class="ai-md" role="dialog" aria-modal="true">
      <h1>${esc(opts.title || "Select AI provider & model")}</h1>
      <p class="sub">${opts.sub || "Choose a provider and model. Nothing is sent until you confirm."}</p>
      ${ins ? `<label>Instruction (optional)</label><textarea id="aiPickIns" rows="2" placeholder="${esc(insPh)}">${esc(insVal)}</textarea>` : ""}
      <input class="msearch" id="aiPickQ" placeholder="Search provider or model…" autocomplete="off">
      <div class="mlist" id="aiPickList">${listHtml("", selModel, selProv)}</div>
      <div class="mest" id="aiPickEst"><div class="tc-chip"><span>Estimating…</span></div></div>
      <div class="macts"><button type="button" class="btn g" id="aiPickNo">Cancel</button>
        <button type="button" class="btn" id="aiPickGo">${esc(opts.confirmLabel || "Confirm")}</button></div>
    </div>`;
    document.body.appendChild(ov);
    const paintList = () => { $("#aiPickList", ov).innerHTML = listHtml($("#aiPickQ", ov).value, selModel, selProv); };
    const refreshEst = () => {
      if (typeof bindLiveEstimate !== "function") return;
      const body = {
        el: $("#aiPickEst", ov),
        kind: opts.kind || "review",
        provider: () => selProv,
        model: () => selModel,
        expected: opts.expected,
        compose: opts.compose !== false,
      };
      if (opts.text !== undefined) body.text = opts.text;
      if (opts.extra) body.extra = opts.extra;
      if (ins) body.instruction = () => ($("#aiPickIns", ov) && $("#aiPickIns", ov).value) || "";
      if (opts.test_case) body.test_case = opts.test_case;
      if (opts.test_cases) body.test_cases = opts.test_cases;
      if (opts.feature_text) body.feature_text = opts.feature_text;
      bindLiveEstimate(body);
    };
    $("#aiPickList", ov).onclick = (e) => {
      const b = e.target.closest(".mi");
      if (!b) return;
      selProv = b.dataset.pid; selModel = b.dataset.mid;
      paintList(); refreshEst();
    };
    $("#aiPickQ", ov).oninput = () => paintList();
    if ($("#aiPickIns", ov)) $("#aiPickIns", ov).addEventListener("change", refreshEst);
    $("#aiPickNo", ov).onclick = () => { closeAiPicker(); if (opts.onCancel) opts.onCancel(); };
    ov.addEventListener("click", (e) => { if (e.target === ov) { closeAiPicker(); if (opts.onCancel) opts.onCancel(); } });
    $("#aiPickGo", ov).onclick = () => {
      const instruction = ins ? (($("#aiPickIns", ov) && $("#aiPickIns", ov).value) || "") : undefined;
      const picked = { provider: selProv, model: selModel, instruction };
      closeAiPicker();
      if (opts.onConfirm) opts.onConfirm(picked);
    };
    _onKey = (e) => { if (e.key === "Escape") { closeAiPicker(); if (opts.onCancel) opts.onCancel(); } };
    document.addEventListener("keydown", _onKey);
    refreshEst();
    setTimeout(() => { const q = $("#aiPickQ", ov); if (q) q.focus(); }, 0);
  }

  window.openAiPicker = openAiPicker;
  window.closeAiPicker = closeAiPicker;
})();
