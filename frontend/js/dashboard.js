/* Dashboard page (additive, data-view="dashboard", routes #dashboard and #dashboard/<section>).
   Read-only; data from GET /api/dashboard. Charts are pure SVG built here (no libraries). */
"use strict";
(function () {
  const SECS = [
    { id: "cases", title: "Test cases by story", sub: "How many cases each story / folder has, and their status." },
    { id: "progress", title: "Cycle progress", sub: "How much of each active cycle has been run." },
    { id: "results", title: "Pass / Fail / Blocked / Not run", sub: "Result counts per cycle." },
    { id: "failed", title: "Failed cases and Jira defects", sub: "Failed cases and the defect keys linked to them." },
    { id: "testers", title: "Cases executed per tester", sub: "Executions recorded per tester." },
    { id: "ai", title: "AI-generated cases and token usage", sub: "Case sources and Gemini token usage per story / run." },
  ];
  const COL = { Draft: "#64748b", Ready: "#16a34a", Obsolete: "#d97706", Archived: "#1e293b", Pass: "#16a34a", Fail: "#dc2626", Blocked: "#b45309", "Not run": "#94a3b8",
    Executed: "#4f46e5", AI: "#4f46e5", Manual: "#0ea5e9", Record: "#d97706", Input: "#4f46e5", Output: "#0ea5e9", "With defect": "#16a34a", "No defect": "#dc2626" };
  const PAL = ["#4f46e5", "#0ea5e9", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#65a30d", "#db2777", "#475569"];
  const LS = "atg_dashboard_v1";
  const D = { data: null, sub: "story" };
  const cfgDefault = () => ({ order: SECS.map((s) => s.id), hidden: {}, chart: {}, defChart: {}, cycle: "", range: "" });
  function cfg() { try { return { ...cfgDefault(), ...JSON.parse(localStorage.getItem(LS) || "{}") }; } catch { return cfgDefault(); } }
  function saveCfg(c) { localStorage.setItem(LS, JSON.stringify(c)); }
  const chartOf = (id) => { const c = cfg(); return c.chart[id] || c.defChart[id] || "table"; };
  const n = (x) => fmt(x || 0);
  const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);
  const day = (ts) => String(ts || "").slice(0, 10);
  const cName = (id) => (SECS.find((s) => s.id === id) || {}).title || id;
  function rangeDates(r) {
    if (!r) return {};
    const t = new Date(), f = new Date(); f.setDate(t.getDate() - (Number(r) - 1));
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { from: iso(f), to: iso(t) };
  }

  // ---------------------------------------------------------------- SVG charts
  function legend(items) { return `<div class="db-key">${items.map((i) => `<span><i style="background:${i.color}"></i>${esc(i.label)}${i.value !== undefined ? ` <b>${n(i.value)}</b>` : ""}</span>`).join("")}</div>`; }
  function donut(slices, centreLabel) {
    slices = slices.filter((s) => s.value > 0);
    const tot = slices.reduce((a, s) => a + s.value, 0);
    if (!tot) return `<div class="db-empty">No data to chart yet.</div>`;
    const R = 70, r = 44, cx = 90, cy = 90; let a0 = -Math.PI / 2, paths = "";
    for (const s of slices) {
      const frac = s.value / tot;
      if (frac >= 0.9999) { paths += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${s.color}" stroke-width="${R - r}"><title>${esc(s.label)}: ${n(s.value)}</title></circle>`; break; }
      const a1 = a0 + frac * 2 * Math.PI, big = frac > 0.5 ? 1 : 0;
      const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
      paths += `<path d="M${p(R, a0)} A${R},${R} 0 ${big} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${big} 0 ${p(r, a0)} Z" fill="${s.color}"><title>${esc(s.label)}: ${n(s.value)} (${pct(s.value, tot)}%)</title></path>`;
      a0 = a1;
    }
    return `<div class="db-donut"><svg viewBox="0 0 180 180" width="190" height="190" role="img">${paths}
      <text x="90" y="88" text-anchor="middle" class="db-ct">${n(tot)}</text><text x="90" y="106" text-anchor="middle" class="db-cl">${esc(centreLabel || "total")}</text></svg>
      <div class="db-dl">${slices.map((s) => `<div><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${n(s.value)}</b><em>${pct(s.value, tot)}%</em></div>`).join("")}</div></div>`;
  }
  function bars(cats, series) {
    if (!cats.length) return `<div class="db-empty">No data to chart yet.</div>`;
    const totals = cats.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
    const max = Math.max(1, ...totals);
    const step = Math.pow(10, Math.floor(Math.log10(max))); let top = Math.ceil(max / step) * step; if (top / step <= 2) top = Math.ceil(max / (step / 2)) * (step / 2);
    const H = 200, padL = 48, padB = 46, padT = 18, bw = Math.max(18, Math.min(56, 520 / cats.length - 14)), gap = Math.max(14, bw * 0.6);
    const W = padL + cats.length * (bw + gap) + gap, y = (v) => padT + H - (v / top) * H;
    let g = "";
    for (let k = 0; k <= 4; k++) { const v = (top / 4) * k, yy = y(v); g += `<line x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}" class="db-grid"/><text x="${padL - 6}" y="${yy + 4}" text-anchor="end" class="db-ax">${n(Math.round(v))}</text>`; }
    let b = "";
    cats.forEach((c, i) => {
      const x = padL + gap + i * (bw + gap); let acc = 0;
      series.forEach((s) => { const v = s.values[i] || 0; if (!v) return; const y1 = y(acc + v), y0 = y(acc); b += `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" fill="${s.color}"><title>${esc(c)} · ${esc(s.name)}: ${n(v)}</title></rect>`; acc += v; });
      b += `<text x="${x + bw / 2}" y="${y(acc) - 5}" text-anchor="middle" class="db-vl">${n(totals[i])}</text>`;
      const lab = String(c).length > 14 ? String(c).slice(0, 13) + "…" : c;
      b += `<text x="${x + bw / 2}" y="${padT + H + 16}" text-anchor="middle" class="db-ax"><title>${esc(c)}</title>${esc(lab)}</text>`;
    });
    const axis = `<line x1="${padL}" x2="${padL}" y1="${padT}" y2="${padT + H}" class="db-axl"/><line x1="${padL}" x2="${W}" y1="${padT + H}" y2="${padT + H}" class="db-axl"/>`;
    return `${series.length > 1 ? legend(series.map((s) => ({ label: s.name, color: s.color }))) : ""}<div class="db-bars"><svg viewBox="0 0 ${W} ${padT + H + padB}" width="${W}" height="${padT + H + padB}" role="img">${g}${axis}${b}</svg></div>`;
  }
  const ser = (name, values, color) => ({ name, values, color: color || COL[name] || PAL[0] });

  // ---------------------------------------------------------------- section content
  function stackBar(vals) { const t = vals.reduce((a, v) => a + v.v, 0); return t ? `<div class="db-sb">${vals.filter((v) => v.v).map((v) => `<i style="flex:${v.v} 0 0;background:${COL[v.k]}" title="${esc(v.k)}: ${v.v}">${v.v}</i>`).join("")}</div>` : `<span class="muted">—</span>`; }
  function prog(a, b) { const p = pct(a, b); return `<div class="db-pb"><i style="width:${p}%"></i><span>${n(a)} of ${n(b)} executed (${p}%)</span></div>`; }
  function tbl(head, rows, tot, nums) {
    nums = nums || [];
    const td = (x, i) => `<td class="${nums.includes(i) ? "n" : ""}">${x}</td>`;
    return `<div class="db-tw"><table class="db-t"><tr>${head.map((h, i) => `<th class="${nums.includes(i) ? "n" : ""}">${h}</th>`).join("")}</tr>
      ${rows.length ? rows.map((r) => `<tr class="${r.cls || ""}">${r.c.map(td).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="db-empty">Nothing here yet.</td></tr>`}
      ${tot && rows.length ? `<tr class="tot">${tot.map(td).join("")}</tr>` : ""}</table></div>`;
  }
  const sum = (a, k) => a.reduce((s, r) => s + (r[k] || 0), 0);
  function jiraLink(k) { const b = D.data.jira_base; return b ? `<a class="db-lk" href="${esc(b)}/browse/${encodeURIComponent(k)}" target="_blank" rel="noopener">${esc(k)}</a>` : `<b>${esc(k)}</b>`; }

  const SEC = {
    cases: {
      rows: () => (D.sub === "folder" ? D.data.cases.by_folder : D.data.cases.by_story),
      extra: () => `<div class="seg db-sub"><button data-sub="story" class="${D.sub === "story" ? "a" : ""}">By story</button><button data-sub="folder" class="${D.sub === "folder" ? "a" : ""}">By folder</button></div>`,
      table(lim) { const st = D.data.cases.statuses, all = this.rows(), rs = lim ? all.slice(0, lim) : all;
        return legend(st.map((s) => ({ label: s, color: COL[s] }))) + tbl([D.sub === "folder" ? "Folder" : "Story", "Total", ...st, "Status split"],
          rs.map((r) => ({ c: [esc(r.label), n(r.total), ...st.map((s) => n(r[s])), stackBar(st.map((s) => ({ k: s, v: r[s] })))] })),
          ["Total", n(sum(all, "total")), ...st.map((s) => n(sum(all, s))), stackBar(st.map((s) => ({ k: s, v: sum(all, s) })))], [1, 2, 3, 4, 5]); },
      donut() { const all = this.rows(); return donut(D.data.cases.statuses.map((s) => ({ label: s, value: sum(all, s), color: COL[s] })), "cases"); },
      bar(lim) { const all = lim ? this.rows().slice(0, 8) : this.rows(); return bars(all.map((r) => r.label), D.data.cases.statuses.map((s) => ser(s, all.map((r) => r[s])))); },
    },
    progress: {
      table(lim) { const all = D.data.progress, rs = lim ? all.slice(0, lim) : all;
        return tbl(["Cycle", "Cases", "Executed", "Passed", "Failed", "Blocked", "Not run", "Progress"],
          rs.map((r) => ({ c: [`<b>${esc(r.name)}</b><div class="muted">${esc(day(r.start))}${r.end ? " → " + esc(day(r.end)) : ""}</div>`, n(r.total), n(r.executed), n(r.passed), n(r.failed), n(r.blocked), n(r.not_run), prog(r.executed, r.total)] })),
          [`Total (${all.length} cycles)`, n(sum(all, "total")), n(sum(all, "executed")), n(sum(all, "passed")), n(sum(all, "failed")), n(sum(all, "blocked")), n(sum(all, "not_run")), prog(sum(all, "executed"), sum(all, "total"))], [1, 2, 3, 4, 5, 6]); },
      donut() { const a = D.data.progress; return donut([{ label: "Executed", value: sum(a, "executed"), color: COL.Executed }, { label: "Not run", value: sum(a, "not_run"), color: COL["Not run"] }], "cases"); },
      bar(lim) { const a = lim ? D.data.progress.slice(0, 8) : D.data.progress; return bars(a.map((r) => r.name), [ser("Executed", a.map((r) => r.executed)), ser("Not run", a.map((r) => r.not_run))]); },
    },
    results: {
      table(lim) { const all = D.data.results, rs = lim ? all.slice(0, lim) : all, K = ["Pass", "Fail", "Blocked", "Not run"];
        return legend(K.map((k) => ({ label: k, color: COL[k] }))) + tbl(["Cycle", "Passed", "Failed", "Blocked", "Not run", "Total", "Split"],
          rs.map((r) => ({ c: [`<b>${esc(r.name)}</b>`, ...K.map((k) => n(r[k])), n(r.total), stackBar(K.map((k) => ({ k, v: r[k] })))] })),
          ["Total", ...K.map((k) => n(sum(all, k))), n(sum(all, "total")), stackBar(K.map((k) => ({ k, v: sum(all, k) })))], [1, 2, 3, 4, 5]); },
      donut() { const a = D.data.results; return donut(["Pass", "Fail", "Blocked", "Not run"].map((k) => ({ label: k, value: sum(a, k), color: COL[k] })), "cases"); },
      bar(lim) { const a = lim ? D.data.results.slice(0, 8) : D.data.results; return bars(a.map((r) => r.name), ["Pass", "Fail", "Blocked", "Not run"].map((k) => ser(k, a.map((r) => r[k])))); },
    },
    failed: {
      table(lim) { const all = D.data.failed, rs = lim ? all.slice(0, lim) : all, wd = all.filter((f) => f.defects.length).length;
        return tbl(["TC-ID", "Title", "Cycle", "Failed on", "Tester", "Jira defect", "Defect status", ""],
          rs.map((f) => ({ cls: f.defects.length ? "" : "warn", c: [`<a class="db-lk" href="#repo/case/${encodeURIComponent(f.case_id)}">${esc(f.case_id)}</a>`, esc(f.title), esc(f.cycle), esc(day(f.failed_on)), esc(f.tester || "—"),
            f.defects.length ? f.defects.map(jiraLink).join(", ") : `<span class="db-nod">No defect logged</span>`,
            f.defects.length ? `<span class="muted" title="Jira status is not fetched by this app">not synced</span>` : "—",
            `<button class="btn g sm" disabled title="Log defect to Jira – coming soon">+ Log defect</button>`] })),
          [`Total ${all.length}`, `${wd} with a defect · ${all.length - wd} without`, "", "", "", "", "", ""]); },
      donut() { const a = D.data.failed, w = a.filter((f) => f.defects.length).length; return donut([{ label: "With defect", value: w, color: COL["With defect"] }, { label: "No defect", value: a.length - w, color: COL["No defect"] }], "failed"); },
      bar() { const m = {}; D.data.failed.forEach((f) => { const r = (m[f.cycle] = m[f.cycle] || [0, 0]); r[f.defects.length ? 0 : 1]++; }); const k = Object.keys(m);
        return bars(k, [ser("With defect", k.map((x) => m[x][0])), ser("No defect", k.map((x) => m[x][1]))]); },
    },
    testers: {
      table(lim) { const all = D.data.testers, rs = lim ? all.slice(0, lim) : all, mx = Math.max(1, ...all.map((t) => t.executed));
        return tbl(["Tester", "Executed", "Passed", "Failed", "Blocked", "Executed (bar)"],
          rs.map((t) => ({ c: [`<b>${esc(t.tester)}</b>`, n(t.executed), n(t.passed), n(t.failed), n(t.blocked), `<div class="db-pb"><i style="width:${pct(t.executed, mx)}%"></i><span>${n(t.executed)} executed</span></div>`] })),
          ["Total", n(sum(all, "executed")), n(sum(all, "passed")), n(sum(all, "failed")), n(sum(all, "blocked")), ""], [1, 2, 3, 4]); },
      donut() { return donut(D.data.testers.map((t, i) => ({ label: t.tester, value: t.executed, color: PAL[i % PAL.length] })), "executed"); },
      bar(lim) { const a = lim ? D.data.testers.slice(0, 8) : D.data.testers; return bars(a.map((t) => t.tester), [ser("Pass", a.map((t) => t.passed)), ser("Fail", a.map((t) => t.failed)), ser("Blocked", a.map((t) => t.blocked))]); },
    },
    ai: {
      table(lim) { const ai = D.data.ai, all = ai.tokens, rs = lim ? all.slice(0, lim) : all, s = ai.sources, tc = s.AI + s.Manual + s.Record;
        const tiles = `<div class="db-mini"><div><div class="l">AI-generated cases</div><div class="v">${n(s.AI)}</div><div class="c">${pct(s.AI, tc)}% of ${n(tc)} cases</div></div>
          <div><div class="l">Manual cases</div><div class="v">${n(s.Manual)}</div><div class="c">${s.Record ? n(s.Record) + " recorded" : "written by hand"}</div></div>
          <div><div class="l">Total tokens</div><div class="v">${n(ai.total_tokens)}</div><div class="c">${n(all.length)} stories / runs</div></div>
          <div><div class="l">Estimated cost</div><div class="v">$${Number(ai.cost || 0).toFixed(2)}</div><div class="c">At $${ai.rates.input}/1M in · $${ai.rates.output}/1M out</div></div></div>`;
        return tiles + tbl(["Story / run", "Last run", "Runs", "Cases (AI, in repo)", "Model", "Input tokens", "Output tokens", "Cost"],
          rs.map((r) => ({ c: [`<b>${esc(r.story || r.key)}</b>${r.title ? `<div class="muted">${esc(r.title)}</div>` : ""}`, esc(day(r.last)), n(r.runs), n(r.cases), esc(r.model), n(r.input), n(r.output), "$" + Number(r.cost).toFixed(2)] })),
          [`Total (${all.length})`, "", n(sum(all, "runs")), n(sum(all, "cases")), "", n(sum(all, "input")), n(sum(all, "output")), "$" + sum(all, "cost").toFixed(2)], [2, 3, 5, 6, 7]); },
      donut() { const s = D.data.ai.sources; return donut(["AI", "Manual", "Record"].map((k) => ({ label: k, value: s[k], color: COL[k] })), "cases"); },
      bar(lim) { const a = lim ? D.data.ai.tokens.slice(0, 8) : D.data.ai.tokens; return bars(a.map((r) => r.story || r.key), [ser("Input", a.map((r) => r.input)), ser("Output", a.map((r) => r.output))]); },
    },
  };

  function body(id, lim) { const t = chartOf(id), s = SEC[id]; return t === "donut" ? s.donut(lim) : t === "bar" ? s.bar(lim) : s.table(lim); }
  function header(id, detail) {
    const i = SECS.findIndex((s) => s.id === id) + 1, s = SECS[i - 1], t = chartOf(id);
    return `<div class="db-sh"><div><div class="db-st">${detail ? "" : i + " · "}${esc(s.title)}</div><div class="db-ss">${esc(s.sub)}</div></div>
      <div class="db-sr">${SEC[id].extra ? SEC[id].extra() : ""}<div class="seg db-cs" data-sec="${id}">${["table", "donut", "bar"].map((k) => `<button data-ct="${k}" class="${t === k ? "a" : ""}">${{ table: "Table", donut: "Donut", bar: "Bar" }[k]}</button>`).join("")}</div>
      ${detail ? "" : `<a class="db-va" href="#dashboard/${id}">View all →</a>`}</div></div>`;
  }
  function section(id, detail) { return `<div class="card db-sec" data-sec="${id}">${header(id, detail)}<div class="db-sb-body">${body(id, detail ? 0 : 5)}</div></div>`; }
  function bindSec(root, detail) {
    $$(".db-cs button", root).forEach((b) => (b.onclick = () => { const c = cfg(); c.chart[b.closest(".db-cs").dataset.sec] = b.dataset.ct; saveCfg(c); refresh(root, detail); }));
    $$(".db-sub button", root).forEach((b) => (b.onclick = () => { D.sub = b.dataset.sub; refresh(root, detail); }));
  }
  function refresh(root, detail) { $$(".db-sec", root).forEach((el) => { el.outerHTML = section(el.dataset.sec, detail); }); bindSec(root, detail); }

  // ---------------------------------------------------------------- views
  async function load(params) {
    const q = new URLSearchParams(); Object.entries(params).forEach(([k, v]) => v && q.set(k, v));
    D.data = await api("/api/dashboard?" + q.toString());
  }
  function tiles(t) {
    return `<div class="db-tiles">
      <div class="db-tile"><div class="l">Total test cases</div><div class="v">${n(t.total_cases)}</div><div class="c">in ${n(t.stories)} stories</div></div>
      <div class="db-tile"><div class="l">Active cycles</div><div class="v">${n(t.active_cycles)}</div><div class="c">${esc(t.active_cycle_names.join(", ") || "none yet")}</div></div>
      <div class="db-tile ok"><div class="l">Pass rate (active cycles)</div><div class="v">${t.pass_rate === null ? "—" : t.pass_rate + "%"}</div><div class="c">${n(t.passed)} passed of ${n(t.executed)} executed</div></div>
      <div class="db-tile bad"><div class="l">Failed cases without a defect</div><div class="v">${n(t.failed_no_defect)}</div><div class="c">of ${n(t.failed)} failed</div></div></div>`;
  }
  async function overview(v) {
    const c = cfg();
    v.innerHTML = `<div class="dbv"><h1>Dashboard</h1><div class="sub">Loading…</div></div>`;
    try { await load({ cycle: c.cycle, ...rangeDates(c.range) }); } catch (e) { v.innerHTML = `<div class="dbv"><h1>Dashboard</h1><div class="card">Could not load dashboard: ${esc(e.message)}</div></div>`; return; }
    const d = D.data, ids = c.order.filter((id) => SEC[id] && !c.hidden[id]);
    v.innerHTML = `<div class="dbv"><div class="db-hd"><div><h1>Dashboard</h1><div class="sub">Live from the Test Case Repo, Test Runs and Token Usage.</div></div>
      <div class="db-tb"><label>Default cycle <select id="dbCyc"><option value="">All active cycles</option>${d.options.cycles.map((x) => `<option value="${esc(x.id)}" ${x.id === c.cycle ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      <label>Dates <select id="dbRange">${[["", "All time"], ["7", "Last 7 days"], ["14", "Last 14 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]].map(([k, l]) => `<option value="${k}" ${String(c.range) === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <button class="btn g sm" id="dbCust">✎ Customize</button></div></div>
      ${tiles(d.tiles)}${ids.map((id) => section(id, false)).join("") || `<div class="card muted">All sections are hidden — use Customize to show them.</div>`}</div>`;
    bindSec(v, false);
    $("#dbCyc").onchange = (e) => { const k = cfg(); k.cycle = e.target.value; saveCfg(k); overview(v); };
    $("#dbRange").onchange = (e) => { const k = cfg(); k.range = e.target.value; saveCfg(k); overview(v); };
    $("#dbCust").onclick = () => customize(v);
  }
  async function detail(v, id, f) {
    const c = cfg();
    f = f || { cycle: c.cycle, story: "", folder: "", ...rangeDates(c.range) };
    v.innerHTML = `<div class="dbv"><a class="db-back" href="#dashboard">← Dashboard</a><h1>${esc(cName(id))}</h1><div class="sub">Loading…</div></div>`;
    try { await load(f); } catch (e) { v.innerHTML = `<div class="dbv"><a class="db-back" href="#dashboard">← Dashboard</a><div class="card">Could not load: ${esc(e.message)}</div></div>`; return; }
    const o = D.data.options, sel = (idn, items, val, all) => `<select id="${idn}"><option value="">${all}</option>${items.map((x) => `<option value="${esc(x.id)}" ${x.id === val ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`;
    v.innerHTML = `<div class="dbv"><a class="db-back" href="#dashboard">← Dashboard</a><h1>${esc(cName(id))}</h1>
      <div class="card db-flt"><label>Story ${sel("dfS", o.stories.map((s) => ({ id: s, name: s })), f.story, "All stories")}</label>
      <label>Cycle ${sel("dfC", o.cycles, f.cycle, "All active cycles")}</label>
      <label>Folder ${sel("dfF", o.folders, f.folder, "All folders")}</label>
      <label>From <input type="date" id="dfFrom" value="${esc(f.from || "")}"></label><label>To <input type="date" id="dfTo" value="${esc(f.to || "")}"></label>
      <button class="btn sm" id="dfGo">Apply</button><button class="btn g sm" id="dfClr">Clear</button></div>
      ${section(id, true)}</div>`;
    bindSec(v, true);
    $("#dfGo").onclick = () => detail(v, id, { story: $("#dfS").value, cycle: $("#dfC").value, folder: $("#dfF").value, from: $("#dfFrom").value, to: $("#dfTo").value });
    $("#dfClr").onclick = () => detail(v, id, { story: "", cycle: "", folder: "", from: "", to: "" });
  }
  function customize(v) {
    const c = cfg(), opts = D.data ? D.data.options.cycles : [];
    openCust(c);
    function openCust(k) {
      const m = $("#modal");
      m.innerHTML = `<div class="dbv db-cust"><h3>Customize dashboard</h3><div class="muted" style="margin-bottom:10px">Drag rows to reorder. Saved in this browser.</div>
        <div id="dbList">${k.order.map((id) => `<div class="db-crow" draggable="true" data-id="${id}"><span class="db-dh">⋮⋮</span><b>${esc(cName(id))}</b>
          <select data-def="${id}">${["table", "donut", "bar"].map((t) => `<option value="${t}" ${(k.defChart[id] || "table") === t ? "selected" : ""}>${{ table: "Table", donut: "Donut", bar: "Bar" }[t]}</option>`).join("")}</select>
          <label class="db-tg"><input type="checkbox" data-show="${id}" ${k.hidden[id] ? "" : "checked"}> Show</label></div>`).join("")}</div>
        <div class="db-flt" style="margin-top:12px"><label>Default cycle <select id="dcCyc"><option value="">All active cycles</option>${opts.map((x) => `<option value="${esc(x.id)}" ${x.id === k.cycle ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
        <label>Default dates <select id="dcRange">${[["", "All time"], ["7", "Last 7 days"], ["14", "Last 14 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]].map(([a, l]) => `<option value="${a}" ${String(k.range) === a ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <div class="fl" style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn g sm" id="dcReset">Reset</button><button class="btn g sm" id="dcCancel">Cancel</button><button class="btn sm" id="dcSave">Save</button></div></div>`;
      $("#modalBg").classList.add("open");
      let drag = null;
      $$(".db-crow", m).forEach((r) => {
        r.ondragstart = () => { drag = r; r.classList.add("drag"); };
        r.ondragend = () => { r.classList.remove("drag"); drag = null; };
        r.ondragover = (e) => { e.preventDefault(); if (!drag || drag === r) return; const b = r.getBoundingClientRect(); r.parentNode.insertBefore(drag, e.clientY > b.top + b.height / 2 ? r.nextSibling : r); };
      });
      const close = () => { if (typeof closeModal === "function") closeModal(); else $("#modalBg").classList.remove("open"); };
      $("#dcCancel").onclick = close;
      $("#dcReset").onclick = () => { localStorage.removeItem(LS); close(); overview(v); };
      $("#dcSave").onclick = () => {
        const n2 = cfg();
        n2.order = $$(".db-crow", m).map((r) => r.dataset.id);
        n2.hidden = {}; $$("[data-show]", m).forEach((x) => { if (!x.checked) n2.hidden[x.dataset.show] = true; });
        n2.defChart = {}; $$("[data-def]", m).forEach((x) => { n2.defChart[x.dataset.def] = x.value; });
        n2.chart = {};   // section choices reset to the new defaults
        n2.cycle = $("#dcCyc").value; n2.range = $("#dcRange").value;
        saveCfg(n2); close(); overview(v);
      };
    }
  }

  window.viewDashboard = function (v) {
    const parts = String(S.view || "dashboard").split("/");
    if (parts[1] && SEC[parts[1]]) return detail(v, parts[1]);
    return overview(v);
  };
})();
