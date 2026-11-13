/* Help Assistant — docs-grounded chat in a draggable header window.
   Own scope (like voice.js). Prefs, position, and history live in this
   browser's localStorage only — not in .env or the database. */
(function () {
  const PREFS_KEY = "atg.help.prefs";
  const POS_KEY = "atg.help.pos";
  const HIST_KEY = "atg.help.history";
  const MAX_THREADS = 20;
  const MAX_MSGS = 50;
  const DEFAULT_CHIPS = [
    "How to generate test cases",
    "Connect Jira",
    "Upload to Zephyr",
    "Fix parse error",
    "What is AI Review"
  ];
  const ENGINES = [
    { id: "generate", label: "Use Generate provider" },
    { id: "gemini", label: "Gemini" },
    { id: "grok", label: "Grok (xAI)" },
    { id: "groq", label: "Groq" },
    { id: "claude", label: "Claude" },
    { id: "openai", label: "OpenAI" },
    { id: "codex", label: "Codex (OpenAI)" },
    { id: "ollama", label: "Ollama" },
    { id: "none", label: "No AI — docs search only" }
  ];
  const ENGINE_HINT = {
    generate: "Follows the Provider dropdown on Generate. No extra key is needed.",
    gemini: "Uses your Gemini key and model from Settings → AI Providers.",
    grok: "Uses your Grok (xAI) key and model from Settings → AI Providers.",
    groq: "Uses your Groq key and model from Settings → AI Providers.",
    claude: "Uses your Claude key and model from Settings → AI Providers.",
    openai: "Uses your OpenAI key and model from Settings → AI Providers.",
    codex: "Uses the Codex model and the shared OpenAI key from Settings → AI Providers.",
    ollama: "Uses the local Ollama host and model from Settings → AI Providers. No cloud key.",
    none: "No model is called. The assistant searches the README and Help FAQ and shows matching sections."
  };
  const SCREENS = {
    dashboard: "Dashboard", input: "Input", generate: "Generate", review: "Review",
    qtest: "qTest Upload", upload: "qTest Upload", history: "Run history",
    settings: "Settings", requirements: "Requirements", projects: "Projects",
    repo: "Test Case Repo", runs: "Test Runs", tokens: "Token Usage",
    usage: "Token Usage", prompts: "Prompt templates", templates: "Prompt templates",
    trace: "Traceability", record: "Record", setup: "Setup", batch: "Batch mode"
  };
  const ICON = '<svg class="help-mark" viewBox="0 0 36 36" aria-hidden="true"><use href="#help-mark"></use></svg>';
  const MIC = '<svg class="mic-mark" viewBox="0 0 36 36" aria-hidden="true"><use href="#mic-mark"></use></svg>';
  const SR = (typeof window !== "undefined") && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
  function say(msg, isErr) { if (typeof toast === "function") toast(msg, !!isErr); }

  // ------------------------------------------------------------------ prefs
  function defaultPrefs() {
    return { enabled: true, engine: "generate", contextOn: true, chips: DEFAULT_CHIPS.slice() };
  }
  function loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { p = {}; }
    const d = defaultPrefs();
    const chips = Array.isArray(p.chips) ? p.chips.map((c) => String(c || "").trim()).filter(Boolean) : d.chips.slice();
    return {
      enabled: p.enabled !== false,
      engine: ENGINES.some((e) => e.id === p.engine) ? p.engine : "generate",
      contextOn: p.contextOn !== false,
      chips: chips.length ? chips : d.chips.slice()
    };
  }
  let P = loadPrefs();
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(P)); } catch (e) { /* full / blocked */ } }

  // ------------------------------------------------------------------ history
  function loadHist() {
    try {
      const h = JSON.parse(localStorage.getItem(HIST_KEY) || "null");
      if (h && Array.isArray(h.threads)) return { threads: h.threads, currentId: h.currentId || "" };
    } catch (e) { /* ignore */ }
    return { threads: [], currentId: "" };
  }
  function saveHist() {
    try {
      H.threads = (H.threads || []).slice(0, MAX_THREADS);
      H.threads.forEach((t) => { if (t.messages && t.messages.length > MAX_MSGS) t.messages = t.messages.slice(-MAX_MSGS); });
      localStorage.setItem(HIST_KEY, JSON.stringify(H));
    } catch (e) { /* ignore */ }
  }
  let H = loadHist();

  const V = { open: false, minimized: false, mode: "normal", pending: false, rec: null, listening: false, startedEmpty: false };

  function currentView() {
    try {
      if (typeof S !== "undefined" && S && S.view) return String(S.view);
    } catch (e) { /* ignore */ }
    const h = (location.hash || "").replace(/^#/, "").split("?")[0];
    return h || "dashboard";
  }
  function screenName(view) {
    const v = String(view || currentView() || "");
    const top = v.split("/")[0];
    return SCREENS[v] || SCREENS[top] || (top ? top.charAt(0).toUpperCase() + top.slice(1) : "the app");
  }
  function engineLabel(id) {
    const e = ENGINES.find((x) => x.id === (id || P.engine));
    return e ? e.label : "Use Generate provider";
  }
  function generateProvider() {
    try {
      if (typeof S !== "undefined" && S && S.run && S.run.model) return String(S.run.model).toLowerCase();
    } catch (e) { /* ignore */ }
    return "gemini";
  }
  function resolvedProvider() {
    if (P.engine === "none") return "none";
    if (P.engine === "generate") return generateProvider();
    return P.engine;
  }
  function prettyProvider(id) {
    const map = { gemini: "Gemini", grok: "Grok", groq: "Groq", claude: "Claude", openai: "OpenAI", codex: "Codex", ollama: "Ollama", none: "Docs search only" };
    return map[String(id || "").toLowerCase()] || (id ? String(id) : "Generate provider");
  }
  function badgeText(resp) {
    if (P.engine === "none") return "Docs search only";
    if (resp && (resp.provider || resp.model)) {
      const p = prettyProvider(resp.provider || resolvedProvider());
      return resp.model ? (p + " · " + resp.model) : p;
    }
    if (P.engine === "generate") return "Generate provider · " + prettyProvider(generateProvider());
    return prettyProvider(P.engine);
  }
  function voiceLang() {
    try {
      const p = JSON.parse(localStorage.getItem("atg.voice.prefs") || "{}") || {};
      if (p.lang) return p.lang;
    } catch (e) { /* ignore */ }
    return "en-IN";
  }

  // ------------------------------------------------------------------ DOM
  function buildDom() {
    if (q("#helpWin") || !q("#helpLaunch")) return !!q("#helpLaunch");
    const win = document.createElement("div");
    win.id = "helpWin";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", "Help Assistant");
    win.innerHTML = `
      <div class="hw-title" id="helpTitle">
        ${ICON}<b>Help Assistant</b><span class="hw-sp"></span>
        <button type="button" class="hw-tb" id="helpRestart" title="Restart chat" aria-label="Restart chat"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.65 8A5.65 5.65 0 1 1 11.2 3.15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M11.15 1.35v2.7h2.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button type="button" class="hw-tb" id="helpMin" title="Minimize" aria-label="Minimize">–</button>
        <button type="button" class="hw-tb" id="helpMax" title="Maximize" aria-label="Maximize">▢</button>
        <button type="button" class="hw-tb x" id="helpClose" title="Close" aria-label="Close">×</button>
      </div>
      <div class="hw-confirm" id="helpRestartConfirm" hidden role="alertdialog" aria-label="Restart chat?">
        <span>Restart this chat? The current conversation stays in History.</span>
        <span class="hw-confirm-acts">
          <button type="button" class="btn sm" id="helpRestartYes">Restart</button>
          <button type="button" class="btn g sm" id="helpRestartNo">Cancel</button>
        </span>
      </div>
      <div class="hw-shell">
        <aside class="hw-side" aria-label="Conversation history">
          <div class="hw-side-h"><span>History</span><span class="hw-side-acts"><button type="button" class="btn g sm" id="helpRestartSide" title="Restart chat">Restart chat</button><button type="button" class="btn g sm" id="helpNewChat">＋ New</button></span></div>
          <div class="hw-side-list" id="helpHistList"></div>
        </aside>
        <div class="hw-main">
          <div class="hw-prov" id="helpProv">Using: <b></b></div>
          <div class="hw-ctx" id="helpCtx"><span class="dot"></span><span id="helpCtxLbl"></span></div>
          <div class="hw-msgs" id="helpMsgs" aria-live="polite"></div>
          <div class="hw-chips" id="helpChips"></div>
          <div class="hw-input">
            <textarea id="helpInput" rows="1" placeholder="Ask how a feature works…" aria-label="Ask a question"></textarea>
            <button type="button" class="hw-mic" id="helpMic" title="Dictate with Voice input" aria-label="Dictate with Voice input">${MIC}</button>
            <button type="button" class="hw-send" id="helpSend" title="Send" aria-label="Send">➤</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(win);
    const pill = document.createElement("button");
    pill.type = "button"; pill.id = "helpPill"; pill.title = "Restore Help Assistant";
    pill.innerHTML = ICON + "<span>Help Assistant</span>";
    document.body.appendChild(pill);
    return true;
  }

  // ------------------------------------------------------------------ placement
  function winEl() { return q("#helpWin"); }
  function loadPos() { try { return JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch (e) { return null; } }
  function savePos() {
    if (V.mode !== "normal") return;
    const r = winEl().getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })); } catch (e) { /* ignore */ }
  }
  function clampPos(l, t) {
    const w = winEl(); const ww = w.offsetWidth || 420, wh = w.offsetHeight || 580;
    return [Math.min(Math.max(0, l), Math.max(0, window.innerWidth - ww)), Math.min(Math.max(0, t), Math.max(0, window.innerHeight - Math.min(wh, 40)))];
  }
  function placeAt(l, t) {
    const w = winEl(); [l, t] = clampPos(l, t);
    Object.assign(w.style, { transform: "", right: "auto", bottom: "auto", left: l + "px", top: t + "px" });
  }
  function applyStartPos(kind) {
    const w = winEl();
    const saved = (kind !== "br") ? loadPos() : null;
    if (kind !== "br" && saved && saved.left != null) { placeAt(saved.left, saved.top); return; }
    Object.assign(w.style, { transform: "", left: "auto", top: "auto", right: "20px", bottom: "16px" });
  }
  function resetPosition() {
    if (window.WinMgr) { window.WinMgr.reset("help"); return; }
    try { localStorage.removeItem(POS_KEY); } catch (e) { /* ignore */ }
    if (V.mode === "max") exitMax(true);
    applyStartPos("br");
    say("Help window moved back to the bottom-right");
  }
  function bindDrag() {
    if (window.WinMgr) return; // shared window manager owns drag, snap, resize, and z-order
    const title = q("#helpTitle"), w = winEl();
    let drag = null;
    title.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button") || V.mode === "max") return;
      const r = w.getBoundingClientRect();
      drag = { ox: e.clientX - r.left, oy: e.clientY - r.top };
      placeAt(r.left, r.top);
      try { title.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    title.addEventListener("pointermove", (e) => { if (drag) placeAt(e.clientX - drag.ox, e.clientY - drag.oy); });
    const end = () => { if (drag) { drag = null; savePos(); } };
    title.addEventListener("pointerup", end);
    title.addEventListener("pointercancel", end);
    title.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) V.mode === "max" ? exitMax() : enterMax(); });
    window.addEventListener("resize", () => {
      if (!V.open || V.mode !== "normal") return;
      const r = w.getBoundingClientRect();
      if (w.style.left && w.style.left !== "auto") placeAt(r.left, r.top);
    });
  }

  function updateLaunch() {
    const b = q("#helpLaunch");
    if (b) b.classList.toggle("open-mark", !!(V.open && !V.minimized));
  }
  function openWindow(opts) {
    opts = opts || {};
    if (!P.enabled) return;
    const w = winEl();
    V.open = true; V.minimized = false;
    q("#helpPill").classList.remove("show");
    w.classList.add("open");
    if (window.WinMgr) {
      if (V.mode === "max") window.WinMgr.maximize("help");
      else window.WinMgr.show("help", { reposition: !!opts.reposition });
      w.dataset.placed = "1";
    } else if (V.mode !== "max" && (!w.dataset.placed || opts.reposition)) { applyStartPos(); w.dataset.placed = "1"; }
    updateContext(); updateBadge(); updateLaunch();
    if (q("#helpMsgs").childElementCount === 0) showWelcome();
  }
  function closeWindow() {
    hideRestartConfirm();
    stopMic();
    V.open = false; V.minimized = false;
    if (window.WinMgr) {
      window.WinMgr.close("help");
    } else {
      if (V.mode === "max") exitMax(true);
      winEl().classList.remove("open");
      q("#helpPill").classList.remove("show");
    }
    V.mode = "normal";
    updateLaunch();
  }
  function minimize() {
    stopMic();
    V.minimized = true; V.open = false;
    if (window.WinMgr) window.WinMgr.minimize("help");
    else {
      if (V.mode === "max") exitMax(true);
      winEl().classList.remove("open");
      q("#helpPill").classList.add("show");
    }
    updateLaunch();
  }
  function enterMax() {
    if (window.WinMgr) { window.WinMgr.maximize("help"); renderHistory(); return; }
    V.mode = "max";
    const w = winEl();
    if (!w.style.left || w.style.left === "auto") {
      const r = w.getBoundingClientRect();
      w.dataset.prevLeft = r.left; w.dataset.prevTop = r.top;
    } else {
      w.dataset.prevLeft = parseFloat(w.style.left) || 0;
      w.dataset.prevTop = parseFloat(w.style.top) || 0;
    }
    w.classList.add("max");
    Object.assign(w.style, { left: "", top: "", right: "", bottom: "", transform: "" });
    renderHistory();
  }
  function exitMax(keepClosed) {
    if (window.WinMgr) { window.WinMgr.unmaximize("help", { keepHidden: !!keepClosed && !V.open }); return; }
    const w = winEl();
    w.classList.remove("max");
    V.mode = "normal";
    const l = parseFloat(w.dataset.prevLeft), t = parseFloat(w.dataset.prevTop);
    if (!isNaN(l) && !isNaN(t)) placeAt(l, t);
    else applyStartPos();
    if (!keepClosed && V.open) w.classList.add("open");
  }

  function applyEnabled() {
    document.body.classList.toggle("help-off", !P.enabled);
    if (!P.enabled && (V.open || V.minimized)) closeWindow();
    updateLaunch();
  }
  function updateBadge(resp) {
    const el = q("#helpProv");
    if (el) el.innerHTML = "Using: <b>" + esc(badgeText(resp)) + "</b>";
    const hint = q("#hpProvHint");
    if (hint) hint.textContent = ENGINE_HINT[P.engine] || "";
  }
  function updateContext() {
    const el = q("#helpCtx"), lbl = q("#helpCtxLbl");
    if (!el) return;
    const on = !!P.contextOn;
    el.classList.toggle("show", on);
    if (on && lbl) lbl.textContent = "You are on " + screenName() + " — ask about this screen";
  }

  // ------------------------------------------------------------------ chips / history sidebar / messages
  function chipsVisible() {
    const id = H.currentId;
    if (!id) return true;
    const th = H.threads.find((t) => t.id === id);
    return !th || !th.messages || !th.messages.some((m) => m.role === "user");
  }
  function renderChips() {
    const box = q("#helpChips"); if (!box) return;
    box.classList.toggle("hidden", !chipsVisible());
    box.innerHTML = (P.chips || []).map((c) => `<button type="button" class="qchip">${esc(c)}</button>`).join("");
  }
  function renderChipEditor() {
    const box = q("#helpChipEdit"); if (!box) return;
    box.innerHTML = (P.chips || []).map((c, i) =>
      `<div class="chip-row"><input type="text" data-chip="${i}" value="${esc(c)}" aria-label="Quick question ${i + 1}"><button type="button" class="chip-x" data-chip-del="${i}" title="Remove" aria-label="Remove">×</button></div>`
    ).join("");
  }
  function renderHistory() {
    const box = q("#helpHistList"); if (!box) return;
    if (!H.threads.length) {
      box.innerHTML = '<div class="sub" style="padding:8px">No saved conversations yet.</div>';
      return;
    }
    box.innerHTML = H.threads.map((t) => {
      const when = t.updated ? String(t.updated).replace("T", " ").slice(0, 16) : "";
      return `<button type="button" class="hw-th${t.id === H.currentId ? " a" : ""}" data-th="${esc(t.id)}"><span class="t">${esc(t.title || "Conversation")}</span><span class="s">${esc(when)}</span></button>`;
    }).join("");
  }
  function botAvatar() {
    return `<span class="hm-av" aria-hidden="true"><svg class="help-mark" viewBox="0 0 36 36"><use href="#help-mark"></use></svg></span>`;
  }
  function addMsg(role, html, opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "hm " + role;
    if (role === "user") wrap.innerHTML = `<span class="hm-av">U</span><div class="hm-bubble">${html}</div>`;
    else wrap.innerHTML = `${botAvatar()}<div class="hm-bubble">${html}</div>`;
    q("#helpMsgs").appendChild(wrap);
    if (opts.scroll !== false) q("#helpMsgs").scrollTop = q("#helpMsgs").scrollHeight;
    return wrap;
  }
  function welcomeHtml() {
    if (P.engine === "none") {
      return `<p>Hi, I’m the <b>Help Assistant</b> for AI TestCase Generator. <b>No AI</b> is on, so I’ll search the README and Help FAQ and show matching sections — I won’t call a model.</p><p>Try a chip below, or type a keyword such as “Zephyr”, “Jira”, or “Review”.</p>`;
    }
    return `<p>Hi, I’m the <b>Help Assistant</b> for AI TestCase Generator. Ask how a feature works — I’ll answer from the app docs (README, Settings help, and a short FAQ). I won’t change your data or run anything.</p><p>Try a suggested question, or type your own. You can also dictate with the teal mic.</p>`;
  }
  function showWelcome() {
    hideRestartConfirm();
    H.currentId = "";
    q("#helpMsgs").innerHTML = "";
    addMsg("bot", welcomeHtml(), { scroll: false });
    q("#helpMsgs").scrollTop = 0;
    renderChips();
    renderHistory();
  }
  function currentHasUserMsgs() {
    const th = H.threads.find((t) => t.id === H.currentId);
    return !!(th && th.messages && th.messages.some((m) => m.role === "user"));
  }
  function hideRestartConfirm() {
    const el = q("#helpRestartConfirm");
    if (el) el.hidden = true;
  }
  function requestRestartChat() {
    if (!currentHasUserMsgs()) { restartChat(); return; }
    const el = q("#helpRestartConfirm");
    if (el) { el.hidden = false; const yes = q("#helpRestartYes"); if (yes) yes.focus(); }
  }
  function restartChat() {
    hideRestartConfirm();
    stopMic();
    V.pending = false;
    const send = q("#helpSend"); if (send) send.disabled = false;
    // Keep the current thread in History if it already has messages (pushMsg saved it).
    saveHist();
    H.currentId = "";
    saveHist();
    const input = q("#helpInput");
    if (input) { input.value = ""; autoSize(input); }
    q("#helpMsgs").innerHTML = "";
    addMsg("bot", welcomeHtml(), { scroll: false });
    q("#helpMsgs").scrollTop = 0;
    renderChips();
    renderHistory();
    updateContext();
    say("Started a new help chat");
    if (input) input.focus();
  }
  function loadThread(id) {
    const th = H.threads.find((t) => t.id === id);
    if (!th) return;
    hideRestartConfirm();
    H.currentId = id;
    saveHist();
    const box = q("#helpMsgs");
    box.innerHTML = "";
    (th.messages || []).forEach((m) => {
      if (m.role === "user") addMsg("user", `<p>${esc(m.text || "")}</p>`, { scroll: false });
      else addMsg("bot", m.html || formatAnswer(m.text || ""), { scroll: false });
    });
    if (!th.messages || !th.messages.length) addMsg("bot", welcomeHtml(), { scroll: false });
    box.scrollTop = box.scrollHeight;
    renderChips();
    renderHistory();
  }
  function newId() { return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function ensureThread(question) {
    if (H.currentId) {
      const ex = H.threads.find((t) => t.id === H.currentId);
      if (ex) return ex;
    }
    const title = String(question || "Conversation").replace(/\s+/g, " ").trim().slice(0, 60) || "Conversation";
    const th = { id: newId(), title: title, updated: new Date().toISOString(), messages: [] };
    H.threads.unshift(th);
    H.currentId = th.id;
    H.threads = H.threads.slice(0, MAX_THREADS);
    return th;
  }
  function pushMsg(th, role, text, html) {
    th.messages = th.messages || [];
    th.messages.push({ role: role, text: text || "", html: html || "" });
    if (th.messages.length > MAX_MSGS) th.messages = th.messages.slice(-MAX_MSGS);
    th.updated = new Date().toISOString();
    saveHist();
    renderHistory();
  }

  // ------------------------------------------------------------------ render answers
  function inlineFmt(s) {
    let out = esc(s);
    out = out.replace(/`([^`]+)`/g, '<code class="mono">$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    return out;
  }
  function formatAnswer(text) {
    const raw = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!raw) return "";
    const lines = raw.split("\n");
    let html = "", list = [], para = [];
    const flushP = () => { if (para.length) { html += "<p>" + inlineFmt(para.join(" ")) + "</p>"; para = []; } };
    const flushList = () => {
      if (!list.length) return;
      html += "<ol>" + list.map((x) => "<li>" + inlineFmt(x) + "</li>").join("") + "</ol>";
      list = [];
    };
    for (const line of lines) {
      const m = line.match(/^\s*\d+\.\s+(.*)$/);
      if (m) { flushP(); list.push(m[1]); continue; }
      if (!line.trim()) { flushList(); flushP(); continue; }
      flushList();
      para.push(line.trim());
    }
    flushList(); flushP();
    return html || "<p></p>";
  }
  function reEsc(w) {
    return String(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function highlight(text, query) {
    const words = String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    let out = esc(text);
    words.forEach((w) => {
      out = out.replace(new RegExp("(" + reEsc(w) + ")", "gi"), "<mark>$1</mark>");
    });
    return out;
  }
  function searchHtml(query, hits) {
    if (!hits || !hits.length) {
      return `<p>No matching README or FAQ sections for “${esc(query)}”. Try “Zephyr”, “Jira”, “Generate”, “Review”, or “qTest”.</p>`;
    }
    const cards = hits.slice(0, 5).map((h) =>
      `<div class="hit"><h4>${esc(h.title)}</h4><p>${highlight(h.snippet || h.text || "", query)}</p><div class="src">${esc((h.source || "README") + " › " + (h.title || ""))}</div></div>`
    ).join("");
    const n = Math.min(hits.length, 5);
    return `<p>Docs search (no AI) — ${n} matching section${n === 1 ? "" : "s"} for “${esc(query)}”:</p>${cards}`;
  }
  function citesHtml(sources) {
    if (!sources || !sources.length) return "";
    return sources.slice(0, 6).map((s) =>
      `<span class="cite">Source: ${esc(s.source || "README")} › ${esc(s.title || "")}</span>`
    ).join("");
  }
  function inferJumps(question, sources) {
    const t = (String(question || "") + " " + (sources || []).map((s) => (s.title || "") + " " + (s.source || "")).join(" ")).toLowerCase();
    const jumps = [];
    const add = (key, spec) => { if (!jumps.some((j) => j.key === key)) jumps.push(Object.assign({ key: key }, spec)); };
    if (/zephyr/.test(t)) add("zephyr", { tab: "integrations", jumpId: "set-int-zephyr-scale", label: "Open Settings › Zephyr" });
    if (/jira/.test(t)) add("jira", { tab: "integrations", jumpId: "set-int-jira", label: "Open Settings › Jira" });
    if (/\bqtest\b/.test(t)) add("qtest", { tab: "integrations", jumpId: "set-int-qtest", label: "Open Settings › qTest" });
    if (/groq|gpt-oss|llama-3\.3|model 404/.test(t)) add("groq", { tab: "providers", provider: "Groq", label: "Open Settings › Groq" });
    if (/parse error|parser/.test(t)) add("generate", { view: "generate", label: "Go to Generate" });
    if (/voice input|speech recognition|dictat|web speech/.test(t)) add("voice", { tab: "preferences", jumpId: "voiceCard", label: "Open Settings › Voice input" });
    if (/help assistant|quick.question chip/.test(t)) add("help", { tab: "preferences", jumpId: "helpCard", label: "Open Settings › Help Assistant" });
    if (/how to generate|generate test cases/.test(t)) add("input", { view: "input", label: "Go to Input" });
    if (/what is (the )?review|review (step|screen|page)/.test(t)) add("review", { view: "review", label: "Go to Review" });
    return jumps.slice(0, 3);
  }
  function jumpsHtml(jumps) {
    if (!jumps || !jumps.length) return "";
    return `<div class="hm-acts">${jumps.map((j, i) =>
      `<button type="button" class="btn g sm" data-jump="${i}">${esc(j.label)}</button>`
    ).join("")}</div>`;
  }
  function doJump(spec) {
    if (!spec) return;
    if (spec.view) {
      if (typeof window.go === "function") window.go(spec.view);
      say("Opened " + (spec.label || spec.view).replace(/^Go to /, ""));
      return;
    }
    const opts = { jumpId: spec.jumpId || "", provider: spec.provider || "" };
    if (typeof window.goSettings === "function") window.goSettings(spec.tab || "preferences", opts);
    else if (typeof window.go === "function") window.go("settings");
    say("Jumped to " + (spec.label || "Settings").replace(/^Open /, ""));
  }

  // ------------------------------------------------------------------ send
  function historyPayload() {
    const th = H.threads.find((t) => t.id === H.currentId);
    if (!th || !th.messages) return [];
    return th.messages.filter((m) => m.role === "user" || m.role === "bot").slice(-6).map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text || ""
    }));
  }
  function showTyping() {
    return addMsg("bot", '<span class="hm-typing" aria-label="Thinking"><i></i><i></i><i></i></span>');
  }
  async function sendQuestion(raw) {
    const question = String(raw || "").replace(/\s+/g, " ").trim();
    if (!question || V.pending) return;
    stopMic();
    const input = q("#helpInput");
    if (input) { input.value = ""; autoSize(input); }
    addMsg("user", `<p>${esc(question)}</p>`);
    const th = ensureThread(question);
    pushMsg(th, "user", question, "");
    renderChips();
    V.pending = true;
    q("#helpSend").disabled = true;
    const typing = showTyping();
    const provider = resolvedProvider();
    const screen = P.contextOn ? screenName() : "";
    try {
      let html = "", sources = [], resp = null;
      if (provider === "none") {
        const j = await api("/api/help/search?q=" + encodeURIComponent(question));
        resp = { provider: "none", model: "", hits: j.hits || [] };
        sources = (j.hits || []).map((h) => ({ title: h.title, anchor: h.anchor, source: h.source }));
        html = searchHtml(question, j.hits || []);
      } else {
        const j = await api("/api/help/chat", {
          method: "POST",
          body: { question: question, history: historyPayload().slice(0, -1), screen: screen, provider: provider }
        });
        resp = j;
        sources = j.sources || [];
        html = formatAnswer(j.answer || "") + citesHtml(sources);
      }
      const jumps = inferJumps(question, sources);
      html += jumpsHtml(jumps);
      const out = html || "<p>(No answer returned.)</p>";
      if (document.body.contains(typing)) {
        typing.dataset.jumps = JSON.stringify(jumps);
        typing.querySelector(".hm-bubble").innerHTML = out;
        q("#helpMsgs").scrollTop = q("#helpMsgs").scrollHeight;
        updateBadge(resp);
      }
      pushMsg(th, "bot", (resp && resp.answer) || question, out);
    } catch (err) {
      const msg = (err && err.message) ? err.message : "Help request failed.";
      const out = `<p>${esc(msg)}</p>`;
      if (document.body.contains(typing)) {
        typing.querySelector(".hm-bubble").innerHTML = out;
        say(msg, true);
      }
      pushMsg(th, "bot", msg, out);
    } finally {
      if (H.currentId === th.id) {
        V.pending = false;
        const send = q("#helpSend"); if (send) send.disabled = false;
        if (input) input.focus();
      }
    }
  }

  // ------------------------------------------------------------------ mic (Web Speech API → help input)
  function setMicLive(on) {
    V.listening = !!on;
    const b = q("#helpMic");
    if (b) b.classList.toggle("live", !!on);
  }
  function stopMic() {
    try { if (V.rec) V.rec.stop(); } catch (e) { /* ignore */ }
    V.rec = null;
    setMicLive(false);
  }
  function startMic() {
    const input = q("#helpInput");
    if (!SR) {
      say("Voice input needs Chrome or Edge — this browser has no speech recognition.", true);
      return;
    }
    if (V.listening) { stopMic(); return; }
    let Rec;
    try { Rec = window.SpeechRecognition || window.webkitSpeechRecognition; } catch (e) { Rec = null; }
    if (!Rec) { say("Voice input needs Chrome or Edge — this browser has no speech recognition.", true); return; }
    const rec = new Rec();
    V.rec = rec;
    V.startedEmpty = !String(input.value || "").trim();
    const base = String(input.value || "");
    rec.lang = voiceLang();
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (ev) => {
      let interim = "", finalT = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalT += t;
        else interim += t;
      }
      const phrase = (finalT || interim).trim();
      const prefix = base && !/[\s]$/.test(base) ? base + " " : base;
      input.value = (prefix + phrase).replace(/^\s+/, "");
      autoSize(input);
      if (finalT.trim()) {
        setMicLive(false);
        if (V.startedEmpty) sendQuestion(input.value);
      }
    };
    rec.onerror = (ev) => {
      setMicLive(false);
      const err = ev && ev.error;
      if (err === "not-allowed") say("Microphone permission is blocked. Allow it in the site settings (padlock icon).", true);
      else if (err && err !== "no-speech" && err !== "aborted") say("Voice input error: " + err, true);
    };
    rec.onend = () => { if (V.rec === rec) { V.rec = null; setMicLive(false); } };
    try { rec.start(); setMicLive(true); }
    catch (e) { setMicLive(false); say("Could not start the microphone.", true); }
  }

  function autoSize(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 88) + "px";
  }

  // ------------------------------------------------------------------ Settings card
  function renderSettingsCard(pane) {
    if (!pane) return;
    let card = q("#helpCard", pane);
    if (!card) { card = document.createElement("div"); card.className = "card"; card.id = "helpCard"; card.style.marginTop = "14px"; pane.appendChild(card); }
    const opts = ENGINES.map((e) => `<option value="${e.id}" ${e.id === P.engine ? "selected" : ""}>${esc(e.label)}</option>`).join("");
    card.innerHTML = `<h3>💬 Help Assistant</h3>
      <div class="sub" style="margin:0 0 10px">A blue chat icon in the header (next to the voice mic) opens a draggable help window. Answers come from the app docs (README and a short FAQ). These preferences stay in this browser only (not in .env or the database).</div>
      <div class="help-pref-grid">
        <div>
          <label class="sw"><input type="checkbox" id="hpEnabled" ${P.enabled ? "checked" : ""}><span class="t"></span> Enable launcher</label>
          <div class="sub" style="margin:6px 0 0">Shows the header chat icon. Turn off to hide it.</div>
        </div>
        <div>
          <label for="hpProvider" style="margin-top:0">Answer engine</label>
          <select id="hpProvider" style="width:100%">${opts}</select>
          <div class="sub" style="margin:6px 0 0" id="hpProvHint">${esc(ENGINE_HINT[P.engine] || "")}</div>
        </div>
        <div>
          <label class="sw"><input type="checkbox" id="hpContext" ${P.contextOn ? "checked" : ""}><span class="t"></span> Include current screen context</label>
          <div class="sub" style="margin:6px 0 0">When you are on Review, the window can say “You are on Review — ask about this screen.”</div>
        </div>
        <div>
          <label style="margin-top:0">Chat history</label>
          <button type="button" class="btn g sm" id="hpClear">Clear chat history</button>
          <button type="button" class="btn g sm" id="hpResetPos" style="margin-left:8px">Reset window position</button>
          <div class="sub" style="margin:6px 0 0">Removes conversations in this browser. Does not change docs or app data.</div>
        </div>
      </div>
      <h3 style="margin:6px 0 4px">Quick-question chips</h3>
      <div class="sub" style="margin:0 0 6px">These shortcuts appear under the welcome message. Edit the label, remove a chip, or add your own.</div>
      <div class="chip-edit" id="helpChipEdit"></div>
      <div style="margin-top:10px"><button type="button" class="btn g sm" id="hpAddChip">＋ Add question</button></div>`;
    renderChipEditor();
    q("#hpEnabled", card).onchange = (e) => { P.enabled = e.target.checked; savePrefs(); applyEnabled(); say(P.enabled ? "Help Assistant launcher on" : "Help Assistant launcher hidden"); };
    q("#hpProvider", card).onchange = (e) => {
      P.engine = e.target.value; savePrefs(); updateBadge();
      if (chipsVisible()) { const box = q("#helpMsgs"); if (box && !H.currentId) { box.innerHTML = ""; addMsg("bot", welcomeHtml(), { scroll: false }); } }
      say(P.engine === "none" ? "Docs search only — no model will be called" : "Answer engine: " + engineLabel(P.engine));
    };
    q("#hpContext", card).onchange = (e) => { P.contextOn = e.target.checked; savePrefs(); updateContext(); };
    q("#hpClear", card).onclick = () => {
      if (!confirm("Clear Help Assistant chat history in this browser?")) return;
      H = { threads: [], currentId: "" };
      try { localStorage.removeItem(HIST_KEY); } catch (e) { /* ignore */ }
      q("#helpMsgs").innerHTML = "";
      addMsg("bot", `<p>Chat history cleared in this browser. Ask a new question whenever you’re ready.</p>` + welcomeHtml());
      renderChips(); renderHistory();
      say("Chat history cleared");
    };
    q("#hpResetPos", card).onclick = () => resetPosition();
    q("#hpAddChip", card).onclick = () => { P.chips.push("New question"); savePrefs(); renderChipEditor(); renderChips(); const ins = qa("#helpChipEdit input", card).pop(); if (ins) { ins.focus(); ins.select(); } };
    const ed = q("#helpChipEdit", card);
    ed.addEventListener("input", (e) => {
      const i = e.target.dataset.chip; if (i == null) return;
      P.chips[+i] = e.target.value; savePrefs(); renderChips();
    });
    ed.addEventListener("click", (e) => {
      const b = e.target.closest("[data-chip-del]"); if (!b) return;
      P.chips.splice(+b.dataset.chipDel, 1); savePrefs(); renderChipEditor(); renderChips();
    });
  }
  window.helpRenderSettings = function (pane) {
    try { renderSettingsCard(pane || q('.set-pane[data-pane="preferences"]')); } catch (e) { console.error("help settings", e); }
  };

  // ------------------------------------------------------------------ bind
  function bind() {
    q("#helpLaunch").onclick = () => { if (V.open) closeWindow(); else openWindow(); };
    q("#helpRestart").onclick = (e) => { e.stopPropagation(); requestRestartChat(); };
    q("#helpRestartSide").onclick = (e) => { e.stopPropagation(); requestRestartChat(); };
    q("#helpRestartYes").onclick = (e) => { e.stopPropagation(); restartChat(); };
    q("#helpRestartNo").onclick = (e) => { e.stopPropagation(); hideRestartConfirm(); };
    q("#helpMin").onclick = (e) => { e.stopPropagation(); hideRestartConfirm(); minimize(); };
    q("#helpMax").onclick = (e) => { e.stopPropagation(); V.mode === "max" ? exitMax() : enterMax(); };
    q("#helpClose").onclick = (e) => { e.stopPropagation(); closeWindow(); };
    q("#helpPill").onclick = () => openWindow();
    q("#helpNewChat").onclick = () => showWelcome();
    q("#helpSend").onclick = () => sendQuestion(q("#helpInput").value);
    q("#helpInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(q("#helpInput").value); }
    });
    q("#helpInput").addEventListener("input", () => autoSize(q("#helpInput")));
    q("#helpChips").addEventListener("click", (e) => {
      const b = e.target.closest(".qchip"); if (b) sendQuestion(b.textContent);
    });
    q("#helpMsgs").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-jump]"); if (!btn) return;
      const wrap = btn.closest(".hm");
      let jumps = [];
      try { jumps = JSON.parse(wrap && wrap.dataset.jumps || "[]"); } catch (err) { jumps = []; }
      doJump(jumps[+btn.dataset.jump]);
    });
    q("#helpHistList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-th]"); if (b) loadThread(b.dataset.th);
    });
    const mic = q("#helpMic");
    if (!SR) {
      mic.classList.add("unsupported");
      mic.title = "Voice input needs Chrome or Edge — this browser has no speech recognition.";
    }
    mic.onclick = () => startMic();
    bindDrag();
    window.addEventListener("hashchange", updateContext);
    if (typeof window.go === "function") {
      const prev = window.go;
      window.go = function () { const r = prev.apply(this, arguments); try { updateContext(); } catch (e) { /* ignore */ } return r; };
    }
  }

  function registerWinMgr() {
    if (!window.WinMgr) return;
    window.WinMgr.register({
      id: "help",
      el: "#helpWin",
      title: "#helpTitle",
      posKey: POS_KEY,
      slot: "left",
      fallbackSize: { w: 420, h: 580 },
      pillId: "wmPill-help",
      pillClass: "help",
      pillLabel: "Help Assistant",
      pillHTML: ICON + "<span>Help Assistant</span>",
      enabled: () => P.enabled,
      requestOpen: () => {
        if (!P.enabled) return;
        V.open = true; V.minimized = false; V.mode = "normal";
        const w = winEl(); if (w) w.classList.add("open");
        updateLaunch();
        if (q("#helpMsgs") && q("#helpMsgs").childElementCount === 0) showWelcome();
      },
      syncState: (state) => {
        V.open = state === "open" || state === "max";
        V.minimized = state === "min";
        V.mode = state === "max" ? "max" : "normal";
        if (state === "max") renderHistory();
        if (state !== "open" && state !== "max") hideRestartConfirm();
        updateLaunch();
      }
    });
  }
  function init() {
    if (!buildDom()) return;
    registerWinMgr();
    bind();
    applyEnabled();
    updateBadge();
    updateContext();
    showWelcome();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
