/* Debounced autosave for Review, Requirements, and Test Case Repo.
   Default ON (Settings → Preferences). Manual Save buttons stay. */
"use strict";
(function () {
  const DELAY = 1500;
  const AS = { timer: null, key: "", fn: null, valid: null, status: "idle", error: "", seq: 0 };
  window.AS = AS;

  function autosaveEnabled() {
    if (window._prefs && Object.prototype.hasOwnProperty.call(_prefs, "autosave")) return !!_prefs.autosave;
    return true; // default ON
  }

  function paint(status, msg) {
    AS.status = status;
    const text = status === "saving" ? "Saving…"
      : status === "ok" ? "All changes saved"
      : status === "err" ? (msg || "Save failed – retry")
      : "";
    document.querySelectorAll(".as-ind").forEach((el) => {
      el.classList.remove("saving", "ok", "err");
      if (!text) { el.hidden = true; el.textContent = ""; return; }
      el.hidden = false;
      el.textContent = text;
      if (status === "saving") el.classList.add("saving");
      if (status === "ok") el.classList.add("ok");
      if (status === "err") el.classList.add("err");
    });
  }

  function autosaveSchedule(key, fn, opts) {
    opts = opts || {};
    if (!autosaveEnabled()) return;
    if (opts.valid && !opts.valid()) {
      AS.fn = fn; AS.key = key; AS.valid = opts.valid;
      return;
    }
    AS.key = key; AS.fn = fn; AS.valid = opts.valid || null;
    clearTimeout(AS.timer);
    AS.timer = setTimeout(() => autosaveFlush({ reason: "debounce" }), DELAY);
  }

  async function autosaveFlush(opts) {
    opts = opts || {};
    clearTimeout(AS.timer);
    AS.timer = null;
    if (!autosaveEnabled()) { AS.fn = null; return "skip"; }
    if (!AS.fn) return "idle";
    if (AS.valid && !AS.valid()) return "invalid";
    const fn = AS.fn;
    const seq = ++AS.seq;
    paint("saving");
    try {
      await fn();
      if (seq !== AS.seq) return "stale";
      AS.fn = null;
      paint("ok");
      clearTimeout(AS._ok);
      AS._ok = setTimeout(() => { if (AS.status === "ok") paint("idle"); }, 4000);
      return "ok";
    } catch (e) {
      if (seq !== AS.seq) return "stale";
      AS.error = e.message || "Save failed";
      paint("err", "Save failed – retry");
      if (opts.reason === "navigate") {
        if (!confirm((AS.error) + ". Leave without saving?")) return "cancel";
        return "ok";
      }
      return "err";
    }
  }

  function autosaveHasPending() {
    return !!(AS.fn || AS.timer) && autosaveEnabled();
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest(".as-ind.err");
    if (!el) return;
    autosaveFlush({ reason: "retry" });
  });

  window.autosaveEnabled = autosaveEnabled;
  window.autosaveSchedule = autosaveSchedule;
  window.autosaveFlush = autosaveFlush;
  window.autosaveHasPending = autosaveHasPending;
  window.autosavePaint = paint;
})();
