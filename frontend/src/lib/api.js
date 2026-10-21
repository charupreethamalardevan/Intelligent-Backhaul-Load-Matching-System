// Reads the deployed backend's URL from Vite's VITE_API_BASE env var
// (see .env.example) so a production build can point at a real backend
// host instead of this local-dev default. Exported so adminApi.js and
// App.jsx's /status health check reuse the exact same base instead of
// each hardcoding their own copy.
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000/api';
const TOKEN_KEY = 'iblms_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// For plain JSON requests (login, etc).
export async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// For multipart/form-data requests (signup with documents, invite
// creation). Deliberately does NOT set Content-Type -- the browser sets
// the multipart boundary itself when the body is a FormData instance.
export async function apiUpload(path, formData, options = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { method: options.method || 'POST', headers, body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
