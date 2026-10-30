/* Prompt templates (additive): templates page + editor, multi-select on Input / batch, View prompt.
   Hooks into existing screens only by injecting extra elements; nothing is removed or re-ordered. */
(function () {
  const st = document.createElement("style");
  st.textContent = `.pt-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.pt-grid .card{margin:0;display:flex;flex-direction:column}
.pt-card.def{border-color:#7c9cff;box-shadow:0 0 0 1px #c9d3ff}.pt-card h3{margin:0 0 6px;font-size:15px}.pt-card .d{font-size:12.5px;color:#4b5368;margin:6px 0;flex:1}
.pt-tags span{display:inline-block;background:#eef0f5;color:#3b4256;font-size:10.5px;padding:2px 7px;border-radius:8px;margin:2px 4px 2px 0;text-transform:uppercase}
.pt-meta{font-size:11.5px;color:#6b7385;display:flex;justify-content:space-between;margin:6px 0;border-bottom:1px solid #eef0f5;padding-bottom:8px}
.pt-acts{display:flex;flex-wrap:wrap;gap:6px}.pt-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.pt-bar input{flex:1;min-width:220px}
.pt-lock{font-size:10.5px;background:#eef0f5;padding:2px 7px;border-radius:8px;margin-right:4px}.pt-isdef{font-size:10.5px;background:#e8ecff;color:#4361ee;padding:2px 7px;border-radius:8px}
.pt-ed{display:grid;grid-template-columns:1.25fr 1fr;gap:14px}.pt-ed .card{margin:0 0 14px}.pt-ed textarea{width:100%;font-family:ui-monospace,monospace;font-size:12px}
.pt-ph{display:flex;justify-content:space-between;align-items:center;border:1px solid #eef0f5;border-radius:7px;padding:5px 8px;margin:5px 0;font-size:12px}
.pt-ph code{background:#f1ecff;color:#6d3fd1;padding:1px 6px;border-radius:5px}.pt-ph .ok{color:#12a150}.pt-ph a{color:#4361ee;cursor:pointer;font-weight:600}
.pt-prev{white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:11.5px;background:#fafbff;border:1px solid #e3e7f0;border-radius:8px;padding:10px;max-height:420px;overflow:auto}
.pt-prev mark{background:#dcf5e3;color:#145c2e}.pt-val{margin:10px 0 0;padding:8px 10px;border-radius:8px;font-size:12.5px}.pt-val.bad{background:#fff4dc;border:1px solid #f0c36d;color:#7a5200}.pt-val.good{background:#e6f6ec;border:1px solid #9fdcb4;color:#12643a}
.pt-opts{border:2px dashed #f0a83a;background:#fffbea}.pt-new{background:#f59e0b;color:#fff;font-size:9.5px;padding:1px 6px;border-radius:8px;margin-left:6px;vertical-align:middle}
.pt-ms{position:relative}.pt-ms-btn{display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-height:36px;border:1px solid #d5dbe8;border-radius:8px;padding:4px 30px 4px 6px;background:#fff;cursor:pointer;position:relative}
.pt-ms-btn:after{content:"▾";position:absolute;right:10px;top:8px;color:#6b7385}.pt-chip{background:#e8ecff;color:#3046c4;border-radius:10px;padding:2px 8px;font-size:12px;white-space:nowrap}.pt-chip b{cursor:pointer;margin-left:4px}
.pt-ms-dd{display:none;position:absolute;z-index:50;left:0;right:0;top:100%;background:#fff;border:1px solid #d5dbe8;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:280px;overflow:auto;padding:4px}
.pt-ms.open .pt-ms-dd{display:block}.pt-ms-dd label{display:flex;gap:8px;align-items:center;padding:6px 8px;margin:0;text-transform:none;font-size:13px;color:#1e2433;font-weight:400;cursor:pointer;letter-spacing:0}.pt-ms-dd label:hover{background:#f4f6fb}
.pt-ms-dd small{color:#6b7385}.pt-tag{background:#f1ecff;color:#6d3fd1;font-size:10.5px;padding:1px 7px;border-radius:8px;margin-right:6px;white-space:nowrap;font-weight:600}
.pt-ov{padding:4px;font-size:12px;max-width:160px}.pt-ov.set{border:1.5px solid #6d3fd1;color:#6d3fd1;font-weight:600}`;
  document.head.appendChild(st);
})();
const PT = { d: null, q: "", tag: "", sort: "edited", edit: null };
async function ptLoad(force) { if (!PT.d || force) PT.d = await api("/api/templates"); return PT.d; }
const ptById = (id) => ((PT.d && PT.d.templates) || []).find((t) => t.id === id);
const ptName = (id) => (ptById(id) || {}).name || id;
const ptWhen = (s) => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? esc(s) : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); };

// ---------------------------------------------------------------- list page (pt_01)
async function viewPrompts(v) {
  if (PT.edit) return ptEditor(v);
  v.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1>Prompt templates</h1><div class="sub">Reusable Gemini prompts. Pick one or more on the Input step or per batch item.</div></div><button class="btn" id="ptNew">＋ New template</button></div><div id="ptBody" class="sub">Loading…</div>`;
  $("#ptNew").onclick = () => { PT.edit = { id: null }; viewPrompts(v); };
  let d; try { d = await ptLoad(true); } catch (e) { $("#ptBody").innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  if (S.view !== "prompts") return;
  const tags = [...new Set(d.templates.flatMap((t) => t.tags || []))].sort();
  $("#ptBody").outerHTML = `<div class="card pt-bar"><input id="ptQ" placeholder="🔍 Search templates…" value="${esc(PT.q)}">
    <select id="ptTag"><option value="">All tags</option>${tags.map((t) => `<option ${t === PT.tag ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
    <select id="ptSort"><option value="edited">Sort: Last edited</option><option value="name" ${PT.sort === "name" ? "selected" : ""}>Sort: Name</option><option value="used" ${PT.sort === "used" ? "selected" : ""}>Sort: Most used</option></select>
    <span class="sub" style="margin:0" id="ptCount"></span></div><div class="pt-grid" id="ptGrid"></div>
    <div class="note" style="margin-top:14px">ℹ The <b>Default</b> template is the built-in prompt file and can't be deleted or edited here — duplicate it to customise. "Set as default" changes which template new runs start with. Selecting several templates on the Input step calls Gemini once per template and merges the results.</div>`;
  const grid = () => {
    const q = PT.q.toLowerCase();
    let ts = d.templates.filter((t) => (!PT.tag || (t.tags || []).includes(PT.tag)) && (!q || [t.name, t.description, (t.tags || []).join(" ")].join(" ").toLowerCase().includes(q)));
    const def = ts.filter((t) => t.builtin), rest = ts.filter((t) => !t.builtin);
    rest.sort((a, b) => PT.sort === "name" ? a.name.localeCompare(b.name) : PT.sort === "used" ? (b.used || 0) - (a.used || 0) : String(b.updated_at).localeCompare(String(a.updated_at)));
    ts = def.concat(rest);
    $("#ptCount").innerHTML = `${d.templates.length} templates · default: <b>${esc(ptName(d.default_id))}</b>`;
    $("#ptGrid").innerHTML = ts.map((t) => { const isDef = t.id === d.default_id; return `<div class="card pt-card ${isDef ? "def" : ""}" data-id="${esc(t.id)}">
      <h3>${t.builtin ? "🔒" : "📝"} ${esc(t.name)}</h3><div>${t.builtin ? '<span class="pt-lock">🔒 Locked · built-in</span>' : ""}${isDef ? '<span class="pt-isdef">★ Default</span>' : ""}</div>
      <div class="d">${esc(t.description)}</div><div class="pt-tags">${(t.tags || []).map((x) => `<span>#${esc(x)}</span>`).join("")}</div>
      <div class="pt-meta"><span>${t.builtin ? "Built-in · read-only" : "Edited " + ptWhen(t.updated_at)}</span><span>Used in ${t.used || 0} runs</span></div>
      <div class="pt-acts">${t.builtin ? `<button class="btn g sm" data-a="view">👁 View</button>` : `<button class="btn g sm" data-a="edit">✎ Edit</button>`}<button class="btn g sm" data-a="dup">⧉ Duplicate</button>
      <button class="btn g sm" data-a="def" ${isDef ? "disabled" : ""}>★ Set as default</button><button class="btn g sm" data-a="del" ${t.builtin ? "disabled" : ""} style="${t.builtin ? "" : "color:#d33"}">🗑 Delete</button></div></div>`; }).join("") || '<div class="muted">No templates match.</div>';
    $$("#ptGrid [data-a]").forEach((b) => (b.onclick = () => guarded(b, async () => {
      const id = b.closest("[data-id]").dataset.id, a = b.dataset.a, t = ptById(id);
      if (a === "view" || a === "edit") { PT.edit = { id }; return viewPrompts(v); }
      if (a === "dup") { const j = await api(`/api/templates/${id}/duplicate`, { method: "POST" }); toast(`Duplicated as “${j.template.name}”`); }
      if (a === "def") { await api(`/api/templates/${id}/default`, { method: "POST" }); toast(`“${t.name}” is now the default for new runs`); }
      if (a === "del") { if (!confirm(`Delete template “${t.name}”?`)) return; await api(`/api/templates/${id}`, { method: "DELETE" }); toast("Template deleted"); }
      setTimeout(() => viewPrompts(v), 0);
    })));
  };
  grid();
  $("#ptQ").oninput = (e) => { PT.q = e.target.value; grid(); };
  $("#ptTag").onchange = (e) => { PT.tag = e.target.value; grid(); };
  $("#ptSort").onchange = (e) => { PT.sort = e.target.value; grid(); };
}

// ---------------------------------------------------------------- editor (pt_02)
const PT_STARTER = "**Role and Persona:**\nYou are an elite QA Architect.\n\n**Story:** {{story_title}}\n**Description:**\n{{description}}\n\n**Acceptance Criteria:**\n{{acceptance_criteria}}\n\n**Instructions:**\n* Generate about {{num_cases}} test cases.\n* Cover {{test_types}} scenarios.\n* Detail level: {{detail_level}}\n";
async function ptEditor(v) {
  const d = await ptLoad(); const id = PT.edit.id; const t = id ? ptById(id) : null; const ro = !!(t && t.builtin);
  const base = t || { name: "", description: "", tags: [], text: PT_STARTER, options: { test_types: ["positive", "negative", "edge"], num_cases: 10, detail_level: "detailed" } };
  const op = base.options || {};
  v.innerHTML = `<div class="sub" style="margin:0">Prompt templates › ${esc(t ? t.name : "New template")}</div><h1>${ro ? "View template" : t ? "Edit template" : "New template"} · ${esc(t ? t.name : "Untitled")}</h1>
  <div class="pt-ed"><div><div class="card">
    <div class="row"><div><label style="margin-top:0">Name</label><input id="ptName" value="${esc(base.name)}" ${ro ? "readonly" : ""} style="width:100%"></div>
    <div><label style="margin-top:0">Tags</label><input id="ptTags" value="${esc((base.tags || []).join(", "))}" ${ro ? "readonly" : ""} style="width:100%" placeholder="api, rest"></div></div>
    <label>Description</label><input id="ptDesc" value="${esc(base.description)}" ${ro ? "readonly" : ""} style="width:100%">
    <label style="display:flex;justify-content:space-between">Prompt text <span class="sub" style="margin:0;text-transform:none" id="ptLen"></span></label>
    <textarea id="ptText" rows="18" ${ro ? "readonly" : ""}>${esc(ro ? t.text : base.text)}</textarea>
    <div id="ptVal"></div>
    ${ro ? '<div class="note">🔒 The built-in Default template is read-only (it is the prompt file used today). Duplicate it to customise.</div>' : `<h3 style="margin-top:14px">Options</h3><div class="row">
      <div><label style="margin-top:0">Test types</label>${d.test_types.map((x) => `<label style="text-transform:none;margin:2px 0;font-weight:400;font-size:13px;color:#1e2433"><input type="checkbox" class="ptTT" value="${x}" ${(op.test_types || []).includes(x) ? "checked" : ""}> ${x[0].toUpperCase() + x.slice(1)}</label>`).join("")}</div>
      <div><label style="margin-top:0">Number of cases</label><input id="ptNum" type="number" min="1" max="100" value="${esc(op.num_cases || 10)}" style="width:90px"></div>
      <div><label style="margin-top:0">Output detail level</label><select id="ptDetail">${Object.entries(d.detail_levels).map(([k, l]) => `<option value="${k}" ${k === (op.detail_level || "detailed") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div></div>`}
  </div></div>
  <div><div class="card"><h3>Insert placeholder</h3><div id="ptPh"></div></div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Live preview</h3><select id="ptEx"><option value="run">Current run input</option><option value="ex">Example: MTG-1427 Refund API</option></select></div>
    <div class="sub" style="margin:4px 0 8px">Final prompt sent to Gemini — <mark style="background:#dcf5e3">filled values</mark> highlighted</div><div class="pt-prev" id="ptPrev">…</div></div></div></div>
  <div class="footer-nav"><div>${ro ? "" : '<button class="btn g" id="ptReset">↺ Reset to default</button>'}</div><div><button class="btn g" id="ptCancel">${ro ? "← Back" : "Cancel"}</button> ${ro ? "" : '<button class="btn" id="ptSave">💾 Save template</button>'}</div></div>`;
  const ta = $("#ptText");
  const opts = () => ro ? (t.options || {}) : { test_types: $$(".ptTT").filter((c) => c.checked).map((c) => c.value), num_cases: +$("#ptNum").value || 10, detail_level: $("#ptDetail").value };
  let tmr;
  const upd = () => {
    $("#ptLen").textContent = `${ta.value.length.toLocaleString()} chars · ~${Math.round(ta.value.length / 4).toLocaleString()} tokens`;
    const found = new Set([...ta.value.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]));
    $("#ptPh").innerHTML = d.placeholders.map((p) => `<div class="pt-ph"><code>{{${p.name}}}</code><span class="sub" style="margin:0">${p.required ? "required" : "optional"}</span>${found.has(p.name) ? '<span class="ok">✓</span>' : ro ? "<span></span>" : `<a data-ins="${p.name}">＋ insert</a>`}</div>`).join("");
    $$("#ptPh [data-ins]").forEach((a) => (a.onclick = () => { const s = ta.selectionStart ?? ta.value.length; const ins = `{{${a.dataset.ins}}}`; ta.value = ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd ?? s); ta.focus(); ta.setSelectionRange(s + ins.length, s + ins.length); upd(); }));
    const known = new Set(d.placeholders.map((p) => p.name));
    const missing = d.placeholders.filter((p) => p.required && !found.has(p.name)).map((p) => p.name);
    const unknown = [...found].filter((x) => !known.has(x));
    $("#ptVal").innerHTML = ro ? "" : (missing.length ? `<div class="pt-val bad" id="ptMissing">⚠ <b>Validation:</b> missing required placeholder${missing.length > 1 ? "s" : ""} ${missing.map((m) => `<code>{{${m}}}</code>`).join(" ")} — Save is blocked.</div>` : "")
      + (unknown.length ? `<div class="pt-val bad" id="ptUnknown">⚠ Unknown placeholder${unknown.length > 1 ? "s" : ""} ${unknown.map((m) => `<code>{{${esc(m)}}}</code>`).join(" ")} will be left as-is.</div>` : "")
      + (!missing.length ? `<div class="pt-val good" id="ptOk">✓ All ${d.placeholders.filter((p) => p.required).length} required placeholders present${/Test Case ID:/.test(ta.value) ? "" : " · output template will be appended automatically"}</div>` : "");
    clearTimeout(tmr); tmr = setTimeout(prev, 250);
  };
  const prev = async () => {
    if (!$("#ptPrev")) return;
    try {
      if (ro) { $("#ptPrev").textContent = t.text; return; }
      const j = await api("/api/templates/preview", { method: "POST", body: { text: ta.value, options: opts(), use_run: $("#ptEx").value === "run" } });
      let h = esc(j.prompt); Object.values(j.values).concat([String(opts().num_cases), opts().test_types.join(", ")]).filter((x) => x && x.length > 1).sort((a, b) => b.length - a.length).forEach((val) => { const e = esc(val); h = h.split(e).join(`\u0000${e}\u0001`); });
      if (!$("#ptPrev")) return;
      $("#ptPrev").innerHTML = h.replace(/\u0000/g, "<mark>").replace(/\u0001/g, "</mark>");
    } catch (e) { if ($("#ptPrev")) $("#ptPrev").innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  };
  ta.oninput = upd; $("#ptEx").onchange = prev; $$(".ptTT, #ptNum, #ptDetail").forEach((x) => (x.onchange = upd)); upd();
  $("#ptCancel").onclick = () => { PT.edit = null; viewPrompts(v); };
  const rs = $("#ptReset"); if (rs) rs.onclick = () => { if (!confirm("Replace the prompt text with the default starter text?")) return; ta.value = PT_STARTER; upd(); };
  const sv = $("#ptSave"); if (sv) sv.onclick = () => guarded(sv, async () => {
    const body = { name: $("#ptName").value, tags: $("#ptTags").value, description: $("#ptDesc").value, text: ta.value, options: opts() };
    const j = await api(id ? `/api/templates/${id}` : "/api/templates", { method: id ? "PUT" : "POST", body });
    toast(`Template “${j.template.name}” saved${j.warnings && j.warnings.length ? " · unknown placeholders left as-is: " + j.warnings.join(", ") : ""}`);
    PT.edit = null; setTimeout(() => viewPrompts(v), 0);
  });
}

// ---------------------------------------------------------------- multi-select widget
function ptMulti(el, ids, onChange) {
  const draw = () => {
    el.innerHTML = `<div class="pt-ms"><div class="pt-ms-btn" tabindex="0" title="Choose one or more templates">${ids.map((i) => `<span class="pt-chip" data-id="${esc(i)}">📝 ${esc(ptName(i))}${ids.length > 1 ? `<b data-x="${esc(i)}" title="Remove">×</b>` : ""}</span>`).join("")}</div>
      <div class="pt-ms-dd">${PT.d.templates.map((t) => `<label><input type="checkbox" value="${esc(t.id)}" ${ids.includes(t.id) ? "checked" : ""}> ${t.builtin ? "🔒" : "📝"} ${esc(t.name)} <small>${(t.tags || []).map((x) => "#" + esc(x)).join(" ")}</small></label>`).join("")}</div></div>`;
    const ms = $(".pt-ms", el);
    $(".pt-ms-btn", el).onclick = (e) => { if (e.target.dataset.x) return; ms.classList.toggle("open"); };
    $$("[data-x]", el).forEach((x) => (x.onclick = (e) => { e.stopPropagation(); ids = ids.filter((i) => i !== x.dataset.x); draw(); onChange(ids); }));
    $$(".pt-ms-dd input", el).forEach((c) => (c.onchange = () => {
      const next = $$(".pt-ms-dd input", el).filter((x) => x.checked).map((x) => x.value);
      if (!next.length) { c.checked = true; return toast("Select at least one template.", true); }
      ids = next; $(".pt-ms-btn", el).innerHTML = ids.map((i) => `<span class="pt-chip" data-id="${esc(i)}">📝 ${esc(ptName(i))}</span>`).join(""); onChange(ids);
    }));
  };
  draw();
}
document.addEventListener("click", (e) => { if (!e.target.closest(".pt-ms")) $$(".pt-ms.open").forEach((m) => { m.classList.remove("open"); if (m._redraw) m._redraw(); }); });

async function ptViewPrompt(item) {
  const j = await api("/api/templates/selection" + (item ? "?item=" + encodeURIComponent(item) : ""));
  modal(`<h1>Prompt${j.prompts.length > 1 ? "s" : ""} sent to Gemini</h1><div class="sub" style="margin:4px 0 10px">${j.prompts.length} template${j.prompts.length > 1 ? "s" : ""} selected${j.prompts.length > 1 ? " — Gemini is called once per template and the results are merged" : ""}.${j.custom_override ? " <b>Note:</b> the Generate step is set to Custom prompt, which overrides templates." : ""} The feature description is sent as the user message.</div>
    <div id="ptVp" style="max-height:60vh;overflow:auto">${j.prompts.map((p) => `<h3 style="margin:10px 0 4px">📝 ${esc(p.name)}</h3><pre class="ro" style="max-height:none">${esc(p.prompt)}</pre>`).join("")}</div>
    <div style="text-align:right;margin-top:12px"><button class="btn" id="mCancel">Close</button></div>`);
  $("#mCancel").onclick = closeModal;
}

// ---------------------------------------------------------------- Input step card (pt_03)
async function ptInjectInput() {
  const v = $("#view"); const foot = $(".footer-nav", v);
  if (!foot || $("#ptOpts") || ptInjectInput.busy) return;
  ptInjectInput.busy = true;
  try {
    await ptLoad(); const sel = await api("/api/templates/selection");
    if (S.view !== "input" || S.mode === "batch" || $("#ptOpts") || !$(".footer-nav", v)) return;
    const card = document.createElement("div"); card.className = "card pt-opts"; card.id = "ptOpts";
    card.innerHTML = `<h3 style="margin:0 0 6px">Generate options <span class="pt-new">NEW</span></h3><label style="margin-top:0">Prompt templates (one or more)</label><div id="ptSel"></div>
      <div class="sub" style="margin:6px 0" id="ptSelInfo"></div><div style="display:flex;justify-content:space-between"><a href="#" id="ptView" style="color:#4361ee;font-weight:600">👁 View prompt</a><a href="#prompts" id="ptManage" style="color:#4361ee;font-weight:600">✎ Manage templates →</a></div>
      <div class="note" style="margin:8px 0 0">Default for new runs: <b>${esc(ptName(PT.d.default_id))}</b>. Model &amp; AI Reviewer are still chosen on the Generate step; choosing <b>Custom prompt</b> there overrides templates.</div>`;
    $(".footer-nav", v).before(card);
    const info = (ids) => { $("#ptSelInfo").innerHTML = ids.length > 1 ? `${ids.length} templates → Gemini is called ${ids.length}× and the results are merged (each case tagged with its template).` : esc((ptById(ids[0]) || {}).description || ""); };
    ptMulti($("#ptSel"), sel.template_ids, (ids) => { info(ids); api("/api/templates/select", { method: "POST", body: { ids } }).catch((e) => toast(e.message, true)); });
    info(sel.template_ids);
    $("#ptView").onclick = (e) => { e.preventDefault(); ptViewPrompt().catch((x) => toast(x.message, true)); };
    $("#ptManage").onclick = (e) => { e.preventDefault(); go("prompts"); };
  } catch (e) { /* ignore: never break the Input step */ } finally { ptInjectInput.busy = false; }
}

// ---------------------------------------------------------------- Generate step note (only when templates differ from Default)
async function ptInjectGenerate() {
  if ($("#ptGenNote") || ptInjectGenerate.busy || !$("#promptArea")) return;
  ptInjectGenerate.busy = true;
  try {
    await ptLoad(); const sel = await api("/api/templates/selection");
    if (S.view !== "generate" || $("#ptGenNote") || !$("#promptArea")) return;
    if (sel.template_ids.length === 1 && sel.template_ids[0] === "default") return;
    const n = document.createElement("div"); n.id = "ptGenNote"; n.className = "note";
    const names = sel.template_ids.map((i) => `<b>${esc(ptName(i))}</b>`).join(", ");
    n.innerHTML = S.run.prompt_mode === "custom" ? `📝 Templates selected on Input (${names}) are <b>ignored</b> because Custom prompt is selected.`
      : `📝 Default prompt source uses the template${sel.template_ids.length > 1 ? "s" : ""} selected on Input: ${names}${sel.template_ids.length > 1 ? ` — ${sel.template_ids.length} Gemini calls, results merged.` : "."} <a href="#" id="ptGenView" style="color:#4361ee">View prompt</a>`;
    $("#promptArea").after(n);
    const a = $("#ptGenView"); if (a) a.onclick = (e) => { e.preventDefault(); ptViewPrompt().catch((x) => toast(x.message, true)); };
  } catch (e) { } finally { ptInjectGenerate.busy = false; }
}

// ---------------------------------------------------------------- Batch (pt_04)
async function ptInjectBatch() {
  const v = $("#view"); if (!$(".bmv", v) || !$("h1", v) || !/Batch items/.test($("h1", v).textContent)) return;
  if (ptInjectBatch.busy) return;
  const needCard = !$("#ptBOpts"), tbl = $("#bItems"), needCol = tbl && !tbl.dataset.pt;
  if (!needCard && !needCol) return;
  ptInjectBatch.busy = true;
  try {
    await ptLoad(); const b = BS.batch; const bids = (b.template_ids && b.template_ids.length) ? b.template_ids : [PT.d.default_id];
    if (!$("#ptBOpts")) {
      const cards = $$(".bmv > .card", v); const anchor = cards[1]; if (!anchor) return;
      const n = (b.items || []).filter((i) => i.template_ids && i.template_ids.length).length;
      const c = document.createElement("div"); c.className = "card pt-opts"; c.id = "ptBOpts";
      c.innerHTML = `<label style="margin-top:0">Batch prompt templates <span class="pt-new">NEW</span></label><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div id="ptBSel" style="min-width:320px;flex:0 1 420px"></div>
        <a href="#" id="ptBView" style="color:#4361ee;font-weight:600">👁 View prompt</a><span class="sub" style="margin:0">Applies to every generated item unless overridden per item below. <span id="ptBOvC">${n} override${n === 1 ? "" : "s"} set.</span></span></div>`;
      anchor.before(c);
      ptMulti($("#ptBSel"), bids, (ids) => bApi("/api/batch/templates", { method: "PUT", body: { ids } }).catch((e) => toast(e.message, true)));
      $("#ptBView").onclick = (e) => { e.preventDefault(); const it = (b.items || []).find((i) => i.source !== "excel"); ptViewPromptBatch(it && it.key); };
    }
    const t = $("#bItems");
    if (t && !t.dataset.pt) {
      t.dataset.pt = "1";
      const hr = t.rows[0]; const th = document.createElement("th"); th.innerHTML = 'Template override <span class="pt-new">NEW</span>'; hr.insertBefore(th, hr.cells[hr.cells.length - 1]);
      [...t.rows].slice(1).forEach((r) => {
        const it = bItem(r.dataset.k); const td = document.createElement("td"); r.insertBefore(td, r.cells[r.cells.length - 1]);
        if (!it) return;
        if (it.source === "excel") { td.innerHTML = '<span class="sub" style="margin:0">n/a (no generation)</span>'; return; }
        const ov = it.template_ids || [];
        td.innerHTML = `<select class="pt-ov ${ov.length ? "set" : ""}" data-k="${esc(it.key)}"><option value="">— batch default —</option>${PT.d.templates.map((x) => `<option value="${esc(x.id)}" ${ov.length === 1 && ov[0] === x.id ? "selected" : ""}>📝 ${esc(x.name)}</option>`).join("")}${ov.length > 1 ? `<option value="__multi" selected>${ov.length} templates: ${esc(ov.map(ptName).join(", "))}</option>` : ""}</select>`;
        $("select", td).onchange = (e) => { const val = e.target.value; if (val === "__multi") return; bApi(`/api/batch/items/${it.key}`, { method: "PATCH", body: { template_ids: val ? [val] : null } }).then(() => { e.target.classList.toggle("set", !!val); it.template_ids = val ? [val] : null; { const c = $("#ptBOvC"); if (c) { const m = (BS.batch.items || []).filter((i) => i.template_ids && i.template_ids.length).length; c.textContent = `${m} override${m === 1 ? "" : "s"} set.`; } } toast(val ? `${it.item_id}: template ${ptName(val)}` : `${it.item_id}: uses batch templates`); }).catch((x) => toast(x.message, true)); };
      });
    }
  } catch (e) { } finally { ptInjectBatch.busy = false; }
}
async function ptViewPromptBatch(key) {
  if (!key) { const b = BS.batch; const ids = (b.template_ids && b.template_ids.length) ? b.template_ids : [PT.d.default_id]; return toast("Add a Jira or local item to preview the filled prompt (" + ids.map(ptName).join(", ") + ")."); }
  try { await ptViewPrompt(key); } catch (e) { toast(e.message, true); }
}

new MutationObserver(() => {
  if (S.mode === "batch") { if (S.view === "b-items") ptInjectBatch(); return; }
  if (S.view === "input" && S.inputMode !== "excel") ptInjectInput();
  if (S.view === "generate") ptInjectGenerate();
}).observe(document.getElementById("view"), { childList: true, subtree: true });
