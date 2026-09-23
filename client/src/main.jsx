import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource-variable/source-serif-4";
import "./styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AuthProvider } from "./auth.jsx";
import Layout from "./components/Layout.jsx";
import Root from "./components/Root.jsx";
import RouteError from "./components/RouteError.jsx";
import { ToastProvider } from "./components/Toaster.jsx";
import { initTelemetry } from "./lib/telemetry.js";
import { lazyPage } from "./routes.js";

initTelemetry();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // retry only what can succeed on retry: network blips and server errors, never 4xx
      retry: (count, err) => (err.status === 0 || err.status >= 500) && count < 2,
      staleTime: 30_000, // show cached data instantly, revalidate in the background
    },
  },
});

const router = createBrowserRouter([
  {
    Component: Root,
    ErrorBoundary: RouteError,
    children: [
      { path: "/login", lazy: lazyPage("login") },
      { path: "/register", lazy: lazyPage("register") },
      { path: "/forgot-password", lazy: lazyPage("forgotPassword") },
      { path: "/reset-password", lazy: lazyPage("resetPassword") },
      { path: "/verify-email", lazy: lazyPage("verifyEmail") },
      { path: "/intake/:token", lazy: lazyPage("intake") },
      { path: "/patient/login", lazy: lazyPage("patientLogin") },
      { path: "/patient/register", lazy: lazyPage("patientRegister") },
      {
        path: "/patient",
        element: <Layout role="patient" />, // patients only; their own record and nothing else
        children: [
          { index: true, lazy: lazyPage("patientDashboard") },
          { path: "record", lazy: lazyPage("patientRecord") },
        ],
      },
      {
        Component: Layout, // everything below requires a signed-in doctor
        children: [
          { index: true, lazy: lazyPage("cases") },
          { path: "cases/:caseId", lazy: lazyPage("caseDetail") },
          { path: "cases/:caseId/record", lazy: lazyPage("caseRecord") },
          { path: "cases/:caseId/shared-record", lazy: lazyPage("sharedRecord") },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
