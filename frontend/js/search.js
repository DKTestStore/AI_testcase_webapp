/* Search (additive): 1) test case search on Review (scope, summary, highlights, chips, no-match state)
   2) Acceptance criteria search page (#acs)  3) Global search box + Ctrl+K palette (GET /api/search).
   Wraps existing functions; nothing changes until the user searches / filters. */
"use strict";

const SR = { scope: "all" };
const SR_SCOPES = { all: "Title, steps, expected, precondition", title: "Title only", steps: "Steps & expected", precondition: "Precondition" };
const srRe = (q) => new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
function srHl(text, q) {
  const s = String(text ?? ""); if (!q) return esc(s);
  let out = "", last = 0; const re = srRe(q); let m;
  while ((m = re.exec(s))) { if (!m[0]) break; out += esc(s.slice(last, m.index)) + `<mark class="sr-hl">${esc(m[0])}</mark>`; last = m.index + m[0].length; }
  return out + esc(s.slice(last));
}
function srMarkEl(el, q) {   // wrap matches inside the text nodes of one element
  if (!el || !q || el === document.activeElement || el.querySelector("mark.sr-hl")) return;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n;
  while ((n = w.nextNode())) if (n.nodeValue && n.nodeValue.toLowerCase().includes(q.toLowerCase())) nodes.push(n);
  nodes.forEach((t) => { const span = document.createElement("span"); span.innerHTML = srHl(t.nodeValue, q); const fr = document.createDocumentFragment(); while (span.firstChild) fr.appendChild(span.firstChild); t.replaceWith(fr); });
}
function srUnmark(el) { $$("mark.sr-hl", el).forEach((m) => m.replaceWith(document.createTextNode(m.textContent))); el.normalize(); }
document.addEventListener("focusin", (e) => { const ed = e.target.closest && e.target.closest(".ed"); if (ed && ed.querySelector("mark.sr-hl")) srUnmark(ed); }, true);

// ------------------------------------------------------------------ 1. Test case search on Review
function srText(t, scope) {
  const steps = t.steps.map((s) => s.description + " " + s.expected).join(" ");
  if (scope === "title") return t.name || "";
  if (scope === "steps") return steps;
  if (scope === "precondition") return t.precondition || "";
  return [t.id, t.name, t.description, t.precondition, steps].join(" ");
}
const _srFiltered = filtered;
filtered = function () {
  if (!RV.q || SR.scope === "all") return _srFiltered();
  const q = RV.q; RV.q = ""; let f; try { f = _srFiltered(); } finally { RV.q = q; }
  return f.filter((t) => srText(t, SR.scope).toLowerCase().includes(q.toLowerCase()));
};
const srActive = () => !!(RV.q || RV.status || RV.prio || RV.ac || SR.scope !== "all");
function srClearSearch() { RV.q = ""; const i = $("#rvQ"); if (i) i.value = ""; RV.page = 0; renderList(); }
function srResetFilters() {
  RV.q = RV.status = RV.prio = RV.ac = ""; SR.scope = "all"; RV.page = 0;
  [["#rvQ", ""], ["#rvStatus", ""], ["#rvPrio", ""], ["#rvAc", ""], ["#srScope", "all"]].forEach(([s, v]) => { const e = $(s); if (e) e.value = v; });
  renderList();
}
function srAfterList() {
  const box = $("#srSum"), list = $("#rvList"); if (!list) return;
  const total = S.cases.length, f = filtered(), q = RV.q.trim();
  if (box) {
    if (!srActive() || !total) { box.innerHTML = ""; box.classList.add("hidden"); }
    else {
      const chips = [];
      if (RV.status) chips.push(["status", "Status: " + STATUS[RV.status].label.slice(2)]);
      if (RV.prio) chips.push(["prio", "Priority: " + RV.prio]);
      if (RV.ac) chips.push(["ac", "Linked AC: " + RV.ac]);
      if (SR.scope !== "all") chips.push(["scope", "In: " + SR_SCOPES[SR.scope]]);
      box.classList.remove("hidden");
      box.innerHTML = `<span>Showing <b>${f.length} of ${total}</b> test cases${q ? ` matching “${esc(q)}”` : ""}</span>
        ${chips.map(([k, l]) => `<span class="sr-chip" data-clr="${k}" title="Remove this filter">${esc(l)} <b>×</b></span>`).join("")}
        <button class="btn g sm" id="srClear">✕ Clear</button>`;
      $$("[data-clr]", box).forEach((c) => (c.onclick = () => {
        const k = c.dataset.clr; if (k === "scope") SR.scope = "all"; else RV[k] = "";
        const sel = { status: "#rvStatus", prio: "#rvPrio", ac: "#rvAc", scope: "#srScope" }[k]; if ($(sel)) $(sel).value = k === "scope" ? "all" : "";
        RV.page = 0; renderList();
      }));
      $("#srClear").onclick = srResetFilters;
    }
  }
  if (total && !f.length && srActive()) {
    list.innerHTML = `<div class="card sr-empty" id="srEmpty"><div class="sr-empty-i">🔍</div><b>No test cases match${q ? ` “${esc(q)}”` : " the filters"}</b>
      <div class="sub">Try another word, widen “Search in”, or remove a filter.</div>
      <div class="sr-empty-a">${q ? '<button class="btn g sm" id="srE1">✕ Clear search</button>' : ""}<button class="btn g sm" id="srE2">↺ Reset filters</button>${q ? '<button class="btn sm" id="srE3">🔎 Search all runs in history</button>' : ""}</div></div>`;
    const b1 = $("#srE1"); if (b1) b1.onclick = srClearSearch;
    $("#srE2").onclick = srResetFilters;
    const b3 = $("#srE3"); if (b3) b3.onclick = () => gsOpen(q);
    return;
  }
  if (!q) return;
  $$(".tc", list).forEach((c) => {
    const t = S.cases[byK(c.dataset.k)]; if (!t) return;
    const sc = SR.scope;
    if (sc === "all" || sc === "title") srMarkEl($('.ed[data-f="name"]', c), q);
    if (sc === "all") { srMarkEl($(".tc-desc", c), q); $$('.tc-b .ed[data-f="description"]:not([data-step])', c).forEach((e) => srMarkEl(e, q)); }
    if (sc === "all" || sc === "precondition") srMarkEl($('.tc-b .ed[data-f="precondition"]', c), q);
    if (sc === "all" || sc === "steps") $$(".tc-b .ed[data-step]", c).forEach((e) => srMarkEl(e, q));
    if (!c.classList.contains("open")) {   // collapsed: show where it matched (steps / precondition)
      const ql = q.toLowerCase(), lines = [];
      if ((sc === "all" || sc === "precondition") && (t.precondition || "").toLowerCase().includes(ql)) lines.push(`<b>Precondition</b> ${srHl(t.precondition, q)}`);
      if (sc === "all" || sc === "steps") t.steps.forEach((s, i) => {
        if (lines.length >= 3) return;
        if ((s.description || "").toLowerCase().includes(ql)) lines.push(`<b>Step ${i + 1}</b> ${srHl(s.description, q)}`);
        if ((s.expected || "").toLowerCase().includes(ql)) lines.push(`<b>Expected</b> ${srHl(s.expected, q)}`);
      });
      if (lines.length) c.insertAdjacentHTML("beforeend", `<div class="sr-snip" data-act="toggle">${lines.slice(0, 3).map((l) => `<div>${l}</div>`).join("")}</div>`);
    }
  });
}
const _srRenderList = renderList;
renderList = function () { _srRenderList(); try { srAfterList(); } catch (e) { console.warn("search", e); } };
const _srViewReview = viewReview;
viewReview = function (v) {
  _srViewReview(v);
  const tb = $("#rvToolbar"); if (!tb) return;
  const ac = $("#rvAc", tb);
  if (ac && !$("#srScope")) ac.insertAdjacentHTML("afterend", `<select id="srScope" title="Search in">${Object.entries(SR_SCOPES).map(([k, l]) => `<option value="${k}" ${SR.scope === k ? "selected" : ""}>${k === "all" ? "Search in: all fields" : l}</option>`).join("")}</select>`);
  $("#srScope").onchange = (e) => { SR.scope = e.target.value; RV.page = 0; renderList(); };
  const qi = $("#rvQ"); if (qi) { qi.title = "Search title, steps, expected result, precondition"; qi.addEventListener("keydown", (e) => { if (e.key === "Escape" && RV.q) srClearSearch(); }); }
  if (!$("#srSum")) tb.insertAdjacentHTML("afterend", `<div class="sr-sum hidden" id="srSum"></div>`);
  if (S.mode !== "batch" && (S.run.ac_list || []).length && !$("#srAcLink")) {
    const lg = $(".rv-legend"); if (lg) lg.insertAdjacentHTML("beforeend", `<span><a href="#acs" id="srAcLink" class="sr-link">🔎 Search acceptance criteria</a></span>`);
  }
  srAfterList();
};

// ------------------------------------------------------------------ 2. Acceptance criteria search (#acs)
const ACS = { q: "", cov: "", sel: null, checked: null };
function acsRows() {
  if (!S.localDirty && S.run) loadCasesFromRun();
  const c = covCalc(S.cases, (S.run && S.run.ac_list) || []), checked = S.cases.length > 0;
  c.rows.forEach((r) => (r.state = !checked ? "nc" : !r.total ? "no" : r.neg ? "ok" : "part"));
  return { c, checked };
}
const ACS_PILL = { ok: ["ok", "● Covered"], part: ["part", "● Partial · no negative"], no: ["no", "● Not covered"], nc: ["nc", "○ Not checked"] };
function viewAcs(v) {
  const { c, checked } = acsRows(), n = c.rows.length, q = ACS.q.trim(), ql = q.toLowerCase();
  const cnt = (s) => c.rows.filter((r) => r.state === s).length;
  const rows = c.rows.filter((r) => (!ql || `${r.id} ${r.title} ${r.text}`.toLowerCase().includes(ql)) && (!ACS.cov || r.state === ACS.cov));
  const act = !!(q || ACS.cov);
  v.innerHTML = `<h1>Acceptance criteria</h1><div class="sub">${n} ACs · ${checked ? `coverage: ${cnt("ok")} covered · ${cnt("part")} partial · ${cnt("no")} not covered` : "coverage not checked (no test cases yet)"}${ACS.checked ? ` · re-checked ${new Date(ACS.checked).toLocaleTimeString()}` : ""}</div>
    <div class="card acs-top"><div class="acs-qrow"><input id="acQ" placeholder="🔍 Search acceptance criteria…" value="${esc(ACS.q)}"><button class="btn g" id="acClear">✕ Clear</button></div>
      <div class="acs-f"><label>Coverage<select id="acCov"><option value="">All</option>${[["ok", "Covered"], ["part", "Partial (no negative case)"], ["no", "Not covered"]].map(([k, l]) => `<option value="${k}" ${ACS.cov === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <span style="flex:1"></span><button class="btn g sm" id="acRerun" title="Re-run the local AC coverage check (no AI call)">↻ Re-run coverage check</button><button class="btn g sm" id="acBack">← Back to Review</button></div>
      <div class="acs-sum" id="acSum">${act ? `Showing <b>${rows.length} of ${n}</b> ACs${q ? ` matching “${esc(q)}”` : ""} · ` : ""}click an AC to see its linked test cases</div></div>
    <div class="card acs-list" id="acList">${!n ? '<div class="muted">This run has no acceptance criteria.</div>' : !rows.length ? `<div class="sr-empty" id="acEmpty"><b>No acceptance criteria match${q ? ` “${esc(q)}”` : ""}</b><div class="sr-empty-a"><button class="btn g sm" id="acE1">↺ Reset search</button>${q ? '<button class="btn sm" id="acE2">🔎 Search all runs in history</button>' : ""}</div></div>` : rows.map((r) => acsRow(r, q)).join("")}</div>`;
  const re = () => viewAcs(v);
  $("#acQ").oninput = (e) => { ACS.q = e.target.value; clearTimeout(viewAcs._t); viewAcs._t = setTimeout(() => { re(); const i = $("#acQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200); };
  $("#acQ").onkeydown = (e) => { if (e.key === "Escape") { ACS.q = ""; re(); } };
  $("#acClear").onclick = () => { ACS.q = ""; ACS.cov = ""; re(); };
  $("#acCov").onchange = (e) => { ACS.cov = e.target.value; re(); };
  $("#acRerun").onclick = () => { ACS.checked = Date.now(); re(); const x = acsRows().c; toast(`Coverage re-checked · ${x.covered}/${x.rows.length} ACs covered`); };
  $("#acBack").onclick = () => go("review");
  const e1 = $("#acE1"); if (e1) e1.onclick = () => { ACS.q = ""; ACS.cov = ""; re(); };
  const e2 = $("#acE2"); if (e2) e2.onclick = () => gsOpen(q);
  $$(".acs-row", v).forEach((el) => (el.onclick = (e) => {
    if (e.target.closest("[data-tc]") || e.target.closest("button")) return;
    ACS.sel = ACS.sel === el.dataset.ac ? null : el.dataset.ac; re();
  }));
  $$("[data-tc]", v).forEach((b) => (b.onclick = () => srJumpTc(b.dataset.tc)));
  $$("[data-addac]", v).forEach((b) => (b.onclick = () => { const id = b.dataset.addac; if (!stepUnlocked("review")) return toast("Generate test cases first.", true); go("review"); if (S.view === "review" && window.covGenDialog) covGenDialog(id); }));
  $$("[data-rerun]", v).forEach((b) => (b.onclick = () => $("#acRerun").click()));
  const nav = $('#nav a[data-view="review"]'); if (nav) nav.classList.add("a");
}
function acsRow(r, q) {
  const [cls, lbl] = ACS_PILL[r.state], open = ACS.sel === r.id;
  let h = `<div class="acs-row ${open ? "open" : ""}" data-ac="${esc(r.id)}"><b class="acs-id">${srHl(r.id, q)}</b><span class="acs-t">${srHl(r.title || r.text, q)}${r.text && r.title && q && r.text.toLowerCase().includes(q.toLowerCase()) ? `<span class="acs-x">${srHl(r.text.slice(0, 220), q)}</span>` : ""}</span>
    <span class="acs-pill ${cls}">${lbl}</span><span class="acs-n">→ ${r.total} linked TC${r.total === 1 ? "" : "s"}</span></div>`;
  if (open) h += `<div class="acs-tcs" data-for="${esc(r.id)}">${r.tcs.length ? r.tcs.map((t) => `<button class="acs-tc" data-tc="${esc(t.id)}" title="Open ${esc(t.id)} in Review"><b>${esc(t.id)}</b> ${esc(t.name)} <span class="sub">${covIsNeg(t) ? "negative" : "positive"} ↗</span></button>`).join("") : '<div class="muted">No test case is linked to this AC yet.</div>'}
    <div class="acs-ta"><button class="btn sm" data-addac="${esc(r.id)}">＋ Add test case for ${esc(r.id)}</button><button class="btn g sm" data-rerun="1">↻ Re-run coverage check</button></div></div>`;
  return h;
}
function srJumpTc(id) {
  RV.q = RV.status = RV.prio = RV.ac = ""; SR.scope = "all";
  const view = S.mode === "batch" ? "b-review" : "review";
  if (S.view !== view) go("review");
  const t = S.cases.find((x) => x.id === id);
  if (!t || !$("#rvList")) return toast(`${id} not found in this run`, true);
  RV.open.add(t._k); RV.just = t._k; showCase(t); renderList();
  const el = $(`.tc[data-k="${t._k}"]`); if (el) el.scrollIntoView({ block: "center" });
}
const _srRender = render;
render = function () {
  if (S.mode !== "batch" && S.view === "acs") { renderNav(); return viewAcs($("#view")); }
  return _srRender();
};

// ------------------------------------------------------------------ 3. Global search + Ctrl+K palette
const GS = { open: false, q: "", items: [], sel: 0, remote: null, seq: 0 };
const GS_KEY = "atg.recentSearches";
const gsRecent = () => { try { return JSON.parse(localStorage.getItem(GS_KEY) || "[]").filter((x) => x && x.q); } catch { return []; } };
function gsRemember(q) { q = (q || "").trim(); if (!q) return; const r = gsRecent().filter((x) => x.q.toLowerCase() !== q.toLowerCase()); r.unshift({ q, t: Date.now() }); localStorage.setItem(GS_KEY, JSON.stringify(r.slice(0, 6))); }
function gsForget(q) { localStorage.setItem(GS_KEY, JSON.stringify(gsRecent().filter((x) => x.q !== q))); }
const gsAgo = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const GS_PAGES = [
  ["input", "📝", "Input", "Step 1 · Jira / local text / Excel"], ["generate", "⚡", "Generate", "Step 2"], ["review", "✅", "Review test cases", "Step 3"],
  ["acs", "🔎", "Acceptance criteria search", "Search ACs, coverage & linked test cases"], ["qtest", "⬆", "qTest Upload", "Step 4 · upload & RTM"],
  ["history", "🕘", "Run history", "Past runs and batches"], ["tokens", "📊", "Token Usage", "Gemini token ledger"], ["setup", "✓", "Setup checklist", "Configuration status"],
  ["settings", "⚙", "Settings", "Gemini key & model, Jira, qTest, default prompt, history limit"],
];
const GS_ACTIONS = [["newrun", "＋", "New run", "Start a new run (clears current data)"], ["tokens", "📊", "Go to Token Usage", ""], ["settings", "⚙", "Open Settings", ""], ["history", "🕘", "Open Run history", ""]];
function gsInit() {
  const tb = $(".topbar"); if (!tb || $("#gsBox")) return;
  tb.insertAdjacentHTML("afterbegin", `<div class="gs-box" id="gsBox" role="button" tabindex="0" title="Search (Ctrl+K)">🔍 <span>Search runs, tickets, test cases, ACs…</span><kbd>Ctrl</kbd><kbd>K</kbd></div>`);
  $("#gsBox").onclick = () => gsOpen();
  $("#gsBox").onkeydown = (e) => { if (e.key === "Enter") gsOpen(); };
  document.body.insertAdjacentHTML("beforeend", `<div class="gs-bg" id="gsBg"><div class="gs-pal" role="dialog" aria-label="Search"><div class="gs-in">🔍<input id="gsQ" placeholder="Search runs, tickets, test cases, ACs, settings…" autocomplete="off"><kbd>Esc</kbd></div><div class="gs-res" id="gsRes"></div>
    <div class="gs-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>Tab</kbd> next group</span><span><kbd>Esc</kbd> close</span></div></div></div>`);
  $("#gsBg").onclick = (e) => { if (e.target.id === "gsBg") gsClose(); };
  $("#gsQ").oninput = (e) => { GS.q = e.target.value; GS.sel = 0; GS.remote = null; gsDraw(); clearTimeout(gsInit._t); gsInit._t = setTimeout(gsFetch, 150); };
  $("#gsQ").onkeydown = gsKey;
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); GS.open ? gsClose() : gsOpen(); }
    else if (e.key === "Escape" && GS.open) { e.preventDefault(); e.stopPropagation(); gsClose(); }
  }, true);
}
function gsOpen(q = "") {
  GS.open = true; GS.q = q; GS.sel = 0; GS.remote = null;
  $("#gsBg").classList.add("open"); const i = $("#gsQ"); i.value = q; i.focus(); gsDraw(); if (q) gsFetch();
}
function gsClose() { GS.open = false; $("#gsBg").classList.remove("open"); }
async function gsFetch() {
  const q = GS.q.trim(); if (!q) return; const n = ++GS.seq;
  try { const j = await api(`/api/search?q=${encodeURIComponent(q)}`); if (n === GS.seq && GS.open) { GS.remote = j; gsDraw(); } } catch (e) { if (n === GS.seq) { GS.remote = { error: e.message }; gsDraw(); } }
}
function gsGroups() {
  const q = GS.q.trim(), ql = q.toLowerCase(), G = [];
  const pages = GS_PAGES.filter(([v]) => S.mode !== "batch" || !["acs"].includes(v));
  if (!q) {
    const rec = gsRecent(); if (rec.length) G.push(["Recent searches", rec.map((r) => ({ kind: "recent", icon: "↺", label: r.q, sub: gsAgo(r.t), q: r.q }))]);
    const r = S.run || {}; if (r.rid && S.mode !== "batch") G.push(["Current run", [{ kind: "page", view: "review", icon: "🕘", label: `${r.rid}${r.story_id ? " · " + r.story_id : ""}`, sub: `Run · ${(r.test_cases || []).length} test cases` }]]);
    G.push(["Quick actions", GS_ACTIONS.map(([a, icon, label, sub]) => ({ kind: a === "newrun" ? "newrun" : "page", view: a, icon, label, sub }))]);
    return G;
  }
  const R = GS.remote || {};
  const when = (iso) => (iso && window.hDate ? hDate(iso) : "");
  const runs = (R.runs || []).map((x) => ({ kind: "run", icon: "🕘", label: `${x.rid} · ${x.title || ""}`, sub: `Run${x.story_id ? " · " + x.story_id : ""} · ${x.count || 0} TCs${x.created ? " · " + when(x.created) : ""}`, x }));
  if (runs.length) G.push(["Runs", runs]);
  const bat = (R.batches || []).map((x) => ({ kind: "batch", icon: "🗂", label: `${x.rid} · ${x.title || ""}`, sub: `Batch${x.story_id ? " · " + x.story_id : ""}${x.created ? " · " + when(x.created) : ""}`, x }));
  if (bat.length) G.push(["Batches", bat]);
  const tk = (R.tickets || []).map((x) => ({ kind: "run", icon: "🎫", label: `${x.story_id}${x.title ? " · " + x.title : ""}`, sub: `Ticket · ${x.batch_rid ? x.batch_rid + " › " : ""}${x.rid || "current run"}`, x }));
  if (tk.length) G.push(["Tickets", tk]);
  const tcs = (R.test_cases || []).map((x) => ({ kind: "tc", icon: "🧪", label: `${x.tc_id} · ${x.name}`, sub: `Test case · ${x.current ? "current run" : x.rid}${x.story_id ? " · " + x.story_id : ""}`, x }));
  if (tcs.length) G.push(["Test cases", tcs]);
  const acs = (R.acs || []).map((x) => ({ kind: "ac", icon: "📋", label: `${x.ac_id} · ${x.title}`, sub: `Acceptance criterion · ${x.current ? "current run" : x.rid}${x.story_id ? " · " + x.story_id : ""}`, x }));
  if (acs.length) G.push(["Acceptance criteria", acs]);
  const pg = pages.filter(([v, , l, s]) => `${v} ${l} ${s}`.toLowerCase().includes(ql)).map(([v, icon, label, sub]) => ({ kind: "page", view: v, icon, label, sub }));
  if (pg.length) G.push(["Pages & settings", pg]);
  const qa = GS_ACTIONS.filter(([, , l]) => l.toLowerCase().includes(ql)).map(([a, icon, label, sub]) => ({ kind: a === "newrun" ? "newrun" : "page", view: a, icon, label, sub }));
  if (qa.length) G.push(["Quick actions", qa]);
  return G;
}
function gsDraw() {
  const G = gsGroups(), q = GS.q.trim(); GS.items = []; let h = "";
  G.forEach(([name, its]) => {
    h += `<div class="gs-g">${esc(name)}</div>`;
    its.forEach((it) => { const i = GS.items.length; GS.items.push({ ...it, group: name });
      h += `<div class="gs-it ${i === GS.sel ? "sel" : ""}" data-i="${i}"><span class="gs-ic">${it.icon}</span><span class="gs-tx"><span class="gs-l">${srHl(it.label, q)}</span><span class="gs-s">${esc(it.sub || "")}</span></span>${it.kind === "recent" ? `<button class="gs-x" data-forget="${esc(it.q)}" title="Remove">×</button>` : ""}</div>`; });
  });
  if (q && !GS.items.length) h = GS.remote ? `<div class="gs-none" id="gsNone">${GS.remote.error ? esc(GS.remote.error) : `No results for “${esc(q)}” in this run or run history.`}</div>` : '<div class="gs-none">Searching…</div>';
  if (GS.sel >= GS.items.length) GS.sel = Math.max(0, GS.items.length - 1);
  $("#gsRes").innerHTML = h;
  $$("#gsRes .gs-it").forEach((el) => {
    el.onmousemove = () => { if (GS.sel !== +el.dataset.i) { GS.sel = +el.dataset.i; $$("#gsRes .gs-it").forEach((x) => x.classList.toggle("sel", x === el)); } };
    el.onclick = (e) => { if (e.target.dataset.forget !== undefined) { e.stopPropagation(); gsForget(e.target.dataset.forget); gsDraw(); $("#gsQ").focus(); return; } gsRun(GS.items[+el.dataset.i]); };
  });
}
function gsKey(e) {
  const n = GS.items.length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!n) return; GS.sel = (GS.sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n; gsDraw(); const s = $("#gsRes .gs-it.sel"); if (s) s.scrollIntoView({ block: "nearest" }); }
  else if (e.key === "Tab") { e.preventDefault(); if (!n) return; const g = GS.items[GS.sel].group; let i = GS.items.findIndex((x, k) => k > GS.sel && x.group !== g); GS.sel = i < 0 ? 0 : i; gsDraw(); }
  else if (e.key === "Enter") { e.preventDefault(); const it = GS.items[GS.sel]; if (it) gsRun(it); else if (GS.q.trim()) gsFetch(); }
}
async function gsOpenRun(x) {   // open a history entry (or stay on the current run), returns true when the single run is now current
  const cur = S.mode !== "batch" && S.run && S.run.run_id === x.open_id;
  if (cur || x.current) return true;
  if (S.localDirty && !confirm("You have unsaved edits in the Review table. Open another run without saving?")) return false;
  const oj = await api(`/api/history/${x.open_id || x.run_id}/open`, { method: "POST" });
  Object.assign(S, { localDirty: false, cases: [], inputMode: null, payloadPreview: null, qtab: "upload" });
  if (window.syncBatchMode && syncBatchMode(oj, x.key ? { key: x.key } : {})) { toast(`Opened ${x.batch_rid || x.rid}`); return false; }
  toast(`Opened ${x.rid}`); if (window.refreshHistoryCount) refreshHistoryCount(); return true;
}
async function gsRun(it) {
  if (it.kind === "recent") { GS.q = it.q; $("#gsQ").value = it.q; GS.sel = 0; GS.remote = null; gsDraw(); gsFetch(); return; }
  if (GS.q.trim()) gsRemember(GS.q);
  gsClose();
  try {
    if (it.kind === "newrun") return newRunDialog();
    if (it.kind === "page") return go(it.view);
    if (it.kind === "batch") { const oj = await api(`/api/history/${it.x.run_id}/open`, { method: "POST" }); Object.assign(S, { localDirty: false, cases: [], inputMode: null, payloadPreview: null, qtab: "upload" }); syncBatchMode(oj); toast(`Opened ${it.x.rid}`); return; }
    const x = { ...it.x, open_id: it.x.open_id || it.x.run_id };
    const single = await gsOpenRun(x);
    if (!single) return;
    if (it.kind === "run") { S.view = "review"; location.hash = "review"; render(); return; }
    if (it.kind === "tc") { S.view = "review"; location.hash = "review"; if (S.view !== "review") return; render(); srJumpTc(x.tc_id); return; }
    if (it.kind === "ac") { ACS.q = x.ac_id; ACS.cov = ""; ACS.sel = x.ac_id; S.view = "acs"; location.hash = "acs"; render(); }
  } catch (e) { toast(e.message, true); }
}
gsInit();
