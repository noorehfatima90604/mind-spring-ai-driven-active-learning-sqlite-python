import React, { useState } from 'react';
import { pushAdaptiveProfile } from './adaptiveSync';

const Quiz = ({ questions, subject, userEmail, onFinish }) => {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);

  const handleAnswer = (isCorrect) => {
    if (isCorrect) setScore(score + 1);
    
    const nextQuestion = currentQuestion + 1;
    if (nextQuestion < questions.length) {
      setCurrentQuestion(nextQuestion);
    } else {
      setShowResult(true);
      // ADAPTIVE LOGIC: Save performance to localStorage
      const finalScore = score + (isCorrect ? 1 : 0);
      const percentage = (finalScore / questions.length) * 100;
      let status = "mastered";
      if (percentage < 50) status = "struggling";
      else if (percentage < 80) status = "improving";
      localStorage.setItem(`status_${subject}`, status);
      const em = userEmail || (typeof localStorage !== 'undefined' ? localStorage.getItem('userEmail') : '');
      pushAdaptiveProfile(em, subject, status, percentage);
    }
  };

  if (showResult) {
    return (
      <div className="card text-center">
        <h2>Quiz Complete!</h2>
        <p className="text-xl">Your Score: {score} / {questions.length}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Back to Dashboard</button>
      </div>
    );
  }

  const q = questions[currentQuestion];

  return (
    <div className="card">
      <div className="page-sub">Question {currentQuestion + 1} of {questions.length}</div>
      <h3 className="quiz-question" style={{ margin: '20px 0' }}>{q.question || q.q}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {q.options.map((opt, i) => (
          <button 
            key={i} 
            className="btn btn-outline" 
            onClick={() => handleAnswer(opt === q.answer)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Quiz;