/* AI TestCase Generator — Record feature. Injected into the TARGET site by the recorder browser.
   Captures user actions and posts them to the backend through the exposed binding window.__atgRec.
   Sensitive values (password / OTP / card) are masked here, before they leave the page. */
(() => {
  if (window.__atgRecInit || window.top !== window) return; window.__atgRecInit = true;
  const CFG = __ATG_CFG__;
  const ST = { paused: false, t0: Date.now(), n: 0 };
  const send = (o) => { try { return window.__atgRec ? window.__atgRec(Object.assign({ url: location.href, title: document.title, ts: Date.now() }, o)) : null; } catch (e) { return null; } };
  const txt = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const inTB = (el) => !!(el && el.closest && el.closest("#atg-rec-toolbar"));
  const ignoredBy = (el) => { for (const s of CFG.ignore || []) { try { if (el && el.closest && el.closest(s)) return s; } catch (e) {} } return ""; };
  const okId = (s) => s && /^[A-Za-z][\w-]*$/.test(s);
  function labelOf(el) {
    try { if (el.labels && el.labels.length) return txt(el.labels[0].innerText); } catch (e) {}
    const lb = el.getAttribute && el.getAttribute("aria-labelledby");
    if (lb) { const l = document.getElementById(lb.split(" ")[0]); if (l) return txt(l.innerText); }
    const p = el.closest && el.closest("label"); if (p && p !== el) return txt(p.innerText);
    return "";
  }
  function roleOf(el) {
    const r = el.getAttribute("role"); if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === "a" && el.hasAttribute("href")) return "link";
    if (t === "button" || (t === "input" && ["button", "submit", "reset"].includes(el.type))) return "button";
    if (t === "select") return "combobox";
    if (t === "textarea") return "textbox";
    if (t === "input") return el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : "textbox";
    if (/^h[1-6]$/.test(t)) return "heading";
    return "";
  }
  function cssPath(el) {
    if (okId(el.id)) return "#" + el.id;
    const parts = []; let e = el;
    while (e && e.nodeType === 1 && parts.length < 5 && e !== document.body) {
      let s = e.tagName.toLowerCase();
      if (okId(e.id)) { parts.unshift("#" + e.id); break; }
      const nm = e.getAttribute("name"); if (nm) { parts.unshift(s + `[name="${nm}"]`); break; }
      const cls = [...e.classList].filter((c) => okId(c) && !c.startsWith("atg")).slice(0, 2); if (cls.length) s += "." + cls.join(".");
      const par = e.parentElement;
      if (par) { const same = [...par.children].filter((c) => c.tagName === e.tagName); if (same.length > 1) s += `:nth-of-type(${same.indexOf(e) + 1})`; }
      parts.unshift(s); e = par;
    }
    return parts.join(" > ");
  }
  // #1 smart element names: label -> aria-label -> placeholder -> visible text -> title -> name -> id
  function describe(el) {
    const tag = el.tagName.toLowerCase(); const isField = /^(input|textarea|select)$/.test(tag);
    const label = isField || ["checkbox", "radio"].includes(el.type) ? labelOf(el) : "";
    const aria = txt(el.getAttribute("aria-label")), ph = txt(el.getAttribute("placeholder")), title = txt(el.getAttribute("title"));
    let text = isField ? "" : txt(el.innerText || "").slice(0, 60);
    if (tag === "input" && ["button", "submit", "reset"].includes(el.type)) text = txt(el.value);
    const cands = [["label", label], ["aria-label", aria], ["placeholder", ph], ["text", text], ["title", title], ["name", el.getAttribute("name")], ["id", el.id]];
    const hit = cands.find((c) => c[1]) || ["tag", tag];
    return { name: String(hit[1]).slice(0, 60), source: hit[0], role: roleOf(el), label, aria, placeholder: ph, text, title,
      form: !!(el.closest && el.closest("form")), testid: el.getAttribute("data-testid") || "", id: okId(el.id) ? el.id : "", nameAttr: el.getAttribute("name") || "", css: cssPath(el), tag, type: el.type || "" };
  }
  // #12 auto-masking
  function sensitive(el) {
    if (!el || !el.getAttribute) return "";
    if (el.closest("[data-sensitive]")) return "custom";
    if (el.type === "password") return CFG.maskPw ? "password" : "";
    const k = [el.name, el.id, el.getAttribute("autocomplete"), el.getAttribute("placeholder"), labelOf(el), el.getAttribute("aria-label")].join(" ").toLowerCase();
    if (/one-time-code|\botp\b|passcode|verification code|\bpin\b/.test(k)) return "otp";
    if (/cc-number|card ?number|cardnumber|credit card|\bcvv\b|\bcvc\b|cc-csc|security code/.test(k)) return "card";
    return "";
  }
  function maskVal(kind, v) {
    v = String(v || "");
    if (kind === "card") { const d = v.replace(/\D/g, ""); return d.length > 4 ? "•••• •••• •••• " + d.slice(-4) : "•".repeat(d.length || 3); }
    if (kind === "otp") return "•".repeat(Math.max(4, v.length));
    return "••••••••";
  }
  function markSensitive(root) {
    (root || document).querySelectorAll && (root || document).querySelectorAll("input,textarea").forEach((el) => { const s = sensitive(el); if (s) el.setAttribute("data-atg-sensitive", s); });
  }
  function hl(el) { try { const o = el.style.outline; el.style.outline = "3px solid #e5484d"; el.style.outlineOffset = "2px"; setTimeout(() => { el.style.outline = o; el.style.outlineOffset = ""; }, 900); } catch (e) {} }
  const isText = (el) => (el.tagName === "TEXTAREA") || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color"].includes(el.type)) || el.isContentEditable;
  const CLICKABLE = "a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[onclick],[data-testid]";

  // clicks / checks
  document.addEventListener("click", (e) => {
    if (ST.paused || !e.isTrusted) return;
    const raw = e.target; if (!raw || raw.nodeType !== 1 || inTB(raw)) return;
    const el = raw.closest(CLICKABLE) || raw;
    const ig = ignoredBy(el);
    if (ig) { send({ type: "ignored", by: ig, el: describe(el) }); return; }
    if (el.tagName === "SELECT" || isText(el)) return;                      // focus only; typing/select recorded separately
    if (el.tagName === "LABEL" && el.control && ["checkbox", "radio"].includes(el.control.type)) return; // the input fires its own click
    if (el.tagName === "INPUT" && ["checkbox", "radio"].includes(el.type)) { send({ type: "check", checked: el.checked, el: describe(el) }); return; }
    hl(el); send({ type: "click", el: describe(el) });
  }, true);
  // #2 merged typing: count keystrokes, emit one step per field on change
  const keys = new WeakMap();
  document.addEventListener("input", (e) => { const el = e.target; if (el && isText(el)) keys.set(el, (keys.get(el) || 0) + 1); }, true);
  document.addEventListener("change", (e) => {
    if (ST.paused) return;
    const el = e.target; if (!el || inTB(el)) return;
    if (ignoredBy(el)) return;
    if (el.tagName === "SELECT") { const o = el.options[el.selectedIndex]; send({ type: "select", value: el.value, option: o ? txt(o.text) : el.value, el: describe(el) }); return; }
    if (!isText(el)) return;
    const s = sensitive(el); if (s) el.setAttribute("data-atg-sensitive", s);
    const v = el.isContentEditable ? el.innerText : el.value;
    send({ type: "type", value: s ? maskVal(s, v) : v, masked: s || "", keys: keys.get(el) || String(v || "").length, el: describe(el) });
    keys.set(el, 0);
  }, true);
  // scroll (only when "ignore hover/scroll" is off)
  if (!CFG.ignoreScroll) { let t; window.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(() => !ST.paused && send({ type: "scroll", y: Math.round(window.scrollY) }), 900); }, true); }
  // #3 visible success / error messages -> checkpoint suggestion
  const MSG = "[role=alert],[role=status],.toast,.alert,.success,.error,.flash,.notice,.notification,.message,.msg";
  const seen = {};
  function scanMsgs(root) {
    if (ST.paused) return;
    const list = []; if (root.matches && root.matches(MSG)) list.push(root); if (root.querySelectorAll) list.push(...root.querySelectorAll(MSG));
    for (const m of list) {
      if (inTB(m) || ignoredBy(m)) continue;
      const t = txt(m.innerText); if (!t || t.length > 160 || !m.getClientRects().length) continue;
      if (seen[t] && Date.now() - seen[t] < 5000) continue; seen[t] = Date.now();
      const cls = (m.className || "") + " " + (m.getAttribute("role") || "");
      send({ type: "msg", text: t, level: /error|danger|fail|alert/i.test(cls) ? "error" : "success", el: describe(m) });
    }
  }
  // #5 hotkeys
  document.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase();
    if (e.ctrlKey && e.shiftKey && ["c", "p", "s", "z"].includes(k)) { e.preventDefault(); e.stopPropagation(); send({ type: "cmd", cmd: { c: "checkpoint", p: ST.paused ? "resume" : "pause", s: "stop", z: "undo" }[k], via: "hotkey" }); return; }
    if (e.ctrlKey && !e.shiftKey && k === "z" && !isText(document.activeElement || document.body)) { e.preventDefault(); send({ type: "cmd", cmd: "undo", via: "hotkey" }); }
  }, true);
  // #5 floating mini toolbar (draggable, excluded from recording)
  function toolbar() {
    if (document.getElementById("atg-rec-toolbar") || !document.body) return;
    const d = document.createElement("div"); d.id = "atg-rec-toolbar";
    d.setAttribute("style", "position:fixed;top:12px;right:12px;z-index:2147483647;background:#111827;color:#fff;border-radius:22px;padding:6px 8px 6px 12px;display:flex;gap:6px;align-items:center;font:600 12px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:move;user-select:none");
    d.innerHTML = `<span id="atg-dot" style="width:9px;height:9px;border-radius:50%;background:#ef4444;display:inline-block"></span><span id="atg-time">00:00</span>
      <button data-c="checkpoint" title="Add checkpoint (Ctrl+Shift+C)">✔</button><button data-c="pause" id="atg-pause" title="Pause / resume (Ctrl+Shift+P)">⏸</button><button data-c="undo" title="Undo last step (Ctrl+Z)">↶</button><button data-c="stop" title="Stop &amp; go to Review (Ctrl+Shift+S)" style="background:#ef4444!important">■ Stop</button>`;
    d.querySelectorAll("button").forEach((b) => { b.setAttribute("style", "background:#374151;color:#fff;border:0;border-radius:12px;padding:3px 8px;font:600 12px system-ui;cursor:pointer");
      b.onclick = (e) => { e.stopPropagation(); let c = b.dataset.c; if (c === "pause" && ST.paused) c = "resume"; send({ type: "cmd", cmd: c, via: "toolbar" }); }; });
    let dx = 0, dy = 0, drag = false;
    d.addEventListener("mousedown", (e) => { if (e.target.tagName === "BUTTON") return; drag = true; const r = d.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; e.preventDefault(); });
    window.addEventListener("mousemove", (e) => { if (!drag) return; d.style.left = e.clientX - dx + "px"; d.style.top = e.clientY - dy + "px"; d.style.right = "auto"; });
    window.addEventListener("mouseup", () => (drag = false));
    document.body.appendChild(d);
  }
  function paint() {
    const t = document.getElementById("atg-time"); if (!t) return;
    const s = Math.max(0, Math.floor((Date.now() - ST.t0) / 1000)); t.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    const p = document.getElementById("atg-pause"); if (p) p.textContent = ST.paused ? "▶" : "⏸";
    const dot = document.getElementById("atg-dot"); if (dot) dot.style.background = ST.paused ? "#f59e0b" : "#ef4444";
  }
  window.__atgSetState = (s) => { Object.assign(ST, s || {}); paint(); };
  async function hello() { try { const r = await send({ type: "hello" }); if (r) window.__atgSetState(r); } catch (e) {} }
  function boot() {
    const st = document.createElement("style");
    st.textContent = "[data-atg-sensitive]{filter:blur(4px)!important}";      // #12 blur sensitive fields in video
    (document.head || document.documentElement).appendChild(st);
    toolbar(); markSensitive(document); hello(); paint(); setInterval(paint, 1000);
    scanMsgs(document.body);
    new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) if (n.nodeType === 1) { scanMsgs(n); markSensitive(n); } if (m.type === "attributes" && m.target.nodeType === 1) scanMsgs(m.target); } })
      .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
