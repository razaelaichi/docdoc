// Route modules are code-split: each page is its own chunk, fetched on first visit.
// The same loaders are used to prefetch a page's code when a link to it is hovered or focused.
const page = (load) => () => load().then((m) => ({ Component: m.default }));

export const loaders = {
  login: () => import("./pages/Login.jsx"),
  register: () => import("./pages/Register.jsx"),
  forgotPassword: () => import("./pages/ForgotPassword.jsx"),
  resetPassword: () => import("./pages/ResetPassword.jsx"),
  intake: () => import("./pages/Intake.jsx"),
  cases: () => import("./pages/Cases.jsx"),
  caseDetail: () => import("./pages/CaseDetail.jsx"),
  caseRecord: () => import("./pages/CaseRecord.jsx"),
  sharedRecord: () => import("./pages/SharedRecord.jsx"),
  patientLogin: () => import("./pages/patient/Login.jsx"),
  patientRegister: () => import("./pages/patient/Register.jsx"),
  patientDashboard: () => import("./pages/patient/Dashboard.jsx"),
  patientRecord: () => import("./pages/patient/Record.jsx"),
  verifyEmail: () => import("./pages/VerifyEmail.jsx"),
};

export const lazyPage = (name) => page(loaders[name]);
