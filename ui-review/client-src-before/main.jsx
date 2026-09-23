import "@picocss/pico/css/pico.min.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AuthProvider } from "./auth.jsx";
import Layout from "./components/Layout.jsx";
import CaseDetail from "./pages/CaseDetail.jsx";
import CaseRecord from "./pages/CaseRecord.jsx";
import Cases from "./pages/Cases.jsx";
import Intake from "./pages/Intake.jsx";
import Login from "./pages/Login.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import Register from "./pages/Register.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (count, err) => err.status >= 500 && count < 2 } },
});

const router = createBrowserRouter([
  { path: "/login", Component: Login },
  { path: "/register", Component: Register },
  { path: "/forgot-password", Component: ForgotPassword },
  { path: "/reset-password", Component: ResetPassword },
  { path: "/intake/:token", Component: Intake },
  {
    Component: Layout, // everything below requires a signed-in doctor
    children: [
      { index: true, Component: Cases },
      { path: "cases/:caseId", Component: CaseDetail },
      { path: "cases/:caseId/record", Component: CaseRecord },
    ],
  },
]);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
