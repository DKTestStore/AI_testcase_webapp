/* Shared floating window manager for Voice input and Help Assistant.
   Loaded before voice.js and help.js. Prefs/positions stay in this browser
   (existing atg.voice.pos / atg.help.pos keys, migrated when needed). */
"use strict";

(function () {
  const GAP = 12, MARGIN = 16, CASCADE_X = 160, CASCADE_Y = 28;
  const Z_MIN = 46, Z_MAX = 48, TRAY_Z = 49;
  const OVERLAP_SNAP = 0.28, OVERLAP_OK = 0.12;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const say = (msg, err) => { if (typeof window.toast === "function") window.toast(msg, !!err); };

  const regs = Object.create(null); // id -> record
  let zTop = Z_MIN;
  let active = "";
  let tray = null;

  function rec(id) { return regs[id]; }
  function el(id) { const r = rec(id); return r ? r.node : null; }
  function otherId(id) { return id === "voice" ? "help" : id === "help" ? "voice" : ""; }
  function isVisible(id) {
    const r = rec(id);
    return !!(r && (r.state === "open" || r.state === "max"));
  }
  function isEnabled(id) {
    const r = rec(id);
    return !!(r && (!r.enabled || r.enabled()));
  }

  function shellRect() {
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
  }
  function dockRect() {
    const main = $(".main");
    if (main) {
      const b = main.getBoundingClientRect();
      if (b.width > 80 && b.height > 80) {
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
      }
    }
    const sb = $(".sb");
    const left = sb ? sb.getBoundingClientRect().right : 0;
    return { left, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth - left, height: window.innerHeight };
  }
  function contentRect() {
    const d = dockRect();
    const trayH = trayVisible() ? 62 : 0;
    return {
      left: d.left + 10, top: d.top + 8,
      right: d.right - 10, bottom: d.bottom - 10 - trayH,
      width: Math.max(0, d.width - 20), height: Math.max(0, d.height - 18 - trayH)
    };
  }

  function measure(id) {
    const r = rec(id);
    const fb = r.fallbackSize || { w: 400, h: 330 };
    const node = r.node;
    if (!node) return fb;
    const hadOpen = node.classList.contains("open");
    if (!hadOpen) {
      node.style.visibility = "hidden";
      node.classList.add("open");
    }
    const w = Math.round(node.offsetWidth) || fb.w;
    const h = Math.round(node.offsetHeight) || fb.h;
    if (!hadOpen) {
      node.classList.remove("open");
      node.style.visibility = "";
    }
    return { w, h };
  }

  function loadPos(id) {
    const r = rec(id);
    if (!r) return null;
    try { return JSON.parse(localStorage.getItem(r.posKey) || "null"); } catch (e) { return null; }
  }
  function savePos(id, opts) {
    const r = rec(id);
    if (!r || r.state === "max") return;
    const node = r.node;
    if (!node || !node.classList.contains("open")) return;
    const b = node.getBoundingClientRect();
    const data = {
      left: Math.round(b.left),
      top: Math.round(b.top),
      v: 2,
      docked: !!(opts && opts.docked)
    };
    r.docked = data.docked;
    try { localStorage.setItem(r.posKey, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }
  function clearPos(id) {
    const r = rec(id);
    if (!r) return;
    r.docked = true;
    try { localStorage.removeItem(r.posKey); } catch (e) { /* ignore */ }
  }

  function isLegacyStacked(id, pos) {
    if (!pos || pos.left == null || pos.v >= 2) return false;
    const s = shellRect();
    const sz = measure(id);
    const defLeft = s.right - 20 - sz.w;
    const defTop = s.bottom - 16 - sz.h;
    return Math.abs(pos.left - defLeft) < 56 && Math.abs(pos.top - defTop) < 56;
  }

  function clampTo(id, x, y, bounds) {
    const sz = measure(id);
    const b = bounds || shellRect();
    const maxX = b.right - sz.w, maxY = b.bottom - Math.min(sz.h, 40);
    return {
      x: Math.min(Math.max(b.left, x), Math.max(b.left, maxX)),
      y: Math.min(Math.max(b.top, y), Math.max(b.top, maxY))
    };
  }

  function dockLayout(forceBoth) {
    const helpOn = forceBoth || isVisible("help") || (rec("help") && rec("help").state === "min");
    const voiceOn = forceBoth || isVisible("voice") || (rec("voice") && rec("voice").state === "min");
    // When placing a just-opening window, treat it as on.
    const both = (forceBoth === true) || (helpOn && voiceOn);
    const s = dockRect();
    const vs = rec("voice") ? measure("voice") : { w: 400, h: 330 };
    const hs = rec("help") ? measure("help") : { w: 420, h: 580 };
    const voice = { x: s.right - MARGIN - vs.w, y: s.bottom - MARGIN - vs.h };
    if (!both) {
      if (voiceOn && !helpOn) return { voice, help: null };
      if (helpOn && !voiceOn) {
        return { help: { x: s.right - MARGIN - hs.w, y: s.bottom - MARGIN - hs.h }, voice: null };
      }
    }
    const availW = s.width - MARGIN * 2;
    const availH = s.height - MARGIN * 2;
    const needW = hs.w + GAP + vs.w;
    if (availW >= needW) {
      return { voice, help: { x: voice.x - GAP - hs.w, y: s.bottom - MARGIN - hs.h } };
    }
    if (availH >= hs.h + GAP + vs.h) {
      return { voice, help: { x: s.right - MARGIN - hs.w, y: voice.y - GAP - hs.h } };
    }
    const casc = clampTo("help", voice.x - CASCADE_X, voice.y - CASCADE_Y, s);
    return { voice, help: casc };
  }

  function cornerPos(id, kind) {
    const s = dockRect();
    const sz = measure(id);
    if (kind === "bl") return { x: s.left + 20, y: s.bottom - MARGIN - sz.h };
    if (kind === "tr") return { x: s.right - MARGIN - sz.w, y: s.top + 64 };
    return { x: s.right - MARGIN - sz.w, y: s.bottom - MARGIN - sz.h };
  }

  function rememberedOrDock(id, layout) {
    const r = rec(id);
    const slot = (layout && layout[id]) || dockLayout()[id];
    const pos = loadPos(id);
    if (!pos || pos.left == null) return slot;
    if (pos.v >= 2 && pos.docked) return slot;
    if (isLegacyStacked(id, pos)) return slot;
    return clampTo(id, pos.left, pos.top);
  }

  function applyGeometry(id, x, y, w, h) {
    const node = el(id);
    if (!node) return;
    const sz = (w && h) ? { w, h } : measure(id);
    const p = (x != null) ? { x, y } : { x: 0, y: 0 };
    Object.assign(node.style, {
      transform: "none",
      right: "auto",
      bottom: "auto",
      left: p.x + "px",
      top: p.y + "px"
    });
    if (w && h) {
      node.style.width = w + "px";
      node.style.height = h + "px";
    } else {
      node.style.width = "";
      node.style.height = "";
    }
    const recd = rec(id);
    recd.x = p.x; recd.y = p.y;
    void sz;
  }

  function place(id, x, y, opts) {
    const p = clampTo(id, x, y, (opts && opts.bounds) || shellRect());
    applyGeometry(id, p.x, p.y);
    return p;
  }

  function overlapArea(a, b) {
    const A = rec(a), B = rec(b);
    if (!A || !B || !isVisible(a) || !isVisible(b)) return 0;
    if (A.state === "max" || B.state === "max") return 0;
    const as = measure(a), bs = measure(b);
    const x = Math.max(0, Math.min(A.x + as.w, B.x + bs.w) - Math.max(A.x, B.x));
    const y = Math.max(0, Math.min(A.y + as.h, B.y + bs.h) - Math.max(A.y, B.y));
    return x * y;
  }

  function snapApart(dragged) {
    const other = otherId(dragged);
    if (!other || !isVisible(other) || !isVisible(dragged)) return;
    if (rec(dragged).state === "max" || rec(other).state === "max") return;
    const area = overlapArea(dragged, other);
    const ds = measure(dragged), os = measure(other);
    const smaller = Math.min(ds.w * ds.h, os.w * os.h);
    if (area < smaller * OVERLAP_SNAP) return;
    const d = rec(dragged), o = rec(other);
    const candidates = [
      { x: o.x - GAP - ds.w, y: d.y },
      { x: o.x + os.w + GAP, y: d.y },
      { x: d.x, y: o.y - GAP - ds.h },
      { x: d.x, y: o.y + os.h + GAP }
    ];
    let best = null, bestDist = Infinity;
    candidates.forEach((c) => {
      const p = clampTo(dragged, c.x, c.y);
      const dist = Math.abs(p.x - d.x) + Math.abs(p.y - d.y);
      const saved = { x: d.x, y: d.y };
      d.x = p.x; d.y = p.y;
      const still = overlapArea(dragged, other);
      d.x = saved.x; d.y = saved.y;
      if (still < smaller * OVERLAP_OK && dist < bestDist) { best = p; bestDist = dist; }
    });
    if (best) place(dragged, best.x, best.y);
  }

  function focus(id) {
    const r = rec(id);
    if (!r || !isVisible(id)) return;
    zTop += 1;
    if (zTop >= Z_MAX) {
      Object.keys(regs).forEach((k) => { if (regs[k].state !== "closed") regs[k].z = Z_MIN; });
      zTop = Z_MIN + 1;
    }
    r.z = zTop;
    active = id;
    paint();
  }

  function trayVisible() {
    return Object.keys(regs).some((id) => rec(id).state === "min" && isEnabled(id));
  }

  function ensureTray() {
    if (tray) return tray;
    tray = document.createElement("div");
    tray.id = "wmTray";
    tray.setAttribute("aria-label", "Minimized windows");
    tray.style.zIndex = String(TRAY_Z);
    document.body.appendChild(tray);
    return tray;
  }

  function paintTray() {
    const t = ensureTray();
    t.classList.toggle("show", trayVisible());
    // Stable order: Help, then Voice.
    ["help", "voice"].forEach((id) => {
      const r = rec(id);
      if (!r) return;
      let pill = document.getElementById(r.pillId);
      if (!pill) {
        pill = document.createElement("button");
        pill.type = "button";
        pill.id = r.pillId;
        pill.className = "wm-pill " + (r.pillClass || id);
        pill.title = "Restore " + (r.pillLabel || id);
        pill.innerHTML = r.pillHTML || (r.pillLabel || id);
        pill.addEventListener("click", () => restore(id));
        t.appendChild(pill);
      }
      pill.style.display = (r.state === "min" && isEnabled(id)) ? "inline-flex" : "none";
    });
  }

  function paint() {
    document.body.classList.add("wm-on");
    Object.keys(regs).forEach((id) => {
      const r = rec(id), node = r.node;
      if (!node) return;
      const vis = r.state === "open" || r.state === "max";
      node.classList.toggle("open", vis);
      node.classList.toggle("max", r.state === "max");
      node.classList.toggle("wm-max", r.state === "max");
      node.classList.toggle("wm-active", active === id && r.state === "open");
      node.style.zIndex = String(r.z || Z_MIN);
      if (r.state === "max") {
        const c = contentRect();
        Object.assign(node.style, {
          transform: "none", right: "auto", bottom: "auto",
          left: c.left + "px", top: c.top + "px",
          width: c.width + "px", height: c.height + "px"
        });
      }
    });
    paintTray();
  }

  function sync(id, state) {
    const r = rec(id);
    if (r && r.syncState) {
      try { r.syncState(state); } catch (e) { /* ignore */ }
    }
  }

  function show(id, opts) {
    opts = opts || {};
    const r = rec(id);
    if (!r || !isEnabled(id)) return;
    const wasMax = r.state === "max" && !opts.reposition;
    r.state = wasMax ? "max" : "open";
    r.node.classList.add("open");
    if (r.state === "max") { paint(); sync(id, "max"); return; }
    r.node.classList.remove("max", "wm-max");
    r.node.style.width = ""; r.node.style.height = "";
    const other = otherId(id);
    const otherOpen = other && isVisible(other);
    const layout = dockLayout(false);
    // If the partner is also open and neither has a custom position, use the shared dock.
    const selfPos = loadPos(id);
    const useDock = opts.reposition || opts.dock || !selfPos || selfPos.docked || isLegacyStacked(id, selfPos);
    const otherPos = other ? loadPos(other) : null;
    const otherCustom = otherOpen && otherPos && otherPos.v >= 2 && otherPos.docked === false && !isLegacyStacked(other, otherPos);
    if (useDock && otherOpen && !otherCustom) {
      const pair = dockLayout(true);
      if (pair[other]) place(other, pair[other].x, pair[other].y);
      if (pair[id]) place(id, pair[id].x, pair[id].y);
      rec(id).docked = true; rec(other).docked = true;
      savePos(id, { docked: true }); savePos(other, { docked: true });
    } else if (useDock) {
      const start = r.getStartPos ? r.getStartPos() : "br";
      const p = (!otherOpen && start && start !== "br" && start !== "remember") ? cornerPos(id, start) : (layout[id] || cornerPos(id, "br"));
      place(id, p.x, p.y);
      r.docked = true;
      savePos(id, { docked: true });
    } else {
      const p = rememberedOrDock(id, layout);
      place(id, p.x, p.y);
      r.docked = false;
      if (otherOpen) snapApart(id);
      savePos(id, { docked: r.docked });
    }
    // Cascade: keep the right-hand window in front so both titles stay readable.
    if (otherOpen) {
      const pair = { a: rec("help"), b: rec("voice") };
      if (pair.a && pair.b && overlapArea("help", "voice") > 0) focus("voice");
      else focus(id);
    } else focus(id);
    paint();
    sync(id, "open");
  }

  function close(id) {
    const r = rec(id);
    if (!r) return;
    const wasMax = r.state === "max";
    const restoreOther = r.autoMinId;
    r.state = "closed";
    r.autoMinId = null;
    r.node.classList.remove("open", "max", "wm-max", "wm-active");
    r.node.style.width = ""; r.node.style.height = "";
    if (active === id) active = "";
    paint();
    sync(id, "closed");
    if (wasMax && restoreOther && rec(restoreOther) && rec(restoreOther).state === "min") restore(restoreOther);
  }

  function minimize(id) {
    const r = rec(id);
    if (!r) return;
    if (r.state === "open") savePos(id, { docked: !!r.docked });
    if (r.state === "max") {
      r.node.classList.remove("wm-max", "max");
      r.node.style.width = ""; r.node.style.height = "";
    }
    r.prev = { x: r.x, y: r.y, docked: r.docked };
    r.state = "min";
    r.node.classList.remove("open", "wm-active");
    if (active === id) active = "";
    paint();
    sync(id, "min");
  }

  function restore(id) {
    const r = rec(id);
    if (!r || !isEnabled(id)) return;
    r.state = "open";
    r.node.classList.add("open");
    r.node.classList.remove("max", "wm-max");
    r.node.style.width = ""; r.node.style.height = "";
    if (r.prev && r.prev.x != null && !r.prev.docked) {
      place(id, r.prev.x, r.prev.y);
      snapApart(id);
      focus(id);
      paint();
      sync(id, "open");
    } else show(id, { dock: true });
  }

  function maximize(id) {
    const r = rec(id);
    if (!r || !isEnabled(id)) return;
    if (r.state === "open") savePos(id, { docked: !!r.docked });
    r.beforeMax = { x: r.x, y: r.y, docked: r.docked, state: "open" };
    const other = otherId(id);
    r.autoMinId = null;
    if (other && rec(other) && rec(other).state === "open") {
      rec(other).beforeMax = { x: rec(other).x, y: rec(other).y, docked: rec(other).docked, state: "open" };
      r.autoMinId = other;
      minimize(other);
    } else if (other && rec(other) && rec(other).state === "max") {
      // Unmax the other first without restoring this (not yet max).
      rec(other).autoMinId = null;
      unmaximize(other);
      rec(other).beforeMax = { x: rec(other).x, y: rec(other).y, docked: rec(other).docked, state: "open" };
      r.autoMinId = other;
      minimize(other);
    }
    r.state = "max";
    focus(id);
    paint();
    sync(id, "max");
  }

  function unmaximize(id, opts) {
    opts = opts || {};
    const r = rec(id);
    if (!r) return;
    const restoreOther = r.autoMinId;
    r.autoMinId = null;
    r.state = "open";
    r.node.classList.remove("wm-max", "max");
    r.node.style.width = ""; r.node.style.height = "";
    if (opts.keepHidden) {
      r.state = "closed";
      r.node.classList.remove("open");
      paint();
      sync(id, "closed");
    } else if (r.beforeMax && r.beforeMax.x != null && !r.beforeMax.docked) {
      r.node.classList.add("open");
      place(id, r.beforeMax.x, r.beforeMax.y);
      r.docked = false;
      focus(id);
      paint();
      sync(id, "open");
    } else {
      r.node.classList.add("open");
      show(id, { dock: true });
    }
    r.beforeMax = null;
    if (restoreOther && rec(restoreOther) && rec(restoreOther).state === "min") restore(restoreOther);
  }

  function reset(id) {
    clearPos(id);
    const r = rec(id);
    if (!r) return;
    if (r.state === "max") unmaximize(id);
    if (r.state === "open" || r.state === "min") {
      if (r.state === "min") r.state = "open";
      show(id, { reposition: true, dock: true });
    }
    const label = r.pillLabel || id;
    say(label + " moved to the default dock");
  }

  function dockBoth() {
    ["help", "voice"].forEach((id) => {
      const r = rec(id);
      if (!r || !isEnabled(id)) return;
      if (r.state === "closed" || r.state === "min") {
        if (r.requestOpen) { try { r.requestOpen(); } catch (e) { /* ignore */ } }
        r.state = "open";
        r.node.classList.add("open");
        r.node.classList.remove("max", "wm-max");
        r.node.style.width = ""; r.node.style.height = "";
        sync(id, "open");
      } else if (r.state === "max") {
        r.node.classList.remove("wm-max", "max");
        r.node.style.width = ""; r.node.style.height = "";
        r.state = "open";
        r.autoMinId = null;
        sync(id, "open");
      }
    });
    const pair = dockLayout(true);
    ["help", "voice"].forEach((id) => {
      const r = rec(id);
      if (!r || !isEnabled(id) || r.state === "closed") return;
      r.state = "open";
      if (pair[id]) place(id, pair[id].x, pair[id].y);
      r.docked = true;
      savePos(id, { docked: true });
    });
    if (isVisible("help") && isVisible("voice") && overlapArea("help", "voice") > 0) focus("voice");
    else if (isVisible("help")) focus("help");
    else if (isVisible("voice")) focus("voice");
    paint();
  }

  function resetLayout() {
    Object.keys(regs).forEach((id) => clearPos(id));
    dockBoth();
    say("Layout reset — windows docked side by side");
  }

  function bindDrag(id) {
    const r = rec(id);
    if (!r || r._dragBound) return;
    const title = r.titleEl;
    if (!title) return;
    r._dragBound = true;
    let drag = null;
    r.node.addEventListener("pointerdown", () => { if (isVisible(id)) focus(id); });
    title.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      if (r.state !== "open") return;
      focus(id);
      const b = r.node.getBoundingClientRect();
      drag = { ox: e.clientX - b.left, oy: e.clientY - b.top };
      place(id, b.left, b.top);
      r.docked = false;
      try { title.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    title.addEventListener("pointermove", (e) => {
      if (!drag) return;
      place(id, e.clientX - drag.ox, e.clientY - drag.oy);
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      snapApart(id);
      savePos(id, { docked: false });
      paint();
    };
    title.addEventListener("pointerup", end);
    title.addEventListener("pointercancel", end);
    title.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      if (r.state === "max") unmaximize(id);
      else if (r.state === "open") maximize(id);
    });
  }

  function onResize() {
    Object.keys(regs).forEach((id) => {
      const r = rec(id);
      if (r.state === "open") place(id, r.x, r.y);
    });
    const openIds = Object.keys(regs).filter((id) => rec(id).state === "open" && rec(id).docked);
    if (openIds.length >= 1) {
      const layout = dockLayout(openIds.length > 1);
      openIds.forEach((id) => { if (layout[id]) place(id, layout[id].x, layout[id].y); });
    }
    paint();
  }

  function register(spec) {
    if (!spec || !spec.id) return;
    const node = typeof spec.el === "string" ? $(spec.el) : spec.el;
    if (!node) return;
    const titleEl = spec.title ? (typeof spec.title === "string" ? $(spec.title) : spec.title) : null;
    const r = {
      id: spec.id,
      node,
      titleEl,
      posKey: spec.posKey,
      slot: spec.slot || "right",
      fallbackSize: spec.fallbackSize || { w: 400, h: 330 },
      pillId: spec.pillId || ("wmPill-" + spec.id),
      pillClass: spec.pillClass || spec.id,
      pillLabel: spec.pillLabel || spec.id,
      pillHTML: spec.pillHTML || "",
      enabled: spec.enabled,
      getStartPos: spec.getStartPos,
      requestOpen: spec.requestOpen,
      syncState: spec.syncState,
      state: node.classList.contains("open") ? "open" : "closed",
      x: 0, y: 0, z: Z_MIN,
      docked: true,
      prev: null, beforeMax: null, autoMinId: null,
      _dragBound: false
    };
    regs[spec.id] = r;
    document.body.classList.add("wm-on");
    ensureTray();
    bindDrag(spec.id);
    paintTray();
  }

  function renderSettings(pane) {
    pane = pane || $('.set-pane[data-pane="preferences"]');
    if (!pane) return;
    let card = $("#wmCard", pane);
    if (!card) {
      card = document.createElement("div");
      card.className = "card";
      card.id = "wmCard";
      card.style.marginTop = "14px";
      const help = $("#helpCard", pane);
      if (help && help.parentNode === pane) help.after(card);
      else pane.appendChild(card);
    }
    card.innerHTML = `<h3>🪟 Floating windows</h3>
      <div class="sub" style="margin:0 0 10px">Voice input and Help Assistant share a window manager: they dock side by side at the bottom-right of the content area (Help to the left of Voice), share a minimize tray, come to the front when you click or drag, and snap apart if they overlap. Positions stay in this browser only (not in .env).</div>
      <div class="wm-card-actions">
        <button type="button" class="btn sm" id="wmDockBoth">Dock both (side by side)</button>
        <button type="button" class="btn g sm" id="wmResetLayout">Reset layout</button>
      </div>
      <div class="sub" style="margin:8px 0 0">Reset clears remembered positions and returns both windows to the default dock. If the window is too narrow, they stack or cascade instead of overlapping. Each window’s own <b>Reset window position</b> button still moves just that window to its dock slot.</div>`;
    $("#wmDockBoth", card).onclick = () => { dockBoth(); say("Windows docked side by side"); };
    $("#wmResetLayout", card).onclick = () => resetLayout();
  }

  window.addEventListener("resize", () => { onResize(); });

  window.WinMgr = {
    register, show, close, minimize, restore, maximize, unmaximize,
    reset, dockBoth, resetLayout, focus, place, savePos,
    renderSettings,
    getPill: (id) => {
      const r = rec(id);
      return r ? document.getElementById(r.pillId) : null;
    }
  };
  window.winmgrRenderSettings = function (pane) {
    try { renderSettings(pane); } catch (e) { console.error("winmgr settings", e); }
  };
})();
