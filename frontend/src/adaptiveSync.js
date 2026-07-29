import { API_BASE } from "./apiConfig";

/** Long-form text from backend Gemini (Smart Notes, plans, PDF tools, etc.). */
export async function generateTextViaBackend({
  messages,
  systemPrompt,
  maxTokens = 1000,
}) {
  const res = await fetch(`${API_BASE}/generate-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: systemPrompt,
      messages,
      max_tokens: maxTokens,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || "generate-text failed");
  const text = data.text;
  if (text == null || String(text).trim() === "") throw new Error(data.error || "empty model response");
  return String(text);
}

export async function pushAdaptiveProfile(email, subject, status, lastScorePct) {
  const em = (email || "").trim().toLowerCase();
  if (!em || !subject || !status) return;
  try {
    const res = await fetch(`${API_BASE}/learning-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: em,
        subject: String(subject).trim(),
        status,
        last_score_pct: lastScorePct == null ? null : Number(lastScorePct),
      }),
    });
    if (!res.ok) console.warn("pushAdaptiveProfile failed", res.status);
  } catch (e) {
    console.warn("pushAdaptiveProfile network error", e);
  }
}

export async function pullAdaptiveProfiles(email) {
  const em = (email || "").trim().toLowerCase();
  if (!em) return;
  try {
    const res = await fetch(`${API_BASE}/learning-profile?email=${encodeURIComponent(em)}`);
    const data = await res.json();
    if (!res.ok) return;
    for (const row of data.profiles || []) {
      if (row.subject && row.status) {
        localStorage.setItem(`status_${row.subject}`, row.status);
      }
    }
  } catch (e) {
    console.warn("pullAdaptiveProfiles network error", e);
  }
}

export async function saveMcqBatch(email, subject, chapter, mcqs) {
  const em = (email || "").trim().toLowerCase();
  if (!em || !subject) return;
  const list = Array.isArray(mcqs) ? mcqs : mcqs?.questions || [];
  const ch = (chapter || "").trim() || null;
  for (const mcq of list) {
    try {
      const res = await fetch(`${API_BASE}/save-mcq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: em,
          subject: String(subject).trim(),
          chapter: ch,
          question: mcq.q || mcq.question,
          options: mcq.options,
          correct_answer: mcq.answer || mcq.correct_answer,
        }),
      });
      if (!res.ok) console.warn("save-mcq failed", res.status);
    } catch (e) {
      console.warn("saveMcqBatch error", e);
    }
  }
}

export async function fetchPerformanceStats(email, subject) {
  const em = (email || "").trim().toLowerCase();
  if (!em) return { error: "no email" };
  let url = `${API_BASE}/performance-stats?email=${encodeURIComponent(em)}`;
  if (subject) url += `&subject=${encodeURIComponent(subject)}`;
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

/** Long-form AI output: notes, plans, PDF output, past papers, tutor replies, etc. */
export async function saveGeneratedContent({ email, kind, subject, chapter, title, content, meta }) {
  const em = (email || "").trim().toLowerCase();
  if (!em || !kind || content == null || String(content).trim() === "") return;
  try {
    const res = await fetch(`${API_BASE}/save-generated`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: em,
        kind: String(kind).trim().toLowerCase(),
        subject: subject ? String(subject).trim() : null,
        chapter: chapter ? String(chapter).trim() : null,
        title: title ? String(title).slice(0, 220) : null,
        content: String(content),
        meta: meta && typeof meta === "object" ? meta : null,
      }),
    });
    if (!res.ok) console.warn("save-generated failed", res.status);
  } catch (e) {
    console.warn("saveGeneratedContent error", e);
  }
}

export async function fetchGeneratedHistory(email, opts = {}) {
  const em = (email || "").trim().toLowerCase();
  if (!em) return { error: "no email" };
  const limit = opts.limit || 200;
  let url = `${API_BASE}/generated-history?email=${encodeURIComponent(em)}&limit=${limit}`;
  if (opts.kind) url += `&kind=${encodeURIComponent(opts.kind)}`;
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

export async function fetchMcqHistory(email, subject) {
  const em = (email || "").trim().toLowerCase();
  if (!em) return { error: "no email" };
  let url = `${API_BASE}/mcq-history?email=${encodeURIComponent(em)}&limit=500`;
  if (subject) url += `&subject=${encodeURIComponent(subject)}`;
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

export async function fetchQuizAttempts(email, opts = {}) {
  const em = (email || "").trim().toLowerCase();
  if (!em) return { error: "no email" };
  const limit = opts.limit || 80;
  try {
    const res = await fetch(`${API_BASE}/quiz-attempts?email=${encodeURIComponent(em)}&limit=${limit}`);
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

export async function saveQuizAttempt(email, subject, chapter, scorePct, questions, answers) {
  const em = (email || "").trim().toLowerCase();
  if (!em || !Array.isArray(questions) || !questions.length) return;
  const responses = questions.map((q, i) => ({
    index: i,
    user_selected: answers[i] != null ? String(answers[i]) : null,
    correct_answer: q.answer != null ? String(q.answer) : null,
    question: String(q.q || q.question || "").slice(0, 500),
    options: Array.isArray(q.options) ? q.options : [],
  }));
  try {
    const res = await fetch(`${API_BASE}/record-quiz-attempt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: em,
        subject: String(subject || "").trim(),
        chapter: (chapter || "").trim() || null,
        score_pct: scorePct == null ? null : Number(scorePct),
        responses,
      }),
    });
    if (!res.ok) console.warn("record-quiz-attempt failed", res.status);
  } catch (e) {
    console.warn("saveQuizAttempt error", e);
  }
}
