"""AI TestCase Generator - FastAPI backend.

Run from the project root (the folder containing backend/ and frontend/):
    uvicorn backend.app:app --reload
then open http://localhost:8000
"""
import io
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Body, Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import config  # noqa: F401  (sys.path + .env)
from . import parsing, services, session_store, settings_store
from .config import FRONTEND_DIR, RUNS_DIR, env
from .services import ServiceError

app = FastAPI(title="AI TestCase Generator")
COOKIE = "atg_session"
MAX_TEXT = 200_000


@app.exception_handler(ServiceError)
async def _service_error(_: Request, exc: ServiceError):
    return JSONResponse({"ok": False, "error": exc.message}, status_code=exc.status)


@app.exception_handler(Exception)
async def _unexpected(_: Request, exc: Exception):
    return JSONResponse({"ok": False, "error": f"Unexpected server error: {exc}"}, status_code=500)


# --------------------------------------------------------------------------- #
# Session helpers (no username/password - the Welcome button starts a session)
# --------------------------------------------------------------------------- #
def current(request: Request) -> Dict[str, Any]:
    sess = session_store.get(request.cookies.get(COOKIE))
    if not sess:
        raise ServiceError("Session expired. Please start again from the Welcome page.", 401)
    return sess


def _run(sess) -> Dict[str, Any]:
    return sess["run"]


def _save(sess):
    session_store.save(sess["sid"])


def _steps(run) -> Dict[str, bool]:
    """Which steps have data (used to enable Next / sidebar progress)."""
    return {
        "input": bool(run.get("feature_text")),
        "generate": bool(run.get("test_cases")),
        "review": bool(run.get("excel_path")) and not run.get("dirty"),
        "qtest": bool(run.get("upload")),
    }


def _public_run(run) -> Dict[str, Any]:
    r = dict(run)
    r["steps"] = _steps(run)
    r["excel_name"] = Path(run["excel_path"]).name if run.get("excel_path") else ""
    r.pop("excel_path", None)
    return r


# --------------------------------------------------------------------------- #
# Pages
# --------------------------------------------------------------------------- #
@app.get("/")
def root(request: Request):
    if session_store.get(request.cookies.get(COOKIE)):
        return RedirectResponse("/app")
    return FileResponse(FRONTEND_DIR / "welcome.html")


@app.get("/welcome")
def welcome():
    return FileResponse(FRONTEND_DIR / "welcome.html")


@app.get("/app")
def app_page(request: Request):
    if not session_store.get(request.cookies.get(COOKIE)):
        return RedirectResponse("/welcome")
    return FileResponse(FRONTEND_DIR / "app.html")


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


# --------------------------------------------------------------------------- #
# Session
# --------------------------------------------------------------------------- #
@app.post("/api/session/start")
def start_session(request: Request):
    sess = session_store.get(request.cookies.get(COOKIE))
    sid = sess["sid"] if sess else session_store.create()
    resp = JSONResponse({"ok": True, "redirect": "/app"})
    resp.set_cookie(COOKIE, sid, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 7)
    return resp


@app.post("/api/session/logout")
def logout(request: Request):
    sid = request.cookies.get(COOKIE)
    if sid and session_store.get(sid):
        session_store.delete(sid)
    resp = JSONResponse({"ok": True, "redirect": "/welcome"})
    resp.delete_cookie(COOKIE)
    return resp


@app.get("/api/state")
def state(sess=Depends(current)):
    return {"ok": True, "run": _public_run(_run(sess))}


@app.post("/api/run/new")
def new_run(sess=Depends(current)):
    run = session_store.reset_run(sess["sid"])
    return {"ok": True, "run": _public_run(run)}


# --------------------------------------------------------------------------- #
# Step 1 - Input
# --------------------------------------------------------------------------- #
@app.post("/api/input/jira")
def input_jira(data: Dict[str, Any] = Body(...), sess=Depends(current)):
    info = services.fetch_jira(str(data.get("story_id", "")))
    run = _run(sess)
    run.update({"source": "jira", "story_id": info["issue_key"], "jira": info,
                "feature_text": info["feature_text"], "local_filename": ""})
    _save(sess)
    return {"ok": True, "jira": info, "run": _public_run(run)}


@app.post("/api/input/local")
def input_local(data: Dict[str, Any] = Body(...), sess=Depends(current)):
    text = str(data.get("text", "")).strip()
    if not text:
        raise ServiceError("Feature description is empty.")
    if len(text) > MAX_TEXT:
        raise ServiceError(f"Feature description is too long (max {MAX_TEXT:,} characters).")
    run = _run(sess)
    run.update({"source": "local", "story_id": str(data.get("story_id", "")).strip(), "jira": None,
                "feature_text": text, "local_filename": str(data.get("filename", ""))[:200]})
    _save(sess)
    return {"ok": True, "run": _public_run(run)}


@app.post("/api/input/feature_text")
def update_feature_text(data: Dict[str, Any] = Body(...), sess=Depends(current)):
    """Lets the user edit the 'Will be sent to generator' text for Jira input too."""
    run = _run(sess)
    run["feature_text"] = str(data.get("text", ""))[:MAX_TEXT]
    _save(sess)
    return {"ok": True, "run": _public_run(run)}


# --------------------------------------------------------------------------- #
# Step 2 - Generate
# --------------------------------------------------------------------------- #
@app.get("/api/prompt/default")
def default_prompt(sess=Depends(current)):
    return {"ok": True, "filename": config.GENERATOR_PROMPT_FILE.name, "text": services.read_default_prompt()}


@app.get("/api/usage")
def usage(sess=Depends(current)):
    return {"ok": True, "usage": services.read_gemini_usage(), "last": _run(sess).get("last_usage")}


@app.post("/api/generate")
def generate(data: Dict[str, Any] = Body(...), sess=Depends(current)):
    run = _run(sess)
    model = str(data.get("model", "gemini")).lower()
    mode = "custom" if data.get("prompt_mode") == "custom" else "default"
    custom = str(data.get("custom_prompt", ""))[:50_000]
    run_reviewer = bool(data.get("run_reviewer"))
    run.update({"model": model, "prompt_mode": mode, "custom_prompt": custom, "run_reviewer": run_reviewer})
    _save(sess)

    prompt, appended = services.build_prompt(mode, custom)
    result = services.generate(model, run["feature_text"], prompt)
    cases = parsing.markdown_to_test_cases(result["markdown"])
    if not cases:
        run["markdown"] = result["markdown"]
        _save(sess)
        raise ServiceError("The model responded, but no test cases could be parsed from its output "
                           "(expected the 'Test Case ID: … | Step Description | Expected Result |' template).", 422)
    run.update({"markdown": result["markdown"], "test_cases": cases, "dirty": True, "excel_path": "",
                "review": None, "upload": None, "rtm": [], "last_usage": result["usage"]})
    review_info = None
    if run_reviewer:
        try:
            rv = services.review(model, run["feature_text"], result["markdown"])
            rv_cases = parsing.markdown_to_test_cases(rv["markdown"])
            review_info = {"markdown": rv["markdown"], "test_cases": rv_cases, "usage": rv["usage"]}
        except ServiceError as ex:
            review_info = {"error": ex.message}
        run["review"] = review_info
    _save(sess)
    return {"ok": True, "count": len(cases), "template_appended": appended,
            "usage": result["usage"], "review": review_info, "run": _public_run(run)}


# --------------------------------------------------------------------------- #
# Step 3 - Review
# --------------------------------------------------------------------------- #
def _validate_cases(cases: List[Dict[str, Any]]):
    ids = [c["id"] for c in cases]
    if any(not i for i in ids):
        raise ServiceError("Every test case needs a Test case Id.")
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise ServiceError("Duplicate Test case Id(s): " + ", ".join(sorted(dup)))


@app.put("/api/review/test_cases")
def save_cases(data: Dict[str, Any] = Body(...), sess=Depends(current)):
    cases = parsing.sanitize_cases(data.get("test_cases"))
    _validate_cases(cases)
    run = _run(sess)
    run.update({"test_cases": cases, "dirty": True})
    _save(sess)
    return {"ok": True, "run": _public_run(run)}


@app.post("/api/review/ai")
def run_reviewer(sess=Depends(current)):
    run = _run(sess)
    md = parsing.test_cases_to_markdown(run["test_cases"])
    rv = services.review(run.get("model", "gemini"), run["feature_text"], md)
    rv_cases = parsing.markdown_to_test_cases(rv["markdown"])
    run["review"] = {"markdown": rv["markdown"], "test_cases": rv_cases, "usage": rv["usage"]}
    _save(sess)
    return {"ok": True, "review": run["review"],
            "summary": {"before": len(run["test_cases"]), "after": len(rv_cases)}}


@app.post("/api/review/accept")
def accept_review(sess=Depends(current)):
    run = _run(sess)
    rv = run.get("review") or {}
    if not rv.get("test_cases"):
        raise ServiceError("No reviewed test cases to apply.")
    run.update({"test_cases": rv["test_cases"], "dirty": True, "review": None})
    _save(sess)
    return {"ok": True, "run": _public_run(run)}


def _write_excel(run) -> Path:
    _validate_cases(run["test_cases"])
    if not run["test_cases"]:
        raise ServiceError("No test cases to save.")
    md = parsing.test_cases_to_markdown(run["test_cases"])
    name = (run.get("story_id") or "LOCAL").replace("/", "_")
    path = RUNS_DIR / run["run_id"] / f"Manual_test_cases_{name}.xlsx"
    services.save_excel(md, path)
    run.update({"excel_path": str(path), "dirty": False})
    return path


@app.post("/api/review/save_excel")
def save_excel(sess=Depends(current)):
    run = _run(sess)
    _write_excel(run)
    _save(sess)
    return {"ok": True, "run": _public_run(run)}


@app.get("/api/review/excel")
def download_excel(sess=Depends(current)):
    run = _run(sess)
    if not run.get("excel_path") or run.get("dirty") or not Path(run["excel_path"]).exists():
        _write_excel(run)
        _save(sess)
    p = Path(run["excel_path"])
    return FileResponse(p, filename=p.name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# --------------------------------------------------------------------------- #
# Step 4 - qTest
# --------------------------------------------------------------------------- #
@app.get("/api/qtest/defaults")
def qtest_defaults(sess=Depends(current)):
    return {"ok": True, "project_id": env("QTEST_PROJECT_ID"), "requirement_id": env("QTEST_REQUIREMENT_ID"),
            "parent_module_id": env("QTEST_PARENT_MODULE_ID"), "configured": bool(env("QTEST_BASE_URL") and env("QTEST_TOKEN"))}


@app.post("/api/qtest/preview")
def qtest_preview(data: Dict[str, Any] = Body(default={}), sess=Depends(current)):
    run = _run(sess)
    if run.get("dirty") or not run.get("excel_path") or not Path(run["excel_path"]).exists():
        _write_excel(run)
        _save(sess)
    payloads = services.build_payload_preview(Path(run["excel_path"]), str(data.get("module_id", "")))
    return {"ok": True, "count": len(payloads), "payloads": payloads}


def _build_rtm(run) -> List[Dict[str, Any]]:
    jira = run.get("jira") or {}
    ac_source = jira.get("acceptance_criteria") or jira.get("scenarios") or run.get("feature_text", "")
    acs = parsing.split_acceptance_criteria(ac_source)
    run["ac_list"] = acs
    mapping = parsing.map_cases_to_acs(run["test_cases"], acs)
    titles = {a["id"]: a["title"] for a in acs}
    up = run.get("upload") or {}
    by_tc = {i["tc_id"]: i for i in up.get("items", [])}
    rows = []
    for tc in run["test_cases"]:
        it = by_tc.get(tc["id"], {})
        ac = mapping.get(tc["id"], "")
        rows.append({
            "story_id": run.get("story_id") or "LOCAL", "ac_id": ac, "ac_title": titles.get(ac, ""),
            "tc_id": tc["id"], "name": tc["name"],
            "qtest_pid": it.get("qtest_pid") or "", "qtest_id": it.get("qtest_id") or "",
            "upload_status": it.get("status", "Not uploaded"), "error": it.get("error", ""),
            "link_status": "Linked" if it.get("linked") else "Not linked",
            "module": f"{up.get('module_name') or ''} ({up.get('module_id')})" if up.get("module_id") else "",
        })
    return rows


@app.post("/api/qtest/upload")
def qtest_upload(data: Dict[str, Any] = Body(...), sess=Depends(current)):
    run = _run(sess)
    if not run.get("test_cases"):
        raise ServiceError("No test cases. Generate and review first.")
    if run.get("dirty") or not run.get("excel_path"):
        _write_excel(run)
    result = services.qtest_upload(
        Path(run["excel_path"]), run["test_cases"], run.get("story_id", ""),
        str(data.get("project_id", "")), str(data.get("requirement_id", "")),
        str(data.get("parent_module_id", "")), str(data.get("module_id", "")).strip(),
        str(data.get("module_name", "")).strip())
    run["upload"] = result
    run["rtm"] = _build_rtm(run)
    _save(sess)
    return {"ok": True, "upload": result, "rtm": run["rtm"], "ac_list": run["ac_list"], "run": _public_run(run)}


@app.post("/api/qtest/retry_failed")
def qtest_retry(sess=Depends(current)):
    run = _run(sess)
    if not run.get("upload"):
        raise ServiceError("Nothing uploaded yet.")
    run["upload"] = services.qtest_retry_failed(run["upload"], run["test_cases"])
    run["rtm"] = _build_rtm(run)
    _save(sess)
    return {"ok": True, "upload": run["upload"], "rtm": run["rtm"], "run": _public_run(run)}


@app.get("/api/qtest/rtm")
def qtest_rtm(sess=Depends(current)):
    run = _run(sess)
    if run.get("test_cases"):
        overrides = {r["tc_id"]: r["ac_id"] for r in run.get("rtm", []) if r.get("ac_overridden")}
        run["rtm"] = _build_rtm(run)
        for r in run["rtm"]:
            if r["tc_id"] in overrides:
                r["ac_id"], r["ac_overridden"] = overrides[r["tc_id"]], True
                r["ac_title"] = next((a["title"] for a in run["ac_list"] if a["id"] == r["ac_id"]), "")
        _save(sess)
    return {"ok": True, "rtm": run.get("rtm", []), "ac_list": run.get("ac_list", []), "upload": run.get("upload")}


@app.put("/api/qtest/rtm/mapping")
def rtm_mapping(data: Dict[str, Any] = Body(...), sess=Depends(current)):
    """Manually override the heuristic TC -> AC mapping."""
    run = _run(sess)
    tc_id, ac_id = str(data.get("tc_id", "")), str(data.get("ac_id", ""))
    for r in run.get("rtm", []):
        if r["tc_id"] == tc_id:
            r["ac_id"], r["ac_overridden"] = ac_id, True
            r["ac_title"] = next((a["title"] for a in run.get("ac_list", []) if a["id"] == ac_id), "")
    _save(sess)
    return {"ok": True, "rtm": run["rtm"]}


@app.get("/api/qtest/rtm/excel")
def rtm_excel(sess=Depends(current)):
    import openpyxl
    from openpyxl.styles import Font, PatternFill
    run = _run(sess)
    rows = run.get("rtm") or []
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "RTM"
    headers = ["Jira Story ID", "Acceptance Criteria", "AC Title", "Generated TC ID", "Test Case Name",
               "qTest TC ID", "qTest Internal ID", "Upload Status", "Link Status", "Module", "Error"]
    ws.append(headers)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="4361EE")
    for r in rows:
        ws.append([r["story_id"], r["ac_id"], r["ac_title"], r["tc_id"], r["name"], r["qtest_pid"],
                   r["qtest_id"], r["upload_status"], r["link_status"], r["module"], r.get("error", "")])
    for col, w in zip("ABCDEFGHIJK", (14, 12, 40, 14, 45, 12, 16, 14, 12, 28, 40)):
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    name = f"RTM_{run.get('story_id') or 'LOCAL'}.xlsx"
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


# --------------------------------------------------------------------------- #
# Settings (stored server-side in ai_test_generator/.env, never returned in full)
# --------------------------------------------------------------------------- #
@app.get("/api/settings")
def get_settings(sess=Depends(current)):
    return {"ok": True, "fields": settings_store.get_settings()}


@app.put("/api/settings")
def put_settings(data: Dict[str, Any] = Body(...), sess=Depends(current)):
    changed = settings_store.update_settings(data.get("values") or {})
    return {"ok": True, "changed": changed, "fields": settings_store.get_settings()}


@app.delete("/api/settings/{key}")
def delete_setting(key: str, sess=Depends(current)):
    if not settings_store.clear_setting(key):
        raise ServiceError("Unknown setting.")
    return {"ok": True, "fields": settings_store.get_settings()}


@app.get("/api/health")
def health():
    return {"ok": True}
