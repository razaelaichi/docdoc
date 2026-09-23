import { Link, Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth.jsx";

export default function Layout() {
  const { status, user, logout } = useAuth();
  const location = useLocation();

  if (status === "loading") return <main className="container" aria-busy="true" />;
  if (status === "out") return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <>
      <header className="container">
        <nav>
          <ul>
            <li>
              <Link to="/">
                <strong>DocDoc</strong>
              </Link>
            </li>
          </ul>
          <ul>
            <li>{user.name}</li>
            <li>
              <button className="secondary outline" onClick={logout}>
                Sign out
              </button>
            </li>
          </ul>
        </nav>
      </header>
      <main className="container"><Outlet /></main>
    </>
  );
}
