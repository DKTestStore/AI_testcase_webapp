/* Token Usage page (additive, separate view: data-view="tokens"). Does not touch other screens. */
(function () {
  const st = document.createElement("style");
  st.textContent = `.tu-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}.tu-cards .card{margin:0}
.tu-k{color:#6b7385;font-size:12px}.tu-v{font-size:22px;font-weight:700;margin:4px 0}.tu-s{color:#6b7385;font-size:11.5px}
.tu-q{height:10px;background:#e8ecf5;border-radius:6px;overflow:hidden;margin:8px 0 4px}.tu-q div{height:100%;background:linear-gradient(90deg,#4361ee,#f59e0b)}
.tu-q.over div{background:#d33}
.tu-chart{display:flex;align-items:flex-end;gap:10px;height:200px;padding-top:10px;border-bottom:1px solid #e3e7f0}
.tu-bc{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}.tu-bar{width:100%;background:#4361ee;border-radius:5px 5px 0 0;min-height:1px}.tu-bc.today .tu-bar{background:#7c9cff}
.tu-bv{font-size:10.5px;color:#6b7385}.tu-bl{font-size:11px;color:#6b7385;margin-top:4px}
.tu-flt{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.tu-flt label{font-size:11.5px;color:#6b7385;display:flex;flex-direction:column;gap:4px;text-transform:uppercase}
.tu-flt input,.tu-flt select{padding:7px 9px;border:1px solid #d5dbe8;border-radius:7px;font-size:13px}
.tu-tbl{width:100%;border-collapse:collapse}.tu-tbl th,.tu-tbl td{padding:8px;border-bottom:1px solid #eef1f7;text-align:left;font-size:13px}.tu-tbl th{font-size:11.5px;color:#6b7385;background:#f7f9fc}
.tu-r{text-align:right!important}.tu-b{font-weight:700}.tu-mono{font-family:Consolas,monospace;font-size:12px}.tu-pill{background:#eef2ff;color:#3046c4;padding:2px 8px;border-radius:10px;font-size:11.5px;white-space:nowrap}
.tu-two{display:grid;grid-template-columns:2fr 1fr;gap:14px}.tu-two .card{margin:0 0 14px}
.tu-ar{display:flex;align-items:center;gap:10px;margin:10px 0}.tu-ar span{width:110px;font-size:13px}.tu-trk{flex:1;height:10px;background:#e8ecf5;border-radius:6px}.tu-trk div{height:100%;background:#4361ee;border-radius:6px}
.tu-tog{cursor:pointer;border:0;background:none;color:#4361ee;font-weight:700;padding:0 4px}.tu-item td{background:#fafbff;font-size:12.5px}.tu-item td:first-child{padding-left:28px}
.tu-set{display:flex;gap:10px;align-items:end;flex-wrap:wrap}
.tu-cb{width:28px;padding-right:0!important}.tu-acts{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin:0 0 10px}
.tu-acts label{text-transform:none;font-size:12px;color:#6b7385;display:flex;flex-direction:column;gap:4px}
.tu-pg{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:#6b7385;flex-wrap:wrap}
.tu-pg .btn{min-width:30px;justify-content:center}.tu-pg .btn.on{background:#4361ee;color:#fff}
.tu-help{margin:8px 0 0;font-size:11.5px;color:#6b7385;line-height:1.45}
.tu-del{border:0;background:transparent;color:#d33333;cursor:pointer;padding:2px 6px;border-radius:6px;font-size:14px}
.tu-del:hover{background:#fdeaea}.tu-tbl tr.sel{background:#f4f6ff}`;
  document.head.appendChild(st);
})();
const TU = { f: null, open: {}, page: 1, size: 25, sel: new Set() };
const tuK = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(2) + " M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n); };
const tuT = (ts) => { const d = new Date(ts); return isNaN(d) ? esc(ts || "") : d.toLocaleString("en-US", { month: "short", day: "numeric" }) + ", " + d.toTimeString().slice(0, 5); };
function tuDay(off) { const d = new Date(); d.setDate(d.getDate() - off); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function tuLoadSize() {
  try { const n = +localStorage.getItem("tuPageSize"); if ([10, 25, 50, 100].includes(n)) return n; } catch (e) {}
  return 25;
}
function tuSaveSize(n) { try { localStorage.setItem("tuPageSize", String(n)); } catch (e) {} }
function tuFilterQS() { const f = TU.f; return new URLSearchParams({ from: f.from, to: f.to, mode: f.mode, model: f.model }).toString(); }
function tuQS() { return tuFilterQS() + "&page=" + TU.page + "&page_size=" + TU.size; }
function tuSrc(r) { const t = r.title ? " · " + esc(r.title.slice(0, 40)) : ""; return r.source === "local" && !r.story_id ? "Local" + t : esc(r.story_id || (r.source === "local" ? "Local" : "—")) + t; }
const TU_MODE = { jira: "Single (Jira)", local: "Single (Local)", batch: "Batch" };
function tuRowIds(r) { return r.kind === "batch" ? (r.ids || (r.items || []).map((it) => it.id).filter(Boolean)) : (r.id ? [r.id] : []); }
function tuPageIds(rows) { return rows.flatMap(tuRowIds); }
function tuPager(total, page, size) {
  if (!total) return "";
  const pages = Math.max(1, Math.ceil(total / size));
  const a = (page - 1) * size + 1, b = Math.min(total, page * size);
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((x, y) => x - y);
  let last = 0;
  const btns = nums.map((n) => { const gap = n - last > 1 ? "<span>…</span>" : ""; last = n; return `${gap}<button type="button" class="btn ${n === page ? "on" : "g"} sm" data-p="${n}">${n}</button>`; }).join("");
  return `<div class="tu-pg" id="tuPg"><span>Showing <b>${a}–${b}</b> of <b>${total}</b></span>
    <span style="margin-left:8px">Rows per page</span>
    <select id="tuSize">${[10, 25, 50, 100].map((n) => `<option value="${n}" ${n === size ? "selected" : ""}>${n}</option>`).join("")}</select>
    <span style="margin-left:auto;display:flex;gap:4px;align-items:center;flex-wrap:wrap">
      <button type="button" class="btn g sm" data-p="${page - 1}" ${page > 1 ? "" : "disabled"}>‹ Prev</button>${btns}
      <button type="button" class="btn g sm" data-p="${page + 1}" ${page < pages ? "" : "disabled"}>Next ›</button>
    </span></div>`;
}
function tuUpdateSelBar() {
  const n = TU.sel.size;
  const b = $("#tuDelSel");
  if (b) { b.disabled = !n; b.textContent = n ? `Delete selected (${n})` : "Delete selected"; }
  const all = $$("#tuTbl input[data-ids]");
  const on = [...all].filter((c) => c.checked).length;
  const sa = $("#tuSelAll");
  if (sa) { sa.checked = all.length && on === all.length; sa.indeterminate = on > 0 && on < all.length; }
  $$("#tuTbl tr[data-ids]").forEach((tr) => {
    const ids = (tr.dataset.ids || "").split(",").filter(Boolean);
    tr.classList.toggle("sel", ids.length && ids.every((id) => TU.sel.has(id)));
  });
}
async function tuConfirmDelete({ ids, before, label }) {
  const body = ids ? { ids, confirm: false } : { before, confirm: false };
  let prev;
  try { prev = await api("/api/tokens/delete", { method: "POST", body }); }
  catch (e) { toast(e.message, true); return false; }
  if (!prev.count) { toast("Nothing to delete."); return false; }
  const who = label || `${prev.count} ledger entr${prev.count === 1 ? "y" : "ies"}`;
  return await new Promise((resolve) => {
    const html = `<h1>Delete token history?</h1>
      <p style="margin:8px 0 12px">This will remove <b>${esc(who)}</b> — <b>${fmt(prev.count)}</b> entr${prev.count === 1 ? "y" : "ies"} totalling <b>${fmt(prev.tokens)}</b> tokens.</p>
      <p class="sub" style="margin:0 0 14px">Tiles, the daily chart, breakdown, and Dashboard token totals will update. This does <b>not</b> reset the provider’s real Gemini daily quota (<span class="mono">reports/gemini_usage.json</span>).</p>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button type="button" class="btn g" id="tuDelNo">Cancel</button>
        <button type="button" class="btn r" id="tuDelYes">Delete</button>
      </div>`;
    const apply = async (btn) => {
      const r = await api("/api/tokens/delete", { method: "POST", body: { ...(ids ? { ids } : { before }), confirm: true } });
      toast(`Deleted ${r.deleted} entr${r.deleted === 1 ? "y" : "ies"} (${fmt(r.tokens)} tokens)`);
      (r.ids || []).forEach((id) => TU.sel.delete(id));
      return true;
    };
    if (typeof modal !== "function") {
      if (!confirm(`Delete ${prev.count} entries (${fmt(prev.tokens)} tokens)?`)) return resolve(false);
      apply().then(resolve).catch((e) => { toast(e.message, true); resolve(false); });
      return;
    }
    modal(html);
    const finish = (ok) => { if (typeof closeModal === "function") closeModal(); resolve(ok); };
    const no = $("#tuDelNo"), yes = $("#tuDelYes");
    if (no) no.onclick = () => finish(false);
    if (yes) yes.onclick = () => guarded(yes, async () => { await apply(); finish(true); });
    else resolve(false);
  });
}
async function viewTokens(v) {
  if (!TU.f) TU.f = { from: tuDay(13), to: tuDay(0), mode: "all", model: "all" };
  TU.size = tuLoadSize();
  v.innerHTML = `<h1>Token Usage</h1><p class="sub">Per-run, per-day and per-action token consumption (all providers recorded in the ledger).</p><div id="tuBody"><div class="muted">Loading…</div></div>`;
  let j; try { j = await api("/api/tokens?" + tuQS()); } catch (e) { $("#tuBody").innerHTML = `<div class="warn">${esc(e.message)}</div>`; return; }
  if (S.view !== "tokens") return;
  const f = TU.f, s = j.settings, mx = Math.max(1, ...j.daily.map((d) => d.total)), today = tuDay(0);
  TU.page = j.page || TU.page;
  TU.size = j.page_size && [10, 25, 50, 100].includes(j.page_size) ? j.page_size : TU.size;
  const opt = (val, lbl, cur) => `<option value="${esc(val)}" ${val === cur ? "selected" : ""}>${esc(lbl)}</option>`;
  const rows = j.rows.map((r, i) => {
    const ids = tuRowIds(r);
    const idStr = ids.map((x) => esc(x)).join(",");
    const checked = ids.length && ids.every((id) => TU.sel.has(id)) ? "checked" : "";
    const del = `<button type="button" class="tu-del" data-del="${idStr}" title="Delete">🗑</button>`;
    const cb = `<td class="tu-cb"><input type="checkbox" data-ids="${idStr}" ${checked} ${ids.length ? "" : "disabled"}></td>`;
    if (r.kind === "batch") {
      return `<tr class="tu-row tu-batch" data-i="${i}" data-bid="${esc(r.batch_id)}" data-ids="${idStr}">${cb}<td class="tu-mono"><button class="tu-tog" data-i="${i}" title="Show per-item breakdown">${TU.open[r.batch_id] ? "▾" : "▸"}</button>${esc(r.rid)}</td><td>${esc(r.source_label)}</td><td><span class="tu-pill">Batch generate</span></td><td>${esc(r.model)}</td><td class="tu-r">${fmt(r.input)}</td><td class="tu-r">${fmt(r.output)}</td><td class="tu-r tu-b">${fmt(r.total)}</td><td>${tuT(r.ts)}</td><td>${del}</td></tr>`
        + (TU.open[r.batch_id] ? r.items.map((it) => {
          const iid = it.id || "";
          const on = iid && TU.sel.has(iid) ? "checked" : "";
          return `<tr class="tu-item" data-b="${esc(r.rid)}" data-bid="${esc(r.batch_id)}" data-ids="${esc(iid)}"><td class="tu-cb"><input type="checkbox" data-ids="${esc(iid)}" ${on} ${iid ? "" : "disabled"}></td><td class="tu-mono">↳ ${esc(it.rid || "—")}</td><td>${tuSrc(it)}</td><td><span class="tu-pill">${esc(it.action)}${it.template ? " · " + esc(it.template) : ""}</span></td><td>${esc(it.model)}</td><td class="tu-r">${fmt(it.input)}</td><td class="tu-r">${fmt(it.output)}</td><td class="tu-r tu-b">${fmt(it.total)}</td><td>${tuT(it.ts)}</td><td><button type="button" class="tu-del" data-del="${esc(iid)}" title="Delete" ${iid ? "" : "disabled"}>🗑</button></td></tr>`;
        }).join("") : "");
    }
    return `<tr class="tu-row tu-run" data-ids="${idStr}">${cb}<td class="tu-mono">${esc(r.rid || "(unsaved)")}</td><td>${tuSrc(r)}</td><td><span class="tu-pill">${esc(r.action)}${r.template ? " · " + esc(r.template) : ""}</span></td><td>${esc(r.model)}</td><td class="tu-r">${fmt(r.input)}</td><td class="tu-r">${fmt(r.output)}</td><td class="tu-r tu-b">${fmt(r.total)}</td><td>${tuT(r.ts)}</td><td>${del}</td></tr>`;
  }).join("");
  const totalRows = j.total_rows != null ? j.total_rows : j.rows.length;
  $("#tuBody").innerHTML = `<div class="card tu-flt"><label>From<input type="date" id="tuFrom" value="${esc(f.from)}"></label><label>To<input type="date" id="tuTo" value="${esc(f.to)}"></label>
    <label>Mode<select id="tuMode">${opt("all", "All modes", f.mode)}${opt("jira", "Single (Jira)", f.mode)}${opt("local", "Single (Local)", f.mode)}${opt("batch", "Batch", f.mode)}</select></label>
    <label>Model<select id="tuModel">${opt("all", "All models", f.model)}${j.models.map((m) => opt(m, m, f.model)).join("")}</select></label>
    <button class="btn" id="tuApply">Apply</button><a class="btn" id="tuCsv" style="margin-left:auto" href="/api/tokens/export.csv?${tuFilterQS()}" download>⬇ Export CSV</a></div>
  <div class="tu-cards">
    <div class="card" id="tuToday"><div class="tu-k">Today — total tokens</div><div class="tu-v">${fmt(j.today.total)}</div><div class="tu-s">Input ${fmt(j.today.input)} · Output ${fmt(j.today.output)}</div></div>
    <div class="card" id="tuMonth"><div class="tu-k">This month (${esc(j.month.label)})</div><div class="tu-v">${tuK(j.month.total)}</div><div class="tu-s">Input ${tuK(j.month.input)} · Output ${tuK(j.month.output)} · ${fmt(j.month.runs)} runs</div></div>
    <div class="card" id="tuCost"><div class="tu-k">Estimated cost (month)</div><div class="tu-v">$${j.month.cost.toFixed(2)}</div><div class="tu-s">At $${s.token_rate_input}/1M input · $${s.token_rate_output}/1M output</div></div>
    <div class="card" id="tuQuota"><div class="tu-k">Daily quota (settings limit)</div><div class="tu-v">${Math.round(j.today.pct)}%</div><div class="tu-q ${j.today.pct > 100 ? "over" : ""}"><div style="width:${Math.min(100, j.today.pct)}%"></div></div><div class="tu-s">${tuK(j.today.total)} of ${tuK(s.token_daily_limit)}/day · <a href="#" id="tuEditLim">limit ✎</a></div>
      <p class="tu-help">This bar uses this page’s ledger vs the Token settings daily limit — it updates if you delete history. It does <b>not</b> reset the provider’s real Gemini quota file (<span class="mono">reports/gemini_usage.json</span>).</p></div></div>
  <div class="tu-two"><div class="card"><h3>Daily usage — last 14 days (total tokens)</h3><div class="tu-chart" id="tuChart">${j.daily.map((d) => `<div class="tu-bc ${d.date === today ? "today" : ""}" title="${d.date}: ${fmt(d.total)} tokens"><div class="tu-bv">${d.total ? tuK(d.total) : ""}</div><div class="tu-bar" data-v="${d.total}" style="height:${Math.round((d.total / mx) * 150)}px"></div><div class="tu-bl">${d.date.slice(8)}</div></div>`).join("")}</div></div>
    <div class="card" id="tuBreak"><h3>Breakdown by action (this range)</h3>${j.breakdown.map((b) => `<div class="tu-ar" data-a="${esc(b.action)}"><span>${esc(b.action)}</span><div class="tu-trk"><div style="width:${b.pct}%"></div></div><b>${b.pct}%</b></div>`).join("")}<p class="tu-s" style="margin-top:12px">Batch runs counted under their underlying actions.</p></div></div>
  <div class="card" id="tuTbl"><h3>Per-run usage <span class="tu-s" style="font-weight:400">(${j.count} call${j.count === 1 ? "" : "s"}${f.mode !== "all" ? " · " + (TU_MODE[f.mode] || f.mode) : ""})</span></h3>
    <div class="tu-acts">
      <button type="button" class="btn g sm" id="tuDelSel" disabled>Delete selected</button>
      <label>Delete older than<input type="date" id="tuBefore" value=""></label>
      <button type="button" class="btn g sm" id="tuDelOlder">Delete older…</button>
    </div>
    ${rows ? `<table class="tu-tbl"><tr><th class="tu-cb"><input type="checkbox" id="tuSelAll" title="Select all on this page"></th><th>Run ID</th><th>Ticket / source</th><th>Mode / action</th><th>Model</th><th class="tu-r">Input</th><th class="tu-r">Output</th><th class="tu-r">Total</th><th>Time</th><th></th></tr>${rows}</table>${tuPager(totalRows, TU.page, TU.size)}` : `<div class="muted" id="tuEmpty">No token usage recorded for these filters yet.</div>`}
    <p class="tu-help">Deleting history updates the tiles, chart, breakdown, and the Dashboard AI token totals (same ledger). CSV export still downloads every row in the current filter, not just this page. The provider’s real Gemini daily quota is unchanged.</p></div>
  <div class="card" id="tuSettings"><h3>Token settings</h3><div class="tu-set tu-flt"><label>Daily token limit<input id="tuLim" type="number" min="1" step="1" value="${s.token_daily_limit}"></label><label>$ per 1M input tokens<input id="tuRin" type="number" min="0" step="0.01" value="${s.token_rate_input}"></label><label>$ per 1M output tokens<input id="tuRout" type="number" min="0" step="0.01" value="${s.token_rate_output}"></label><button class="btn" id="tuSave">Save</button></div><p class="tu-s" style="margin-top:8px">Stored in backend/app_settings.json. Used for the quota bar and cost estimate only.</p></div>`;
  const read = () => { TU.f = { from: $("#tuFrom").value, to: $("#tuTo").value, mode: $("#tuMode").value, model: $("#tuModel").value }; };
  $("#tuApply").onclick = () => { read(); TU.page = 1; viewTokens(v); };
  $$("#tuTbl .tu-tog").forEach((b) => (b.onclick = () => { const r = j.rows[+b.dataset.i]; TU.open[r.batch_id] = !TU.open[r.batch_id]; viewTokens(v); }));
  $("#tuEditLim").onclick = (e) => { e.preventDefault(); $("#tuLim").focus(); $("#tuSettings").scrollIntoView({ block: "center" }); };
  $("#tuSave").onclick = async () => {
    try { await api("/api/settings/tokens", { method: "PUT", body: { token_daily_limit: $("#tuLim").value, token_rate_input: $("#tuRin").value, token_rate_output: $("#tuRout").value } }); toast("Token settings saved."); viewTokens(v); }
    catch (e) { toast(e.message, true); }
  };
  const pg = $("#tuPg");
  if (pg) {
    $$("button[data-p]", pg).forEach((b) => (b.onclick = () => { TU.page = +b.dataset.p; viewTokens(v); }));
    const sz = $("#tuSize");
    if (sz) sz.onchange = () => { TU.size = +sz.value; tuSaveSize(TU.size); TU.page = 1; viewTokens(v); };
  }
  $$("#tuTbl input[data-ids]").forEach((cb) => (cb.onchange = () => {
    const ids = (cb.dataset.ids || "").split(",").filter(Boolean);
    ids.forEach((id) => { if (cb.checked) TU.sel.add(id); else TU.sel.delete(id); });
    tuUpdateSelBar();
  }));
  const selAll = $("#tuSelAll");
  if (selAll) selAll.onchange = () => {
    tuPageIds(j.rows).forEach((id) => { if (selAll.checked) TU.sel.add(id); else TU.sel.delete(id); });
    $$("#tuTbl input[data-ids]").forEach((cb) => { if (!cb.disabled) cb.checked = selAll.checked; });
    tuUpdateSelBar();
  };
  const reload = async (ok) => { if (ok) viewTokens(v); };
  $("#tuDelSel").onclick = () => { const ids = [...TU.sel]; if (!ids.length) return; tuConfirmDelete({ ids, label: `${ids.length} selected entr${ids.length === 1 ? "y" : "ies"}` }).then(reload); };
  $$("#tuTbl [data-del]").forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const ids = (b.dataset.del || "").split(",").filter(Boolean);
    if (!ids.length) return;
    tuConfirmDelete({ ids, label: ids.length > 1 ? `this batch (${ids.length} entries)` : "this entry" }).then(reload);
  }));
  $("#tuDelOlder").onclick = () => {
    const before = ($("#tuBefore") && $("#tuBefore").value) || "";
    if (!before) { toast("Pick a date first.", true); return; }
    tuConfirmDelete({ before, label: `entries older than ${before}` }).then(reload);
  };
  tuUpdateSelBar();
}
