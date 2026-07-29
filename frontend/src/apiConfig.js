/** Backend URL: dev default is local Flask. Set VITE_API_BASE for production & mobile (HTTPS). */
const raw = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:5000";
export const API_BASE = String(raw).replace(/\/$/, "");
