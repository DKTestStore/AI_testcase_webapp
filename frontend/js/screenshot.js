/* Screenshot + Notes input (additive). Wraps viewInput; other input tabs are unchanged.
   Step 2 layout is untouched — only a compact context line and a vision badge/warning
   are injected when the run came from this tab. */
"use strict";
const SS = { images: [], page: 0, per: 6, notes: "", module: "", story: "", focus: [], pasteBound: false };
const SS_MAX = 12;
const SS_FOCUS = ["Functional", "UI/Layout", "Validation", "Negative"];

function ssReset() {
  SS.images = []; SS.page = 0; SS.notes = ""; SS.module = ""; SS.story = ""; SS.focus = [];
}
function ssHydrate() {
  const r = S.run || {};
  const ss = r.screenshot || {};
  if (SS.images.length) return;
  const imgs = ss.images || [];
  SS.images = imgs.map((im, i) => ({
    mime: im.mime || "image/png",
    data: im.data || "",
    src: im.data ? (`data:${im.mime || "image/png"};base64,${im.data}`) : (im.src || ""),
    caption: im.caption || "",
    w: im.w, h: im.h,
    name: im.name || ("Screenshot " + (i + 1)),
  })).filter((im) => im.src || im.data);
  SS.notes = ss.notes || "";
  SS.module = ss.module || "";
  SS.story = ss.story_id || r.story_id || "";
  SS.focus = Array.isArray(ss.focus) ? ss.focus.slice() : [];
  SS.page = 0;
}
function ssGenerated() {
  const r = S.run || {};
  const n = ((r.test_cases || []).length);
  const g = ((r.screenshot || {}).generated_count) || 0;
  return r.source === "screenshot" && (n > 0 || g > 0);
}
function ssIteration() {
  const g = Number((S.run && S.run.screenshot && S.run.screenshot.generated_count) || 0);
  return g ? g + 1 : 1;
}
function ssActive() {
  const ss = (S.run && S.run.screenshot) || {};
  const cases = (S.run && S.run.test_cases) || [];
  const id = ss.active_tc_id || (cases[0] && cases[0].id) || "";
  const title = ss.active_title || ((cases.find((c) => c.id === id) || cases[0] || {}).name) || "";
  return { id, title };
}

function ssAddTab(v) {
  const seg = $(".seg", v); if (!seg || $('button[data-m="screenshot"]', seg)) return;
  const b = document.createElement("button");
  b.dataset.m = "screenshot"; b.title = "Paste or upload screenshots and notes, then generate test cases";
  b.textContent = "Screenshot + Notes";
  b.onclick = () => { S.inputMode = "screenshot"; render(); };
  const rec = $('button[data-m="record"]', seg);
  const local = $('button[data-m="local"]', seg);
  const excel = $('button[data-m="excel"]', seg);
  if (rec) rec.after(b);
  else if (local) local.after(b);
  else if (excel) excel.before(b);
  else seg.appendChild(b);
}

const _ssOrigViewInput = viewInput;
viewInput = function (v) {
  if (!S.inputMode && S.run && S.run.source === "screenshot") S.inputMode = "screenshot";
  if (S.inputMode === "screenshot") return ssView(v);
  ssUnbindPaste();
  _ssOrigViewInput(v);
  ssAddTab(v);
};

function ssSeg() {
  return `<div class="seg"><button data-m="jira">Jira Story</button><button data-m="local">Local text</button><button data-m="record" class="rec-tab">⏺ Record</button><button data-m="screenshot" class="a">Screenshot + Notes</button><button data-m="excel">⬆ Upload test cases (Excel)</button><button data-m="batch" class="bm-tab" title="Open the separate Batch workspace (multiple stories)">▦ Batch mode</button></div>`;
}

function ssPages() { return Math.max(1, Math.ceil(SS.images.length / SS.per)); }
function ssClampPage() { const p = ssPages(); if (SS.page >= p) SS.page = p - 1; if (SS.page < 0) SS.page = 0; }

function ssThumb(im, i) {
  const cap = esc(im.caption || "");
  return `<article class="ss-th" data-i="${i}">
    <div class="prev" title="Preview">${im.src ? `<img src="${im.src}" alt="${cap || "Screenshot"}">` : ""}</div>
    <div class="meta">
      <input class="cap" data-i="${i}" placeholder="Optional caption (e.g. Add Product modal)" value="${cap}">
      <div class="acts"><button type="button" class="btn sec ss-zoom" data-i="${i}">Preview</button><button type="button" class="btn sec ss-rm" data-i="${i}">Remove</button></div>
    </div></article>`;
}

function ssPagerHtml() {
  const total = SS.images.length;
  if (total <= SS.per) return total ? `<div class="ss-pager"><span>${total} screenshot${total === 1 ? "" : "s"}</span><button type="button" class="btn sec" id="ssAddMore">+ Paste or add another</button></div>` : "";
  ssClampPage();
  const from = SS.page * SS.per + 1;
  const to = Math.min(total, (SS.page + 1) * SS.per);
  const pages = ssPages();
  let btns = `<button type="button" data-p="prev" ${SS.page === 0 ? "disabled" : ""}>Prev</button>`;
  for (let i = 0; i < pages; i++) btns += `<button type="button" data-p="${i}" class="${i === SS.page ? "on" : ""}">${i + 1}</button>`;
  btns += `<button type="button" data-p="next" ${SS.page >= pages - 1 ? "disabled" : ""}>Next</button>`;
  return `<div class="ss-pager"><span>Showing ${from}–${to} of ${total}</span><div class="ss-pages">${btns}</div><button type="button" class="btn sec" id="ssAddMore">+ Paste or add another</button></div>`;
}

function ssView(v) {
  ssHydrate();
  const r = S.run || {};
  const iter = ssIteration();
  const active = ssActive();
  const showIter = ssGenerated();
  const total = SS.images.length;
  ssClampPage();
  const slice = SS.images.slice(SS.page * SS.per, SS.page * SS.per + SS.per).map((im, k) => ssThumb(im, SS.page * SS.per + k)).join("");
  const empty = !total ? `<div class="ss-drop" id="ssDrop" tabindex="0"><div class="ss-ico">🖼️</div><b>Paste, drop, or browse screenshots</b><div class="sub">Ctrl+V to paste · drag and drop · or <u>Browse</u> — up to ${SS_MAX} images (PNG, JPEG, WebP, GIF). Large images are resized automatically.</div></div>` : "";
  const ban = showIter ? `<div class="ss-ban">Iteration ${iter} · Active test: <b>${esc(active.id || "TC-001")}</b> ${esc(active.title || "")}</div>` : "";
  const foci = SS_FOCUS.map((f) => `<button type="button" class="chip${SS.focus.includes(f) ? " a" : ""}" data-f="${esc(f)}">${esc(f)}</button>`).join("");
  v.innerHTML = `<h1>Input Source</h1><div class="sub">Paste or upload screenshot(s) and add notes, then continue to Generate</div>
    <div class="card">${ssSeg()}${ban}
      ${empty}
      ${total ? `<div class="ss-grid" id="ssGrid">${slice}</div>${ssPagerHtml()}` : `<input type="file" id="ssFile" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>`}
      ${total ? `<input type="file" id="ssFile" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>` : ""}
      <label>Feature &amp; screenshot notes</label>
      <textarea id="ssNotes" class="ss-notes" rows="6" placeholder="Describe the feature, the flow shown in the screenshot(s), and what to test. Example: Add Product modal — Name and Price are required; empty fields show inline validation; Save should be disabled until valid.">${esc(SS.notes)}</textarea>
      <div class="ss-opt">
        <div><label>Feature / module name (optional)</label><input id="ssModule" placeholder="e.g. Product Master · Add Product" value="${esc(SS.module)}"></div>
        <div><label>Story ID (optional)</label><input id="ssStory" placeholder="e.g. MTG-1427" value="${esc(SS.story)}"></div>
      </div>
      <label>Focus (optional)</label>
      <div class="ss-foci" id="ssFocus">${foci}</div>
    </div>
    <div class="footer-nav"><div></div><button class="btn" id="ssContinue">Continue to Generate →</button></div>`;
  $$(".seg button", v).forEach((b) => (b.onclick = () => {
    if (b.dataset.m === "screenshot") return;
    if (b.dataset.m === "batch") return guarded(b, enterBatch);
    ssCaptureFields();
    if (b.dataset.m === "record") { S.inputMode = "record"; render(); return; }
    S.inputMode = b.dataset.m; render();
  }));
  ssBind(v);
}

function ssCaptureFields() {
  const n = $("#ssNotes"); if (n) SS.notes = n.value;
  const m = $("#ssModule"); if (m) SS.module = m.value;
  const s = $("#ssStory"); if (s) SS.story = s.value;
}

function ssBind(v) {
  ssBindPaste();
  const file = $("#ssFile");
  const openBrowse = () => { if (file) file.click(); };
  if (file) file.onchange = () => { ssAddFiles(file.files); file.value = ""; };
  const drop = $("#ssDrop");
  if (drop) {
    drop.onclick = openBrowse;
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); ssAddFiles(e.dataTransfer && e.dataTransfer.files); };
  }
  const add = $("#ssAddMore");
  if (add) add.onclick = openBrowse;
  // Allow dropping onto the card/grid once images exist
  v.ondragover = (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); };
  v.ondrop = (e) => {
    if (!(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)) return;
    e.preventDefault(); ssAddFiles(e.dataTransfer.files);
  };
  $$("#ssFocus .chip").forEach((b) => (b.onclick = () => {
    const f = b.dataset.f;
    SS.focus = SS.focus.includes(f) ? SS.focus.filter((x) => x !== f) : SS.focus.concat(f);
    b.classList.toggle("a");
  }));
  $$(".ss-th .cap", v).forEach((inp) => (inp.onchange = inp.oninput = () => {
    const i = +inp.dataset.i; if (SS.images[i]) SS.images[i].caption = inp.value;
  }));
  $$(".ss-rm", v).forEach((b) => (b.onclick = () => {
    const i = +b.dataset.i; SS.images.splice(i, 1); ssClampPage(); ssView(v);
  }));
  $$(".ss-zoom, .ss-th .prev", v).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const art = b.closest(".ss-th"); const i = +(b.dataset.i || (art && art.dataset.i) || 0);
    ssLightbox(i);
  }));
  $$(".ss-pages button", v).forEach((b) => (b.onclick = () => {
    const p = b.dataset.p;
    if (p === "prev") SS.page = Math.max(0, SS.page - 1);
    else if (p === "next") SS.page = Math.min(ssPages() - 1, SS.page + 1);
    else SS.page = +p;
    ssView($("#view") || v);
  }));
  $("#ssContinue").onclick = () => guarded($("#ssContinue"), () => ssContinue());
}

function ssBindPaste() {
  if (SS.pasteBound) return;
  SS.pasteBound = true;
  SS._paste = (e) => {
    if (S.view !== "input" || S.inputMode !== "screenshot") return;
    const items = (e.clipboardData && e.clipboardData.items) ? [...e.clipboardData.items] : [];
    const files = items.filter((it) => it.type && it.type.startsWith("image/")).map((it) => it.getAsFile()).filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    ssAddFiles(files);
  };
  document.addEventListener("paste", SS._paste);
}
function ssUnbindPaste() {
  if (!SS.pasteBound) return;
  document.removeEventListener("paste", SS._paste);
  SS.pasteBound = false;
}

async function ssAddFiles(list) {
  const files = [...(list || [])].filter((f) => f && /^image\//.test(f.type || ""));
  if (!files.length) { toast("No images found to add.", true); return; }
  const room = SS_MAX - SS.images.length;
  if (room <= 0) { toast(`You already have ${SS_MAX} screenshots (the maximum). Remove one to add another.`, true); return; }
  const take = files.slice(0, room);
  const skipped = files.length - take.length;
  let err = 0;
  for (const f of take) {
    try { SS.images.push(await ssReadImage(f)); }
    catch (e) { err += 1; console.warn(e); }
  }
  if (err) toast(`${err} image${err === 1 ? "" : "s"} could not be read.`, true);
  if (skipped) toast(`Only ${SS_MAX} screenshots can be added. ${skipped} skipped.`);
  SS.page = ssPages() - 1;
  const v = $("#view"); if (v && S.inputMode === "screenshot") ssView(v);
}

function ssReadImage(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 12 * 1024 * 1024) return reject(new Error("Image is larger than 12 MB."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 1280;
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const scale = Math.min(1, max / Math.max(w, h, 1));
        w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const keepPng = /png/i.test(file.type || "") && file.size < 400000 && scale === 1;
        const mime = keepPng ? "image/png" : "image/jpeg";
        const src = keepPng ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.72);
        const data = src.split(",", 2)[1] || "";
        resolve({ mime, data, src, caption: "", w, h, name: file.name || "screenshot" });
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}

function ssLightbox(i) {
  if (!SS.images.length) return;
  if (i < 0) i = SS.images.length - 1;
  if (i >= SS.images.length) i = 0;
  const im = SS.images[i];
  const box = $("#modal"); if (box) box.classList.add("ss-lb");
  modal(`<div class="ss-lb-top"><h3 style="margin:0">Screenshot ${i + 1} of ${SS.images.length}</h3><button class="btn sec" id="ssLbClose">Close</button></div>
    <div class="ss-lb-stage"><img src="${im.src}" alt="${esc(im.caption || "Screenshot")}"></div>
    <label>Caption / note</label>
    <input class="cap" id="ssLbCap" value="${esc(im.caption || "")}" placeholder="Optional caption">
    <div class="ss-lb-nav"><button class="btn sec" id="ssLbPrev" ${SS.images.length < 2 ? "disabled" : ""}>← Prev</button>
      <span class="sub" style="margin:0">Screenshot ${i + 1} of ${SS.images.length}</span>
      <button class="btn sec" id="ssLbNext" ${SS.images.length < 2 ? "disabled" : ""}>Next →</button></div>`);
  if (box) box.classList.add("ss-lb");
  $("#ssLbClose").onclick = () => closeModal();
  $("#ssLbCap").oninput = () => {
    SS.images[i].caption = $("#ssLbCap").value;
    const inp = $(`.ss-th .cap[data-i="${i}"]`); if (inp) inp.value = SS.images[i].caption;
  };
  $("#ssLbPrev").onclick = () => ssLightbox(i - 1);
  $("#ssLbNext").onclick = () => ssLightbox(i + 1);
}

function ssPayload(mode) {
  ssCaptureFields();
  return {
    images: SS.images.map((im) => ({ mime: im.mime, data: im.data, caption: im.caption || "" })),
    notes: SS.notes, module: SS.module, story_id: SS.story, focus: SS.focus,
    mode: mode || "", active_tc_id: ssActive().id,
  };
}

async function ssSave(mode) {
  if (!SS.images.length && !(SS.notes || "").trim()) throw new Error("Add at least one screenshot or some feature notes.");
  const j = await api("/api/input/screenshots", { method: "POST", body: ssPayload(mode) });
  if (j.run) S.run = j.run;
  return j;
}

async function ssContinue() {
  ssCaptureFields();
  if (!SS.images.length && !(SS.notes || "").trim()) throw new Error("Add at least one screenshot or some feature notes.");
  if (ssGenerated()) {
    const active = ssActive();
    const iter = ssIteration();
    modal(`<h3 style="margin:0 0 6px">How should this iteration be generated?</h3>
      <div class="sub" style="margin:0">Iteration ${iter} · Active test: ${esc(active.id || "TC-001")} ${esc(active.title || "")}</div>
      <div class="opt">
        <button type="button" id="ssNew"><b>Generate a New Test Case</b><span>Create a separate new test case from the new screenshot(s) and notes.</span></button>
        <button type="button" id="ssSame"><b>Continue as Same Test</b><span>Append or extend ${esc(active.id || "TC-001")} with new steps and assertions from the new screenshot(s) and notes.</span></button>
      </div>
      <div style="text-align:right"><button class="btn sec" id="ssChoiceCancel">Cancel</button></div>`);
    const box = $("#modal"); if (box) box.classList.add("ss-choice");
    $("#ssChoiceCancel").onclick = () => closeModal();
    $("#ssNew").onclick = () => guarded($("#ssNew"), async () => { closeModal(); await ssSave("new"); go("generate"); });
    $("#ssSame").onclick = () => guarded($("#ssSame"), async () => { closeModal(); await ssSave("same"); go("generate"); });
    return;
  }
  await ssSave("");
  go("generate");
}

/* ---------- Step 2 hooks (layout unchanged) ---------- */
function ssSkipReplaceConfirm() {
  const ss = (S.run && S.run.screenshot) || {};
  return S.run && S.run.source === "screenshot" && (ss.mode === "same" || ss.mode === "new");
}
function ssGenerateBody() {
  if (!(S.run && S.run.source === "screenshot")) return {};
  return { screenshot_mode: ((S.run.screenshot || {}).mode) || "" };
}

function ssLocalVision(provider, model) {
  const p = (provider || "").toLowerCase();
  const m = (model || "").toLowerCase();
  const deny = ["text-embedding", "embedding", "tts", "whisper", "dall-e", "dalle", "imagen", "veo", "gpt-3.5", "davinci"];
  const allow = ["vision", "gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-4-vision", "gpt-4.5", "gpt-5", "omni",
    "llava", "bakllava", "moondream", "minicpm", "pixtral", "maverick", "scout", "llama-4", "llama4",
    "qwen2.5-vl", "qwen2-vl", "qwen2.5vl", "qwen3-vl", "gemma3", "nemotron-3.5-super-vl", "-vl-", "vl-120",
    "granite-vision", "grok-2-vision", "grok-2v", "claude-3", "claude-4", "claude-sonnet", "claude-opus",
    "claude-haiku", "gemini-1.5", "gemini-2", "gemini-3", "gemini-flash", "gemini-pro-vision", "o3", "o4"];
  if (deny.some((x) => m.includes(x))) return { ok: false };
  if (allow.some((x) => m.includes(x))) return { ok: true };
  if (p === "gemini" || p === "claude") return { ok: true };
  return { ok: false };
}

async function ssPaintVision() {
  const host = $("#ssVision"); if (!host) return;
  const provider = ($("#model") && $("#model").value) || (S.run && S.run.model) || "";
  const model = ($("#genModel") && $("#genModel").value) || (S.run && S.run.model_name) || "";
  let info = ssLocalVision(provider, model);
  try {
    const j = await api(`/api/vision?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`);
    if (j && typeof j.ok === "boolean") info = j;
  } catch (e) { /* local fallback */ }
  if (info.ok) {
    host.innerHTML = `<span class="ss-vok">Vision supported${model ? " · " + esc(model) : ""}</span>`;
    return;
  }
  const label = model || provider || "this model";
  host.innerHTML = `<div class="ss-vwarn">Screenshot analysis needs a vision-capable model (for example Gemini, OpenAI GPT-4o, or a vision model on Groq, Ollama, or NVIDIA). <b>${esc(label)}</b> is treated as text-only. Generated test cases still land in the existing Review screen.
    <div><button type="button" class="btn" id="ssSwGemini">Switch to Gemini</button><button type="button" class="btn sec" id="ssSwOpenAI">Switch to OpenAI</button></div></div>`;
  const pick = (prov, prefer) => {
    const msel = $("#model"); const gsel = $("#genModel");
    if (msel) { msel.value = prov; msel.dispatchEvent(new Event("change")); }
    if (gsel && window.tcModelOpts) {
      const wanted = prefer || "";
      const opts = [...gsel.options];
      const hit = opts.find((o) => o.value && prefer.split("|").some((p) => o.value.toLowerCase().includes(p)));
      if (hit) gsel.value = hit.value;
      gsel.dispatchEvent(new Event("change"));
    }
    ssPaintVision();
  };
  const g = $("#ssSwGemini"); if (g) g.onclick = () => pick("gemini", "flash|gemini-2|gemini-1.5|pro");
  const o = $("#ssSwOpenAI"); if (o) o.onclick = () => pick("openai", "gpt-4o|gpt-4.1|gpt-4-turbo|omni");
}

function ssEnhanceGenerate(v) {
  const r = S.run; if (!r || r.source !== "screenshot" || !v) return;
  const sub = v.querySelector(":scope > .sub") || v.querySelector("h1 + .sub");
  if (sub && sub.textContent.indexOf("Screenshot + Notes") < 0) {
    sub.innerHTML = sub.innerHTML.replace("Local input", "Screenshot + Notes");
  }
  if (sub && !v.querySelector(".ss-ctx")) {
    const ss = r.screenshot || {};
    const n = (ss.images && ss.images.length) || ss.image_count || 0;
    const notes = !!(ss.notes || "").trim();
    const iter = ss.iteration || ss.generated_count || 1;
    const last = ss.last_mode || ss.mode || "";
    const modeLabel = last === "same"
      ? `Continue as Same Test (${ss.active_tc_id || "TC-001"})`
      : last === "new" ? "Generate a New Test Case" : "Screenshot + Notes";
    const bits = [modeLabel, `Iteration ${iter}`, `${n} screenshot${n === 1 ? "" : "s"}${notes ? " + notes" : ""}`];
    const ctx = document.createElement("div");
    ctx.className = "ss-ctx";
    ctx.innerHTML = `<span>${bits.map((b) => `<b>${esc(b)}</b>`).join(" · ")}</span>`;
    sub.after(ctx);
  }
  if (!$("#ssVision")) {
    const host = document.createElement("div");
    host.id = "ssVision"; host.className = "ss-vision";
    const row = $("#model") && $("#model").closest("div") && $("#model").closest("div").parentElement;
    if (row) row.after(host);
    else if ($("#genEst")) $("#genEst").before(host);
    else v.appendChild(host);
  }
  const chain = (el) => {
    if (!el || el.dataset.ssVis) return;
    el.dataset.ssVis = "1";
    const prev = el.onchange;
    el.onchange = (e) => { if (typeof prev === "function") prev.call(el, e); ssPaintVision(); };
  };
  chain($("#model")); chain($("#genModel"));
  ssPaintVision();
}

window.ssReset = ssReset;
window.ssEnhanceGenerate = ssEnhanceGenerate;
window.ssSkipReplaceConfirm = ssSkipReplaceConfirm;
window.ssGenerateBody = ssGenerateBody;
