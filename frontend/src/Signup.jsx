import React, { useState } from "react";
import { pullAdaptiveProfiles } from "./adaptiveSync";
import { API_BASE } from "./apiConfig";

// 1. Styles ko upar define kar diya taake error na aaye
const inputStyle = { 
  padding: "12px", 
  borderRadius: "8px", 
  border: "1px solid #334155", 
  background: "#0f172a", 
  color: "white",
  fontSize: "16px"
};

export default function AuthPage({ onSignupSuccess }) {
  const [isLoginMode, setIsLoginMode] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    grade: '9th Class'
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const endpoint = isLoginMode ? '/login' : '/signup';
    console.log(`Sending request to: ${endpoint}`, formData); 

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      console.log("Full Backend Response:", data);

      if (response.ok) {
         // --- SMART EMAIL LOGIC ---
        // Pehle backend se dhoondo, agar wahan nahi mil raha to jo bache ne form mein likha (formData.email) wo use karo
        const userEmail = data.user?.email || formData.email;
        const userName = data.user?.full_name || formData.full_name || "Student";

        console.log("✅ Final Decided Email for History:", userEmail);
        localStorage.setItem("userEmail", userEmail);
       console.log("✅ Email Saved to Storage:", userEmail);

        await pullAdaptiveProfiles(userEmail);

        if (isLoginMode) {
          alert(`✅ Welcome Back, ${userName}!`);
          onSignupSuccess(userName, userEmail);
        } else {
          alert("✅ Account Created Successfully!");
          onSignupSuccess(userName, userEmail);
        }
      } else {
        alert(data.error || "Login/Signup failed. Please try again.");
      }
    } catch (err) {
      alert("⚠️ Backend connection failed! Flask server check karein.");
      console.error("Fetch Error:", err);
    }
  };

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", color: "white", fontFamily: "Arial, sans-serif" }}>
      <div style={{ background: "#1e293b", padding: "35px", borderRadius: "15px", width: "100%", maxWidth: "400px", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}>
        <h2 style={{ textAlign: "center", color: "#3b82f6", marginBottom: "20px" }}>
          {isLoginMode ? "Login to MindSpring" : "Join MindSpring"}
        </h2>
        
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          {!isLoginMode && (
            <>
              <input 
                type="text" placeholder="Full Name" required 
                style={inputStyle}
                onChange={(e) => setFormData({...formData, full_name: e.target.value})} 
              />
              <select 
                style={inputStyle}
                onChange={(e) => setFormData({...formData, grade: e.target.value})}
              >
                <option>9th Class</option>
                <option>10th Class</option>
              </select>
            </>
          )}

          <input 
            type="email" placeholder="Email Address" required 
            style={inputStyle}
            onChange={(e) => setFormData({...formData, email: e.target.value})} 
          />
          
          <input 
            type="password" placeholder="Password" required 
            style={inputStyle}
            onChange={(e) => setFormData({...formData, password: e.target.value})} 
          />

          <button type="submit" style={{ padding: "12px", background: "#3b82f6", border: "none", color: "white", borderRadius: "8px", cursor: "pointer", fontWeight: "bold", fontSize: "16px", marginTop: "10px" }}>
            {isLoginMode ? "Login" : "Register Now"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: "20px", color: "#94a3b8" }}>
          {isLoginMode ? "New here?" : "Already have an account?"}
          <button type="button" onClick={() => setIsLoginMode(!isLoginMode)} style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", textDecoration: "underline", marginLeft: "5px", fontWeight: "bold" }}>
            {isLoginMode ? "Create Account" : "Login Here"}
          </button>
        </p>
      </div>
    </div>
  );
}