// Run history: rolling last 5 runs per browser (server keeps index in backend/history/<hid>/history.json)
const HNOTE = '<div class="keepnote">ℹ Keeps your last 5 runs. When a new run is saved, only the oldest one is removed — history is never cleared all at once.</div>';
const H_SRC = { "Jira": "b", "Local text": "gr", "Excel upload": "y" };
const H_ST = { "Draft": "gr", "Reviewed": "b", "Uploaded to qTest": "" };
function hDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).replace(/\bam\b/, "AM").replace(/\bpm\b/, "PM") + " IST";
}
async function refreshHistoryCount() {
  try { const j = await api("/api/history"); const c = $("#hCnt"); if (c) c.textContent = j.items.length || ""; return j; } catch { return null; }
}
function hRows(j, compact) {
  const items = j.items, full = items.length >= j.max;
  return items.map((e, i) => {
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
function hTable(j, compact) {
  if (!j.items.length) return `<div class="sub" style="margin:6px 0">No saved runs yet. A run appears here once it has test cases (generate, import from Excel or save).</div>`;
  return `<table class="rh"><tr><th>Run ID</th><th>Story</th><th>Source</th><th class="c">Test cases</th><th>Reviewed</th><th>Status</th><th>Actions</th></tr>${hRows(j, compact)}</table>`;
}
function hBind(root, j, rerender) {
  root.querySelectorAll("tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id, e = j.items.find((x) => x.run_id === id);
    tr.querySelector(".h-open").onclick = (ev) => guarded(ev.currentTarget, async () => {
      if (S.localDirty && !confirm("You have unsaved edits in the Review table. Open another run without saving?")) return;
      await api(`/api/history/${id}/open`, { method: "POST" });
      Object.assign(S, { localDirty: false, cases: [], inputMode: null, payloadPreview: null, qtab: "upload" });
      toast(`Opened ${e.rid}`); S.view = "review"; location.hash = "review"; render();
    });
    const xl = tr.querySelector(".h-xl"); if (xl) xl.onclick = () => download(`/api/history/${id}/excel`);
    const del = tr.querySelector(".h-del"); if (del) del.onclick = () => {
      root.querySelectorAll(".cfm").forEach((c) => c.remove());
      const cf = document.createElement("div"); cf.className = "cfm";
      cf.innerHTML = `<b>Delete ${esc(e.rid)}?</b><div class="cs">Story ${esc(e.story_id || "—")}</div><p>Removes this run · ${e.count} test cases and its Excel from this browser. This can't be undone. Other runs are not affected.${e.run_id === j.current ? " This is your open run — a new empty run will start." : ""}</p><div class="cfa"><button class="btn g sm h-cancel">Cancel</button><button class="btn r sm h-yes">Delete run</button></div>`;
      del.parentElement.appendChild(cf);
      cf.querySelector(".h-cancel").onclick = () => cf.remove();
      cf.querySelector(".h-yes").onclick = (ev) => guarded(ev.currentTarget, async () => {
        await api(`/api/history/${id}`, { method: "DELETE" }); toast(`Deleted ${e.rid}`); rerender();
      });
    };
  });
}
async function viewHistory(v) {
  v.innerHTML = `<h1>Run history</h1><div class="sub">Resume any recent run, download its Excel, or delete it. Stored on this browser only.</div><div class="card" id="hBody">Loading…</div>`;
  const j = await refreshHistoryCount(); if (!j) { $("#hBody").innerHTML = '<div class="error">Could not load run history.</div>'; return; }
  renderNav();
  $("#hBody").innerHTML = HNOTE + hTable(j, false) + `<div class="foot muted">${j.items.length} of ${j.max} runs · saved when you generate, import, save or upload · newest first</div>`;
  hBind($("#hBody"), j, () => viewHistory(v));
}
async function renderRecentRuns(el) {
  const j = await refreshHistoryCount(); if (!j || !el.isConnected) return;
  el.innerHTML = `<div class="card"><div class="ph"><h3 style="margin:0">🕘 Recent runs</h3><a href="#history" class="tpl-link">View all in Run history →</a></div>${HNOTE}${hTable(j, true)}</div>`;
  hBind(el, j, () => renderRecentRuns(el));
}
