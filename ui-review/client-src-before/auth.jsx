import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, onSessionExpired, refreshSession, setAccessToken } from "./api.js";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: "loading", user: null });

  const signedIn = useCallback(({ user, accessToken }) => {
    setAccessToken(accessToken);
    setState({ status: "in", user });
  }, []);

  const signedOut = useCallback(() => {
    setAccessToken(null);
    queryClient.clear(); // drop cached patient data
    setState({ status: "out", user: null });
  }, [queryClient]);

  useEffect(() => {
    onSessionExpired(signedOut);
    // restore the session from the refresh cookie on page load
    refreshSession()
      .then(signedIn)
      .catch(() => setState({ status: "out", user: null }));
  }, [signedIn, signedOut]);

  const value = {
    ...state,
    login: async (credentials) => signedIn(await api("/auth/login", { method: "POST", json: credentials })),
    register: async (details) => {
      await api("/auth/register", { method: "POST", json: details });
      signedIn(await api("/auth/login", { method: "POST", json: { email: details.email, password: details.password } }));
    },
    logout: async () => {
      await api("/auth/logout", { method: "POST" }).catch(() => {});
      signedOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
