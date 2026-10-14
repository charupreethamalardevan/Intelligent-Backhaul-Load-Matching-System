import { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch, getToken, setToken } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On first load, if a token is already saved (from a previous login),
  // try to restore the session via /api/auth/me instead of making the
  // person log in again every time they refresh the page.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    apiFetch('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  function login(token, user) {
    setToken(token);
    setUser(user);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
