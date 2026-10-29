# AI TestCase Generator — Web App

A FastAPI + static HTML/CSS/JS web UI built on the existing `ai_test_generator`
code. It takes you through **Welcome → Input → Generate → Review → qTest Upload**.

## Project layout

```
.
├── ai_test_generator/     # core generation + integrations
├── backend/               # FastAPI API
├── frontend/              # static HTML/CSS/JS
├── requirements.txt
└── README.md
```

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ai_test_generator/.env.example ai_test_generator/.env
# edit .env with your API keys
uvicorn backend.app:app --reload
```

Open http://127.0.0.1:8000

See `NOTES.md` for known gaps.
