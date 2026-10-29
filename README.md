# AI Test Case Web App

A small web application that generates test cases from feature descriptions using AI
(Gemini, OpenAI-compatible, or local Ollama) and can push them to Jira / qTest.

## Project layout

```
.
├── ai_test_generator/     # core generation + integrations
├── backend/               # Flask API
├── frontend/              # static HTML/CSS/JS
├── requirements.txt
└── README.md
```

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp ai_test_generator/.env.example ai_test_generator/.env
# edit .env with your API keys
python -m backend.app
```

Open the URL printed by the server (typically http://127.0.0.1:5000).

## Features

- Generate test cases from a feature description
- Review / refine generated cases
- Export or push to Jira and qTest
- Simple web UI

See `NOTES.md` for known gaps and assumptions.
