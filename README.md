# MindSpring — Complete Project Documentation

> **Version:** Based on codebase snapshot (May 2026)  
> **Audience:** Developers, reviewers, viva/interview preparation  
> **Project type:** EdTech — AI-powered study companion for Pakistani Matric/Intermediate (BISE) students

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem & Goals](#2-problem--goals)
3. [System Architecture](#3-system-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Project Structure](#5-project-structure)
6. [How to Run (Development)](#6-how-to-run-development)
7. [Environment Variables](#7-environment-variables)
8. [Database (SQLite)](#8-database-sqlite)
9. [Backend API Reference](#9-backend-api-reference)
10. [RAG — Retrieval Augmented Generation](#10-rag--retrieval-augmented-generation)
11. [AI Models (Gemini & Local T5)](#11-ai-models-gemini--local-t5)
12. [Adaptive Learning](#12-adaptive-learning)
13. [Frontend Application](#13-frontend-application)
14. [Feature-by-Feature Workflow](#14-feature-by-feature-workflow)
15. [My Library & Data Persistence](#15-my-library--data-persistence)
16. [PDF Export](#16-pdf-export)
17. [Mobile App (Capacitor / Android)](#17-mobile-app-capacitor--android)
18. [Security & Production Gaps](#18-security--production-gaps)
19. [Known Limitations & Bugs](#19-known-limitations--bugs)
20. [Deployment Notes](#20-deployment-notes)
21. [File Reference](#21-file-reference)
22. [Glossary](#22-glossary)

---

## 1. Executive Summary

**MindSpring** is a full-stack learning application that helps Pakistani school students prepare for board exams (BISE-style). Students can:

- Chat with an **AI tutor** grounded in ingested textbook content (RAG)
- Generate **MCQ quizzes**, **flashcards**, **smart notes**, and **study plans**
- Analyze pasted text / files (**PDF Summarizer**)
- Practice **past-paper style** exams
- Track **performance** and review saved work in **My Library**
- **Download** generated content as PDF
- Use the app on **web** or **Android** (Capacitor)

The system has three main technical pillars:

| Pillar | Technology |
|--------|------------|
| UI | React + Vite (+ Capacitor for Android) |
| API & persistence | Flask + SQLite |
| Intelligence | Google Gemini + ChromaDB vector search (+ optional local Flan-T5) |

---

## 2. Problem & Goals

### Problem
Students need personalized, curriculum-aligned help (Physics, Chemistry, Biology, etc.) without always relying on expensive tutoring. Generic ChatGPT answers may not match Pakistani textbooks or exam patterns.

### Solution approach
1. **Ingest textbooks** into vector databases (Chroma) per subject/book.
2. **Retrieve** relevant chunks when the student asks a question or picks a chapter.
3. **Generate** answers/questions with Gemini using that context (RAG).
4. **Adapt** difficulty based on quiz performance (`struggling` / `improving` / `mastered`).
5. **Persist** generated content and quiz history for revision (My Library).

### Target users
- Matric and Intermediate students in Pakistan
- Subjects: Physics, Chemistry, Biology, Mathematics, English, Computer Science, Urdu, etc. (configurable in UI)

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│  Browser (Vite dev :5173)  OR  Android APK (Capacitor WebView)   │
│  React App (App.jsx) — pages, state, UI                          │
│  adaptiveSync.js — HTTP calls to backend                         │
└────────────────────────────┬────────────────────────────────────┘
                             │ JSON over HTTP (CORS enabled)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BACKEND LAYER (Flask :5000)                  │
│  app.py — routes, auth, DB, orchestration                        │
│  local_t5.py — optional on-device model (fallback)               │
└──────┬──────────────────┬────────────────────┬──────────────────┘
       │                  │                    │
       ▼                  ▼                    ▼
┌──────────────┐  ┌───────────────┐  ┌─────────────────────────┐
│ SQLite       │  │ ChromaDB      │  │ Google Gemini API       │
│ mindspring.db│  │ db_storage/   │  │ (generate_content)      │
│ users, MCQs, │  │ {book_id}_db  │  │                         │
│ library, etc.│  │ embeddings    │  │                         │
└──────────────┘  └───────────────┘  └─────────────────────────┘
```

### Request flow (example: AI Tutor)

1. User types question in React → `POST /chat` with `message` + optional `learning_status`.
2. Backend may call `get_intelligent_book_id()` to pick book (e.g. `physics_9th`).
3. `get_context(book_id, query)` embeds query, searches Chroma, returns text chunks.
4. Optional: `try_local_chat()` if local T5 configured and output passes quality check.
5. Else: Gemini `generate_content` with context + adaptive instructions.
6. Response JSON → UI displays reply; optional `saveGeneratedContent` for Library.

---

## 4. Technology Stack

### Frontend
| Tool | Purpose |
|------|---------|
| React 19 | UI components & state |
| Vite 8 | Dev server & production build |
| Capacitor 7 | Android wrapper |
| html2pdf.js | Client-side PDF download |
| Supabase packages | Present in `package.json`; **login currently uses Flask**, not Supabase |

### Backend
| Tool | Purpose |
|------|---------|
| Python 3 | Runtime |
| Flask | REST API |
| flask-cors | Cross-origin requests from frontend |
| sqlite3 | Embedded database |
| chromadb | Vector store for textbook chunks |
| sentence-transformers | `all-MiniLM-L6-v2` embeddings for search |
| google-genai | Gemini API client |
| werkzeug | Password hashing |
| python-dotenv | Load `.env` secrets |
| transformers + torch | Optional local Flan-T5 (`local_t5.py`) |

---

## 5. Project Structure

```
mindspring2_project copy/
├── PROJECT_DOCUMENTATION.md    ← this file
├── requirements.txt            ← Python dependencies (partial list)
├── db_storage/                 ← Chroma vector DBs (per book)
│   ├── physics_9th_db/
│   ├── biology_9th_db/
│   └── ...
├── backend/
│   ├── app.py                  ← Main Flask application (~1000+ lines)
│   ├── local_t5.py             ← Optional local AI model
│   ├── gemini_service.py       ← Placeholder (logic is in app.py)
│   ├── mindspring.db           ← SQLite (created at runtime)
│   ├── .env                    ← GEMINI_API_KEY, LOCAL_T5_*, etc.
│   └── models/
│       └── mindspring_model/   ← Fine-tuned Flan-T5 weights (optional)
└── frontend/
    ├── src/
    │   ├── App.jsx             ← All main pages & UI (~2300 lines)
    │   ├── Signup.jsx          ← Login/signup screen
    │   ├── adaptiveSync.js     ← Backend API client helpers
    │   ├── apiConfig.js        ← VITE_API_BASE → API_BASE
    │   ├── PdfExport.jsx       ← PDF button + print layouts
    │   ├── pdfExport.js        ← html2pdf wrapper
    │   ├── Quiz.jsx            ← Standalone quiz component (legacy/aux)
    │   ├── supabaseClient.js   ← Supabase config (not wired to main auth)
    │   └── main.jsx            ← React entry
    ├── .env.local              ← VITE_API_BASE for dev/mobile
    ├── .env.example
    ├── capacitor.config.json
    ├── android/                ← Capacitor Android project
    └── package.json
```

---

## 6. How to Run (Development)

### Prerequisites
- Node.js 18+ and npm
- Python 3.10+
- Gemini API key from [Google AI Studio](https://aistudio.google.com/)
- Ingested Chroma DBs under `db_storage/` (for RAG features)

### Backend

```bash
cd backend
pip install flask flask-cors python-dotenv google-genai chromadb sentence-transformers
# Optional for local T5:
# pip install torch transformers

# Create backend/.env:
# GEMINI_API_KEY=your_key_here
# GEMINI_MODEL=gemini-2.0-flash   (optional)

python app.py
```

Server runs at **`http://127.0.0.1:5000`** with `host=0.0.0.0` (LAN/mobile access).

### Frontend (website)

```bash
cd frontend
npm install
# frontend/.env.local:
# VITE_API_BASE=http://127.0.0.1:5000

npm run dev
```

Open **`http://localhost:5173`** (not port 5000 for the UI).

### Mobile (Android)

```bash
cd frontend
npm run mobile:sync    # build + cap sync
npm run mobile:android # open Android Studio
```

**API URL for devices:**
| Scenario | VITE_API_BASE |
|----------|----------------|
| PC browser | `http://127.0.0.1:5000` |
| Android emulator | `http://10.0.2.2:5000` |
| Physical phone (Wi‑Fi) | `http://<PC_LAN_IP>:5000` |
| USB + adb reverse | `http://127.0.0.1:5000` after `adb reverse tcp:5000 tcp:5000` |

Enable cleartext HTTP in `android/app/src/main/AndroidManifest.xml` for local dev (`usesCleartextTraffic="true"`).

---

## 7. Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes (for AI) | Google Gemini API key |
| `GEMINI_MODEL` | No | Force model name (e.g. `gemini-2.0-flash`) |
| `LOCAL_T5_MODEL_PATH` | No | Path to fine-tuned Flan-T5 folder |
| `LOCAL_T5_DEVICE` | No | `cpu` or `cuda` |
| `LOCAL_T5_INCLUDE_RAG_CONTEXT` | No | `0` = local model without Chroma text |
| `LOCAL_T5_*_TEMPLATE` | No | Custom prompts for MCQ/chat/summary |

Loaded via `load_dotenv()` at startup in `app.py` (line ~27).

### Frontend (`frontend/.env.local`)

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE` | Flask backend URL (no trailing slash) |
| `VITE_SUPABASE_URL` | Optional — not used for main login |
| `VITE_SUPABASE_ANON_KEY` | Optional |

Read in `apiConfig.js` as `import.meta.env.VITE_API_BASE`.

---

## 8. Database (SQLite)

**File:** `backend/mindspring.db`  
**Path set in app.py:**

```python
DATABASE = os.path.join(os.path.dirname(__file__), "mindspring.db")
```

### Tables

#### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto increment |
| full_name | TEXT | Display name |
| email | TEXT UNIQUE | Lowercased on write |
| password_hash | TEXT | werkzeug hash |
| grade | TEXT | e.g. 9th Class |
| created_at | TIMESTAMP | Default now |

#### `mcq_history`
Stores each generated/saved MCQ (one row per question).

| Column | Notes |
|--------|-------|
| email, subject, chapter | Ownership & grouping |
| question, options (JSON), correct_answer | MCQ content |

Used for: My Library MCQ batches, Performance chapter counts.

#### `adaptive_profile`
| Column | Notes |
|--------|-------|
| email + subject | Composite PRIMARY KEY |
| status | `struggling` \| `improving` \| `mastered` |
| last_score_pct | Last quiz percentage |
| updated_at | Timestamp |

#### `generated_content`
| Column | Notes |
|--------|-------|
| kind | e.g. `notes`, `study_plan`, `tutor_reply` |
| title, content, meta_json | Saved AI output |
| subject, chapter | Optional filters |

**Allowed kinds on save** (`ALLOWED_GENERATED_KINDS` in app.py):
`notes`, `study_plan`, `pdf_summary`, `past_paper`, `past_paper_tips`, `tutor_reply`, `performance_analysis`

> **Note:** Frontend may send `flashcards` kind but it is **not** in the allowed list — save may fail with 400.

#### `quiz_attempt`
| Column | Notes |
|--------|-------|
| score_pct | Quiz score |
| responses_json | Array of per-question user vs correct answers |

### Viewing data
Use **DB Browser for SQLite** → open `backend/mindspring.db`.

---

## 9. Backend API Reference

Base URL: `{API_BASE}` (default `http://127.0.0.1:5000`)

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service status + route list |

### Authentication
| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/signup` | `full_name`, `email`, `password`, `grade?` | `{ user }` |
| POST | `/login` | `email`, `password` | `{ user }` or 401 |

Passwords are hashed; never stored plain text.

### Persistence (used by `adaptiveSync.js`)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/save-mcq` | Save one MCQ row |
| GET | `/mcq-history?email=&subject?&limit=` | List saved MCQs |
| POST | `/save-generated` | Save notes/plan/etc. |
| GET | `/generated-history?email=&kind?&limit=` | Library text items |
| POST | `/record-quiz-attempt` | Save quiz submit |
| GET | `/quiz-attempts?email=&limit=` | List attempts |
| GET | `/learning-profile?email=` | Get adaptive statuses |
| POST | `/learning-profile` | Update adaptive status |
| GET | `/performance-stats?email=&subject?` | Dashboard analytics |

### AI / RAG
| Method | Path | RAG? | Description |
|--------|------|------|-------------|
| POST | `/generate-text` | No | Generic Gemini completion (notes, plans) |
| POST | `/chat` | Yes | AI tutor |
| POST | `/summarize` | Yes | Chapter summary |
| POST | `/generate-mcqs` | Yes | MCQ JSON list |
| POST | `/generate-flashcards` | Yes | `{ cards: [{front, back}] }` |

Common JSON fields for adaptive features:
- `learning_status`: `struggling` | `improving` | `mastered` (from frontend quiz)
- `book_id`: e.g. `physics_9th`, `biology_9th`

---

## 10. RAG — Retrieval Augmented Generation

### What is stored
Textbook content split into **chunks**, embedded with `SentenceTransformer('all-MiniLM-L6-v2')`, stored in **ChromaDB** per book:

```
db_storage/
  physics_9th_db/     ← collection name typically matches book_id
  biology_9th_db/
  ...
```

### `get_context(book_id, query, n_results=5)`
1. Open `db_storage/{book_id}_db`
2. Encode `query` to vector
3. Query collection for top `n_results` documents
4. Join chunk text → returned as one string for the prompt

### Book ID mapping (frontend)
`ragBookIdFromSubject(subject)` in `App.jsx`:
- Physics → `physics_9th`
- Biology → `biology_9th`
- Chemistry → `chemistry_9th`
- Computer → `computer_9th`
- Math → `mathematics_9th`
- Default → `physics_9th`

### Chat-specific routing
`/chat` uses `get_intelligent_book_id(user_query)` — Gemini classifies the question into a book category before retrieval.

---

## 11. AI Models (Gemini & Local T5)

### Gemini (primary)
- Client: `genai.Client(api_key=...)`
- Model selection: `_resolve_gemini_model()` tries candidates at startup:
  - `GEMINI_MODEL` from env
  - `gemini-2.5-flash`, `gemini-2.0-flash`, etc.
- Stored in global `MODEL_NAME` for all routes

### Local Flan-T5 (optional)
**File:** `backend/local_t5.py`

Enabled only if `LOCAL_T5_MODEL_PATH` points to a valid model folder.

| Function | Used in route | Fallback |
|----------|---------------|----------|
| `try_local_chat` | `/chat` | Gemini |
| `try_local_mcq` | `/generate-mcqs` | Gemini |
| `try_local_summary` | `/summarize` | Gemini |

Output is validated (JSON shape for MCQs, minimum length for chat/summary). Invalid output → Gemini.

### Features NOT using local T5
- `/generate-text` (Smart Notes, Study Plan, Past Papers, Performance coach)
- `/generate-flashcards`

---

## 12. Adaptive Learning

### Flow
1. Student completes quiz → frontend calculates % correct.
2. Status assigned:
   - &lt; 50% → `struggling`
   - 50–79% → `improving`
   - ≥ 80% → `mastered`
3. Saved to:
   - `localStorage.setItem('status_${subject}', status)`
   - `POST /learning-profile` (SQLite)
4. Next AI calls include `learning_status` in JSON body.
5. Backend `_adaptive_instruction(status, task)` prepends tailored prompt text for tutor/mcq/summary.

### Login sync
`Signup.jsx` calls `pullAdaptiveProfiles(email)` → restores `status_*` keys from server.

---

## 13. Frontend Application

### Entry & auth
- `main.jsx` → renders `App`
- If not logged in → `Signup.jsx` (signup/login forms → Flask API)
- On success → `App` with `userEmail`, `userName`, `classLevel`, `subject`

### Navigation pages (`App.jsx`)

| Page ID | Label | Main backend calls |
|---------|-------|-------------------|
| `dashboard` | Dashboard | `fetchPerformanceStats` |
| `quiz` | MCQ Quiz | `/generate-mcqs`, save MCQ, record attempt |
| `library` | My Library | history endpoints |
| `tutor` | AI Tutor | `/chat` |
| `notes` | Smart Notes | `/generate-text` |
| `plan` | Study Plan | `/generate-text` (JSON blocks UI) |
| `flashcards` | Flashcards | `/generate-flashcards` |
| `pdf` | PDF Summarizer | `/generate-text` |
| `performance` | Performance | stats + `/generate-text` |
| `pastpapers` | Past Papers AI | `/generate-text` |

### Key helpers in App.jsx
- `callClaude()` → wraps `generateTextViaBackend()` (name is legacy; uses Gemini)
- `parseStudyPlanBlocks()` → parses JSON study plan for card UI
- `computeSubjectPerformance()` → dashboard % from quiz + saves
- `libraryPdfChildren()` → PDF content by library item kind

### `adaptiveSync.js`
Central API layer — see separate explanation in conversation; all `fetch` URLs use `API_BASE`.

---

## 14. Feature-by-Feature Workflow

### MCQ Quiz
1. Select chapter, difficulty, count → **Generate Quiz**
2. `POST /generate-mcqs` with `book_id`, `chapter`, `learning_status`
3. Parse JSON array from response text
4. `saveMcqBatch()` → each question to `/save-mcq`
5. User answers → **Submit** → score, adaptive status, `record-quiz-attempt`
6. **Download PDF** via `ExportPdfButton` + `PdfMcqList`

### AI Tutor
1. User message → `POST /chat`
2. RAG context + Gemini (or local T5)
3. Optional save as `tutor_reply` in Library
4. PDF: full chat transcript when messages &gt; 1

### Smart Notes
1. Chapter + note type (summary, keypoints, formulas, mindmap)
2. `generateTextViaBackend` → `/generate-text`
3. Save as `kind: notes`
4. Copy / PDF export

### Study Plan
1. Weeks, hours/day, weak topics, weekly/monthly tab
2. `/generate-text` with JSON-shaped prompt
3. `parseStudyPlanBlocks()` → colored block cards
4. Save as `study_plan`

### Flashcards
1. Chapter or custom topic, card count (3–12)
2. `POST /generate-flashcards` → strict JSON cards
3. Flip UI (`FlashcardTile`)
4. Save content as JSON string (`flashcards` kind — backend allowlist issue)
5. PDF: `PdfFlashcardList`

### PDF Summarizer
1. Paste text or upload `.txt` / `.md`
2. Mode: summarize, notes, questions, simplify
3. `/generate-text` → `pdf_summary` save

### Performance
1. Load `GET /performance-stats`
2. Subject tiles, chapter bars, adaptive tags
3. **Get AI Analysis** → coach text via `/generate-text`

### Past Papers AI
1. Board + year → generate paper text
2. **Exam Tips** (second call) based on paper
3. PDF per section

### My Library
Merged timeline:
- `generated` items (notes, plans, …)
- `mcq` batches (grouped by time window)
- `attempt` quiz results

Actions: Read/Hide, **Download PDF**, Practise again (reload MCQs into Quiz page)

---

## 15. My Library & Data Persistence

### What gets saved automatically
| User action | Storage |
|-------------|---------|
| Generate quiz | `mcq_history` (per question) |
| Submit quiz | `quiz_attempt` + `adaptive_profile` |
| Generate notes/plan/etc. | `generated_content` (if kind allowed) |
| Tutor reply (on success) | `generated_content` tutor_reply |

### MCQ batch grouping
`groupSavedMcqBatches()` groups rows within 120 seconds, same subject/chapter.

---

## 16. PDF Export

### Files
- `frontend/src/pdfExport.js` — `downloadElementAsPdf()` using html2pdf.js
- `frontend/src/PdfExport.jsx` — `ExportPdfButton`, layout components

### How it works
1. Button renders hidden off-screen “sheet” with A4-friendly CSS
2. On click, html2canvas + jsPDF generate download
3. No server involved — pure client

### Components
| Component | Use |
|-----------|-----|
| `PdfText` | Plain text |
| `PdfMcqList` | Quiz questions |
| `PdfFlashcardList` | Flashcards |
| `PdfStudyPlanBlocks` | Study plan cards |
| `PdfChatTranscript` | Tutor messages |
| `PdfQuizAttemptList` | Library attempts |

Import path in App.jsx: `./PdfExport.jsx` (required on Windows due to `pdfExport.js` name collision).

---

## 17. Mobile App (Capacitor / Android)

- **Config:** `frontend/capacitor.config.json` — `webDir: "dist"`
- **Build:** `npm run build` → static files in `frontend/dist`
- **Sync:** `npx cap sync` copies into Android project
- **Open:** Android Studio → Run on emulator/device

Network: phone must reach Flask on PC (LAN IP or `adb reverse`).

---

## 18. Security & Production Gaps

| Area | Current state | Production recommendation |
|------|---------------|---------------------------|
| API auth | Email in body; no JWT | Session tokens / OAuth |
| Password | Hashed ✓ | Add rate limiting on login |
| HTTPS | Local HTTP only | TLS everywhere |
| API keys | Backend .env ✓ | Secret manager, never commit `.env` |
| CORS | Open (`CORS(app)`) | Restrict origins |
| Input validation | Basic | Sanitize length, rate limit AI routes |
| Supabase | Installed but unused for auth | Remove or integrate fully |

---

## 19. Known Limitations & Bugs

1. **`flashcards` not in `ALLOWED_GENERATED_KINDS`** — Library save may return 400.
2. **No session tokens** — refreshing page may lose login unless extended.
3. **Chroma DBs must exist** — missing `db_storage` → empty RAG / errors.
4. **`LOCAL_T5_MODEL_PATH` in .env`** may point to Mac path — won't work on Windows without update.
5. **`gemini_service.py`** is empty — all Gemini logic in `app.py`.
6. **Large `App.jsx`** (~2300 lines) — maintenance would benefit from splitting pages into files.
7. **Quiz.jsx** vs **QuizPage** in App.jsx — some duplication.

---

## 20. Deployment Notes

### Suggested production layout
- **Frontend:** Vercel/Netlify static hosting OR Capacitor store build
- **Backend:** Railway, Render, AWS EC2, etc.
- **Database:** Migrate SQLite → PostgreSQL for multi-user scale
- **Vector DB:** Chroma on persistent volume or managed vector service
- **Env:** Set `VITE_API_BASE=https://api.yourdomain.com` at build time

### Checklist
- [ ] `GEMINI_API_KEY` on server only
- [ ] HTTPS + CORS whitelist
- [ ] Auth middleware on all non-public routes
- [ ] Backup `mindspring.db` / Postgres
- [ ] Monitor Gemini quota & latency

---

## 21. File Reference

| File | Role |
|------|------|
| `backend/app.py` | Flask app: DB, routes, RAG, Gemini |
| `backend/local_t5.py` | Optional local model |
| `backend/mindspring.db` | SQLite data |
| `frontend/src/App.jsx` | Main UI & page logic |
| `frontend/src/adaptiveSync.js` | Backend HTTP helpers |
| `frontend/src/Signup.jsx` | Auth UI |
| `frontend/src/apiConfig.js` | API base URL |
| `frontend/src/PdfExport.jsx` | PDF UI components |
| `frontend/src/pdfExport.js` | PDF generation util |
| `frontend/src/Quiz.jsx` | Alternate quiz component |
| `frontend/src/supabaseClient.js` | Supabase (optional, unused in main flow) |
| `db_storage/*_db` | Chroma textbook indexes |

---

## 22. Glossary

| Term | Meaning |
|------|---------|
| **RAG** | Retrieval Augmented Generation — AI + retrieved documents |
| **Chroma** | Vector database for embeddings |
| **BISE** | Board of Intermediate and Secondary Education (Pakistan) |
| **MCQ** | Multiple choice question |
| **Adaptive profile** | Per-subject learning level from quiz scores |
| **book_id** | Folder/collection id for a textbook (e.g. `physics_9th`) |
| **Capacitor** | Bridge to run web app as native Android/iOS |
| **Flan-T5** | Google's instruction-tuned T5 model family |

---

## Quick Interview Answers

**Q: What is this project?**  
EdTech AI study app for Pakistani students — RAG tutor, quizzes, notes, plans, flashcards, library, PDF export, Android support.

**Q: What is the hardest technical part?**  
RAG pipeline (correct book, chunk retrieval, prompt design) + keeping Gemini output in valid JSON for MCQs/flashcards.

**Q: How do you improve answers?**  
Better chunking/ingestion, stronger prompts, adaptive status, optional fine-tuned local model, user feedback loop.

---

*Document generated for the MindSpring project. Update this file when routes, env vars, or features change.*
