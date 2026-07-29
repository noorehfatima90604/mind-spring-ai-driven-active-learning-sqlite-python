import React, { useRef, useState } from "react";
import { downloadElementAsPdf } from "./pdfExport";

const pdfSheetCss = `
.pdf-sheet {
  width: 190mm;
  max-width: 190mm;
  background: #ffffff;
  color: #111827;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 11pt;
  line-height: 1.55;
  padding: 0;
  box-sizing: border-box;
}
.pdf-sheet h1 {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 18pt;
  margin: 0 0 6px 0;
  color: #0f172a;
}
.pdf-sheet .pdf-meta {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 9pt;
  color: #64748b;
  margin-bottom: 14px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 10px;
}
.pdf-sheet .pdf-body { white-space: pre-wrap; }
.pdf-sheet .pdf-mcq-block {
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e2e8f0;
  page-break-inside: avoid;
}
.pdf-sheet .pdf-mcq-q { font-weight: 600; margin-bottom: 6px; }
.pdf-sheet .pdf-mcq-opt { margin: 3px 0 3px 12px; font-size: 10.5pt; }
.pdf-sheet .pdf-mcq-ans { margin-top: 6px; font-size: 10pt; color: #0369a1; }
.pdf-sheet .pdf-card {
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  page-break-inside: avoid;
}
.pdf-sheet .pdf-plan-block {
  margin-bottom: 12px;
  padding-left: 10px;
  border-left: 3px solid #3b82f6;
  page-break-inside: avoid;
}
.pdf-sheet .pdf-chat-msg { margin-bottom: 10px; page-break-inside: avoid; }
.pdf-sheet .pdf-chat-role {
  font-weight: 700;
  font-size: 9pt;
  text-transform: uppercase;
  color: #475569;
}
`;

export function ExportPdfButton({ title, filename, metaLines = [], children, disabled, className = "" }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);

  const onDownload = async () => {
    if (!ref.current || busy || disabled) return;
    setBusy(true);
    try {
      await downloadElementAsPdf(ref.current, filename || title || "export");
    } catch (e) {
      console.error(e);
      alert(`Could not create PDF: ${e.message || e}`);
    }
    setBusy(false);
  };

  return (
    <>
      <button
        type="button"
        className={`btn btn-outline btn-sm ${className}`.trim()}
        onClick={onDownload}
        disabled={disabled || busy}
        title="Download as A4 PDF"
      >
        {busy ? "…" : "📥 Download PDF"}
      </button>
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: "-12000px",
          top: 0,
          width: "210mm",
          overflow: "hidden",
          pointerEvents: "none",
          zIndex: -1,
        }}
      >
        <style>{pdfSheetCss}</style>
        <div ref={ref} className="pdf-sheet">
          <h1>{title || "MindSpring"}</h1>
          {metaLines.length > 0 ? (
            <div className="pdf-meta">
              {metaLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          ) : null}
          <div className="pdf-body">{children}</div>
        </div>
      </div>
    </>
  );
}

export function PdfText({ text }) {
  return <div>{text}</div>;
}

export function PdfMcqList({ questions, showAnswers = true }) {
  const labels = ["A", "B", "C", "D"];
  return (
    <>
      {(questions || []).map((q, qi) => {
        const stem = q.q || q.question || "";
        const opts = Array.isArray(q.options) ? q.options : [];
        const ans = (q.answer || q.correct_answer || "").toString().toUpperCase().slice(0, 1);
        return (
          <div key={qi} className="pdf-mcq-block">
            <div className="pdf-mcq-q">
              Q{qi + 1}. {stem}
            </div>
            {opts.map((opt, oi) => (
              <div key={oi} className="pdf-mcq-opt">
                {labels[oi]}) {String(opt).replace(/^[ABCD]\)\s*/i, "")}
              </div>
            ))}
            {showAnswers && ans ? <div className="pdf-mcq-ans">Answer: {ans}</div> : null}
            {q.explanation ? <div className="pdf-mcq-ans">Note: {q.explanation}</div> : null}
          </div>
        );
      })}
    </>
  );
}

export function PdfFlashcardList({ cards }) {
  return (
    <>
      {(cards || []).map((c, i) => (
        <div key={i} className="pdf-card">
          <div>
            <strong>Card {i + 1} — Front:</strong> {c.front}
          </div>
          <div style={{ marginTop: 6 }}>
            <strong>Back:</strong> {c.back}
          </div>
        </div>
      ))}
    </>
  );
}

export function PdfStudyPlanBlocks({ blocks }) {
  return (
    <>
      {(blocks || []).map((b, i) => (
        <div key={i} className="pdf-plan-block">
          {b.header ? <div style={{ fontWeight: 600, marginBottom: 4 }}>{b.header}</div> : null}
          {b.main ? <div>{b.main}</div> : null}
          {b.focus ? (
            <div style={{ fontSize: "10pt", color: "#475569", marginTop: 4 }}>{b.focus}</div>
          ) : null}
        </div>
      ))}
    </>
  );
}

export function PdfChatTranscript({ messages }) {
  return (
    <>
      {(messages || []).map((m, i) => (
        <div key={i} className="pdf-chat-msg">
          <div className="pdf-chat-role">{m.role === "user" ? "Student" : "MindSpring AI"}</div>
          <div>{m.text}</div>
        </div>
      ))}
    </>
  );
}

export function PdfQuizAttemptList({ responses, scorePct }) {
  const rows = Array.isArray(responses) ? responses : [];
  return (
    <>
      {scorePct != null ? (
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Score: {Math.round(Number(scorePct))}%</div>
      ) : null}
      {rows.map((x, i) => (
        <div key={i} className="pdf-mcq-block">
          <div className="pdf-mcq-q">Q{i + 1}. {x.question || "—"}</div>
          <div className="pdf-mcq-ans">
            Your answer: {x.user_selected || "—"} · Correct: {x.correct_answer || "—"}
          </div>
        </div>
      ))}
    </>
  );
}



