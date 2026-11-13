/* Voice input — dictate into any field across the app.
   Header mic launcher → draggable "Voice input" window (minimize / maximize / close),
   Start / Pause / Resume / Stop, language picker, voice commands, Ctrl+Shift+Space.
   Uses the browser's Web Speech API (SpeechRecognition / webkitSpeechRecognition):
   no AI model, no API key, no backend call. Preferences live in this browser's localStorage. */
"use strict";

(function () {
  const PREFS_KEY = "atg.voice.prefs";
  const POS_KEY = "atg.voice.pos";
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const LANGS = [["en-IN", "English (India)"], ["en-US", "English (US)"], ["hi-IN", "Hindi"], ["ta-IN", "Tamil"]];
  const ACTIONS = [
    { id: "next-field", label: "Next field" },
    { id: "next-step", label: "Next step" },
    { id: "new-line", label: "New line" },
    { id: "pause", label: "Pause" },
    { id: "stop", label: "Stop listening" },
    { id: "undo", label: "Undo last phrase" },
    { id: "add-step", label: "Add step" },
    { id: "save", label: "Save changes" },
    { id: "insert", label: "Insert text…" },
  ];
  const DEFAULT_CMDS = [
    { phrases: "next field, next box", action: "next-field", on: true },
    { phrases: "next step", action: "next-step", on: true },
    { phrases: "new line, new paragraph", action: "new-line", on: true },
    { phrases: "pause, pause dictation", action: "pause", on: true },
    { phrases: "stop listening, stop dictation", action: "stop", on: true },
    { phrases: "undo, scratch that, delete that", action: "undo", on: true },
    { phrases: "add step, new step", action: "add-step", on: true },
    { phrases: "save changes, save", action: "save", on: true },
  ];
  const DEFAULT_PREFS = { enabled: true, lang: "en-IN", shortcut: true, autoPunct: true, startPos: "br", commands: null };

  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
  const vesc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (msg, err) => { if (typeof window.toast === "function") window.toast(msg, !!err); };
  const cloneCmds = (list) => list.map((c) => ({ phrases: c.phrases || "", action: c.action || "insert", snippet: c.snippet || "", on: c.on !== false, custom: !!c.custom }));

  // ------------------------------------------------------------------ preferences (localStorage only)
  function loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { p = {}; }
    const out = Object.assign({}, DEFAULT_PREFS, p);
    if (!LANGS.some((l) => l[0] === out.lang)) out.lang = "en-IN";
    if (!["br", "bl", "tr", "remember"].includes(out.startPos)) out.startPos = "br";
    out.commands = Array.isArray(out.commands) ? cloneCmds(out.commands) : cloneCmds(DEFAULT_CMDS);
    return out;
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(P)); } catch (e) { /* storage full / blocked */ } }
  const P = loadPrefs();

  // ------------------------------------------------------------------ state
  const V = {
    state: "idle",          // idle | listening | paused
    target: null,           // last focused editable element (outside the voice window)
    sel: null,              // saved caret for target: {start,end} or Range
    interim: "",
    rec: null, restart: false, restarts: [],
    mode: "normal",         // normal | max
    open: false, minimized: false,
    undo: [],
  };

  // ------------------------------------------------------------------ editable fields
  const TEXT_TYPES = ["text", "search", "url", "tel", ""];
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest("#voiceWin, #vPill, #helpWin, #helpPill, #wmTray")) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (el.tagName === "INPUT") {
      const t = (el.getAttribute("type") || "").toLowerCase();
      return TEXT_TYPES.includes(t) && !el.disabled && !el.readOnly;
    }
    return false;
  }
  function editableRoot(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.isContentEditable) { let r = el; while (r.parentElement && r.parentElement.isContentEditable) r = r.parentElement; return r; }
    return isEditable(el) ? el : null;
  }
  function visible(el) { return !!(el && document.contains(el) && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden"); }
  function allFields() {
    return qa('input, textarea, [contenteditable="true"], [contenteditable=""]').filter((el) => isEditable(el) && visible(el) && (!el.isContentEditable || editableRoot(el) === el));
  }
  function liveTarget() { return V.target && document.contains(V.target) ? V.target : null; }

  function labelOf(el) {
    if (!el) return "—";
    const tc = el.closest(".tc");
    if (tc && el.dataset.f) {
      const id = (q(".tcid", tc) || {}).textContent || "Test case";
      const fname = { name: "Name", description: "Description", precondition: "Precondition", expected: "Expected Result" }[el.dataset.f] || el.dataset.f;
      if (el.dataset.step !== undefined) return `${id} · Step ${+el.dataset.step + 1} · ${el.dataset.f === "expected" ? "Expected Result" : "Step Description"}`;
      return `${id} · ${fname}`;
    }
    const aria = el.getAttribute("aria-label"); if (aria) return aria;
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && l.textContent.trim()) return l.textContent.trim().slice(0, 60); }
    const wrap = el.closest("label"); if (wrap && wrap.textContent.trim()) return wrap.textContent.trim().slice(0, 60);
    let prev = el.previousElementSibling;
    while (prev && !/^(LABEL|H3|H4)$/.test(prev.tagName) && !prev.classList.contains("lbl")) prev = prev.previousElementSibling;
    if (prev && prev.textContent.trim()) return prev.textContent.trim().slice(0, 60);
    const ph = el.getAttribute("placeholder") || el.dataset.ph || el.getAttribute("title");
    if (ph) return ph.replace(/^🔍\s*/, "").slice(0, 60);
    return el.name || el.id || "Field";
  }

  function setTarget(el, focus) {
    qa(".voice-focus").forEach((n) => n.classList.remove("voice-focus"));
    if (el !== V.target) V.sel = null;
    V.target = el || null;
    if (el) {
      if (V.state !== "idle") el.classList.add("voice-focus");
      if (focus && document.activeElement !== el) {
        const saved = V.sel;
        try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); }
        if (saved) restoreCaret(el, saved); else placeCaretEnd(el);
      }
    }
    updateTargetLabel();
  }
  function placeCaretEnd(el) {
    try {
      if (el.isContentEditable) {
        const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      } else if (typeof el.selectionStart === "number") { const n = el.value.length; el.setSelectionRange(n, n); }
    } catch (e) { /* not selectable */ }
  }
  function restoreCaret(el, saved) {
    try {
      if (el.isContentEditable && saved.commonAncestorContainer && el.contains(saved.commonAncestorContainer)) {
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(saved);
      } else if (typeof saved.start === "number" && typeof el.selectionStart === "number") {
        el.setSelectionRange(Math.min(saved.start, el.value.length), Math.min(saved.end, el.value.length));
      } else placeCaretEnd(el);
    } catch (e) { placeCaretEnd(el); }
  }
  function rememberCaret() {
    const el = liveTarget(); if (!el) return;
    if (el.isContentEditable) {
      const s = window.getSelection();
      if (s && s.rangeCount && el.contains(s.getRangeAt(0).commonAncestorContainer)) V.sel = s.getRangeAt(0).cloneRange();
    } else if (document.activeElement === el && typeof el.selectionStart === "number") {
      V.sel = { start: el.selectionStart, end: el.selectionEnd };
    }
  }

  // ------------------------------------------------------------------ text insertion
  function punctuate(text, before) {
    if (!P.autoPunct) return text;
    let t = text
      .replace(/\s*\b(comma)\b/gi, ",")
      .replace(/\s*\b(full stop)\b/gi, ".")
      .replace(/\s*\b(question mark)\b/gi, "?")
      .replace(/\s*\b(exclamation mark|exclamation point)\b/gi, "!")
      .replace(/\s*\b(colon)\b/gi, ":")
      .replace(/\s*\b(semicolon)\b/gi, ";");
    t = t.replace(/([.?!])\s*([a-z])/g, (m, p, c) => p + " " + c.toUpperCase());
    const startSentence = !before.trim() || /[.?!]\s*$/.test(before) || /\n\s*$/.test(before);
    if (startSentence) t = t.replace(/^(\s*)([a-z])/, (m, s, c) => s + c.toUpperCase());
    return t;
  }
  function insertText(raw, opts = {}) {
    const el = liveTarget();
    if (!el) { say("Click into a field first, then dictate.", true); return false; }
    if (!raw) return false;
    const undo = el.isContentEditable ? { el, html: el.innerHTML } : { el, value: el.value };
    if (el.isContentEditable) {
      const s = window.getSelection();
      let range = null;
      if (document.activeElement === el && s.rangeCount && el.contains(s.getRangeAt(0).commonAncestorContainer)) range = s.getRangeAt(0);
      else if (V.sel && V.sel.commonAncestorContainer && el.contains(V.sel.commonAncestorContainer)) range = V.sel;
      if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
      const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(range.startContainer, range.startOffset);
      const prevText = pre.toString();
      let text = opts.raw ? raw : punctuate(raw.trim(), prevText);
      if (!opts.raw && prevText && !/\s$/.test(prevText) && !/^[\s.,?!:;]/.test(text)) text = " " + text;
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      const after = document.createRange(); after.setStartAfter(node); after.collapse(true);
      if (document.activeElement === el) { s.removeAllRanges(); s.addRange(after); }
      V.sel = after.cloneRange();
    } else {
      const v = el.value;
      let start = v.length, end = v.length;
      if (document.activeElement === el && typeof el.selectionStart === "number") { start = el.selectionStart; end = el.selectionEnd; }
      else if (V.sel && typeof V.sel.start === "number") { start = Math.min(V.sel.start, v.length); end = Math.min(V.sel.end, v.length); }
      const prevText = v.slice(0, start);
      let text = opts.raw ? raw : punctuate(raw.trim(), prevText);
      if (el.tagName === "INPUT") text = text.replace(/\n/g, " ");
      if (!opts.raw && prevText && !/\s$/.test(prevText) && !/^[\s.,?!:;]/.test(text)) text = " " + text;
      el.value = v.slice(0, start) + text + v.slice(end);
      const pos = start + text.length;
      try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
      V.sel = { start: pos, end: pos };
    }
    V.undo.push(undo); if (V.undo.length > 30) V.undo.shift();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  function undoLast() {
    const u = V.undo.pop();
    if (!u || !document.contains(u.el)) { say("Nothing to undo"); return; }
    if ("html" in u) u.el.innerHTML = u.html; else u.el.value = u.value;
    setTarget(u.el, true);
    u.el.dispatchEvent(new Event("input", { bubbles: true }));
    say("Undid last phrase");
  }

  // ------------------------------------------------------------------ DOM: launcher, window, pill
  const MIC = '<svg class="mic-mark" viewBox="0 0 36 36" aria-hidden="true"><use href="#mic-mark"></use></svg>';
  function langOptions(sel) { return LANGS.map(([v, l]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${l}</option>`).join(""); }
  function buildDom() {
    let launch = q("#voiceLaunch");
    if (!launch) {
      const tb = q(".topbar"); if (!tb) return false;
      launch = document.createElement("button");
      launch.type = "button"; launch.id = "voiceLaunch"; launch.className = "voice-launch";
      launch.innerHTML = MIC + '<span class="live-badge"><i></i>LIVE</span>';
      const nr = q("#newRunBtn"); if (nr) nr.after(launch); else tb.appendChild(launch);
    }
    launch.setAttribute("aria-label", "Voice input");
    if (!SR) { launch.classList.add("unsupported"); launch.title = "Voice input needs Chrome or Edge (this browser has no speech recognition)"; }
    else launch.title = "Voice input (Ctrl+Shift+Space to start / pause)";

    const win = document.createElement("div");
    win.id = "voiceWin"; win.setAttribute("role", "dialog"); win.setAttribute("aria-label", "Voice input");
    win.innerHTML = `
      <div class="vw-title" id="vTitle">${MIC}<b>Voice input</b>
        <span class="vw-live"><i></i><span id="vwLiveLbl">LIVE</span></span><span class="vw-sp"></span>
        <button type="button" class="vw-tb" id="vMin" title="Minimize" aria-label="Minimize">–</button>
        <button type="button" class="vw-tb" id="vMax" title="Maximize" aria-label="Maximize">▢</button>
        <button type="button" class="vw-tb x" id="vClose" title="Close" aria-label="Close">×</button></div>
      <div class="vw-body">
        <div class="vstate idle" id="vState"><span class="dot"></span><span id="vStateLbl">Idle</span></div>
        <div class="vtarget" id="vTarget"></div>
        <div class="vmsg hidden" id="vMsg"></div>
        <div class="vlang"><label for="vLang">Language</label><select id="vLang" aria-label="Dictation language">${langOptions(P.lang)}</select></div>
        <div class="vrow">
          <button type="button" class="btn sm" id="vStart">Start</button>
          <button type="button" class="btn sm vam" id="vPause" disabled>Pause</button>
          <button type="button" class="btn sm s" id="vResume" disabled>Resume</button>
          <button type="button" class="btn sm r" id="vStop" disabled>Stop</button></div>
        <div class="vtranscript" id="vTrans"><div class="th">Live transcript</div><div class="muted" id="vTransEmpty">Nothing dictated yet. Click a field, then Start and speak.</div><div id="vTransLines"></div></div>
        <div class="vfoot"><span id="vShortcutHint">Shortcut: <span class="vkbd">Ctrl</span>+<span class="vkbd">Shift</span>+<span class="vkbd">Space</span></span><span style="flex:1"></span>
          <button type="button" class="link" id="vResetPos">Reset position</button>
          <button type="button" class="v-ico-btn" id="vHelpBtn" title="Voice commands" aria-label="Voice commands">?</button></div>
        <div class="vpop hidden" id="vPop" role="dialog" aria-label="Voice commands"><h4>Voice commands</h4>
          <p class="sub" style="margin:0 0 8px">Say the phrase on its own. Edit phrases in Settings → Preferences → Voice input. Click or Tab to another field to keep dictating there.</p>
          <table id="vPopTable"></table></div>
      </div>`;
    document.body.appendChild(win);
    const pill = document.createElement("button");
    pill.type = "button"; pill.id = "vPill"; pill.title = "Restore Voice input";
    pill.innerHTML = MIC + '<span>Voice input</span><span class="live-badge" id="vPillBadge">LIVE</span>';
    document.body.appendChild(pill);
    return true;
  }

  // ------------------------------------------------------------------ window placement
  function win() { return q("#voiceWin"); }
  function loadPos() { try { return JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch (e) { return null; } }
  function savePos() {
    if (V.mode !== "normal") return;
    const r = win().getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })); } catch (e) { /* ignore */ }
  }
  function clampPos(l, t) {
    const w = win(); const ww = w.offsetWidth || 400, wh = w.offsetHeight || 300;
    return [Math.min(Math.max(0, l), Math.max(0, window.innerWidth - ww)), Math.min(Math.max(0, t), Math.max(0, window.innerHeight - Math.min(wh, 40)))];
  }
  function placeAt(l, t) {
    const w = win(); [l, t] = clampPos(l, t);
    Object.assign(w.style, { transform: "", right: "auto", bottom: "auto", left: l + "px", top: t + "px" });
  }
  function applyStartPos(kind) {
    const w = win(); const k = kind || P.startPos || "br";
    if (k === "remember") { const s = loadPos(); if (s && s.left != null) { placeAt(s.left, s.top); return; } }
    Object.assign(w.style, { transform: "", left: "auto", top: "auto", right: "auto", bottom: "auto" });
    if (k === "bl") { const sb = q(".sb"); w.style.left = ((sb ? sb.offsetWidth : 0) + 20) + "px"; w.style.bottom = "16px"; }
    else if (k === "tr") { w.style.right = "20px"; w.style.top = "64px"; }
    else { w.style.right = "20px"; w.style.bottom = "16px"; }
  }
  function resetPosition() {
    if (window.WinMgr) { window.WinMgr.reset("voice"); return; }
    try { localStorage.removeItem(POS_KEY); } catch (e) { /* ignore */ }
    if (V.mode === "max") exitMax(true);
    applyStartPos("br");
    say("Voice window moved back to the bottom-right");
  }
  function bindDrag() {
    if (window.WinMgr) return; // shared window manager owns drag, snap, resize, and z-order
    const title = q("#vTitle"), w = win();
    let drag = null;
    title.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button") || V.mode === "max") return;
      const r = w.getBoundingClientRect();
      drag = { ox: e.clientX - r.left, oy: e.clientY - r.top, id: e.pointerId };
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

  // ------------------------------------------------------------------ open / minimize / maximize / close
  function openWindow(opts = {}) {
    if (!P.enabled) return;
    const w = win(); const first = !w.dataset.placed;
    V.open = true; V.minimized = false;
    q("#vPill").classList.remove("show");
    w.classList.add("open");
    if (window.WinMgr) {
      if (V.mode === "max") window.WinMgr.maximize("voice");
      else window.WinMgr.show("voice", { reposition: !!opts.reposition });
      w.dataset.placed = "1";
    } else if (V.mode !== "max" && (first || opts.reposition)) { applyStartPos(); w.dataset.placed = "1"; }
    if (!liveTarget()) { const a = editableRoot(document.activeElement); if (a) setTarget(a); }
    updateTargetLabel(); updateLaunch();
  }
  function closeWindow() {
    if (V.state !== "idle") stopListening();
    V.open = false; V.minimized = false;
    if (window.WinMgr) {
      window.WinMgr.close("voice");
    } else {
      const w = win(); w.classList.remove("open", "max"); w.style.transform = "";
      if (V.mode === "max") { V.mode = "normal"; applyStartPos(); }
      q("#vPill").classList.remove("show");
    }
    V.mode = "normal";
    q("#vMax").title = "Maximize";
    hideHelp(); updateLaunch();
  }
  function minimize() {
    V.open = false; V.minimized = true;
    hideHelp();
    if (window.WinMgr) window.WinMgr.minimize("voice");
    else { win().classList.remove("open"); q("#vPill").classList.add("show"); }
    updateLaunch();
  }
  function enterMax() {
    if (window.WinMgr) { window.WinMgr.maximize("voice"); return; }
    if (V.mode === "normal") savePos();
    V.mode = "max"; win().classList.add("max"); q("#vMax").title = "Restore"; q("#vMax").setAttribute("aria-label", "Restore");
  }
  function exitMax(skipPlace) {
    if (window.WinMgr) { window.WinMgr.unmaximize("voice", { keepHidden: !!skipPlace && !V.open }); return; }
    V.mode = "normal"; const w = win(); w.classList.remove("max"); w.style.transform = "";
    q("#vMax").title = "Maximize"; q("#vMax").setAttribute("aria-label", "Maximize");
    if (skipPlace) return;
    const s = loadPos(); if (s && s.left != null) placeAt(s.left, s.top); else applyStartPos();
  }
  function hideHelp() { const p = q("#vPop"); if (p) p.classList.add("hidden"); const b = q("#vHelpBtn"); if (b) b.classList.remove("on"); }

  // ------------------------------------------------------------------ status rendering
  function updateTargetLabel() {
    const box = q("#vTarget"); if (!box) return;
    const el = liveTarget();
    box.innerHTML = "Typing into: <b>" + vesc(el ? labelOf(el) : "—") + "</b>" + (el ? "" : ' <span class="muted">(click a field first)</span>');
    box.title = el ? labelOf(el) : "";
  }
  function updateLaunch() {
    const l = q("#voiceLaunch"); if (!l) return;
    l.classList.toggle("live", V.state === "listening");
    l.setAttribute("aria-pressed", V.open || V.minimized ? "true" : "false");
  }
  function setState(s) {
    V.state = s;
    const st = q("#vState"); st.className = "vstate " + s;
    q("#vStateLbl").textContent = s === "listening" ? "Listening… speak now" : s === "paused" ? "Paused" : "Idle";
    const w = win(); w.classList.toggle("listening", s === "listening"); w.classList.toggle("paused", s === "paused");
    q("#vwLiveLbl").textContent = s === "paused" ? "PAUSED" : "LIVE";
    const pill = q("#vPill"); if (pill) { pill.classList.toggle("live", s === "listening"); pill.classList.toggle("paused", s === "paused"); }
    const pb = q("#vPillBadge"); if (pb) pb.textContent = s === "paused" ? "PAUSED" : "LIVE";
    const wp = q("#wmPill-voice");
    if (wp) { wp.classList.toggle("live", s === "listening"); wp.classList.toggle("paused", s === "paused"); }
    const wb = q("#wmVoiceBadge"); if (wb) wb.textContent = s === "paused" ? "PAUSED" : "LIVE";
    q("#vStart").disabled = s !== "idle";
    q("#vPause").disabled = s !== "listening";
    q("#vResume").disabled = s !== "paused";
    q("#vStop").disabled = s === "idle";
    qa(".voice-focus").forEach((n) => n.classList.remove("voice-focus"));
    const el = liveTarget(); if (el && s !== "idle") el.classList.add("voice-focus");
    updateTargetLabel(); updateLaunch();
  }
  function showMsg(text) { const m = q("#vMsg"); if (!m) return; m.textContent = text || ""; m.classList.toggle("hidden", !text); }
  function addLine(text, kind) {
    const lines = q("#vTransLines"); if (!lines) return;
    q("#vTransEmpty").style.display = "none";
    let live = q(".line.live", lines);
    if (kind === "live") {
      if (!text) { if (live) live.remove(); return; }
      if (!live) { live = document.createElement("div"); live.className = "line live"; lines.appendChild(live); }
      live.innerHTML = '<span class="t">live</span>' + vesc(text);
    } else {
      if (live) live.remove();
      if (!text) return;
      const d = document.createElement("div");
      d.className = "line" + (kind === "cmd" ? " cmd" : "");
      const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      d.innerHTML = `<span class="t">${kind === "cmd" ? "cmd" : t}</span>` + vesc(text);
      lines.appendChild(d);
      while (lines.children.length > 200) lines.removeChild(lines.firstChild);
    }
    const tr = q("#vTrans"); tr.scrollTop = tr.scrollHeight;
  }

  // ------------------------------------------------------------------ speech engine
  function startListening() {
    if (!P.enabled) return;
    if (!SR) { say("Voice input needs Chrome or Edge — this browser has no speech recognition.", true); return; }
    if (!V.open) openWindow();
    let el = liveTarget();
    if (!el) { el = editableRoot(document.activeElement); if (el) setTarget(el); }
    if (!el) { showMsg("Click into a text field first, then press Start."); return; }
    showMsg("");
    setTarget(el, true);
    V.restarts = [];
    startRec();
    setState("listening");
  }
  function pauseListening() {
    if (V.state !== "listening") return;
    stopRec(); flushInterim(); setState("paused");
  }
  function resumeListening() {
    if (V.state !== "paused") return;
    startListening();
  }
  function stopListening() {
    stopRec(); flushInterim(); setState("idle");
  }
  function flushInterim() { V.interim = ""; addLine("", "live"); }
  function stopRec() {
    V.restart = false;
    if (V.rec) { const r = V.rec; V.rec = null; r.onend = null; r.onresult = null; r.onerror = null; try { r.stop(); } catch (e) { /* ignore */ } }
  }
  function startRec() {
    stopRec();
    const rec = new SR();
    V.rec = rec;
    rec.lang = q("#vLang").value || P.lang || "en-IN";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (ev) => {
      let mid = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (V.rec !== rec) return; // a command paused / stopped dictation
        if (ev.results[i].isFinal) handleFinal(t); else mid += t;
      }
      if (V.state !== "listening") return;
      V.interim = mid.trim(); addLine(V.interim, "live");
    };
    rec.onerror = (ev) => {
      const e = ev.error;
      if (e === "no-speech" || e === "aborted") return; // onend auto-restarts
      if (e === "not-allowed" || e === "service-not-allowed") { showMsg("Microphone blocked. Allow microphone access for this site (address bar → site settings), then press Start."); stopListening(); return; }
      if (e === "audio-capture") { showMsg("No microphone found. Plug one in and press Start."); stopListening(); return; }
      if (e === "network") { showMsg("Speech service unreachable (Chrome/Edge need internet for dictation)."); stopListening(); return; }
      if (e === "language-not-supported") { showMsg("This language is not supported by the browser's speech service."); stopListening(); return; }
      showMsg("Speech recognition error: " + e);
    };
    rec.onend = () => {
      if (V.rec !== rec) return;
      if (!(V.restart && V.state === "listening")) return;
      // Chrome ends the session after a pause in speech — restart, but guard against a tight loop.
      const now = Date.now(); V.restarts = V.restarts.filter((t) => now - t < 10000); V.restarts.push(now);
      if (V.restarts.length > 8) { showMsg("Speech recognition keeps stopping — press Start to try again."); stopListening(); return; }
      try { rec.start(); } catch (e) { setTimeout(() => { if (V.rec === rec && V.state === "listening") { try { rec.start(); } catch (e2) { stopListening(); } } }, 300); }
    };
    V.restart = true;
    try { rec.start(); } catch (e) { showMsg("Could not start speech recognition: " + e.message); V.restart = false; V.rec = null; }
  }
  function handleFinal(t) {
    const text = (t || "").trim(); if (!text) return;
    V.interim = "";
    if (maybeCommand(text)) return;
    if (insertText(text)) addLine(text, "said");
  }

  // ------------------------------------------------------------------ voice commands
  const norm = (s) => String(s || "").toLowerCase().replace(/[.,!?;:]+/g, "").replace(/\s+/g, " ").trim();
  function maybeCommand(phrase) {
    const t = norm(phrase);
    for (const c of P.commands) {
      if (!c.on) continue;
      const list = String(c.phrases || "").split(",").map(norm).filter(Boolean);
      if (list.includes(t)) { addLine(phrase + " → " + actionLabel(c.action), "cmd"); runAction(c.action, c.snippet); return true; }
    }
    return false;
  }
  const actionLabel = (id) => (ACTIONS.find((a) => a.id === id) || {}).label || id;
  function runAction(id, snippet) {
    switch (id) {
      case "pause": return pauseListening();
      case "stop": return stopListening();
      case "new-line": return insertText("\n", { raw: true });
      case "insert": return snippet ? insertText(snippet, { raw: true }) : undefined;
      case "undo": return undoLast();
      case "next-field": return nextField();
      case "next-step": return nextStep();
      case "add-step": return addStep();
      case "save": return saveChanges();
    }
  }
  function nextField() {
    const list = allFields(); if (!list.length) return;
    const cur = liveTarget(); const i = list.indexOf(cur);
    setTarget(list[(i + 1) % list.length], true);
  }
  // Review screen: step cells are .ed[data-step] inside .sr[data-s] within a .tc card
  function nextStep() {
    const cur = liveTarget(); const card = cur && cur.closest(".tc");
    if (card && cur.dataset.step !== undefined) {
      const next = q(`.sr[data-s="${+cur.dataset.step + 1}"] .ed[data-f="${cur.dataset.f}"]`, card);
      if (next) { setTarget(next, true); return; }
      say("Last step — say “add step” to add another");
      return;
    }
    if (card) { const first = q('.sr[data-s="0"] .ed[data-f="description"]', card); if (first) { setTarget(first, true); return; } }
    nextField();
  }
  function addStep() {
    const cur = liveTarget(); const card = cur && cur.closest(".tc");
    // Prefer the real Review handlers: the row's "Add step below" button, else the card footer "+ Add step".
    let btn = null;
    if (card) { const row = cur.closest(".sr[data-s]"); btn = (row && q('[data-act="sadd"]', row)) || q('.tc-foot [data-act="sadd"]', card); }
    if (!btn) { const open = qa(".tc.open .tc-foot [data-act='sadd']"); if (open.length === 1) btn = open[0]; }
    if (!btn) { say("Add step works on the Review screen — open a test case and click one of its fields first.", true); return; }
    btn.click();
    // review.js re-renders and focuses the new step's description cell
    setTimeout(() => { const el = editableRoot(document.activeElement) || q(".sr.just .ed"); if (el) setTarget(el, true); say("Step added"); }, 0);
  }
  function saveChanges() {
    const btn = q("#saveCases");
    if (btn && visible(btn)) {
      if (btn.disabled) { say("No unsaved changes"); return; }
      btn.click(); return;
    }
    say("Save changes by voice works on the Review screen. Use the page’s own Save button here.");
  }

  // ------------------------------------------------------------------ help popover
  function fillHelp() {
    const rows = P.commands.filter((c) => c.on && String(c.phrases || "").trim());
    q("#vPopTable").innerHTML = rows.map((c) => {
      const ph = c.phrases.split(",").map((x) => x.trim()).filter(Boolean).map((x) => `<span class="vkbd">${vesc(x)}</span>`).join(" ");
      return `<tr><td>${ph}</td><td>${vesc(actionLabel(c.action))}${c.action === "insert" && c.snippet ? " “" + vesc(c.snippet) + "”" : ""}</td></tr>`;
    }).join("") + (P.shortcut ? `<tr><td><span class="vkbd">Ctrl</span>+<span class="vkbd">Shift</span>+<span class="vkbd">Space</span></td><td>Start / pause</td></tr>` : "")
      || "<tr><td colspan='2' class='muted'>No commands enabled.</td></tr>";
  }

  // ------------------------------------------------------------------ enable / disable
  function applyEnabled() {
    document.body.classList.toggle("voice-off", !P.enabled);
    if (!P.enabled) { if (V.state !== "idle") stopListening(); if (V.open || V.minimized) closeWindow(); }
    const hint = q("#vShortcutHint"); if (hint) hint.style.display = P.shortcut ? "" : "none";
  }

  // ------------------------------------------------------------------ Settings → Preferences card
  function cmdRowsHtml() {
    const actOpts = (sel) => ACTIONS.map((a) => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${a.label}</option>`).join("");
    return P.commands.map((c, i) => `<tr data-i="${i}">
      <td><input type="text" data-vc="phrases" value="${vesc(c.phrases)}" placeholder="comma-separated phrases" aria-label="Phrases"></td>
      <td><select data-vc="action" aria-label="Action">${actOpts(c.action)}</select>${c.action === "insert" ? `<input type="text" data-vc="snippet" value="${vesc(c.snippet || "")}" placeholder="Text to insert" style="margin-top:4px" aria-label="Text to insert">` : ""}</td>
      <td><label class="sw"><input type="checkbox" data-vc="on" ${c.on ? "checked" : ""} aria-label="Enabled"><span class="t"></span></label></td>
      <td>${c.custom ? '<button type="button" class="btn g sm" data-vc-del>Remove</button>' : ""}</td></tr>`).join("");
  }
  function renderSettingsCard(pane) {
    if (!pane) return;
    let card = q("#voiceCard", pane);
    if (!card) { card = document.createElement("div"); card.className = "card"; card.id = "voiceCard"; card.style.marginTop = "14px"; pane.appendChild(card); }
    const posOpts = [["br", "Bottom right (default)"], ["bl", "Bottom left"], ["tr", "Top right"], ["remember", "Remember last position"]]
      .map(([v, l]) => `<option value="${v}" ${v === P.startPos ? "selected" : ""}>${l}</option>`).join("");
    card.innerHTML = `<h3>🎤 Voice input</h3>
      <div class="sub" style="margin:0 0 10px">The teal mic in the header opens a draggable Voice input window. Uses the browser’s Web Speech API — no AI model, no API key. These settings are saved instantly in this browser (not in <span class="mono">.env</span>).</div>
      ${SR ? "" : '<div class="warn" style="margin:0 0 10px">⚠ This browser has no speech recognition. Use <b>Chrome</b> or <b>Edge</b> for voice input.</div>'}
      <div class="v-pref-grid">
        <div><label class="sw"><input type="checkbox" id="vpEnabled" ${P.enabled ? "checked" : ""}><span class="t"></span> Enable launcher</label>
          <div class="sub" style="margin:6px 0 0">Shows the header mic. Turn off to hide it.</div></div>
        <div><label for="vpLang" style="margin-top:0">Default language</label><select id="vpLang" style="width:100%">${langOptions(P.lang)}</select></div>
        <div><label class="sw"><input type="checkbox" id="vpShortcut" ${P.shortcut ? "checked" : ""}><span class="t"></span> Keyboard shortcut</label>
          <div class="sub" style="margin:6px 0 0"><span class="vkbd">Ctrl</span>+<span class="vkbd">Shift</span>+<span class="vkbd">Space</span> start / pause</div></div>
        <div><label class="sw"><input type="checkbox" id="vpPunct" ${P.autoPunct ? "checked" : ""}><span class="t"></span> Auto-punctuation</label>
          <div class="sub" style="margin:6px 0 0">Capitalises sentences; “comma”, “full stop”, “question mark” become symbols.</div></div>
        <div><label for="vpPos" style="margin-top:0">Window start position</label><select id="vpPos" style="width:100%">${posOpts}</select></div>
        <div><label style="margin-top:0">&nbsp;</label><button type="button" class="btn g sm" id="vpResetPos">Reset window position</button></div>
      </div>
      <h3 style="margin:12px 0 4px">Voice commands</h3>
      <div class="sub" style="margin:0 0 6px">Each row is an action plus the phrase(s) you can say on their own (comma-separated synonyms). The window’s “?” help uses this list. Toggle a row off to ignore it.</div>
      <table class="v-cmd-table"><thead><tr><th style="width:44%">Phrase(s)</th><th style="width:30%">Action</th><th style="width:10%">On</th><th style="width:16%"></th></tr></thead>
        <tbody id="vpCmdBody">${cmdRowsHtml()}</tbody></table>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn g sm" id="vpAddCmd">＋ Add custom command</button>
        <button type="button" class="btn g sm" id="vpResetCmds">Reset to defaults</button></div>`;
    q("#vpEnabled", card).onchange = (e) => { P.enabled = e.target.checked; savePrefs(); applyEnabled(); say(P.enabled ? "Voice input launcher on" : "Voice input launcher hidden"); };
    q("#vpLang", card).onchange = (e) => { P.lang = e.target.value; savePrefs(); const l = q("#vLang"); if (l) { l.value = P.lang; if (V.state === "listening") startRec(); } };
    q("#vpShortcut", card).onchange = (e) => { P.shortcut = e.target.checked; savePrefs(); applyEnabled(); };
    q("#vpPunct", card).onchange = (e) => { P.autoPunct = e.target.checked; savePrefs(); };
    q("#vpPos", card).onchange = (e) => { P.startPos = e.target.value; savePrefs(); };
    q("#vpResetPos", card).onclick = () => resetPosition();
    q("#vpAddCmd", card).onclick = () => { P.commands.push({ phrases: "", action: "insert", snippet: "", on: true, custom: true }); savePrefs(); renderSettingsCard(pane); const ins = qa("#vpCmdBody [data-vc=phrases]", card).pop(); if (ins) ins.focus(); };
    q("#vpResetCmds", card).onclick = () => { if (!confirm("Reset voice commands to the defaults? Custom commands are removed.")) return; P.commands = cloneCmds(DEFAULT_CMDS); savePrefs(); renderSettingsCard(pane); fillHelp(); say("Voice commands reset to defaults"); };
    const body = q("#vpCmdBody", card);
    const rowOf = (el) => P.commands[+el.closest("tr").dataset.i];
    body.addEventListener("input", (e) => {
      const k = e.target.dataset.vc; if (!k || k === "on" || k === "action") return;
      rowOf(e.target)[k] = e.target.value; savePrefs(); fillHelp();
    });
    body.addEventListener("change", (e) => {
      const k = e.target.dataset.vc; if (!k) return;
      const c = rowOf(e.target);
      if (k === "on") c.on = e.target.checked;
      else if (k === "action") { c.action = e.target.value; savePrefs(); renderSettingsCard(pane); fillHelp(); return; }
      savePrefs(); fillHelp();
    });
    body.addEventListener("click", (e) => {
      if (!e.target.closest("[data-vc-del]")) return;
      P.commands.splice(+e.target.closest("tr").dataset.i, 1); savePrefs(); renderSettingsCard(pane); fillHelp();
    });
  }
  // Called by app.js viewSettings() after the Preferences pane is rendered
  window.voiceRenderSettings = function (pane) { try { renderSettingsCard(pane || q('.set-pane[data-pane="preferences"]')); } catch (e) { console.error("voice settings", e); } };

  // ------------------------------------------------------------------ bindings
  function toggleShortcut() {
    if (!P.enabled || !P.shortcut) return;
    if (!SR) { say("Voice input needs Chrome or Edge.", true); return; }
    if (!V.open) openWindow();
    if (V.state === "listening") pauseListening();
    else if (V.state === "paused") resumeListening();
    else startListening();
  }
  function bind() {
    q("#voiceLaunch").onclick = () => {
      if (!SR) { say("Voice input needs Chrome or Edge — this browser has no speech recognition.", true); return; }
      if (V.open) closeWindow(); else openWindow();
    };
    q("#vMin").onclick = (e) => { e.stopPropagation(); minimize(); };
    q("#vMax").onclick = (e) => { e.stopPropagation(); V.mode === "max" ? exitMax() : enterMax(); };
    q("#vClose").onclick = (e) => { e.stopPropagation(); closeWindow(); };
    q("#vPill").onclick = () => openWindow();
    q("#vStart").onclick = () => startListening();
    q("#vPause").onclick = () => pauseListening();
    q("#vResume").onclick = () => resumeListening();
    q("#vStop").onclick = () => stopListening();
    q("#vResetPos").onclick = () => resetPosition();
    q("#vHelpBtn").onclick = (e) => { e.stopPropagation(); fillHelp(); const p = q("#vPop"); p.classList.toggle("hidden"); q("#vHelpBtn").classList.toggle("on", !p.classList.contains("hidden")); };
    document.addEventListener("click", (e) => { if (!e.target.closest("#vPop, #vHelpBtn")) hideHelp(); });
    q("#vLang").onchange = () => {
      P.lang = q("#vLang").value; savePrefs();
      const d = q("#vpLang"); if (d) d.value = P.lang;
      if (V.state === "listening") startRec();
    };
    // Keep the voice window's buttons from stealing the caret position
    win().addEventListener("mousedown", () => rememberCaret(), true);
    document.addEventListener("focusin", (e) => {
      const el = editableRoot(e.target);
      if (el) { if (el !== V.target) setTarget(el); }
    });
    document.addEventListener("selectionchange", () => { const el = liveTarget(); if (el && (document.activeElement === el || el.contains(document.activeElement))) rememberCaret(); });
    document.addEventListener("keyup", (e) => { if (liveTarget() && e.target === V.target) rememberCaret(); });
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && (e.code === "Space" || e.key === " ")) { e.preventDefault(); toggleShortcut(); }
    }, true);
    // Re-renders (e.g. Review list) can detach the target — refresh the label when that happens
    new MutationObserver(() => { if (V.target && !document.contains(V.target)) { V.target = null; V.sel = null; updateTargetLabel(); } })
      .observe(document.body, { childList: true, subtree: true });
    bindDrag();
  }

  function registerWinMgr() {
    if (!window.WinMgr) return;
    window.WinMgr.register({
      id: "voice",
      el: "#voiceWin",
      title: "#vTitle",
      posKey: POS_KEY,
      slot: "right",
      fallbackSize: { w: 400, h: 330 },
      pillId: "wmPill-voice",
      pillClass: "voice",
      pillLabel: "Voice input",
      pillHTML: MIC + '<span>Voice input</span><span class="live-badge" id="wmVoiceBadge">LIVE</span>',
      enabled: () => P.enabled,
      getStartPos: () => P.startPos,
      requestOpen: () => {
        if (!P.enabled) return;
        V.open = true; V.minimized = false; V.mode = "normal";
        const w = win(); if (w) w.classList.add("open");
        updateLaunch();
      },
      syncState: (state) => {
        V.open = state === "open" || state === "max";
        V.minimized = state === "min";
        V.mode = state === "max" ? "max" : "normal";
        const b = q("#vMax");
        if (b) { b.title = V.mode === "max" ? "Restore" : "Maximize"; b.setAttribute("aria-label", b.title); }
        if (state !== "open" && state !== "max") hideHelp();
        updateLaunch();
      }
    });
  }
  function init() {
    if (!buildDom()) return;
    registerWinMgr();
    bind(); setState("idle"); applyEnabled(); fillHelp();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
