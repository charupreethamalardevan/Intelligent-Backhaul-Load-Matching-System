import { API_BASE } from './api.js'; // same backend base as the regular user API -- see api.js's comment
const TOKEN_KEY = 'iblms_admin_token'; // separate from the regular user token on purpose

// sessionStorage, not localStorage -- see api.js's getToken()/setToken()
// comment; same per-tab reasoning applies to the admin session.
export function getAdminToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export async function adminFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getAdminToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // `status` is attached (not just encoded in the message) so callers can
    // reliably detect "the admin session itself is the problem" (401) and
    // react to it -- e.g. by bouncing back to the login screen -- without
    // string-matching the error text, which could drift from the backend's
    // own wording.
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
