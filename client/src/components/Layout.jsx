import { Link, Navigate, Outlet, useLocation } from "react-router";
import { homeFor, useAuth } from "../auth.jsx";
import { BrandMark } from "./Icons.jsx";
import Spinner from "./Spinner.jsx";

export function Brand({ to = "/" }) {
  return (
    <Link to={to} className="brand">
      <BrandMark />
      DocDoc
    </Link>
  );
}

// The signed-in shell. `role` is the only kind of account allowed inside; anyone else is sent home.
export default function Layout({ role = "doctor" }) {
  const { status, user, logout } = useAuth();
  const location = useLocation();

  if (status === "loading")
    return (
      <main id="main" tabIndex={-1} className="page page-loading">
        <Spinner />
      </main>
    );
  if (status === "out") return <Navigate to={role === "patient" ? "/patient/login" : "/login"} replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand to={homeFor(user)} />
          <div className="topbar-user">
            <span className="name">{user.name}</span>
            <button className="btn-sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="page">
        <Outlet />
      </main>
    </>
  );
}
