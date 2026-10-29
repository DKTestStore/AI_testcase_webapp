// Run history: rolling last 5 runs per browser (server keeps index in backend/history/<hid>/history.json)
const hNote = (n, batch) => batch
  ? `<div class="keepnote" id="hNote">ℹ Keeps your last ${n} entr${n === 1 ? "y" : "ies"} — a batch counts as <b>one</b> entry. When a new run or batch is saved, only the oldest entry is removed (a whole batch with all its story runs) — history is never cleared all at once.</div>`
  : `<div class="keepnote" id="hNote">ℹ Keeps your last ${n} run${n === 1 ? "" : "s"}. When a new run is saved, only the oldest one is removed — history is never cleared all at once.</div>`;
const hHasBatch = (j) => j.items.some((e) => e.kind === "batch");
const H_EXP = new Set();
const H_SRC = { "Jira": "b", "Local text": "gr", "Excel upload": "y" };
const H_ST = { "Draft": "gr", "Reviewed": "b", "Uploaded to qTest": "", "Partly uploaded": "y" };
function hDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).replace(/\bam\b/, "AM").replace(/\bpm\b/, "PM") + " IST";
}
async function refreshHistoryCount() {
  try { const j = await api("/api/history"); const c = $("#hCnt"); if (c) c.textContent = j.items.length || ""; return j; } catch { return null; }
}
function hRows(j, compact) {
  const items = j.items, full = items.length === j.max;
  return items.map((e, i) => {
    if (e.kind === "batch") return hBatchRows(e, i, j, compact, full);
    const cur = e.run_id === j.current, old = full && i === items.length - 1, pct = e.count ? Math.round(e.reviewed * 100 / e.count) : 0;
    return `<tr data-id="${esc(e.run_id)}" class="${old ? "old" : ""}">
      <td class="rid"><div class="rl"><b>${esc(e.rid)}</b>${cur ? ' <span class="pill b">current</span>' : ""}</div><div class="muted">${esc(hDate(e.created))}</div>${old ? '<span class="pill y oldtag">⟳ will be replaced next</span>' : ""}</td>
      <td><span class="pill b spill">${esc(e.story_id || "—")}</span><div class="ttl">${esc(e.title)}</div></td>
      <td><span class="pill ${H_SRC[e.source] || "gr"}">${esc(e.source)}</span></td>
      <td class="c">${e.count}</td>
      <td><div class="rvb"><span>${e.reviewed}/${e.count}</span><i><s style="width:${pct}%"></s></i></div></td>
      <td><span class="pill ${H_ST[e.status] ?? "gr"}">${e.status !== "Draft" ? "✓ " : ""}${esc(e.status)}</span></td>
      <td class="acts"><button class="btn sm h-open">▶ Open</button>${compact ? "" : '<button class="btn g sm h-xl">⬇ Excel</button><button class="btn g sm h-del">🗑 Delete</button>'}</td></tr>`;
  }).join("");
}
function hBatchRows(e, i, j, compact, full) {
  const cur = e.run_id === j.current, old = full && i === j.items.length - 1, pct = e.count ? Math.round(e.reviewed * 100 / e.count) : 0;
  const open = H_EXP.has(e.run_id) || (cur && !H_EXP.has("x" + e.run_id)), kids = e.children || [];
  let h = `<tr data-id="${esc(e.run_id)}" class="bgrp ${old ? "old" : ""}">
      <td class="rid"><div class="rl"><span class="tgl" title="Show / hide the story runs">${open ? "▾" : "▸"}</span> <b>${esc(e.rid)}</b> <span class="batch-pill" style="margin-left:4px">Batch · ${kids.length} stor${kids.length === 1 ? "y" : "ies"}</span>${cur ? ' <span class="pill b">current</span>' : ""}</div><div class="muted">${esc(hDate(e.created))}</div>${old ? '<span class="pill y oldtag">⟳ will be replaced next</span>' : ""}</td>
      <td><div class="ttl" style="margin:0;max-width:170px">${esc(e.story_id || "—")}</div></td>
      <td><span class="pill" style="background:#f3e8ff;color:#6d28d9">Batch</span></td>
      <td class="c">${e.count}</td>
      <td><div class="rvb"><span>${e.reviewed}/${e.count}</span><i><s style="width:${pct}%"></s></i></div></td>
      <td><span class="pill ${H_ST[e.status] ?? "gr"}">${e.status !== "Draft" ? "✓ " : ""}${esc(e.status)}</span></td>
      <td class="acts"><button class="btn sm h-open">▶ Open batch</button>${compact ? "" : '<button class="btn g sm h-xl">⬇ Excel (zip)</button><button class="btn g sm h-del" title="Delete this batch" style="color:#d33;border-color:#f3b4b4">🗑</button>'}</td></tr>`;
  if (open) h += kids.map((c) => `<tr class="bchild" data-bid="${esc(e.run_id)}" data-cid="${esc(c.run_id)}" data-key="${esc(c.key)}">
      <td><b>${esc(c.rid)}</b></td><td><span class="pill b spill">${esc(c.story_id || "—")}</span><div class="ttl">${esc(c.title)}</div></td>
      <td><span class="pill ${H_SRC[c.source] || "gr"}">${esc(c.source)}</span></td><td class="c">${c.count}</td><td>${c.reviewed}/${c.count}</td>
      <td><span class="pill ${H_ST[c.status] ?? "gr"}">${esc(c.status)}</span></td>
      <td class="acts"><button class="btn g sm hc-open">▶ Open</button>${compact ? "" : '<button class="btn g sm hc-xl">⬇ Excel</button>'}</td></tr>`).join("");
  return h;
}
function hTable(j, compact) {
  if (!j.items.length) return `<div class="sub" style="margin:6px 0">No saved runs yet. A run appears here once it has test cases (generate, import from Excel or save).</div>`;
  return `<table class="rh"><tr><th>${hHasBatch(j) ? "Run / Batch ID" : "Run ID"}</th><th>Story</th><th>Source</th><th class="c">Test cases</th><th>Reviewed</th><th>Status</th><th>Actions</th></tr>${hRows(j, compact)}</table>`;
}
function hBind(root, j, rerender) {
  root.querySelectorAll("tr.bgrp .tgl").forEach((t) => (t.onclick = () => {
    const id = t.closest("tr").dataset.id, cur = id === j.current;
    const open = H_EXP.has(id) || (cur && !H_EXP.has("x" + id));
    if (open) { H_EXP.delete(id); H_EXP.add("x" + id); } else { H_EXP.add(id); H_EXP.delete("x" + id); }
    rerender();
  }));
  root.querySelectorAll("tr.bchild").forEach((tr) => {
    const bid = tr.dataset.bid, ent = j.items.find((x) => x.run_id === bid);
    tr.querySelector(".hc-open").onclick = (ev) => guarded(ev.currentTarget, async () => {
      if (S.localDirty && !confirm("You have unsaved edits in the Review table. Open another run without saving?")) return;
      const oj = await api(`/api/history/${bid}/open`, { method: "POST" });
      Object.assign(S, { localDirty: false, cases: [], inputMode: null, payloadPreview: null, qtab: "upload" });
      syncBatchMode(oj, { key: tr.dataset.key }); toast(`Opened ${ent.rid}`);
    });
    const xl = tr.querySelector(".hc-xl"); if (xl) xl.onclick = () => download(`/api/history/${bid}/excel?item=${encodeURIComponent(tr.dataset.cid)}`);
  });
  root.querySelectorAll("tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id, e = j.items.find((x) => x.run_id === id);
    tr.querySelector(".h-open").onclick = (ev) => guarded(ev.currentTarget, async () => {
      if (S.localDirty && !confirm("You have unsaved edits in the Review table. Open another run without saving?")) return;
      const oj = await api(`/api/history/${id}/open`, { method: "POST" });
      Object.assign(S, { localDirty: false, cases: [], inputMode: null, payloadPreview: null, qtab: "upload" });
      if (window.syncBatchMode && syncBatchMode(oj)) { toast(`Opened ${e.rid}`); return; }
      toast(`Opened ${e.rid}`); S.view = "review"; location.hash = "review"; render();
    });
    const xl = tr.querySelector(".h-xl"); if (xl) xl.onclick = () => download(`/api/history/${id}/excel`);
    const del = tr.querySelector(".h-del"); if (del) del.onclick = () => {
      root.querySelectorAll(".cfm").forEach((c) => c.remove());
      const cf = document.createElement("div"); cf.className = "cfm";
      cf.innerHTML = e.kind === "batch"
        ? `<b>Delete ${esc(e.rid)}?</b><div class="cs">Stories ${esc(e.story_id || "—")}</div><p>Removes this whole batch · ${(e.children || []).length} story runs · ${e.count} test cases and their Excel files from this browser. This can't be undone. Other runs are not affected.${e.run_id === j.current ? " This is your open batch — a new empty batch will start." : ""}</p><div class="cfa"><button class="btn g sm h-cancel">Cancel</button><button class="btn r sm h-yes">Delete batch</button></div>`
        : `<b>Delete ${esc(e.rid)}?</b><div class="cs">Story ${esc(e.story_id || "—")}</div><p>Removes this run · ${e.count} test cases and its Excel from this browser. This can't be undone. Other runs are not affected.${e.run_id === j.current ? " This is your open run — a new empty run will start." : ""}</p><div class="cfa"><button class="btn g sm h-cancel">Cancel</button><button class="btn r sm h-yes">Delete run</button></div>`;
      del.parentElement.appendChild(cf);
      cf.querySelector(".h-cancel").onclick = () => cf.remove();
      cf.querySelector(".h-yes").onclick = (ev) => guarded(ev.currentTarget, async () => {
        await api(`/api/history/${id}`, { method: "DELETE" }); toast(`Deleted ${e.rid}`);
        if (S.mode === "batch") { await refreshBatch(); renderBatchNav(); }
        rerender();
      });
    };
  });
}
async function viewHistory(v) {
  v.innerHTML = `<h1>Run history</h1><div class="sub">Resume any recent run, download its Excel, or delete it. Stored on this browser only.</div><div class="card" id="hBody">Loading…</div>`;
  const j = await refreshHistoryCount(); if (!j) { $("#hBody").innerHTML = '<div class="error">Could not load run history.</div>'; return; }
  renderNav();
  const hb = hHasBatch(j);
  $("#hBody").innerHTML = hNote(j.max, hb) + hTable(j, false) + `<div class="foot muted">${j.items.length} of ${j.max} ${hb ? "entries · a batch counts as one" : "runs"} · saved when you generate, import, save or upload · newest first</div>`;
  hBind($("#hBody"), j, () => viewHistory(v));
}
async function renderRecentRuns(el) {
  const j = await refreshHistoryCount(); if (!j || !el.isConnected) return;
  el.innerHTML = `<div class="card"><div class="ph"><h3 style="margin:0">🕘 Recent runs</h3><a href="#history" class="tpl-link">View all in Run history →</a></div>${hNote(j.max, hHasBatch(j))}${hTable(j, true)}</div>`;
  hBind(el, j, () => renderRecentRuns(el));
}
