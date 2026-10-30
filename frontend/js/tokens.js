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
.tu-set{display:flex;gap:10px;align-items:end;flex-wrap:wrap}`;
  document.head.appendChild(st);
})();
const TU = { f: null, open: {} };
const tuK = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(2) + " M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n); };
const tuT = (ts) => { const d = new Date(ts); return isNaN(d) ? esc(ts || "") : d.toLocaleString("en-US", { month: "short", day: "numeric" }) + ", " + d.toTimeString().slice(0, 5); };
function tuDay(off) { const d = new Date(); d.setDate(d.getDate() - off); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function tuQS() { const f = TU.f; return new URLSearchParams({ from: f.from, to: f.to, mode: f.mode, model: f.model }).toString(); }
function tuSrc(r) { const t = r.title ? " · " + esc(r.title.slice(0, 40)) : ""; return r.source === "local" && !r.story_id ? "Local" + t : esc(r.story_id || (r.source === "local" ? "Local" : "—")) + t; }
const TU_MODE = { jira: "Single (Jira)", local: "Single (Local)", batch: "Batch" };
async function viewTokens(v) {
  if (!TU.f) TU.f = { from: tuDay(13), to: tuDay(0), mode: "all", model: "all" };
  v.innerHTML = `<h1>Token Usage</h1><p class="sub">Gemini token consumption per run, per day and per action.</p><div id="tuBody"><div class="muted">Loading…</div></div>`;
  let j; try { j = await api("/api/tokens?" + tuQS()); } catch (e) { $("#tuBody").innerHTML = `<div class="warn">${esc(e.message)}</div>`; return; }
  if (S.view !== "tokens") return;
  const f = TU.f, s = j.settings, mx = Math.max(1, ...j.daily.map((d) => d.total)), today = tuDay(0);
  const opt = (val, lbl, cur) => `<option value="${esc(val)}" ${val === cur ? "selected" : ""}>${esc(lbl)}</option>`;
  const rows = j.rows.map((r, i) => r.kind === "batch"
    ? `<tr class="tu-row tu-batch" data-i="${i}" data-bid="${esc(r.batch_id)}"><td class="tu-mono"><button class="tu-tog" data-i="${i}" title="Show per-item breakdown">${TU.open[r.batch_id] ? "▾" : "▸"}</button>${esc(r.rid)}</td><td>${esc(r.source_label)}</td><td><span class="tu-pill">Batch generate</span></td><td>${esc(r.model)}</td><td class="tu-r">${fmt(r.input)}</td><td class="tu-r">${fmt(r.output)}</td><td class="tu-r tu-b">${fmt(r.total)}</td><td>${tuT(r.ts)}</td></tr>`
      + (TU.open[r.batch_id] ? r.items.map((it) => `<tr class="tu-item" data-b="${esc(r.rid)}" data-bid="${esc(r.batch_id)}"><td class="tu-mono">↳ ${esc(it.rid || "—")}</td><td>${tuSrc(it)}</td><td><span class="tu-pill">${esc(it.action)}${it.template ? " · " + esc(it.template) : ""}</span></td><td>${esc(it.model)}</td><td class="tu-r">${fmt(it.input)}</td><td class="tu-r">${fmt(it.output)}</td><td class="tu-r tu-b">${fmt(it.total)}</td><td>${tuT(it.ts)}</td></tr>`).join("") : "")
    : `<tr class="tu-row tu-run"><td class="tu-mono">${esc(r.rid || "(unsaved)")}</td><td>${tuSrc(r)}</td><td><span class="tu-pill">${esc(r.action)}${r.template ? " · " + esc(r.template) : ""}</span></td><td>${esc(r.model)}</td><td class="tu-r">${fmt(r.input)}</td><td class="tu-r">${fmt(r.output)}</td><td class="tu-r tu-b">${fmt(r.total)}</td><td>${tuT(r.ts)}</td></tr>`).join("");
  $("#tuBody").innerHTML = `<div class="card tu-flt"><label>From<input type="date" id="tuFrom" value="${esc(f.from)}"></label><label>To<input type="date" id="tuTo" value="${esc(f.to)}"></label>
    <label>Mode<select id="tuMode">${opt("all", "All modes", f.mode)}${opt("jira", "Single (Jira)", f.mode)}${opt("local", "Single (Local)", f.mode)}${opt("batch", "Batch", f.mode)}</select></label>
    <label>Model<select id="tuModel">${opt("all", "All models", f.model)}${j.models.map((m) => opt(m, m, f.model)).join("")}</select></label>
    <button class="btn" id="tuApply">Apply</button><a class="btn" id="tuCsv" style="margin-left:auto" href="/api/tokens/export.csv?${tuQS()}" download>⬇ Export CSV</a></div>
  <div class="tu-cards">
    <div class="card" id="tuToday"><div class="tu-k">Today — total tokens</div><div class="tu-v">${fmt(j.today.total)}</div><div class="tu-s">Input ${fmt(j.today.input)} · Output ${fmt(j.today.output)}</div></div>
    <div class="card" id="tuMonth"><div class="tu-k">This month (${esc(j.month.label)})</div><div class="tu-v">${tuK(j.month.total)}</div><div class="tu-s">Input ${tuK(j.month.input)} · Output ${tuK(j.month.output)} · ${fmt(j.month.runs)} runs</div></div>
    <div class="card" id="tuCost"><div class="tu-k">Estimated cost (month)</div><div class="tu-v">$${j.month.cost.toFixed(2)}</div><div class="tu-s">At $${s.token_rate_input}/1M input · $${s.token_rate_output}/1M output</div></div>
    <div class="card" id="tuQuota"><div class="tu-k">Daily quota (Gemini limit)</div><div class="tu-v">${Math.round(j.today.pct)}%</div><div class="tu-q ${j.today.pct > 100 ? "over" : ""}"><div style="width:${Math.min(100, j.today.pct)}%"></div></div><div class="tu-s">${tuK(j.today.total)} of ${tuK(s.token_daily_limit)}/day · <a href="#" id="tuEditLim">limit ✎</a></div></div></div>
  <div class="tu-two"><div class="card"><h3>Daily usage — last 14 days (total tokens)</h3><div class="tu-chart" id="tuChart">${j.daily.map((d) => `<div class="tu-bc ${d.date === today ? "today" : ""}" title="${d.date}: ${fmt(d.total)} tokens"><div class="tu-bv">${d.total ? tuK(d.total) : ""}</div><div class="tu-bar" data-v="${d.total}" style="height:${Math.round((d.total / mx) * 150)}px"></div><div class="tu-bl">${d.date.slice(8)}</div></div>`).join("")}</div></div>
    <div class="card" id="tuBreak"><h3>Breakdown by action (this range)</h3>${j.breakdown.map((b) => `<div class="tu-ar" data-a="${esc(b.action)}"><span>${esc(b.action)}</span><div class="tu-trk"><div style="width:${b.pct}%"></div></div><b>${b.pct}%</b></div>`).join("")}<p class="tu-s" style="margin-top:12px">Batch runs counted under their underlying actions.</p></div></div>
  <div class="card" id="tuTbl"><h3>Per-run usage <span class="tu-s" style="font-weight:400">(${j.count} Gemini calls${f.mode !== "all" ? " · " + TU_MODE[f.mode] : ""})</span></h3>${rows ? `<table class="tu-tbl"><tr><th>Run ID</th><th>Ticket / source</th><th>Mode / action</th><th>Model</th><th class="tu-r">Input</th><th class="tu-r">Output</th><th class="tu-r">Total</th><th>Time</th></tr>${rows}</table>` : `<div class="muted" id="tuEmpty">No token usage recorded for these filters yet.</div>`}</div>
  <div class="card" id="tuSettings"><h3>Token settings</h3><div class="tu-set tu-flt"><label>Daily token limit<input id="tuLim" type="number" min="1" step="1" value="${s.token_daily_limit}"></label><label>$ per 1M input tokens<input id="tuRin" type="number" min="0" step="0.01" value="${s.token_rate_input}"></label><label>$ per 1M output tokens<input id="tuRout" type="number" min="0" step="0.01" value="${s.token_rate_output}"></label><button class="btn" id="tuSave">Save</button></div><p class="tu-s" style="margin-top:8px">Stored in backend/app_settings.json. Used for the quota bar and cost estimate only.</p></div>`;
  const read = () => { TU.f = { from: $("#tuFrom").value, to: $("#tuTo").value, mode: $("#tuMode").value, model: $("#tuModel").value }; };
  $("#tuApply").onclick = () => { read(); viewTokens(v); };
  $$("#tuTbl .tu-tog").forEach((b) => (b.onclick = () => { const r = j.rows[+b.dataset.i]; TU.open[r.batch_id] = !TU.open[r.batch_id]; viewTokens(v); }));
  $("#tuEditLim").onclick = (e) => { e.preventDefault(); $("#tuLim").focus(); $("#tuSettings").scrollIntoView({ block: "center" }); };
  $("#tuSave").onclick = async () => {
    try { await api("/api/settings/tokens", { method: "PUT", body: { token_daily_limit: $("#tuLim").value, token_rate_input: $("#tuRin").value, token_rate_output: $("#tuRout").value } }); toast("Token settings saved."); viewTokens(v); }
    catch (e) { toast(e.message, true); }
  };
}
