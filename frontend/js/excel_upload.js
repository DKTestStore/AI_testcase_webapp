/* Upload test cases from Excel (.xlsx) — used on the Review page (modal) and on the Input page (inline). */
"use strict";
const UP_MAX = 5 * 1024 * 1024;
const UP_COLS = [["id", "Test case Id"], ["name", "Name"], ["description", "Description"], ["precondition", "Precondition"], ["step", "Step"], ["expected", "Expected"], ["acs", "AC Tags"], ["priority", "Priority"], ["status", "Review Status"]];
function uploadUI(root, opts = {}) {
  const st = { file: null, data: null, prev: null, mode: "replace" };
  const hasCases = (S.run.test_cases || []).length > 0;
  root.innerHTML = `<div class="up-dz" id="upDz"><div style="font-size:22px">📄</div><b>Drag &amp; drop an .xlsx file here</b> or <a class="up-browse">browse</a>
      <div class="sub" style="margin:2px 0 0">.xlsx only · max 5 MB · first sheet is read · <a class="up-tpl" href="/api/excel/template">Download template</a></div>
      <input type="file" id="upFile" accept=".xlsx" class="hidden"><div id="upFileInfo"></div></div>
    ${hasCases ? `<label>Import mode</label><div class="up-modes">
      <div class="up-mode a" data-m="replace"><b>◉ Replace all</b>Replace the current ${(S.run.test_cases || []).length} test cases with the file.</div>
      <div class="up-mode" data-m="append"><b>○ Append</b>Add file test cases after the current ones; IDs renumbered.</div>
      <div class="up-mode" data-m="merge"><b>○ Merge by TC ID</b>Update matching IDs, add new ones, keep the rest.</div></div>` : ""}
    <div id="upPrev"></div>
    <div class="up-actions">${opts.cancel ? '<button class="btn g" id="upCancel">Cancel</button>' : ""}<button class="btn" id="upGo" disabled>⬆ Import</button></div>`;
  const dz = $("#upDz", root), fi = $("#upFile", root);
  $(".up-browse", root).onclick = () => fi.click();
  dz.onclick = (e) => { if (e.target === dz) fi.click(); };
  fi.onchange = () => fi.files[0] && pick(fi.files[0]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); e.dataTransfer.files[0] && pick(e.dataTransfer.files[0]); };
  $$(".up-mode", root).forEach((m) => (m.onclick = () => { st.mode = m.dataset.m; $$(".up-mode", root).forEach((x) => { x.classList.toggle("a", x === m); x.querySelector("b").textContent = (x === m ? "◉ " : "○ ") + x.querySelector("b").textContent.slice(2); }); updGo(); }));
  if (opts.cancel) $("#upCancel", root).onclick = opts.cancel;
  const updGo = () => { const b = $("#upGo", root); b.disabled = !st.prev; if (st.prev) b.textContent = `⬆ Import ${st.prev.counts.test_cases} test cases${st.mode === "append" ? " (append)" : st.mode === "merge" ? " (merge)" : ""}`; };
  function err(msg) { st.prev = null; $("#upPrev", root).innerHTML = `<div class="error">${esc(msg)}</div>`; updGo(); }
  function pick(file) {
    st.file = file; st.prev = null; updGo();
    $("#upFileInfo", root).innerHTML = `<div class="up-file">📄 <b>${esc(file.name)}</b><span class="sub" style="margin:0">${(file.size / 1024).toFixed(0)} KB</span><span style="flex:1"></span><a class="up-rm">Remove</a></div>`;
    $(".up-rm", root).onclick = (e) => { e.stopPropagation(); st.file = st.data = st.prev = null; fi.value = ""; $("#upFileInfo", root).innerHTML = ""; $("#upPrev", root).innerHTML = ""; updGo(); };
    if (!/\.xlsx$/i.test(file.name)) return err("Only .xlsx files are supported (save the file as Excel Workbook .xlsx).");
    if (file.size > UP_MAX) return err("File is larger than 5 MB.");
    $("#upPrev", root).innerHTML = `<div class="sub">Validating…</div>`;
    const rd = new FileReader();
    rd.onload = async () => {
      st.data = String(rd.result).split(",").pop();
      try { st.prev = await api("/api/excel/import/preview", { method: "POST", body: { filename: file.name, data: st.data } }); }
      catch (e) { return err(e.message); }
      $("#upFileInfo .sub", root).textContent += ` · first sheet · ${st.prev.counts.rows} rows`;
      renderPrev(); updGo();
    };
    rd.readAsDataURL(file);
  }
  function renderPrev() {
    const p = st.prev, c = p.counts;
    const warn = p.warnings.slice(0, 6).map((w) => `<div>⚠ ${w.row ? `Row ${w.row}${w.tc ? ` (${esc(w.tc)})` : ""}: ` : ""}${esc(w.message)}</div>`).join("") + (p.warnings.length > 6 ? `<div>… ${p.warnings.length - 6} more</div>` : "");
    $("#upPrev", root).innerHTML = `<div class="up-sum"><span class="pill">✓ ${c.test_cases} test cases</span><span class="pill">✓ ${c.steps} steps</span>${c.warnings ? `<span class="pill y">⚠ ${c.warnings} warning${c.warnings > 1 ? "s" : ""}</span>` : '<span class="pill">✓ no warnings</span>'}
        <span class="sub" style="margin:0">Columns detected: ${p.columns.length} of 9${p.missing_optional.length ? ` (missing optional: ${esc(p.missing_optional.join(", "))})` : ""}</span></div>
      ${warn ? `<div class="warn up-warn">${warn}</div>` : ""}
      <div class="tablewrap up-table"><table><thead><tr><th>Row</th>${UP_COLS.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>
      ${p.preview.map((r) => `<tr class="${r.bad.length ? "err" : ""}"><td class="muted">${r.row}</td>${UP_COLS.map(([k]) => `<td class="${r.bad.includes(k) ? "bad" : ""}">${esc(r.values[k])}${r.bad.includes(k) ? " ⚠" : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="sub" style="margin:6px 0 0">Preview: ${p.preview.length} of ${c.rows} rows (rows with warnings always shown)</div>`;
  }
  $("#upGo", root).onclick = () => guarded($("#upGo", root), async () => {
    if (!st.prev) return;
    const j = await api("/api/excel/import", { method: "POST", body: { filename: st.file.name, data: st.data, mode: st.mode, story_id: opts.storyId ? opts.storyId() : "" } });
    S.localDirty = false; S.cases = []; if (typeof RV !== "undefined") { RV.open.clear(); RV.sel.clear(); RV.page = 0; }
    toast(`Imported ${j.imported} test cases from ${st.file.name}${j.warnings.length ? ` (${j.warnings.length} warning${j.warnings.length > 1 ? "s" : ""})` : ""}`);
    if (opts.done) opts.done(j);
  });
}
function openUploadModal() {
  modal(`<div style="display:flex;justify-content:space-between;align-items:center"><h1 style="margin:0">⬆ Upload test cases from Excel</h1><span id="upX" style="cursor:pointer;font-size:18px">✕</span></div>
    <div class="sub" style="margin:4px 0 12px">Use the app's export format (or the template). AC Tags, Priority and Review Status are optional and display-only — they are never sent to qTest.</div><div id="upRoot"></div>`);
  $("#modal").classList.add("wide"); $("#upX").onclick = closeUpload;
  uploadUI($("#upRoot"), { cancel: closeUpload, done: () => { closeUpload(); S.view = "review"; render(); } });
}
function closeUpload() { closeModal(); $("#modal").classList.remove("wide"); }
