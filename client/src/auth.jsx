import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, onSessionExpired, refreshSession, setAccessToken } from "./lib/api.js";
import { reportWorkflow } from "./lib/telemetry.js";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// where each kind of account lives after signing in
export const homeFor = (user) => (user?.role === "patient" ? "/patient" : "/");

// Runs a sign-in style action and records whether the workflow succeeded.
async function tracked(name, action) {
  try {
    const result = await action();
    reportWorkflow(name, "success");
    return result;
  } catch (err) {
    reportWorkflow(name, "failure");
    throw err;
  }
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  // reason: why the doctor is signed out ("expired" shows a notice on the sign-in page)
  const [state, setState] = useState({ status: "loading", user: null, reason: null });

  const signedIn = useCallback(({ user, accessToken }) => {
    setAccessToken(accessToken);
    setState({ status: "in", user, reason: null });
  }, []);

  const signedOut = useCallback(
    (reason = null) => {
      setAccessToken(null);
      queryClient.clear(); // drop cached patient data
      setState({ status: "out", user: null, reason });
    },
    [queryClient]
  );

  useEffect(() => {
    onSessionExpired(() => signedOut("expired"));
    // restore the session from the refresh cookie on page load
    refreshSession()
      .then(signedIn)
      .catch(() => {
        setAccessToken(null);
        setState({ status: "out", user: null, reason: null });
      });
  }, [signedIn, signedOut]);

  const value = {
    ...state,
    login: (credentials) => tracked("login", async () => signedIn(await api("/auth/login", { method: "POST", json: credentials }))),
    register: (details) =>
      tracked("register", async () => {
        await api("/auth/register", { method: "POST", json: details }); // details.accountType: doctor | patient
        signedIn(await api("/auth/login", { method: "POST", json: { email: details.email, password: details.password } }));
      }),
    // re-read the account (e.g. after the email was confirmed in another tab or on this page)
    refreshUser: async () => {
      const user = await api("/auth/me");
      setState((s) => (s.status === "in" ? { ...s, user } : s));
    },
    logout: async () => {
      await api("/auth/logout", { method: "POST" }).catch(() => {});
      signedOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
