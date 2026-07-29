import os
import re
import json
import sqlite3
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import chromadb
from sentence_transformers import SentenceTransformer
from google import genai
from dotenv import load_dotenv

try:
    from local_t5 import try_local_chat, try_local_mcq, try_local_summary
except ImportError:
    def try_local_mcq(*_a, **_k):
        return None

    def try_local_summary(*_a, **_k):
        return None

    def try_local_chat(*_a, **_k):
        return None


# Load Environment Variables
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

DATABASE = os.path.join(os.path.dirname(__file__), "mindspring.db")


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def _migrate_mcq_history_chapter(conn):
    cols = [r[1] for r in conn.execute("PRAGMA table_info(mcq_history)").fetchall()]
    if "chapter" not in cols:
        conn.execute("ALTER TABLE mcq_history ADD COLUMN chapter TEXT")


def init_db():
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                grade TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS mcq_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                question TEXT NOT NULL,
                options TEXT,
                correct_answer TEXT,
                subject TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS adaptive_profile (
                email TEXT NOT NULL,
                subject TEXT NOT NULL,
                status TEXT NOT NULL,
                last_score_pct REAL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (email, subject)
            )
            """
        )
        _migrate_mcq_history_chapter(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS generated_content (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                kind TEXT NOT NULL,
                subject TEXT,
                chapter TEXT,
                title TEXT,
                content TEXT NOT NULL,
                meta_json TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS quiz_attempt (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                subject TEXT NOT NULL,
                chapter TEXT,
                score_pct REAL,
                responses_json TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def _ensure_library_tables(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS generated_content (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            kind TEXT NOT NULL,
            subject TEXT,
            chapter TEXT,
            title TEXT,
            content TEXT NOT NULL,
            meta_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS quiz_attempt (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            subject TEXT NOT NULL,
            chapter TEXT,
            score_pct REAL,
            responses_json TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


ALLOWED_GENERATED_KINDS = frozenset(
    {
        "notes",
        "study_plan",
        "pdf_summary",
        "past_paper",
        "past_paper_tips",
        "tutor_reply",
        "performance_analysis",
    }
)


# --- 1. MODEL CONFIGURATION ---
# gemini-1.5-flash is not available on current v1beta generateContent for many keys.
# Set GEMINI_MODEL in .env to force a specific id (e.g. gemini-2.0-flash).
def _resolve_gemini_model(client: genai.Client) -> str:
    env_model = (os.getenv("GEMINI_MODEL") or "").strip()
    candidates = [
        env_model,
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-2.0-flash-001",
        "gemini-flash-latest",
    ]
    seen: set[str] = set()
    ordered: list[str] = []
    for m in candidates:
        if m and m not in seen:
            seen.add(m)
            ordered.append(m)

    last_err = None
    for name in ordered:
        try:
            client.models.generate_content(model=name, contents="Hi")
            print(f"✅ Gemini API Connection ({name}): SUCCESS")
            return name
        except Exception as e:
            last_err = e
            print(f"⚠️ Gemini model '{name}' failed: {e}")

    fallback = "gemini-2.0-flash"
    print(
        f"❌ CRITICAL: No Gemini model responded. Last error: {last_err}. "
        f"Using '{fallback}' for requests — set GEMINI_MODEL in .env or fix API key (ai.google.dev)."
    )
    return fallback


client = genai.Client(api_key=api_key)
MODEL_NAME = _resolve_gemini_model(client)

app = Flask(__name__)
CORS(app)
init_db()

def get_intelligent_book_id(user_query):
    prompt = f"""
    Classify the following student question into one of these categories:
    - physics_9th
    - biology_9th
    - computer_9th
    - english_9th
    - physics_10th
    - biology_10th
    
    Return ONLY the category name.
    
    QUESTION: "{user_query}"
    """
    try:
        # Use the global MODEL_NAME to keep it consistent
        response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
        # Clean the response in case AI adds extra text or quotes
        category = response.text.strip().lower().replace('"', '').replace("'", "")
        return category
    except:
        return "physics_9th" # Fallback

# Initialize Embedding Model
embed_model = SentenceTransformer('all-MiniLM-L6-v2')

def _extract_json_object(text: str):
    """Pull a JSON object from model output (markdown fences or extra prose)."""
    if not text or not isinstance(text, str):
        return None
    t = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", t, re.I)
    if m:
        t = m.group(1).strip()
    a = t.find("{")
    b = t.rfind("}")
    if a == -1 or b <= a:
        return None
    try:
        return json.loads(t[a : b + 1])
    except json.JSONDecodeError:
        return None


def get_context(book_id, query, n_results=5):
    try:
        # Resolve path to db_storage (ensure it's relative to where you run app.py)
        db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "db_storage", f"{book_id}_db"))
        
        if not os.path.exists(db_path):
            print(f"⚠️ {book_id} database not found at {db_path}.")
            return ""

        chroma_client = chromadb.PersistentClient(path=db_path)
        existing_collections = [c.name for c in chroma_client.list_collections()]
        
        if book_id not in existing_collections:
            return ""

        collection = chroma_client.get_collection(name=book_id)
        query_vector = embed_model.encode(query).tolist()
        results = collection.query(query_embeddings=[query_vector], n_results=n_results)
        
        return "\n".join(results['documents'][0])
    except Exception as e:
        print(f"Error fetching context: {e}")
        return ""


def _rag_context_for_local(full_context: str) -> str:
    """LOCAL_T5_INCLUDE_RAG_CONTEXT=0 → local model without Chroma; Gemini still uses full RAG."""
    v = (os.getenv("LOCAL_T5_INCLUDE_RAG_CONTEXT") or "1").strip().lower()
    if v in ("0", "false", "no", "off"):
        return ""
    return full_context


def _adaptive_instruction(status: str | None, task: str = "tutor") -> str:
    """Frontend sends learning_status from quiz performance (struggling / improving / mastered)."""
    s = (status or "").strip().lower()
    if s not in ("struggling", "improving", "mastered"):
        return ""
    mcq = {
        "struggling": (
            "ADAPTIVE PROFILE — STRUGGLING: Use only basic recall MCQs: very short stems, plain words, "
            "one-step reasoning, no trick distractors; answers should follow clearly from the context."
        ),
        "improving": (
            "ADAPTIVE PROFILE — IMPROVING: Standard BISE-style MCQs mixing recall with light one-step application."
        ),
        "mastered": (
            "ADAPTIVE PROFILE — STRONG: Where the context supports it, include harder application or "
            "two-step questions; remain fair and syllabus-aligned."
        ),
    }
    tutor = {
        "struggling": (
            "ADAPTIVE PROFILE — STRUGGLING: Explain in very simple steps, define terms, use examples, "
            "and encourage; do not skip reasoning."
        ),
        "improving": (
            "ADAPTIVE PROFILE — IMPROVING: Clear explanations with moderate exam-style detail."
        ),
        "mastered": (
            "ADAPTIVE PROFILE — STRONG: You may add concise depth or link ideas, still grounded in the context."
        ),
    }
    summary = {
        "struggling": (
            "ADAPTIVE PROFILE — STRUGGLING: Short sections, bold key terms, mnemonics, very plain language."
        ),
        "improving": (
            "ADAPTIVE PROFILE — IMPROVING: Structured notes with definitions and exam-relevant bullets."
        ),
        "mastered": (
            "ADAPTIVE PROFILE — STRONG: Denser notes OK: relationships, pitfalls, quick recap tables if helpful."
        ),
    }
    bucket = {"mcq": mcq, "tutor": tutor, "summary": summary}.get(task, tutor)
    return bucket.get(s, "")


@app.route("/", methods=["GET"])
def index():
    return jsonify(
        {
            "status": "ok",
            "service": "MindSpring API",
            "routes": [
                "GET /",
                "POST /signup",
                "POST /login",
                "POST /save-mcq",
                "POST /save-generated",
                "GET /generated-history",
                "GET /mcq-history",
                "POST /record-quiz-attempt",
                "GET /quiz-attempts",
                "GET /learning-profile",
                "POST /learning-profile",
                "GET /performance-stats",
                "POST /generate-text",
                "POST /chat",
                "POST /summarize",
                "POST /generate-mcqs",
                "POST /generate-flashcards",
            ],
        }
    )


@app.route("/signup", methods=["POST"])
def signup():
    data = request.get_json(silent=True) or {}
    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    grade = (data.get("grade") or "").strip() or "9th Class"

    if not full_name or not email or not password:
        return jsonify({"error": "full_name, email, and password are required"}), 400

    pw_hash = generate_password_hash(password)
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (full_name, email, password_hash, grade) VALUES (?, ?, ?, ?)",
                (full_name, email, pw_hash, grade),
            )
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already registered"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"user": {"email": email, "full_name": full_name, "grade": grade}})


@app.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "email and password are required"}), 400

    with get_db() as conn:
        row = conn.execute(
            "SELECT full_name, email, password_hash, grade FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    if not row or not check_password_hash(row["password_hash"], password):
        return jsonify({"error": "Invalid email or password"}), 401

    return jsonify(
        {
            "user": {
                "email": row["email"],
                "full_name": row["full_name"],
                "grade": row["grade"],
            }
        }
    )


@app.route("/save-mcq", methods=["POST"])
def save_mcq():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    question = data.get("question") or data.get("q")
    options = data.get("options")
    correct = data.get("correct_answer") or data.get("answer")
    subject = (data.get("subject") or "").strip() or "unknown"
    chapter = (data.get("chapter") or "").strip() or None

    if not email or not question:
        return jsonify({"error": "email and question are required"}), 400

    try:
        options_json = json.dumps(options) if options is not None else None
    except (TypeError, ValueError):
        options_json = str(options)

    try:
        with get_db() as conn:
            _migrate_mcq_history_chapter(conn)
            conn.execute(
                """
                INSERT INTO mcq_history (email, question, options, correct_answer, subject, chapter)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    email,
                    str(question),
                    options_json,
                    str(correct) if correct is not None else None,
                    subject,
                    chapter,
                ),
            )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True})


@app.route("/save-generated", methods=["POST"])
def save_generated():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    kind = (data.get("kind") or "").strip().lower()
    subject = (data.get("subject") or "").strip() or None
    chapter = (data.get("chapter") or "").strip() or None
    title = (data.get("title") or "").strip() or None
    content = data.get("content")
    meta = data.get("meta")

    if not email or not kind:
        return jsonify({"error": "email and kind are required"}), 400
    if kind not in ALLOWED_GENERATED_KINDS:
        return jsonify({"error": f"kind must be one of: {', '.join(sorted(ALLOWED_GENERATED_KINDS))}"}), 400
    if content is None or (isinstance(content, str) and not content.strip()):
        return jsonify({"error": "content is required"}), 400

    try:
        meta_json = json.dumps(meta) if meta is not None else None
    except (TypeError, ValueError):
        meta_json = None

    try:
        with get_db() as conn:
            _ensure_library_tables(conn)
            conn.execute(
                """
                INSERT INTO generated_content (email, kind, subject, chapter, title, content, meta_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (email, kind, subject, chapter, title, str(content), meta_json),
            )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True})


@app.route("/generated-history", methods=["GET"])
def generated_history():
    email = (request.args.get("email") or "").strip().lower()
    kind_f = (request.args.get("kind") or "").strip().lower()
    limit = request.args.get("limit", type=int) or 200
    limit = min(max(1, limit), 400)
    if not email:
        return jsonify({"error": "email query parameter is required"}), 400

    try:
        with get_db() as conn:
            _ensure_library_tables(conn)
            sql = (
                "SELECT id, kind, subject, chapter, title, content, meta_json, created_at "
                "FROM generated_content WHERE email = ?"
            )
            params = [email]
            if kind_f:
                sql += " AND kind = ?"
                params.append(kind_f)
            sql += " ORDER BY datetime(created_at) DESC, id DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(sql, tuple(params)).fetchall()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    items = []
    for r in rows:
        meta = None
        if r["meta_json"]:
            try:
                meta = json.loads(r["meta_json"])
            except (TypeError, ValueError, json.JSONDecodeError):
                meta = None
        items.append(
            {
                "id": r["id"],
                "kind": r["kind"],
                "subject": r["subject"],
                "chapter": r["chapter"],
                "title": r["title"],
                "content": r["content"],
                "meta": meta,
                "created_at": r["created_at"],
            }
        )
    return jsonify({"items": items})


@app.route("/mcq-history", methods=["GET"])
def mcq_history_list():
    email = (request.args.get("email") or "").strip().lower()
    subject_f = (request.args.get("subject") or "").strip()
    limit = request.args.get("limit", type=int) or 400
    limit = min(max(1, limit), 600)
    if not email:
        return jsonify({"error": "email query parameter is required"}), 400

    try:
        with get_db() as conn:
            _migrate_mcq_history_chapter(conn)
            sql = (
                "SELECT id, question, options, correct_answer, subject, chapter, created_at "
                "FROM mcq_history WHERE email = ?"
            )
            params = [email]
            if subject_f:
                sql += " AND subject = ?"
                params.append(subject_f)
            sql += " ORDER BY datetime(created_at) DESC, id DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(sql, tuple(params)).fetchall()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    items = []
    for r in rows:
        opts_raw = r["options"]
        parsed_opts = None
        if opts_raw is not None and str(opts_raw).strip():
            try:
                parsed_opts = json.loads(opts_raw)
            except (TypeError, ValueError, json.JSONDecodeError):
                parsed_opts = None
        if not isinstance(parsed_opts, list):
            parsed_opts = []
        items.append(
            {
                "id": r["id"],
                "question": r["question"],
                "options": parsed_opts,
                "correct_answer": r["correct_answer"],
                "subject": r["subject"],
                "chapter": r["chapter"],
                "created_at": r["created_at"],
            }
        )
    return jsonify({"items": items})


@app.route("/record-quiz-attempt", methods=["POST"])
def record_quiz_attempt():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    subject = (data.get("subject") or "").strip() or "unknown"
    chapter = (data.get("chapter") or "").strip() or None
    score_pct = data.get("score_pct")
    responses = data.get("responses")

    if not email or not isinstance(responses, list) or len(responses) == 0:
        return jsonify({"error": "email and non-empty responses list are required"}), 400

    try:
        pct = float(score_pct) if score_pct is not None and score_pct != "" else None
    except (TypeError, ValueError):
        pct = None

    try:
        payload = json.dumps(responses)
    except (TypeError, ValueError) as e:
        return jsonify({"error": f"invalid responses: {e}"}), 400

    try:
        with get_db() as conn:
            _ensure_library_tables(conn)
            conn.execute(
                """
                INSERT INTO quiz_attempt (email, subject, chapter, score_pct, responses_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (email, subject, chapter, pct, payload),
            )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True})


@app.route("/quiz-attempts", methods=["GET"])
def quiz_attempts_list():
    email = (request.args.get("email") or "").strip().lower()
    limit = request.args.get("limit", type=int) or 80
    limit = min(max(1, limit), 200)
    if not email:
        return jsonify({"error": "email query parameter is required"}), 400

    try:
        with get_db() as conn:
            _ensure_library_tables(conn)
            rows = conn.execute(
                """
                SELECT id, subject, chapter, score_pct, responses_json, created_at
                FROM quiz_attempt WHERE email = ?
                ORDER BY datetime(created_at) DESC, id DESC LIMIT ?
                """,
                (email, limit),
            ).fetchall()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    attempts = []
    for r in rows:
        try:
            resp = json.loads(r["responses_json"])
        except (TypeError, ValueError, json.JSONDecodeError):
            resp = []
        attempts.append(
            {
                "id": r["id"],
                "subject": r["subject"],
                "chapter": r["chapter"],
                "score_pct": r["score_pct"],
                "responses": resp,
                "created_at": r["created_at"],
            }
        )
    return jsonify({"attempts": attempts})


@app.route("/learning-profile", methods=["GET"])
def learning_profile_get():
    email = (request.args.get("email") or "").strip().lower()
    if not email:
        return jsonify({"error": "email query parameter is required"}), 400
    try:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT subject, status, last_score_pct, updated_at
                FROM adaptive_profile
                WHERE email = ?
                ORDER BY subject
                """,
                (email,),
            ).fetchall()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    profiles = [
        {
            "subject": r["subject"],
            "status": r["status"],
            "last_score_pct": r["last_score_pct"],
            "updated_at": r["updated_at"],
        }
        for r in rows
    ]
    return jsonify({"profiles": profiles})


@app.route("/learning-profile", methods=["POST"])
def learning_profile_post():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    subject = (data.get("subject") or "").strip()
    status = (data.get("status") or "").strip().lower()
    last_pct = data.get("last_score_pct")

    if not email or not subject or not status:
        return jsonify({"error": "email, subject, and status are required"}), 400
    if status not in ("struggling", "improving", "mastered"):
        return jsonify({"error": "status must be struggling, improving, or mastered"}), 400

    try:
        pct = float(last_pct) if last_pct is not None and last_pct != "" else None
    except (TypeError, ValueError):
        pct = None

    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO adaptive_profile (email, subject, status, last_score_pct, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                ON CONFLICT(email, subject) DO UPDATE SET
                    status = excluded.status,
                    last_score_pct = excluded.last_score_pct,
                    updated_at = datetime('now')
                """,
                (email, subject, status, pct),
            )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True})


@app.route("/performance-stats", methods=["GET"])
def performance_stats():
    email = (request.args.get("email") or "").strip().lower()
    subject_filter = (request.args.get("subject") or "").strip()
    if not email:
        return jsonify({"error": "email query parameter is required"}), 400

    try:
        with get_db() as conn:
            _migrate_mcq_history_chapter(conn)
            total_row = conn.execute(
                "SELECT COUNT(*) AS n FROM mcq_history WHERE email = ?",
                (email,),
            ).fetchone()
            total_mcqs = int(total_row["n"] if isinstance(total_row, sqlite3.Row) else total_row[0])

            week_row = conn.execute(
                """
                SELECT COUNT(*) AS n FROM mcq_history
                WHERE email = ? AND datetime(created_at) >= datetime('now', '-7 days')
                """,
                (email,),
            ).fetchone()
            mcqs_this_week = int(week_row["n"] if isinstance(week_row, sqlite3.Row) else week_row[0])

            sub_rows = conn.execute(
                """
                SELECT subject, COUNT(*) AS cnt, MAX(created_at) AS last_at
                FROM mcq_history WHERE email = ?
                GROUP BY subject ORDER BY cnt DESC
                """,
                (email,),
            ).fetchall()

            ad_rows = conn.execute(
                """
                SELECT subject, status, last_score_pct, updated_at
                FROM adaptive_profile WHERE email = ? ORDER BY subject
                """,
                (email,),
            ).fetchall()

            chapter_rows = []
            if subject_filter:
                chapter_rows = conn.execute(
                    """
                    SELECT chapter, COUNT(*) AS cnt
                    FROM mcq_history
                    WHERE email = ? AND subject = ?
                      AND chapter IS NOT NULL AND TRIM(chapter) != ''
                    GROUP BY chapter ORDER BY cnt ASC
                    """,
                    (email, subject_filter),
                ).fetchall()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    by_subject = [
        {"subject": r["subject"], "saved_count": int(r["cnt"]), "last_at": r["last_at"]}
        for r in sub_rows
    ]
    adaptive_by_subject = [
        {
            "subject": r["subject"],
            "status": r["status"],
            "last_score_pct": r["last_score_pct"],
            "updated_at": r["updated_at"],
        }
        for r in ad_rows
    ]
    chapters = [
        {"chapter": r["chapter"], "saved_count": int(r["cnt"])} for r in chapter_rows
    ]

    pct_vals = [
        float(r["last_score_pct"])
        for r in ad_rows
        if r["last_score_pct"] is not None
    ]
    avg_last_quiz = round(sum(pct_vals) / len(pct_vals), 1) if pct_vals else None

    return jsonify(
        {
            "total_mcqs": total_mcqs,
            "mcqs_this_week": mcqs_this_week,
            "by_subject": by_subject,
            "adaptive_by_subject": adaptive_by_subject,
            "chapters": chapters,
            "avg_last_quiz_pct": avg_last_quiz,
        }
    )


@app.route("/generate-text", methods=["POST"])
def generate_text():
    """Open-ended completion for UI features (notes, study plans, PDF tools, etc.)."""
    data = request.get_json(silent=True) or {}
    system = (data.get("system") or "").strip()
    messages = data.get("messages")
    max_tokens = data.get("max_tokens") or data.get("maxTokens") or 2048

    if not messages or not isinstance(messages, list):
        return jsonify({"error": "messages array is required"}), 400

    lines = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        role = (m.get("role") or "user").strip().upper()
        content = m.get("content")
        if content is None:
            continue
        c = str(content).strip()
        if not c:
            continue
        lines.append(f"{role}:\n{c}")
    block = "\n\n".join(lines)
    if not block:
        return jsonify({"error": "no usable message content"}), 400

    parts = []
    if system:
        parts.append(f"Instructions (follow closely):\n{system}")
    parts.append(block)
    try:
        mt = int(max_tokens)
    except (TypeError, ValueError):
        mt = 2048
    if 0 < mt < 32000:
        parts.append(f"Keep the answer within roughly {mt} tokens unless the user needs more detail.")
    prompt = "\n\n---\n\n".join(parts)

    try:
        response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
        text = (getattr(response, "text", None) or "").strip()
        if not text:
            return jsonify({"error": "empty model output"}), 502
        return jsonify({"text": text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json(silent=True) or {}
    user_query = data.get('message')
    if user_query is None or (isinstance(user_query, str) and not user_query.strip()):
        return jsonify({"error": "message is required"}), 400
    
    book_id = get_intelligent_book_id(user_query)
    context = get_context(book_id, user_query)
    adaptive = _adaptive_instruction(data.get("learning_status"), "tutor")

    local_reply = try_local_chat(
        user_query.strip(), _rag_context_for_local(context), adaptive
    )
    if local_reply:
        return jsonify({"reply": local_reply, "detected_subject": book_id})

    prompt = f"You are MindSpring AI, an expert tutor. Use this context: {context}\n\nQuestion: {user_query}"
    if adaptive:
        prompt = adaptive + "\n\n" + prompt

    try:
        response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
        return jsonify({"reply": response.text, "detected_subject": book_id})
    except Exception as e:
        return jsonify({"reply": "I'm having trouble connecting to my brain right now. Please try again!", "error": str(e)})

@app.route('/summarize', methods=['POST'])
def summarize():
    data = request.get_json(silent=True) or {}
    chapter = data.get('chapter')
    if not chapter:
        return jsonify({"error": "chapter is required"}), 400
    book_id = data.get('book_id', 'biology_9th')
    context = get_context(book_id, chapter, n_results=10)
    adaptive = _adaptive_instruction(data.get("learning_status"), "summary")

    local_summary = try_local_summary(
        chapter, _rag_context_for_local(context), adaptive
    )
    if local_summary:
        return jsonify({"summary": local_summary})

    prompt = f"Summarize the chapter '{chapter}' clearly based on this text: {context}"
    if adaptive:
        prompt = adaptive + "\n\n" + prompt
    try:
        response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
        return jsonify({"summary": response.text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/generate-mcqs', methods=['POST'])
def generate_mcqs():
    data = request.get_json(silent=True) or {}
    chapter = data.get('chapter')
    if not chapter:
        return jsonify({"error": "chapter is required"}), 400
    book_id = data.get('book_id', 'biology_9th')
    count = data.get('num_questions', 5)
    difficulty = (data.get("difficulty") or "").strip().lower()
    adaptive = _adaptive_instruction(data.get("learning_status"), "mcq")

    context = get_context(book_id, chapter, n_results=10)

    local_questions = try_local_mcq(
        chapter, int(count), _rag_context_for_local(context), adaptive
    )
    if local_questions:
        return jsonify({"questions": local_questions})

    prompt = (
        f"Generate exactly {count} MCQs for '{chapter}' from this context: {context}. "
        f"Return ONLY a JSON list with keys: 'q', 'options', 'answer', 'explanation'."
    )
    if difficulty in ("easy", "medium", "hard"):
        prompt += f"\nLabel the overall difficulty as {difficulty.upper()} in the style of the questions (easier stems vs harder application)."
    if adaptive:
        prompt = adaptive + "\n\n" + prompt

    try:
        response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
        return jsonify({"questions": response.text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/generate-flashcards", methods=["POST"])
def generate_flashcards():
    """RAG-backed flashcards: Chroma retrieval + Gemini JSON output."""
    data = request.get_json(silent=True) or {}
    topic = (data.get("topic") or data.get("chapter") or "").strip()
    if not topic:
        return jsonify({"error": "topic is required"}), 400

    book_id = (data.get("book_id") or "biology_9th").strip()
    try:
        count = int(data.get("count") or 5)
    except (TypeError, ValueError):
        count = 5
    count = max(3, min(12, count))

    context = get_context(book_id, topic, n_results=10)
    if not (context or "").strip():
        return jsonify(
            {
                "error": (
                    "No textbook chunks found for this book_id/topic. "
                    "Check db_storage ingest or try another subject (book_id)."
                ),
                "cards": [],
            }
        ), 400

    adaptive = _adaptive_instruction(data.get("learning_status"), "tutor")
    prompt = (
        "You create revision flashcards for Pakistani BISE students.\n"
        "Rules:\n"
        "- Use ONLY the TEXTBOOK CONTEXT below for facts; do not invent curriculum content beyond it.\n"
        f'- Produce exactly {count} flashcards focused on: "{topic}".\n'
        "- Each card: FRONT = short question, term, or recall prompt; BACK = clear answer suitable for exams.\n"
        '- Return ONLY valid JSON in this shape (no markdown outside JSON): '
        '{"cards":[{"front":"...","back":"..."}]}\n'
        f"- The array must have exactly {count} objects.\n\n"
        "TEXTBOOK CONTEXT:\n"
        f"{context}"
    )
    if adaptive:
        prompt = adaptive + "\n\n" + prompt

    try:
        response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
        raw = (getattr(response, "text", None) or "").strip()
        if not raw:
            return jsonify({"error": "empty model output"}), 502

        obj = _extract_json_object(raw)
        if not obj or not isinstance(obj.get("cards"), list):
            return jsonify({"error": "model did not return valid JSON with a cards array", "raw_preview": raw[:800]}), 502

        out = []
        for c in obj["cards"]:
            if not isinstance(c, dict):
                continue
            front = str(c.get("front") or c.get("q") or "").strip()
            back = str(c.get("back") or c.get("a") or "").strip()
            if front and back:
                out.append({"front": front, "back": back})

        if not out:
            return jsonify({"error": "no valid cards after parse", "cards": [], "raw_preview": raw[:800]}), 502

        return jsonify({"cards": out[:count], "book_id": book_id, "topic": topic})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    # Listen on all interfaces so phones/emulators on the same LAN can reach the API during dev.
    app.run(debug=True, port=5000, host="0.0.0.0")