import Signup from "./Signup";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { API_BASE } from "./apiConfig";
import {
  ExportPdfButton,
  PdfText,
  PdfMcqList,
  PdfFlashcardList,
  PdfStudyPlanBlocks,
  PdfChatTranscript,
  PdfQuizAttemptList,
} from "./PdfExport.jsx";

import Quiz from "./Quiz"; // Correct path for src/Quiz.jsx
import {
  pushAdaptiveProfile,
  saveMcqBatch,
  saveQuizAttempt,
  saveGeneratedContent,
  fetchPerformanceStats,
  fetchGeneratedHistory,
  fetchMcqHistory,
  fetchQuizAttempts,
  generateTextViaBackend,
} from "./adaptiveSync";

// ─── THEME & GLOBALS ───────────────────────────────────────────────────────
const COLORS = {
  bg: "#0a0e1a",
  bgCard: "#111827",
  bgCardHover: "#1a2235",
  border: "#1e2d45",
  accent: "#3b82f6",
  accentGlow: "#60a5fa",
  gold: "#f59e0b",
  green: "#10b981",
  red: "#ef4444",
  purple: "#8b5cf6",
  text: "#f1f5f9",
  textMuted: "#94a3b8",
  textDim: "#475569",
};

const SUBJECTS = {
  Matric: ["Physics", "Chemistry", "Biology", "Mathematics", "English", "Urdu", "Pakistan Studies", "Islamiat"],
  Intermediate: ["Physics", "Chemistry", "Biology", "Mathematics", "English", "Urdu", "Economics", "Computer Science"],
};

/** UI: sidebar, dashboard progress, performance tiles — only these, in this order (must exist for the class). */
const CORE_SUBJECTS = ["Physics", "Chemistry", "Biology", "Computer Science"];

function coreSubjectsForClass(classLevel) {
  const all = SUBJECTS[classLevel] || [];
  return CORE_SUBJECTS.filter((s) => all.includes(s));
}

/** Dashboard “Subject progress” + its avg — always these four (when class offers them). */
const DASHBOARD_SUBJECT_PROGRESS = ["Physics", "Chemistry", "English", "Biology"];

function dashboardProgressSubjects(classLevel) {
  const all = SUBJECTS[classLevel] || [];
  return DASHBOARD_SUBJECT_PROGRESS.filter((s) => all.includes(s));
}

const CHAPTERS = {
  Physics: ["Motion & Kinematics", "Forces & Newton's Laws", "Work, Energy & Power", "Waves & Sound", "Light & Optics", "Electricity & Magnetism", "Modern Physics"],
  Chemistry: ["Atomic Structure", "Chemical Bonding", "States of Matter", "Thermodynamics", "Electrochemistry", "Organic Chemistry", "Reaction Kinetics"],
  Mathematics: ["Sets & Functions", "Algebra", "Trigonometry", "Coordinate Geometry", "Calculus", "Statistics", "Probability"],
  Biology: ["Cell Biology", "Genetics", "Evolution", "Ecology", "Human Physiology", "Plant Biology", "Microbiology"],
  English: ["Grammar & Syntax", "Reading Comprehension", "Essay Writing", "Poetry Analysis", "Prose Literature", "Vocabulary"],
  "Computer Science": ["Programming Fundamentals", "Data Types & Variables", "Control Structures", "Functions", "Arrays & Lists", "Algorithms", "OOP Basics"],
  default: ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4", "Chapter 5"],
};

/** Last quiz performance for this subject (QuizPage `submit` / Quiz.jsx). */
function getAdaptiveStatus(subject) {
  if (!subject || typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(`status_${subject}`) || "";
  } catch {
    return "";
  }
}

function adaptiveApiFields(subject) {
  const learning_status = getAdaptiveStatus(subject);
  return learning_status ? { learning_status } : {};
}

/** Chroma `book_id` + folder `db_storage/{book_id}_db` — align with ingested textbooks. */
function ragBookIdFromSubject(subject) {
  const s = (subject || "").toLowerCase();
  if (s.includes("physics")) return "physics_9th";
  if (s.includes("biology")) return "biology_9th";
  if (s.includes("computer")) return "computer_9th";
  if (s.includes("chemistry")) return "chemistry_9th";
  if (s.includes("math")) return "mathematics_9th";
  return "physics_9th";
}

function libraryPdfChildren(it, parseStudyPlanBlocks) {
  if (it.kind === "flashcards") {
    try {
      const cards = JSON.parse(it.content);
      if (Array.isArray(cards)) return <PdfFlashcardList cards={cards} />;
    } catch (_) {}
  }
  if (it.kind === "study_plan") {
    const blocks = parseStudyPlanBlocks(it.content);
    if (blocks?.length) return <PdfStudyPlanBlocks blocks={blocks} />;
  }
  return <PdfText text={it.content || ""} />;
}

function pdfMetaLines(classLevel, subject, extra = []) {
  return [classLevel, subject, new Date().toLocaleString(), ...extra].filter(Boolean);
}

/**
 * One place for “subject performance %” on Dashboard + Performance.
 * Quiz last_score_pct wins; else soft estimate from saves + adaptive mastered.
 */
function computeSubjectPerformance(savedCount, adaptiveRow) {
  const saved = Number(savedCount) || 0;
  const ad = adaptiveRow;
  const hasQuiz = ad?.last_score_pct != null && ad.last_score_pct !== "";
  const masteredSub = ad?.status === "mastered";
  let pct;
  if (hasQuiz) {
    pct = Math.round(Number(ad.last_score_pct));
  } else if (masteredSub && saved < 8) {
    pct = Math.round(Math.min(85, 55 + saved * 3));
  } else {
    pct = Math.min(100, saved * 5);
  }
  const isEstimated = !hasQuiz;
  const tag = ad?.status
    ? ad.status + (masteredSub && !hasQuiz && saved < 8 ? " · few saves OK" : "")
    : saved
      ? "practice only"
      : "—";
  const barColor =
    hasQuiz || masteredSub
      ? pct > 70
        ? COLORS.green
        : pct > 50
          ? COLORS.gold
          : COLORS.red
      : pct < 15
        ? COLORS.textDim
        : pct > 70
          ? COLORS.green
          : pct > 50
            ? COLORS.gold
            : COLORS.red;
  return { pct, isEstimated, tag, saved, hasQuiz, masteredSub, barColor };
}

// ─── API CALL ──────────────────────────────────────────────────────────────
async function callClaude(messages, systemPrompt, maxTokens = 1000) {
  return generateTextViaBackend({ messages, systemPrompt, maxTokens });
}

// ─── STYLED COMPONENTS ────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${COLORS.bg}; color: ${COLORS.text}; font-family: 'Space Grotesk', sans-serif; min-height: 100vh; font-size: 16px; line-height: 1.55; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: ${COLORS.bg}; } ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 2px; }
  
  .app { display: flex; min-height: 100vh; }
  
  /* Sidebar */
  .sidebar { width: 240px; min-height: 100vh; background: ${COLORS.bgCard}; border-right: 1px solid ${COLORS.border}; display: flex; flex-direction: column; position: fixed; left: 0; top: 0; bottom: 0; z-index: 10; }
  .sidebar-logo { padding: 24px 20px 16px; border-bottom: 1px solid ${COLORS.border}; }
  .sidebar-logo h1 { font-size: 20px; font-weight: 700; background: linear-gradient(135deg, ${COLORS.accent}, ${COLORS.purple}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .sidebar-logo p { font-size: 12px; color: ${COLORS.textDim}; margin-top: 2px; font-family: 'JetBrains Mono', monospace; }
  .sidebar-nav { flex: 1; padding: 12px 0; overflow-y: auto; }
  .nav-section { padding: 8px 20px 4px; font-size: 11px; font-weight: 600; color: ${COLORS.textDim}; text-transform: uppercase; letter-spacing: 1px; }
  .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 20px; cursor: pointer; font-size: 14px; color: ${COLORS.textMuted}; transition: all 0.15s; border-left: 2px solid transparent; }
  .nav-item:hover { color: ${COLORS.text}; background: rgba(59,130,246,0.06); }
  .nav-item.active { color: ${COLORS.accent}; border-left-color: ${COLORS.accent}; background: rgba(59,130,246,0.08); }
  .nav-item .icon { width: 16px; text-align: center; font-size: 15px; }
  .sidebar-footer { padding: 16px 20px; border-top: 1px solid ${COLORS.border}; }
  .class-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); border-radius: 20px; padding: 4px 12px; font-size: 13px; color: ${COLORS.accent}; cursor: pointer; }

  /* Main */
  .main { margin-left: 240px; flex: 1; padding: 32px; min-height: 100vh; }
  .page-header { margin-bottom: 28px; }
  .page-title { font-size: 26px; font-weight: 700; color: ${COLORS.text}; line-height: 1.2; letter-spacing: -0.02em; }
  .page-sub { font-size: 14px; font-weight: 500; color: ${COLORS.textMuted}; margin-top: 4px; line-height: 1.45; }
  /* Same level everywhere: card / panel section titles */
  .heading-panel { font-size: 17px; font-weight: 600; color: ${COLORS.text}; line-height: 1.35; }
  /* Inline labels inside cards (e.g. performance tiles) */
  .heading-label { font-size: 14px; font-weight: 600; color: ${COLORS.text}; line-height: 1.35; }
  /* Long-form AI text — one size for all */
  .text-body { font-size: 16px; line-height: 1.7; color: ${COLORS.textMuted}; }

  /* Cards */
  .card { background: ${COLORS.bgCard}; border: 1px solid ${COLORS.border}; border-radius: 12px; padding: 20px; }
  .card-sm { padding: 14px 16px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  @media (max-width: 1100px) { .grid-4 { grid-template-columns: 1fr 1fr; } }

  /* Selectors */
  .select { background: ${COLORS.bg}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; border-radius: 8px; padding: 8px 12px; font-size: 14px; font-family: 'Space Grotesk', sans-serif; outline: none; cursor: pointer; transition: border 0.15s; }
  .select:focus { border-color: ${COLORS.accent}; }
  select option { background: ${COLORS.bgCard}; }

  /* Buttons */
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 18px; border-radius: 8px; font-size: 14px; font-weight: 500; font-family: 'Space Grotesk', sans-serif; cursor: pointer; border: none; transition: all 0.15s; }
  .btn-primary { background: ${COLORS.accent}; color: white; }
  .btn-primary:hover { background: ${COLORS.accentGlow}; transform: translateY(-1px); }
  .btn-primary:disabled { background: ${COLORS.textDim}; cursor: not-allowed; transform: none; }
  .btn-outline { background: transparent; border: 1px solid ${COLORS.border}; color: ${COLORS.textMuted}; }
  .btn-outline:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }
  .btn-gold { background: ${COLORS.gold}; color: #000; }
  .btn-gold:hover { background: #fbbf24; }
  .btn-sm { padding: 6px 12px; font-size: 13px; }

  /* Quiz */
  .quiz-question { font-size: 16px; font-weight: 500; line-height: 1.55; color: ${COLORS.text}; }
  .quiz-option { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border: 1px solid ${COLORS.border}; border-radius: 8px; cursor: pointer; transition: all 0.15s; margin-bottom: 8px; }
  .quiz-option:hover { border-color: ${COLORS.accent}; background: rgba(59,130,246,0.05); }
  .quiz-option.selected { border-color: ${COLORS.accent}; background: rgba(59,130,246,0.1); }
  .quiz-option.correct { border-color: ${COLORS.green}; background: rgba(16,185,129,0.1); }
  .quiz-option.wrong { border-color: ${COLORS.red}; background: rgba(239,68,68,0.1); }
  .opt-letter { width: 26px; height: 26px; border-radius: 50%; background: ${COLORS.border}; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0; margin-top: 1px; }
  .selected .opt-letter { background: ${COLORS.accent}; }
  .correct .opt-letter { background: ${COLORS.green}; }
  .wrong .opt-letter { background: ${COLORS.red}; }

  /* Chat */
  .chat-area { height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 16px; background: ${COLORS.bg}; border-radius: 8px; margin-bottom: 12px; }
  .msg { max-width: 85%; padding: 10px 14px; border-radius: 10px; font-size: 16px; line-height: 1.65; }
  .msg.user { align-self: flex-end; background: ${COLORS.accent}; color: white; border-bottom-right-radius: 2px; }
  .msg.ai { align-self: flex-start; background: ${COLORS.bgCard}; border: 1px solid ${COLORS.border}; border-bottom-left-radius: 2px; }
  .msg.ai .msg-header { font-size: 11px; color: ${COLORS.textDim}; margin-bottom: 4px; font-family: 'JetBrains Mono', monospace; }
  .chat-input-row { display: flex; gap: 8px; }
  .chat-input { flex: 1; background: ${COLORS.bg}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; border-radius: 8px; padding: 10px 14px; font-size: 14px; font-family: 'Space Grotesk', sans-serif; outline: none; resize: none; }
  .chat-input:focus { border-color: ${COLORS.accent}; }

  /* Notes */
  .note-area { background: ${COLORS.bg}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 16px; font-size: 16px; line-height: 1.7; color: ${COLORS.textMuted}; white-space: pre-wrap; min-height: 200px; max-height: 400px; overflow-y: auto; }

  /* Study Plan */
  .plan-day { border-left: 2px solid ${COLORS.accent}; padding: 12px 16px; margin-bottom: 12px; background: rgba(59,130,246,0.04); border-radius: 0 8px 8px 0; }
  .plan-day-title { font-size: 16px; font-weight: 600; color: ${COLORS.accent}; margin-bottom: 6px; line-height: 1.35; }
  .plan-day-tasks { font-size: 16px; color: ${COLORS.textMuted}; line-height: 1.65; }

  /* PDF Upload */
  .upload-zone { border: 2px dashed ${COLORS.border}; border-radius: 12px; padding: 40px; text-align: center; cursor: pointer; transition: all 0.2s; }
  .upload-zone:hover, .upload-zone.drag { border-color: ${COLORS.accent}; background: rgba(59,130,246,0.04); }
  .upload-zone p { color: ${COLORS.textMuted}; font-size: 14px; margin-top: 8px; }

  /* Performance */
  .stat-card { background: ${COLORS.bgCard}; border: 1px solid ${COLORS.border}; border-radius: 10px; padding: 16px; text-align: center; }
  .stat-value { font-size: 34px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
  .stat-label { font-size: 12px; color: ${COLORS.textDim}; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
  .progress-bar { height: 6px; background: ${COLORS.border}; border-radius: 3px; overflow: hidden; margin-top: 6px; }
  .progress-fill { height: 100%; border-radius: 3px; transition: width 0.6s ease; }
  .topic-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid ${COLORS.border}; }
  .topic-name { flex: 1; font-size: 16px; font-weight: 500; line-height: 1.4; }
  .topic-score { font-size: 14px; font-family: 'JetBrains Mono', monospace; color: ${COLORS.textMuted}; }

  /* Spinner */
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Tabs */
  .tabs { display: flex; gap: 4px; background: ${COLORS.bg}; border-radius: 8px; padding: 4px; margin-bottom: 20px; width: fit-content; }
  .tab { padding: 7px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; color: ${COLORS.textMuted}; transition: all 0.15s; }
  .tab.active { background: ${COLORS.bgCard}; color: ${COLORS.text}; border: 1px solid ${COLORS.border}; }

  /* Study Plan */
  .study-plan-config-grid { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(100px, 1fr) minmax(180px, 2fr); gap: 16px 20px; align-items: end; }
  @media (max-width: 720px) { .study-plan-config-grid { grid-template-columns: 1fr; } }
  .study-plan-actions { margin-top: 18px; display: flex; justify-content: flex-start; }
  .study-plan-blocks { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
  .study-plan-block {
    background: ${COLORS.bg};
    border: 1px solid ${COLORS.border};
    border-radius: 10px;
    padding: 14px 16px 14px 18px;
    border-left-width: 4px;
    border-left-style: solid;
  }
  .study-plan-block-h { font-size: 13px; font-weight: 600; color: ${COLORS.accentGlow}; letter-spacing: 0.02em; margin-bottom: 8px; }
  .study-plan-block-m { font-size: 15px; font-weight: 500; color: ${COLORS.text}; line-height: 1.45; margin-bottom: 6px; }
  .study-plan-block-f { font-size: 14px; color: ${COLORS.textMuted}; line-height: 1.5; }

  /* Flashcards (RAG) */
  .flash-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
  .flash-scene { perspective: 1000px; height: 200px; cursor: pointer; outline: none; }
  .flash-scene:focus-visible { box-shadow: 0 0 0 2px ${COLORS.accent}; border-radius: 14px; }
  .flash-card-inner { position: relative; width: 100%; height: 100%; transition: transform 0.55s ease; transform-style: preserve-3d; border-radius: 12px; }
  .flash-scene.flipped .flash-card-inner { transform: rotateY(180deg); }
  .flash-face { position: absolute; inset: 0; backface-visibility: hidden; border-radius: 12px; padding: 16px; border: 1px solid ${COLORS.border}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: ${COLORS.bgCard}; }
  .flash-face.back { transform: rotateY(180deg); background: ${COLORS.bg}; }
  .flash-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: ${COLORS.textDim}; margin-bottom: 8px; }
  .flash-text { font-size: 15px; font-weight: 500; color: ${COLORS.text}; line-height: 1.45; }

  /* Tag */
  .tag { display: inline-flex; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; font-family: 'JetBrains Mono', monospace; }
  .tag-blue { background: rgba(59,130,246,0.15); color: ${COLORS.accentGlow}; }
  .tag-green { background: rgba(16,185,129,0.15); color: ${COLORS.green}; }
  .tag-gold { background: rgba(245,158,11,0.15); color: ${COLORS.gold}; }
  .tag-red { background: rgba(239,68,68,0.15); color: ${COLORS.red}; }

  /* Alert */
  .alert { padding: 10px 14px; border-radius: 8px; font-size: 16px; line-height: 1.55; margin: 10px 0; }
  .alert-info { background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.25); color: ${COLORS.accentGlow}; }
  .alert-success { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); color: ${COLORS.green}; }
  .alert-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); color: ${COLORS.red}; }

  label { font-size: 13px; color: ${COLORS.textDim}; display: block; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
  hr { border: none; border-top: 1px solid ${COLORS.border}; margin: 16px 0; }
  textarea { font-family: 'Space Grotesk', sans-serif; }
`;

// ─── NAV CONFIG ────────────────────────────────────────────────────────────
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "⬡", section: "Overview" },
  { id: "quiz", label: "MCQ Quiz", icon: "◈", section: "Learn" },
  { id: "library", label: "My Library", icon: "📚", section: "Learn" },
  { id: "tutor", label: "AI Tutor", icon: "◎", section: "Learn" },
  { id: "notes", label: "Smart Notes", icon: "◻", section: "Learn" },
  { id: "plan", label: "Study Plan", icon: "◷", section: "Learn" },
  { id: "flashcards", label: "Flashcards", icon: "▤", section: "Learn" },
  { id: "pdf", label: "PDF Summarizer", icon: "◆", section: "Tools" },
  { id: "performance", label: "Performance", icon: "◉", section: "Analytics" },
  { id: "pastpapers", label: "Past Papers AI", icon: "◐", section: "Analytics" },
];

// ─── DASHBOARD ─────────────────────────────────────────────────────────────
function Dashboard({ classLevel, subject, onNavigate, userEmail }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!userEmail) return;
    let cancel = false;
    (async () => {
      const d = await fetchPerformanceStats(userEmail, null);
      if (!cancel && d && !d.error) setStats(d);
    })();
    return () => {
      cancel = true;
    };
  }, [userEmail]);

  const total = stats?.total_mcqs ?? "—";
  const week = stats?.mcqs_this_week ?? "—";
  const avgQuiz =
    stats?.avg_last_quiz_pct != null ? `${stats.avg_last_quiz_pct}%` : "—";
  const subjectsHit = stats?.by_subject?.length ?? 0;
  const dashboardSubs = dashboardProgressSubjects(classLevel);
  const subsAll = Math.max(1, dashboardSubs.length);
  const mastered = (stats?.adaptive_by_subject || []).filter((r) => r.status === "mastered").length;

  const bySub = Object.fromEntries((stats?.by_subject || []).map((r) => [r.subject, r]));
  const byAd = Object.fromEntries((stats?.adaptive_by_subject || []).map((r) => [r.subject, r]));
  const subsList = dashboardSubs;
  const classAvgPerf =
    subsList.length > 0
      ? Math.round(
          subsList.reduce((acc, sub) => {
            const row = bySub[sub] || { saved_count: 0 };
            return acc + computeSubjectPerformance(row.saved_count, byAd[sub]).pct;
          }, 0) / subsList.length
        )
      : null;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Welcome back 👋</div>
        <div className="page-sub">{classLevel} · {subject} · Today is a great day to study</div>
      </div>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        {[
          { label: "MCQs saved (all time)", value: String(total), color: COLORS.accent, tag: `This week: ${week}` },
          {
            label: "Avg subject performance (class)",
            value: classAvgPerf != null ? `${classAvgPerf}%` : "—",
            color:
              classAvgPerf == null
                ? COLORS.textDim
                : classAvgPerf >= 70
                  ? COLORS.green
                  : classAvgPerf >= 50
                    ? COLORS.gold
                    : COLORS.red,
            tag: `Same formula as list below · quiz-only avg: ${avgQuiz}`,
          },
          { label: "Subjects with data", value: `${subjectsHit}/${subsAll}`, color: COLORS.gold, tag: `Strong (mastered): ${mastered}` },
        ].map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <div style={{ marginTop: 6 }}><span className="tag tag-blue">{s.tag}</span></div>
          </div>
        ))}
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="heading-panel" style={{ marginBottom: 14 }}>Quick Actions</div>
          {[
            { label: "Generate 10 MCQs", page: "quiz", icon: "◈" },
            { label: "My Library (saved work)", page: "library", icon: "📚" },
            { label: "Ask AI Tutor", page: "tutor", icon: "◎" },
            { label: "Summarize PDF", page: "pdf", icon: "◆" },
            { label: "Get Study Plan", page: "plan", icon: "◷" },
            { label: "RAG Flashcards", page: "flashcards", icon: "▤" },
          ].map((a) => (
            <div key={a.page} onClick={() => onNavigate(a.page)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer", color: COLORS.textMuted, fontSize: 14 }}
              onMouseEnter={e => e.currentTarget.style.color = COLORS.accent}
              onMouseLeave={e => e.currentTarget.style.color = COLORS.textMuted}>
              <span style={{ fontSize: 16 }}>{a.icon}</span> {a.label}
              <span style={{ marginLeft: "auto", fontSize: 13 }}>→</span>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="heading-panel" style={{ marginBottom: 14 }}>Subject progress</div>
          {dashboardSubs.map((sub) => {
            const row = bySub[sub] || { saved_count: 0 };
            const ad = byAd[sub];
            const perf = computeSubjectPerformance(row.saved_count, ad);
            return (
              <div key={sub} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, marginBottom: 4 }}>
                  <span style={{ color: COLORS.textMuted }}>{sub}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: perf.barColor }}>
                    {perf.isEstimated ? `${perf.pct}%*` : `${perf.pct}%`}
                  </span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: perf.pct + "%", background: perf.barColor }} />
                </div>
                <div className="text-body" style={{ fontSize: 14, marginTop: 2 }}>{perf.tag} · saved {perf.saved}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── MCQ QUIZ ──────────────────────────────────────────────────────────────
function QuizPage({ classLevel, subject, userEmail, importPack, onImportConsumed, onStartQuiz: _onStartQuiz }) {
  const [chapter, setChapter] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(null);
  const [explanation, setExplanation] = useState("");
  const [expLoading, setExpLoading] = useState(false);
  const chapters = CHAPTERS[subject] || CHAPTERS.default;

  useEffect(() => {
    const st = getAdaptiveStatus(subject);
    if (st === "struggling") setDifficulty("easy");
    else if (st === "improving") setDifficulty("medium");
    else if (st === "mastered") setDifficulty("hard");
  }, [subject]);

  useEffect(() => {
    if (!importPack?.questions?.length) return;
    setChapter(importPack.chapter || "");
    setQuestions(importPack.questions);
    setAnswers({});
    setSubmitted(false);
    setScore(null);
    setExplanation("");
    onImportConsumed?.();
  }, [importPack, onImportConsumed]);

const persistMcqs = async (mcqs) => {
    const emailToUse = (userEmail || "").trim() || localStorage.getItem("userEmail");
    if (!emailToUse || emailToUse === "undefined") {
      console.error("❌ Email missing for save-mcq");
      return;
    }
    await saveMcqBatch(emailToUse, subject, chapter, mcqs);
};
 

const generateQuiz = async () => {
    if (!chapter) return;
    setLoading(true);

    // Resetting old states
    setQuestions([]);
    setAnswers({});
    setSubmitted(false);
    setScore(null);
    setExplanation("");

    try {
        const res = await fetch(`${API_BASE}/generate-mcqs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chapter: chapter,
                book_id: `${subject.toLowerCase()}_9th`,
                num_questions: count,
                difficulty,
                ...adaptiveApiFields(subject),
            })
        });
        
        const data = await res.json();

        // 🔥 AGAR FLASK MEIN KOI ERROR HAI TO YE CHALEGA
        if (!res.ok) {
            // Ab aapko alert mein asli wajah nazar aayegi (e.g. API key issue or get_context error)
            throw new Error(data.error || `Server Error: ${res.status}`);
        }

        const rawText = data.questions;
        
        // 🔍 Check if rawText exists before calling indexOf
        if (!rawText) {
            throw new Error("Backend response is empty!");
        }

        const start = rawText.indexOf("[");
        const end = rawText.lastIndexOf("]") + 1;
        
        if (start === -1 || end === 0) {
            throw new Error("AI returned text but no JSON list found.");
        }

        const cleanJson = rawText.slice(start, end);
        const parsed = JSON.parse(cleanJson);
        
        setQuestions(parsed);
        persistMcqs(parsed);

    } catch (e) {
        console.error("Quiz Error Detail:", e);
        // Ab aapko "Failed to generate quiz" ki bajaye asli error dikhega
        alert(`⚠️ Quiz Error: ${e.message}`); 
    } finally {
        setLoading(false);
    }
};
  const submit = () => {
    let correct = 0;
    questions.forEach((q, i) => { 
      if (answers[i] === q.answer) correct++; 
    });
    
    const finalScore = correct;
    setScore(finalScore);
    setSubmitted(true);

    // --- ADAPTIVE LEARNING LOGIC ---
    const percentage = (finalScore / questions.length) * 100;
    let status = "mastered";
    
    if (percentage < 50) status = "struggling";
    else if (percentage < 80) status = "improving";

    // Save this to memory so the Tutor can see it later
    localStorage.setItem(`status_${subject}`, status);
    console.log(`Student status for ${subject}: ${status}`);
    const em = (userEmail || "").trim() || localStorage.getItem("userEmail");
    pushAdaptiveProfile(em, subject, status, percentage);
    saveQuizAttempt(em, subject, chapter, percentage, questions, answers);
  };
  const explainWrong = async () => {
    const wrong = questions.filter((q, i) => answers[i] !== q.answer);
    if (!wrong.length) { setExplanation("Perfect score! No wrong answers to explain."); return; }
    setExpLoading(true);
    try {
      const txt = await callClaude(
        [{ role: "user", content: `Explain these wrong answers for a ${classLevel} student:\n${wrong.map(q => `Q: ${q.q}\nCorrect: ${q.answer}\nExplanation: ${q.explanation}`).join("\n\n")}` }],
        "You are a helpful Pakistani curriculum teacher. Give clear, simple explanations in English. Be encouraging.",
        1500
      );
      setExplanation(txt);
    } catch (e) { setExplanation("Could not load explanation."); }
    setExpLoading(false);
  };

  const optLabel = ["A", "B", "C", "D"];

  return (
    <div>
      <div className="page-header"><div className="page-title">MCQ Quiz Generator</div>
        <div className="page-sub">AI-generated chapter-wise quizzes · {subject}</div></div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label>Chapter</label>
            <select className="select" value={chapter} onChange={e => setChapter(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">Select chapter</option>
              {chapters.map(c => <option key={c}>{c}</option>)}
            </select></div>
          <div><label>Difficulty</label>
            <select className="select" value={difficulty} onChange={e => setDifficulty(e.target.value)}>
              <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </select></div>
          <div><label>Questions</label>
            <select className="select" value={count} onChange={e => setCount(+e.target.value)}>
              {[5, 10, 15, 20].map(n => <option key={n}>{n}</option>)}
            </select></div>
          <button className="btn btn-primary" onClick={generateQuiz} disabled={!chapter || loading}>
            {loading ? <><span className="spinner" /> Generating…</> : "⚡ Generate Quiz"}
          </button>
        </div>
        <div style={{ fontSize: 13, color: COLORS.textDim, marginTop: 10 }}>
          Sets are saved to the server. Open <strong>My Library</strong> to review or practise again; Submit stores your
          chosen answers.
        </div>
      </div>

      {questions.length > 0 && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <div className="heading-panel">{chapter} · {questions.length} Questions</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="tag tag-blue">{difficulty}</span>
                <ExportPdfButton
                  title={`Quiz · ${chapter}`}
                  filename={`quiz-${subject}-${chapter}`}
                  metaLines={pdfMetaLines(classLevel, subject, [
                    chapter,
                    difficulty,
                    submitted && score != null ? `Score: ${score}/${questions.length}` : null,
                  ])}
                >
                  <PdfMcqList questions={questions} showAnswers={submitted} />
                  {submitted && explanation ? (
                    <>
                      <div style={{ marginTop: 14, fontWeight: 600 }}>Wrong-answer explanations</div>
                      <PdfText text={explanation} />
                    </>
                  ) : null}
                </ExportPdfButton>
              </div>
            </div>
            {questions.map((q, qi) => (
              <div key={qi} style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${COLORS.border}` }}>
               <div className="quiz-question" style={{ marginBottom: 12 }}>
  <span style={{ color: COLORS.textDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
    Q{qi + 1}. 
  </span>
  {/* Change q.q to q.question if your backend uses that name */}
  {q.q || q.question} 
</div>
                {q.options.map((opt, oi) => {
                  const letter = optLabel[oi];
                  let cls = "quiz-option";
                  if (submitted) {
                    if (letter === q.answer) cls += " correct";
                    else if (answers[qi] === letter && letter !== q.answer) cls += " wrong";
                  } else if (answers[qi] === letter) cls += " selected";
                  return (
                    <div key={oi} className={cls} onClick={() => !submitted && setAnswers(a => ({ ...a, [qi]: letter }))}>
                      <div className="opt-letter">{letter}</div>
                      <div className="text-body" style={{ color: COLORS.text }}>{opt.replace(/^[ABCD]\)\s*/, "")}</div>
                    </div>
                  );
                })}
                {submitted && q.explanation && (
                  <div className="alert alert-info" style={{ marginTop: 8 }}>💡 {q.explanation}</div>
                )}
              </div>
            ))}
            {!submitted ? (
              <button className="btn btn-gold" onClick={submit} disabled={Object.keys(answers).length < questions.length}>
                Submit Answers ({Object.keys(answers).length}/{questions.length})
              </button>
            ) : (
              <div>
                <div className="alert alert-success" style={{ marginBottom: 12 }}>
                  ✅ Score: <strong>{score}/{questions.length}</strong> ({Math.round(score / questions.length * 100)}%)
                  {score === questions.length ? " — Perfect! 🎉" : score >= questions.length * 0.7 ? " — Great job!" : " — Keep practicing!"}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" onClick={generateQuiz}>🔄 New Quiz</button>
                  {score < questions.length && (
                    <button className="btn btn-outline" onClick={explainWrong} disabled={expLoading}>
                      {expLoading ? <><span className="spinner" style={{ borderColor: "rgba(148,163,184,0.3)", borderTopColor: COLORS.textMuted }} /> Explaining…</> : "📖 Explain Wrong Answers"}
                    </button>
                  )}
                </div>
                {explanation && <div className="note-area" style={{ marginTop: 12 }}>{explanation}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AI TUTOR (UPDATED FOR FLASK) ──────────────────────────────────────────
function TutorPage({ classLevel, subject, userEmail }) {
  const [messages, setMessages] = useState([
    { role: "ai", text: `Assalam o Alaikum! I'm your MindSpring AI tutor for ${classLevel} ${subject}. Ask me anything about your textbook! 📚` }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chapter, setChapter] = useState("All chapters");
  const chatRef = useRef(null);

  useEffect(() => { 
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; 
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setInput("");
    setLoading(true);

    try {
      // THIS CALLS YOUR FLASK BACKEND
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          book_id: subject.toLowerCase() === "biology" ? "biology_9th" : "physics_10",
          ...adaptiveApiFields(subject),
        }),
      });

      const data = await response.json();

      if (data.reply) {
        setMessages(prev => [...prev, { role: "ai", text: data.reply }]);
        const em = (userEmail || "").trim() || localStorage.getItem("userEmail");
        if (em) {
          saveGeneratedContent({
            email: em,
            kind: "tutor_reply",
            subject,
            chapter: chapter !== "All chapters" ? chapter : null,
            title: userMsg.slice(0, 120),
            content: data.reply,
            meta: { question: userMsg.slice(0, 800), classLevel },
          });
        }
      } else {
        throw new Error("No reply from AI");
      }

    } catch (error) {
      console.error("Connection Error:", error);
      setMessages(prev => [...prev, { 
        role: "ai", 
        text: "I'm having trouble connecting to the MindSpring brain. Please make sure your Python server (app.py) is running!" 
      }]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions = ["What is a cell?", "Define Newton's First Law", "Summarize this chapter", "Help me with a practice question"];

  return (
    <div>
      <div className="page-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="page-title">AI Tutor</div>
            <div className="page-sub">Retrieval-Augmented Generation · Ask anything about {subject}</div>
          </div>
          {messages.length > 1 ? (
            <ExportPdfButton
              title={`AI Tutor · ${subject}`}
              filename={`tutor-${subject}`}
              metaLines={pdfMetaLines(classLevel, subject)}
            >
              <PdfChatTranscript messages={messages} />
            </ExportPdfButton>
          ) : null}
        </div>
      </div>
      <div className="card">
        <div className="chat-area" ref={chatRef}>
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.role === "ai" && <div className="msg-header">MindSpring AI · {subject}</div>}
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{m.text}</div>
            </div>
          ))}
          {loading && (
            <div className="msg ai">
              <div className="msg-header">MindSpring is reading your textbook…</div>
              <span className="spinner" style={{ borderColor: `rgba(148,163,184,0.3)`, borderTopColor: COLORS.accent }} />
            </div>
          )}
        </div>
        
        <div style={{ marginBottom: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {suggestions.map(s => (
            <button key={s} className="btn btn-outline btn-sm" onClick={() => setInput(s)} style={{ fontSize: 13 }}>{s}</button>
          ))}
        </div>

        <div className="chat-input-row">
          <textarea 
            className="chat-input" 
            rows={2} 
            placeholder="Type your question here..." 
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} 
          />
          <button className="btn btn-primary" onClick={send} disabled={!input.trim() || loading} style={{ alignSelf: "flex-end" }}>
            {loading ? <span className="spinner" /> : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SMART NOTES ────────────────────────────────────────────────────────────
function NotesPage({ classLevel, subject, userEmail }) {
  const [chapter, setChapter] = useState("");
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState("summary");
  const chapters = CHAPTERS[subject] || CHAPTERS.default;

  const generate = async () => {
    if (!chapter) return;
    setLoading(true); setNotes("");
    const st = getAdaptiveStatus(subject);
    const adaptiveLead =
      st === "struggling"
        ? "[Adaptive: student is struggling — simplest notes, extra scaffolding, short sentences.]\n\n"
        : st === "improving"
          ? "[Adaptive: student is improving — standard depth, clear exam focus.]\n\n"
          : st === "mastered"
            ? "[Adaptive: student is strong — allow concise density and links between ideas.]\n\n"
            : "";
    const prompts = {
      summary: `Write comprehensive study notes for ${classLevel} ${subject} — "${chapter}". Include key concepts, definitions, important formulas, and bullet-point explanations. Pakistan BISE curriculum.`,
      keypoints: `List the most important key points for ${classLevel} ${subject} — "${chapter}" for BISE exam. Number each point. Focus on frequently tested concepts.`,
      formulas: `List all important formulas, equations, and definitions for ${classLevel} ${subject} — "${chapter}". Format clearly with the formula name, the formula itself, and what each symbol means.`,
      mindmap: `Create a structured text mind map for ${classLevel} ${subject} — "${chapter}". Use indentation and symbols (→, •, ◦) to show relationships between concepts.`,
    };
    try {
      const txt = await callClaude(
        [{ role: "user", content: adaptiveLead + prompts[mode] }],
        `You are an expert ${classLevel} teacher in Pakistan's BISE curriculum. Generate clear, concise, exam-focused notes.`,
        1500
      );
      setNotes(txt);
      const em = (userEmail || "").trim() || localStorage.getItem("userEmail");
      if (em && txt && !txt.startsWith("Error")) {
        saveGeneratedContent({
          email: em,
          kind: "notes",
          subject,
          chapter,
          title: `${mode} · ${chapter}`,
          content: txt,
          meta: { mode, classLevel },
        });
      }
    } catch { setNotes("Error generating notes. Please try again."); }
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header"><div className="page-title">Smart Notes</div>
        <div className="page-sub">AI-generated chapter notes · {subject}</div></div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label>Chapter</label>
            <select className="select" value={chapter} onChange={e => setChapter(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">Select chapter</option>
              {chapters.map(c => <option key={c}>{c}</option>)}
            </select></div>
          <div><label>Note Type</label>
            <select className="select" value={mode} onChange={e => setMode(e.target.value)}>
              <option value="summary">Full Summary</option>
              <option value="keypoints">Key Points</option>
              <option value="formulas">Formulas & Definitions</option>
              <option value="mindmap">Mind Map</option>
            </select></div>
          <button className="btn btn-primary" onClick={generate} disabled={!chapter || loading}>
            {loading ? <><span className="spinner" /> Generating…</> : "📝 Generate Notes"}
          </button>
        </div>
      </div>
      {notes && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="heading-panel">{chapter} · {mode === "summary" ? "Summary" : mode === "keypoints" ? "Key Points" : mode === "formulas" ? "Formulas" : "Mind Map"}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(notes)}>📋 Copy</button>
              <ExportPdfButton
                title={`${chapter} · Notes`}
                filename={`notes-${subject}-${chapter}`}
                metaLines={pdfMetaLines(classLevel, subject, [chapter, mode])}
              >
                <PdfText text={notes} />
              </ExportPdfButton>
            </div>
          </div>
          <div className="note-area">{notes}</div>
        </div>
      )}
    </div>
  );
}

// ─── STUDY PLAN ─────────────────────────────────────────────────────────────
const STUDY_PLAN_ACCENT_COLORS = [COLORS.accent, COLORS.purple, COLORS.green, COLORS.gold];

function parseStudyPlanBlocks(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i;
  const m = s.match(fence);
  if (m) s = m[1].trim();
  const brace = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (brace !== -1 && last > brace) s = s.slice(brace, last + 1);
  try {
    const data = JSON.parse(s);
    const arr = data.blocks ?? data.items ?? data.plan;
    if (!Array.isArray(arr) || !arr.length) return null;
    const blocks = arr
      .map((b) => ({
        header: String(b.header ?? b.period ?? b.title ?? "").trim(),
        main: String(b.main ?? b.body ?? b.summary ?? b.description ?? "").trim(),
        focus: String(b.focus ?? b.sub ?? b.note ?? "").trim(),
      }))
      .filter((b) => b.header || b.main);
    return blocks.length ? blocks : null;
  } catch {
    return null;
  }
}

function StudyPlanPage({ classLevel, subject, userEmail }) {
  const [weeks, setWeeks] = useState(4);
  const [hoursPerDay, setHoursPerDay] = useState(2);
  const [weakTopics, setWeakTopics] = useState("");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState("");
  const [planBlocks, setPlanBlocks] = useState(null);
  const [tab, setTab] = useState("weekly");

  const generate = async () => {
    setLoading(true);
    setPlan("");
    setPlanBlocks(null);
    const ast = getAdaptiveStatus(subject);
    const adaptPlan =
      ast === "struggling"
        ? `Recent quiz profile for ${subject}: struggling — add more revision, shorter daily blocks, and basics-first sequencing. `
        : ast === "improving"
          ? `Recent quiz profile for ${subject}: improving — balance new topics with weekly review. `
          : ast === "mastered"
            ? `Recent quiz profile for ${subject}: strong — can include stretch goals and past-paper style blocks. `
            : "";
    const scope = tab === "monthly" ? "monthly (organize by weeks within the month)" : "weekly";
    const userAsk = `${adaptPlan}Create a ${scope} study plan for ${classLevel} ${subject}. Duration: ${weeks} weeks. Study time: ${hoursPerDay} hours/day. Weak topics: ${weakTopics || "none specified"}. Pakistan BISE exam.`;
    try {
      const txt = await callClaude(
        [{ role: "user", content: userAsk }],
        `You are an expert academic planner for Pakistani matric/intermediate students.
Return ONLY valid JSON (no markdown outside the JSON). Use this exact shape:
{"blocks":[{"header":"Week 1 • Mon-Wed","main":"Topic — concrete tasks (read chapters, MCQs, numericals)","focus":"Focus: one line on emphasis or weak-area work"}]}
Rules:
- Provide ${Math.min(12, Math.max(4, Math.ceil(weeks * 1.5)))} blocks covering all ${weeks} weeks logically.
- Headers like "Week 1 • Mon-Wed" or "Week 2 • Thu-Sun" (realistic day ranges).
- "main": one clear line per block (chapters, tasks, past papers as appropriate).
- "focus": optional extra line; prefix with "Focus: " when giving a tip.
- Weave weak topics into relevant weeks with slightly more time where needed.
- Be practical, exam-oriented, and motivating.`,
        2200
      );
      setPlan(txt);
      setPlanBlocks(parseStudyPlanBlocks(txt));
      const em = (userEmail || "").trim() || localStorage.getItem("userEmail");
      if (em && txt && !txt.startsWith("Error")) {
        saveGeneratedContent({
          email: em,
          kind: "study_plan",
          subject,
          chapter: null,
          title: `${tab} plan · ${weeks} weeks`,
          content: txt,
          meta: { tab, weeks, hoursPerDay, weakTopics, classLevel },
        });
      }
    } catch {
      setPlan("Error generating plan. Please try again.");
      setPlanBlocks(null);
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Study Plan</div>
        <div className="page-sub">AI-powered personalized study schedules · {subject}</div>
      </div>
      <div className="tabs">
        {[
          { id: "weekly", label: "Weekly Plan" },
          { id: "monthly", label: "Monthly Plan" },
        ].map((t) => (
          <div
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setTab(t.id)}
          >
            {t.label}
          </div>
        ))}
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="study-plan-config-grid">
          <div>
            <label>Duration</label>
            <select className="select" value={weeks} onChange={(e) => setWeeks(+e.target.value)} style={{ width: "100%", minWidth: 0 }}>
              {[2, 4, 6, 8, 12].map((w) => (
                <option key={w} value={w}>
                  {w} weeks
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Hours/day</label>
            <select className="select" value={hoursPerDay} onChange={(e) => setHoursPerDay(+e.target.value)} style={{ width: "100%", minWidth: 0 }}>
              {[1, 2, 3, 4, 5, 6].map((h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Weak topics</label>
            <input
              type="text"
              className="select"
              style={{ width: "100%" }}
              placeholder="e.g. Trigonometry, Optics"
              value={weakTopics}
              onChange={(e) => setWeakTopics(e.target.value)}
            />
          </div>
        </div>
        <div className="study-plan-actions">
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" /> Generating…
              </>
            ) : (
              <>📅 Generate Plan</>
            )}
          </button>
        </div>
      </div>
      {plan && !plan.startsWith("Error") && (planBlocks?.length ? (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
            <div className="heading-panel">{weeks}-Week {subject} Study Plan</div>
            <ExportPdfButton
              title={`${weeks}-Week Study Plan · ${subject}`}
              filename={`study-plan-${subject}`}
              metaLines={pdfMetaLines(classLevel, subject, [`${tab} · ${hoursPerDay}h/day`, weakTopics ? `Weak: ${weakTopics}` : null])}
            >
              <PdfStudyPlanBlocks blocks={planBlocks} />
            </ExportPdfButton>
          </div>
          <div className="study-plan-blocks">
            {planBlocks.map((b, i) => (
              <div
                key={i}
                className="study-plan-block"
                style={{ borderLeftColor: STUDY_PLAN_ACCENT_COLORS[i % STUDY_PLAN_ACCENT_COLORS.length] }}
              >
                {b.header ? <div className="study-plan-block-h">{b.header}</div> : null}
                {b.main ? <div className="study-plan-block-m">{b.main}</div> : null}
                {b.focus ? <div className="study-plan-block-f">{b.focus}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div className="heading-panel">{weeks}-Week {subject} Study Plan</div>
            <ExportPdfButton
              title={`${weeks}-Week Study Plan · ${subject}`}
              filename={`study-plan-${subject}`}
              metaLines={pdfMetaLines(classLevel, subject, [`${tab} · ${hoursPerDay}h/day`])}
            >
              <PdfText text={plan} />
            </ExportPdfButton>
          </div>
          <div className="note-area">{plan}</div>
        </div>
      ))}
      {plan && plan.startsWith("Error") && (
        <div className="card">
          <div className="alert alert-error">{plan}</div>
        </div>
      )}
    </div>
  );
}

// ─── FLASHCARDS (RAG: Chroma + same embedder as tutor/MCQ) ──────────────────
function FlashcardTile({ front, back }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      className={`flash-scene ${flipped ? "flipped" : ""}`}
      onClick={() => setFlipped((f) => !f)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setFlipped((f) => !f);
        }
      }}
      aria-label="Flip flashcard"
    >
      <div className="flash-card-inner">
        <div className="flash-face front">
          <span className="flash-label">Front</span>
          <div className="flash-text">{front}</div>
          <span style={{ marginTop: 12, fontSize: 12, color: COLORS.textDim }}>Tap to flip</span>
        </div>
        <div className="flash-face back">
          <span className="flash-label">Back</span>
          <div className="flash-text">{back}</div>
        </div>
      </div>
    </div>
  );
}

function FlashcardsPage({ classLevel, subject, userEmail }) {
  const chapters = CHAPTERS[subject] || CHAPTERS.default;
  const [topic, setTopic] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [count, setCount] = useState(5);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const effectiveTopic = (customTopic || "").trim() || topic;

  const generate = async () => {
    if (!effectiveTopic) {
      setError("Pick a chapter from the list or type a custom topic.");
      return;
    }
    setLoading(true);
    setError("");
    setCards([]);
    try {
      const res = await fetch(`${API_BASE}/generate-flashcards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: effectiveTopic,
          book_id: ragBookIdFromSubject(subject),
          count,
          ...adaptiveApiFields(subject),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      const list = data.cards || [];
      if (!list.length) throw new Error(data.error || "No cards returned.");
      setCards(list);
      const em = (userEmail || "").trim() || localStorage.getItem("userEmail");
      if (em) {
        saveGeneratedContent({
          email: em,
          kind: "flashcards",
          subject,
          chapter: effectiveTopic,
          title: `Flashcards · ${effectiveTopic}`,
          content: JSON.stringify(list),
          meta: { count: list.length, book_id: data.book_id, classLevel },
        });
      }
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Flashcards</div>
        <div className="page-sub">
          Textbook-grounded cards  · {classLevel} · {subject}
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          className="study-plan-config-grid"
          style={{ gridTemplateColumns: "minmax(160px,1.2fr) minmax(100px,0.8fr) minmax(180px,1.5fr)" }}
        >
          <div>
            <label>Chapter / unit</label>
            <select className="select" value={topic} onChange={(e) => setTopic(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select chapter…</option>
              {chapters.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Card count</label>
            <select className="select" value={count} onChange={(e) => setCount(+e.target.value)} style={{ width: "100%" }}>
              {[3, 5, 7, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Custom topic (optional)</label>
            <input
              className="select"
              style={{ width: "100%" }}
              placeholder="If filled, this overrides the chapter above"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
            />
          </div>
        </div>
        <div className="study-plan-actions">
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" /> Building cards…
              </>
            ) : (
              <>▤ Generate flashcards</>
            )}
          </button>
        </div>
        {error ? (
          <div className="alert alert-error" style={{ marginTop: 14 }}>
            {error}
          </div>
        ) : null}
      </div>
      {cards.length > 0 ? (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div className="heading-panel">{effectiveTopic} · {cards.length} cards</div>
            <ExportPdfButton
              title={`Flashcards · ${effectiveTopic}`}
              filename={`flashcards-${subject}`}
              metaLines={pdfMetaLines(classLevel, subject, [effectiveTopic, `${cards.length} cards`])}
            >
              <PdfFlashcardList cards={cards} />
            </ExportPdfButton>
          </div>
          <div className="flash-grid">
            {cards.map((c, i) => (
              <FlashcardTile key={i} front={c.front} back={c.back} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── PDF SUMMARIZER ─────────────────────────────────────────────────────────
function PDFPage({ classLevel, subject, userEmail }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState("");
  const [mode, setMode] = useState("summary");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef();

  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => setText(e.target.result);
    reader.readAsText(file);
  };

  const analyze = async () => {
    if (!text.trim()) return;
    setLoading(true); setSummary("");
    const prompts = {
      summary: "Summarize this text for a Pakistani student. Highlight key concepts, important points, and anything likely to appear in BISE exams.",
      notes: "Convert this text into structured study notes with headings, bullet points, and key terms highlighted.",
      questions: "Generate 10 MCQ practice questions based on this text content for a Pakistani student exam.",
      simplify: "Rewrite this content in simple, easy-to-understand English suitable for a Pakistani matric/intermediate student.",
    };
    try {
      const truncated = text.slice(0, 8000);
      const res = await callClaude(
        [{ role: "user", content: `${prompts[mode]}\n\nText:\n${truncated}` }],
        `You are an expert ${classLevel} ${subject} teacher. Analyze educational content for Pakistani BISE students.`,
        2000
      );
      setSummary(res);
      const em = (userEmail || "").trim() || localStorage.getItem("userEmail");
      if (em && res && !res.startsWith("Error")) {
        saveGeneratedContent({
          email: em,
          kind: "pdf_summary",
          subject,
          chapter: null,
          title: `Text analysis · ${mode}`,
          content: res,
          meta: { mode, classLevel, sourceChars: text.length },
        });
      }
    } catch { setSummary("Error processing text. Please try again."); }
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header"><div className="page-title">PDF Summarizer</div>
        <div className="page-sub">Paste text or upload a file — AI will analyze it instantly</div></div>
      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <label>Paste Text or Upload File</label>
          <div className={`upload-zone ${drag ? "drag" : ""}`}
            style={{ marginBottom: 12 }}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current.click()}>
            <div style={{ fontSize: 24 }}>📄</div>
            <p>Drag & drop a .txt file or click to upload</p>
            <input ref={fileRef} type="file" accept=".txt,.md" style={{ display: "none" }} onChange={e => readFile(e.target.files[0])} />
          </div>
          <label>Or paste text directly</label>
          <textarea className="chat-input" rows={8} style={{ width: "100%", marginBottom: 12 }}
            placeholder="Paste your chapter text, notes, or any educational content here..."
            value={text} onChange={e => setText(e.target.value)} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select className="select" value={mode} onChange={e => setMode(e.target.value)}>
              <option value="summary">Summarize</option>
              <option value="notes">Convert to Notes</option>
              <option value="questions">Generate Questions</option>
              <option value="simplify">Simplify Language</option>
            </select>
            <button className="btn btn-primary" onClick={analyze} disabled={!text.trim() || loading}>
              {loading ? <><span className="spinner" /> Analyzing…</> : "🔍 Analyze"}
            </button>
          </div>
          {text && <div style={{ marginTop: 8, fontSize: 13, color: COLORS.textDim }}>{text.length.toLocaleString()} characters · {Math.ceil(text.length / 4).toLocaleString()} tokens est.</div>}
        </div>
        <div className="card">
          <label>AI Output</label>
          {summary ? (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(summary)}>📋 Copy</button>
                <ExportPdfButton
                  title={`Text analysis · ${mode}`}
                  filename={`pdf-analysis-${subject}`}
                  metaLines={pdfMetaLines(classLevel, subject, [mode])}
                >
                  <PdfText text={summary} />
                </ExportPdfButton>
              </div>
              <div className="note-area" style={{ maxHeight: 460 }}>{summary}</div>
            </>
          ) : (
            <div style={{ color: COLORS.textDim, fontSize: 14, marginTop: 20, textAlign: "center", padding: 40 }}>
              📥 Paste or upload content on the left, then click Analyze
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PERFORMANCE ─────────────────────────────────────────────────────────────
function PerformancePage({ classLevel, subject, userEmail, onSelectSubject }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!userEmail) return;
    let cancel = false;
    (async () => {
      const d = await fetchPerformanceStats(userEmail, subject);
      if (!cancel && d && !d.error) setStats(d);
    })();
    return () => {
      cancel = true;
    };
  }, [userEmail, subject]);

  const bySubMap = Object.fromEntries((stats?.by_subject || []).map((r) => [r.subject, r]));
  const byAdMap = Object.fromEntries((stats?.adaptive_by_subject || []).map((r) => [r.subject, r]));

  const chapterMap = Object.fromEntries(
    (stats?.chapters || []).map((c) => [c.chapter, c.saved_count])
  );
  const chapterNames = CHAPTERS[subject] || CHAPTERS.default;
  const topics = chapterNames.map((name) => {
    const attempts = chapterMap[name] || 0;
    return { name, attempts };
  });
  const maxA = Math.max(1, ...topics.map((t) => t.attempts));
  const topicsScored = topics.map((t) => ({
    ...t,
    score: Math.min(100, Math.round((t.attempts / maxA) * 100)),
  }));
  const subSaved = bySubMap[subject]?.saved_count ?? 0;
  const adapt = byAdMap[subject];
  const subjectPerf = computeSubjectPerformance(subSaved, adapt);
  const lastQuiz =
    adapt?.last_score_pct != null ? `${Math.round(Number(adapt.last_score_pct))}%` : "—";
  const adaptLabel = adapt?.status || "—";
  const sortedByPractice = [...topicsScored].sort((a, b) => a.attempts - b.attempts);
  const subjectMastered = adapt?.status === "mastered";
  const weakLow = subjectMastered
    ? []
    : sortedByPractice.slice(0, Math.min(3, sortedByPractice.length));
  const weakNames = new Set(weakLow.map((t) => t.name));
  const strong = topicsScored.filter((t) => t.attempts > 0 && t.attempts >= maxA * 0.85);
  const weak = weakLow;
  const avg =
    topicsScored.length > 0
      ? Math.round(topicsScored.reduce((a, t) => a + t.score, 0) / topicsScored.length)
      : 0;

  const getAIAnalysis = async () => {
    setLoading(true);
    setAnalysis("");
    const lines = [
      `Subject ${subject}: subject performance score=${subjectPerf.pct}% (${subjectPerf.isEstimated ? "estimated from saves/adaptive" : "from last quiz"}), adaptive status=${adaptLabel}, last quiz=${lastQuiz}, MCQs saved=${subSaved}.`,
      "Chapter practice (saved MCQs per chapter):",
      ...topicsScored.map((t) => `- ${t.name}: ${t.attempts} saved, relative bar ${t.score}%`),
    ].join("\n");
    const coachNote = subjectMastered
      ? "This subject is marked MASTERED: fewer saved MCQs may mean confidence / time saved, not weakness. Suggest gaps only if evidence; do not assume low counts mean must study more."
      : "Chapters with fewer saved MCQs often need more drill, but combine with any quiz scores if provided.";
    try {
      const txt = await callClaude(
        [{ role: "user", content: `Analyze this student's performance in ${classLevel} ${subject}:\n${lines}\n\n${coachNote} Give specific study recommendations.` }],
        "You are an expert educational coach. Analyze student performance data and give specific, actionable, encouraging advice. Identify weak areas, patterns, and suggest concrete steps to improve. Keep advice practical for Pakistani BISE students.",
        1200
      );
      setAnalysis(txt);
      const em = (userEmail || "").trim() || localStorage.getItem("userEmail");
      if (em && txt && !txt.startsWith("Could not")) {
        saveGeneratedContent({
          email: em,
          kind: "performance_analysis",
          subject,
          chapter: null,
          title: `Performance coach · ${subject}`,
          content: txt,
          meta: { classLevel },
        });
      }
    } catch {
      setAnalysis("Could not load analysis.");
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Performance Analytics</div>
        <div className="page-sub">Saved MCQs + last quiz · {subject}</div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="heading-panel" style={{ marginBottom: 12 }}>Subject-wise performance</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {coreSubjectsForClass(classLevel).map((sub) => {
            const row = bySubMap[sub] || { saved_count: 0 };
            const ad = byAdMap[sub];
            const perf = computeSubjectPerformance(row.saved_count, ad);
            const active = sub === subject;
            return (
              <div
                key={sub}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSubject?.(sub)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectSubject?.(sub);
                  }
                }}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
                  background: active ? "rgba(59,130,246,0.12)" : COLORS.bg,
                  cursor: onSelectSubject ? "pointer" : "default",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span className="heading-label">{sub}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: perf.barColor }}>
                    {perf.isEstimated ? `${perf.pct}%*` : `${perf.pct}%`}
                  </span>
                </div>
                <div className="progress-bar" style={{ height: 6 }}>
                  <div className="progress-fill" style={{ width: perf.pct + "%", background: perf.barColor }} />
                </div>
                <div className="text-body" style={{ fontSize: 14, marginTop: 4 }}>{perf.tag} · saved {perf.saved}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-value" style={{ color: subjectPerf.barColor }}>
            {subjectPerf.isEstimated ? `${subjectPerf.pct}%*` : `${subjectPerf.pct}%`}
          </div>
          <div className="stat-label">Subject score ({subject})</div>
          <div className="text-body" style={{ fontSize: 14, marginTop: 6 }}>
            {subjectPerf.isEstimated ? "Estimate (no quiz % yet)" : "Last quiz score"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: avg >= 70 ? COLORS.green : avg >= 50 ? COLORS.gold : COLORS.red }}>{avg}%</div>
          <div className="stat-label">Chapter coverage (relative)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: COLORS.red }}>{subjectMastered ? "—" : weak.length}</div>
          <div className="stat-label">{subjectMastered ? "Focus chapters (N/A if mastered)" : "Chapters to prioritise"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: COLORS.green }}>{strong.length}</div>
          <div className="stat-label">Most practised chapters</div>
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="heading-panel" style={{ marginBottom: 14 }}>Chapter-wise (saved MCQs)</div>
          {topicsScored.map((t) => {
            const isWeak = weakNames.has(t.name);
            const tagCls = subjectMastered
              ? t.attempts >= maxA * 0.85
                ? "tag-green"
                : "tag-blue"
              : isWeak
                ? "tag-red"
                : t.attempts >= maxA * 0.85
                  ? "tag-green"
                  : "tag-gold";
            const tagLabel = subjectMastered
              ? t.attempts >= maxA * 0.85
                ? "Drilled"
                : "Optional"
              : isWeak
                ? "Focus"
                : t.attempts >= maxA * 0.85
                  ? "Strong"
                  : "Fair";
            const barBg = subjectMastered
              ? t.attempts >= maxA * 0.85
                ? COLORS.green
                : COLORS.textDim
              : isWeak
                ? COLORS.red
                : t.score >= 75
                  ? COLORS.green
                  : COLORS.gold;
            return (
              <div className="topic-row" key={t.name}>
                <div className="topic-name">{t.name}</div>
                <div style={{ flex: 2 }}>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: t.score + "%",
                        background: barBg,
                      }}
                    />
                  </div>
                </div>
                <div className="topic-score">{t.attempts} saved</div>
                <span className={`tag ${tagCls}`}>{tagLabel}</span>
              </div>
            );
          })}
        </div>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div className="heading-panel">AI Performance Analysis</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" onClick={getAIAnalysis} disabled={loading}>
                {loading ? <><span className="spinner" /> Analyzing…</> : "🤖 Get AI Analysis"}
              </button>
              {analysis ? (
                <ExportPdfButton
                  title={`Performance · ${subject}`}
                  filename={`performance-${subject}`}
                  metaLines={pdfMetaLines(classLevel, subject)}
                >
                  <PdfText text={analysis} />
                </ExportPdfButton>
              ) : null}
            </div>
          </div>
          {analysis ? (
            <div className="note-area" style={{ maxHeight: 380 }}>{analysis}</div>
          ) : (
            <>
              {weak.length > 0 && (
                <div className="alert alert-error">
                  ⚠️ Focus chapters: {weak.map((t) => t.name).join(", ") || "—"}
                </div>
              )}
              {strong.length > 0 && (
                <div className="alert alert-success">
                  ✅ Most practised: {strong.map((t) => t.name).join(", ")}
                </div>
              )}
              <div className="text-body" style={{ marginTop: 16 }}>
                Data comes from MCQs you saved with a chapter name. Click “Get AI Analysis” for recommendations.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PAST PAPERS ─────────────────────────────────────────────────────────────
function PastPapersPage({ classLevel, subject, userEmail }) {
  const [year, setYear] = useState("2023");
  const [board, setBoard] = useState("Federal Board");
  const [loading, setLoading] = useState(false);
  const [paper, setPaper] = useState("");
  const [tips, setTips] = useState("");
  const [tipsLoading, setTipsLoading] = useState(false);

  const boards = ["Federal Board", "Punjab Board", "Sindh Board", "KPK Board", "Balochistan Board"];
  const years = ["2024", "2023", "2022", "2021", "2020", "2019", "2018"];

  const generatePaper = async () => {
    setLoading(true); setPaper(""); setTips("");
    try {
      const txt = await callClaude(
        [{ role: "user", content: `Generate a realistic ${classLevel} ${subject} past paper style exam for ${board} ${year}. Include Section A (MCQs), Section B (short questions), Section C (long questions). Follow the actual BISE format.` }],
        `You are an expert at Pakistan's BISE exam system. Generate realistic past paper style questions that match actual board exam patterns for ${classLevel} ${subject}. Include proper marks, instructions, and section divisions.`,
        2500
      );
      setPaper(txt);
      const em = (userEmail || "").trim() || localStorage.getItem("userEmail");
      if (em && txt && !txt.startsWith("Error")) {
        saveGeneratedContent({
          email: em,
          kind: "past_paper",
          subject,
          chapter: null,
          title: `${board} ${year} · ${subject}`,
          content: txt,
          meta: { board, year, classLevel },
        });
      }
    } catch { setPaper("Error generating paper. Please try again."); }
    setLoading(false);
  };

  const getExamTips = async () => {
    if (!paper) return;
    setTipsLoading(true); setTips("");
    try {
      const txt = await callClaude(
        [{ role: "user", content: `Based on this past paper pattern, give 10 specific exam tips and prediction of important topics for ${classLevel} ${subject} ${board} ${year} style exams.` }],
        "You are an expert Pakistani board exam coach. Give specific, practical exam tips based on past paper patterns.",
        1000
      );
      setTips(txt);
      const em = (userEmail || "").trim() || localStorage.getItem("userEmail");
      if (em && txt && !txt.startsWith("Could not")) {
        saveGeneratedContent({
          email: em,
          kind: "past_paper_tips",
          subject,
          chapter: null,
          title: `Exam tips · ${board} ${year}`,
          content: txt,
          meta: { board, year, classLevel },
        });
      }
    } catch { setTips("Could not load tips."); }
    setTipsLoading(false);
  };

  return (
    <div>
      <div className="page-header"><div className="page-title">Past Papers AI</div>
        <div className="page-sub">AI-generated past paper style questions · BISE format</div></div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label>Board</label>
            <select className="select" value={board} onChange={e => setBoard(e.target.value)}>
              {boards.map(b => <option key={b}>{b}</option>)}
            </select></div>
          <div><label>Year</label>
            <select className="select" value={year} onChange={e => setYear(e.target.value)}>
              {years.map(y => <option key={y}>{y}</option>)}
            </select></div>
          <button className="btn btn-primary" onClick={generatePaper} disabled={loading}>
            {loading ? <><span className="spinner" /> Generating…</> : "📜 Generate Paper"}
          </button>
          {paper && (
            <button className="btn btn-outline" onClick={getExamTips} disabled={tipsLoading}>
              {tipsLoading ? <><span className="spinner" style={{ borderColor: "rgba(148,163,184,0.3)", borderTopColor: COLORS.textMuted }} /> Loading…</> : "💡 Exam Tips"}
            </button>
          )}
        </div>
      </div>
      {paper && (
        <div className="grid-2">
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="heading-panel">{board} · {year} Style Paper</div>
              <div style={{ display: "flex", gap: 6 }}>
                <span className="tag tag-gold">BISE Format</span>
                <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(paper)}>📋 Copy</button>
                <ExportPdfButton
                  title={`${board} ${year} · ${subject}`}
                  filename={`past-paper-${subject}-${year}`}
                  metaLines={pdfMetaLines(classLevel, subject, [board, year])}
                >
                  <PdfText text={paper} />
                </ExportPdfButton>
              </div>
            </div>
            <div className="note-area" style={{ maxHeight: 500 }}>{paper}</div>
          </div>
          {tips && (
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <div className="heading-panel">💡 Exam Tips & Predictions</div>
                <ExportPdfButton
                  title={`Exam tips · ${board} ${year}`}
                  filename={`exam-tips-${subject}-${year}`}
                  metaLines={pdfMetaLines(classLevel, subject, [board, year])}
                >
                  <PdfText text={tips} />
                </ExportPdfButton>
              </div>
              <div className="note-area" style={{ maxHeight: 500 }}>{tips}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const LIBRARY_KIND_LABEL = {
  notes: "Smart Notes",
  study_plan: "Study Plan",
  flashcards: "Flashcards",
  pdf_summary: "PDF / Text analysis",
  past_paper: "Past paper",
  past_paper_tips: "Exam tips",
  tutor_reply: "AI Tutor",
  performance_analysis: "Performance coach",
};

function normalizeHistoryMcq(item) {
  let options = item.options;
  if (!Array.isArray(options)) options = [];
  let answer = (item.correct_answer ?? "").toString().trim();
  const letterMatch = answer.match(/^[ABCD]/i);
  if (letterMatch) answer = letterMatch[0].toUpperCase();
  else if (answer) {
    const idx = options.findIndex((o) => {
      const os = (o || "").toString().replace(/^[ABCD]\)\s*/i, "").trim();
      const as = answer.replace(/^[ABCD]\)\s*/i, "").trim();
      return os === as || (o || "").toString().trim() === answer;
    });
    if (idx >= 0 && idx < 4) answer = ["A", "B", "C", "D"][idx];
  }
  return {
    q: item.question,
    question: item.question,
    options,
    answer,
    explanation: "",
  };
}

function groupSavedMcqBatches(items) {
  const sorted = [...items].sort((a, b) => {
    const ta = Date.parse(a.created_at || "") || 0;
    const tb = Date.parse(b.created_at || "") || 0;
    return tb - ta;
  });
  const groups = [];
  const WINDOW_MS = 120000;
  for (const row of sorted) {
    const t = Date.parse(row.created_at || "") || 0;
    const prev = groups[groups.length - 1];
    if (
      prev &&
      row.subject === prev.subject &&
      String(row.chapter || "") === String(prev.chapter || "") &&
      t > 0 &&
      prev.anchorT - t < WINDOW_MS
    ) {
      prev.items.push(row);
    } else {
      groups.push({
        subject: row.subject,
        chapter: row.chapter || "",
        anchorT: t,
        items: [row],
        savedAt: row.created_at,
      });
    }
  }
  for (const g of groups) {
    g.items.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  }
  return groups;
}

function GeneratedLibraryPage({ classLevel, subject, userEmail, onLoadMcqBatch }) {
  const [tab, setTab] = useState("all");
  const [generated, setGenerated] = useState([]);
  const [mcqItems, setMcqItems] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);

  const reload = async () => {
    if (!userEmail) return;
    setLoading(true);
    const [g, m, a] = await Promise.all([
      fetchGeneratedHistory(userEmail, { limit: 200 }),
      fetchMcqHistory(userEmail),
      fetchQuizAttempts(userEmail, { limit: 60 }),
    ]);
    setGenerated(Array.isArray(g?.items) ? g.items : []);
    setMcqItems(Array.isArray(m?.items) ? m.items : []);
    setAttempts(Array.isArray(a?.attempts) ? a.attempts : []);
    setLoading(false);
  };

  useEffect(() => {
    reload();
  }, [userEmail]);

  const batches = groupSavedMcqBatches(mcqItems);
  const rows = [];
  for (const it of generated) {
    rows.push({
      key: `g-${it.id}`,
      sort: Date.parse(it.created_at || "") || 0,
      type: "generated",
      item: it,
    });
  }
  for (let bi = 0; bi < batches.length; bi++) {
    const b = batches[bi];
    rows.push({
      key: `m-${b.savedAt}-${bi}`,
      sort: Date.parse(b.savedAt || "") || 0,
      type: "mcq",
      batch: b,
      bi,
    });
  }
  for (const att of attempts) {
    rows.push({
      key: `a-${att.id}`,
      sort: Date.parse(att.created_at || "") || 0,
      type: "attempt",
      att,
    });
  }
  rows.sort((a, b) => b.sort - a.sort);

  const filterRow = (r) => {
    if (tab === "all") return true;
    if (tab === "text") return r.type === "generated";
    if (tab === "mcq") return r.type === "mcq" || r.type === "attempt";
    if (tab === "subject") {
      if (r.type === "generated") return (r.item.subject || "") === subject;
      if (r.type === "mcq") return (r.batch.subject || "") === subject;
      if (r.type === "attempt") return (r.att.subject || "") === subject;
    }
    return true;
  };
  const visible = rows.filter(filterRow);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">My Library</div>
        <div className="page-sub">Everything you generate is saved here for later · {classLevel}</div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {[
            { id: "all", label: "All" },
            { id: "text", label: "Notes & tools" },
            { id: "mcq", label: "Quizzes & attempts" },
            { id: "subject", label: `This subject (${subject})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              className={`btn btn-sm ${tab === t.id ? "btn-primary" : "btn-outline"}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={reload} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
        {!userEmail ? (
          <div style={{ marginTop: 12, color: COLORS.textDim, fontSize: 14 }}>Log in to see saved content.</div>
        ) : null}
      </div>
      {!userEmail ? null : visible.length === 0 ? (
        <div className="card" style={{ color: COLORS.textDim, padding: 28 }}>
          Nothing here yet. Generate notes, a quiz, a plan, PDF analysis, past papers, or chat with the tutor — it will
          appear automatically.
        </div>
      ) : (
        visible.map((r) => {
          if (r.type === "generated") {
            const it = r.item;
            const open = openId === r.key;
            const label = LIBRARY_KIND_LABEL[it.kind] || it.kind;
            return (
              <div className="card" key={r.key} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <span className="tag tag-blue">{label}</span>
                    {it.subject ? (
                      <span className="tag tag-gold" style={{ marginLeft: 6 }}>
                        {it.subject}
                      </span>
                    ) : null}
                    {it.chapter ? (
                      <span className="tag tag-green" style={{ marginLeft: 6 }}>
                        {it.chapter}
                      </span>
                    ) : null}
                    <div style={{ fontSize: 13, color: COLORS.textDim, marginTop: 6 }}>{it.created_at || "—"}</div>
                    {it.title ? (
                      <div style={{ fontSize: 14, color: COLORS.textMuted, marginTop: 4 }}>{it.title}</div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpenId(open ? null : r.key)}>
                      {open ? "Hide" : "Read"}
                    </button>
                    <ExportPdfButton
                      title={it.title || label}
                      filename={`library-${it.kind}-${it.id}`}
                      metaLines={pdfMetaLines(classLevel, it.subject, [it.chapter, it.created_at])}
                    >
                      {libraryPdfChildren(it, parseStudyPlanBlocks)}
                    </ExportPdfButton>
                  </div>
                </div>
                {open ? (
                  <div className="note-area" style={{ marginTop: 12, maxHeight: 420 }}>
                    {it.content}
                  </div>
                ) : null}
              </div>
            );
          }
          if (r.type === "attempt") {
            const att = r.att;
            const open = openId === r.key;
            const n = Array.isArray(att.responses) ? att.responses.length : 0;
            return (
              <div className="card" key={r.key} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <span className="tag tag-red">Quiz attempt</span>
                    <span className="tag tag-gold" style={{ marginLeft: 6 }}>
                      {att.subject}
                    </span>
                    {att.chapter ? (
                      <span className="tag tag-green" style={{ marginLeft: 6 }}>
                        {att.chapter}
                      </span>
                    ) : null}
                    <div style={{ fontSize: 13, color: COLORS.textDim, marginTop: 6 }}>
                      {att.created_at || "—"} · {n} answers
                      {att.score_pct != null ? ` · score ${Math.round(Number(att.score_pct))}%` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpenId(open ? null : r.key)}>
                      {open ? "Hide" : "Details"}
                    </button>
                    <ExportPdfButton
                      title={`Quiz attempt · ${att.chapter || att.subject}`}
                      filename={`attempt-${att.id}`}
                      metaLines={pdfMetaLines(classLevel, att.subject, [att.chapter, att.created_at, att.score_pct != null ? `Score ${Math.round(Number(att.score_pct))}%` : null])}
                    >
                      <PdfQuizAttemptList responses={att.responses} scorePct={att.score_pct} />
                    </ExportPdfButton>
                  </div>
                </div>
                {open && Array.isArray(att.responses) ? (
                  <div style={{ marginTop: 12, fontSize: 13, color: COLORS.textMuted }}>
                    {att.responses.map((x, i) => (
                      <div key={i} style={{ marginBottom: 8, lineHeight: 1.5 }}>
                        Q{i + 1}: picked <strong>{x.user_selected || "—"}</strong>, correct{" "}
                        <strong>{x.correct_answer || "—"}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }
          const b = r.batch;
          const playable = b.items
            .map(normalizeHistoryMcq)
            .filter((q) => q.options.length >= 2 && /^[ABCD]$/i.test(String(q.answer || "")));
          const open = openId === r.key;
          return (
            <div className="card" key={r.key} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span className="tag tag-blue">MCQ set</span>
                  <span className="tag tag-gold" style={{ marginLeft: 6 }}>
                    {b.subject}
                  </span>
                  {b.chapter ? (
                    <span className="tag tag-green" style={{ marginLeft: 6 }}>
                      {b.chapter}
                    </span>
                  ) : null}
                  <div style={{ fontSize: 13, color: COLORS.textDim, marginTop: 6 }}>
                    {b.items.length} questions · {b.savedAt || "—"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpenId(open ? null : r.key)}>
                    {open ? "Hide" : "Preview"}
                  </button>
                  <ExportPdfButton
                    title={`MCQ set · ${b.chapter || b.subject}`}
                    filename={`mcq-${b.subject}-${b.chapter || "set"}`}
                    metaLines={pdfMetaLines(classLevel, b.subject, [b.chapter, b.savedAt])}
                  >
                    <PdfMcqList questions={playable} showAnswers />
                  </ExportPdfButton>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!playable.length}
                    onClick={() =>
                      onLoadMcqBatch?.({
                        subject: b.subject,
                        chapter: b.chapter,
                        questions: playable,
                      })
                    }
                  >
                    Practise again
                  </button>
                </div>
              </div>
              {open ? (
                <div style={{ marginTop: 12, borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
                  {b.items.map((row, i) => (
                    <div key={row.id || i} style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 8 }}>
                      Q{i + 1}. {row.question}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────
export default function App() {
  // 1. Login ki state yahan banayein
  const [isLoggedIn, setIsLoggedIn] = useState(false); 
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  
  const [page, setPage] = useState("dashboard");
  const [classLevel, setClassLevel] = useState("Matric");
  const [subject, setSubject] = useState("Physics");
  const [quizData, setQuizData] = useState(null);
  const [quizImport, setQuizImport] = useState(null);
  const [loading, setLoading] = useState(false);

  const clearQuizImport = useCallback(() => setQuizImport(null), []);

  const handleLoadMcqBatch = useCallback(({ subject: sub, chapter, questions }) => {
    setQuizData(null);
    setSubject(sub);
    setQuizImport({ chapter: chapter || "", questions });
    setPage("quiz");
  }, []);

  useEffect(() => {
    const allowed = coreSubjectsForClass(classLevel);
    if (allowed.length && !allowed.includes(subject)) {
      setSubject(allowed[0]);
    }
  }, [classLevel, subject]);

 // App.jsx mein ye wala hissa confirm karein:
if (!isLoggedIn) {
  return <Signup onSignupSuccess={(name, email) => { 
    console.log("Login Success! Email received:", email); // Ye check karein
    setIsLoggedIn(true);
    setUserName(name);
    setUserEmail(email); // <--- Ye line missing toh nahi?
  }} />;
}
  // 2. Agar login nahi hai to Signup screen dikhao aur function pass karein
 /*if (!isLoggedIn) {
  // Ab hum function ke sath 'name' bhi receive karenge
  return <Signup onSignupSuccess={(name) => {
    setIsLoggedIn(true);
    setUserName(name);
  }} />;
}*/

  // 3. Login hone ke baad ye neechay wala hissa chalay ga
  const pages = { 
    dashboard: Dashboard, 
    tutor: TutorPage, 
    quiz: (props) =>
      quizData ? (
        <Quiz questions={quizData} subject={subject} userEmail={userEmail} />
      ) : (
        <QuizPage
          {...props}
          importPack={quizImport}
          onImportConsumed={clearQuizImport}
          onStartQuiz={(topic) => handleGenerateQuiz(topic)}
        />
      ),
    library: (props) => (
      <GeneratedLibraryPage {...props} userEmail={userEmail} onLoadMcqBatch={handleLoadMcqBatch} />
    ),
    notes: NotesPage, 
    plan: StudyPlanPage,
    flashcards: FlashcardsPage,
    pdf: PDFPage, 
    performance: PerformancePage, 
    pastpapers: PastPapersPage 
  };

  const PageComponent = pages[page] || Dashboard;
  const sections = [...new Set(NAV.map(n => n.section))];

 /* const saveToHistory = async (mcqs) => {
  console.log("🚀 Saving to DB for:", userEmail);
  
  if (!userEmail) {
    console.error("❌ Save cancel: Email missing in App.jsx state!");
    return;
  }

  // MCQs array nikalna
  const mcqList = Array.isArray(mcqs) ? mcqs : (mcqs.questions || []);

  for (const mcq of mcqList) {
    try {
      // Backend ko exact wohi keys bhejein jo app.py mang raha hai
      const response = await fetch(`${API_BASE}/save-mcq`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          question: mcq.q || mcq.question, // Dono check kar raha hai
          options: mcq.options,
          correct_answer: mcq.answer || mcq.correct_answer,
          subject: subject // Jo subject state mein hai
        })
      });

      if (response.ok) {
        console.log("✅ MCQ Saved!");
      } else {
        const errData = await response.json();
        console.error("❌ Server Error:", errData.error);
      }
    } catch (err) {
      console.error("❌ Network Error in saveToHistory:", err);
    }
  }
};*/
const handleGenerateQuiz = async (topic) => {
    // Sab se pehle console check
    console.log("🔥 STEP 1: handleGenerateQuiz START for topic:", topic);
    console.log("🔥 Current User Email in State:", userEmail);

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/generate-mcqs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chapter: topic,
            book_id: `${subject.toLowerCase()}_9th`,
            num_questions: 5,
            difficulty: "medium",
            ...adaptiveApiFields(subject),
        })
      });
      
      const data = await res.json();
      console.log("🔥 STEP 2: Received data from Flask", data);

      if (!res.ok) {
        throw new Error(data.error || `Server Error: ${res.status}`);
      }

      const rawText = data.questions;
      if (!rawText) {
        throw new Error("No questions received from backend");
      }

      const start = rawText.indexOf("[");
      const end = rawText.lastIndexOf("]") + 1;
      if (start === -1 || end === 0) {
        throw new Error("AI returned text but no JSON list found.");
      }
      const parsedData = JSON.parse(rawText.slice(start, end));
      
      console.log("🔥 STEP 3: Data parsed successfully. Setting state...");
      setQuizData(parsedData);
      setPage('quiz');

      // 🔥 CALLING SAVE TO HISTORY
      console.log("🔥 STEP 4: Saving MCQs to server...");
      await saveMcqBatch(userEmail, subject, topic, parsedData); 

    } catch (error) { 
      console.error("❌ Quiz Generation Error:", error); 
      alert("Quiz generation failed. Check console.");
    }
    setLoading(false);
  };

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <h1>mindspring ai</h1>
            <p style={{ fontSize: '13px', color: '#94a3b8' }}>Welcome, {userName}!</p>
          </div>
          <nav className="sidebar-nav">
            {sections.map(sec => (
              <div key={sec}>
                <div className="nav-section">{sec}</div>
                {NAV.filter(n => n.section === sec).map(n => (
                  <div key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
                    <span className="icon">{n.icon}</span> {n.label}
                  </div>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div style={{ fontSize: 13, color: COLORS.textDim, marginBottom: 8 }}>Current Class & Subject</div>
            <select className="select" value={classLevel} onChange={e => { const cl = e.target.value; setClassLevel(cl); const first = coreSubjectsForClass(cl)[0]; if (first) setSubject(first); }} style={{ width: "100%", fontSize: 14 }}>
              {Object.keys(SUBJECTS).map(c => <option key={c}>{c}</option>)}
            </select>
            <select className="select" value={subject} onChange={e => setSubject(e.target.value)} style={{ width: "100%", fontSize: 14 }}>
              {coreSubjectsForClass(classLevel).map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </aside>
        <main className="main">
          <PageComponent
            classLevel={classLevel}
            subject={subject}
            onNavigate={setPage}
            userEmail={userEmail}
            onSelectSubject={page === "performance" ? setSubject : undefined}
          />
        </main>
      </div>
    </>
  );
}