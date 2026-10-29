"""AI TestCase Generator - FastAPI backend.

Run from the project root:
    uvicorn backend.app:app --reload
then open http://localhost:8000
"""
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
import uuid

from . import services, session_store, settings_store

app = FastAPI(title="AI TestCase Generator")

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=FRONTEND), name="static")

@app.get("/")
def welcome():
    return FileResponse(FRONTEND / "welcome.html")

@app.get("/app")
def app_page():
    return FileResponse(FRONTEND / "app.html")

@app.post("/api/session/start")
def start_session():
    sid = str(uuid.uuid4())
    session_store.save_session(sid, {"id": sid, "step": "input"})
    return {"ok": True, "session_id": sid, "redirect": "/app"}

# Additional routes for generate / review / qtest would go here
# (see services.py)
