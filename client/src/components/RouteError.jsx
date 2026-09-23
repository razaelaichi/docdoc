import { useEffect } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { reportError } from "../lib/telemetry.js";
import { usePageTitle } from "../lib/usePageTitle.js";
import { AlertIcon } from "./Icons.jsx";
import { Brand } from "./Layout.jsx";

// The route error boundary: a crash in any page lands here instead of a blank screen.
export default function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // after a deploy, an open tab may ask for a chunk that no longer exists: reloading fixes it
  const staleBuild = /dynamically imported module|Importing a module script failed/i.test(error?.message ?? "");
  usePageTitle(notFound ? "Page not found" : "Something went wrong");

  useEffect(() => {
    if (!notFound) reportError(staleBuild ? "chunk-load" : "render", error);
  }, [error, notFound, staleBuild]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="page page-narrow">
        <div className="error-page">
          {notFound ? (
            <>
              <h1>Page not found</h1>
              <p>The address may be mistyped, or the page may have moved.</p>
              <Link to="/" className="btn btn-primary">
                Go to cases
              </Link>
            </>
          ) : (
            <>
              <AlertIcon />
              <h1>{staleBuild ? "DocDoc has been updated" : "Something went wrong"}</h1>
              <p>
                {staleBuild
                  ? "Reload the page to get the latest version. Nothing you saved is lost."
                  : "The problem has been reported. Reloading the page usually fixes it."}
              </p>
              <button className="btn-primary" onClick={() => location.reload()}>
                Reload page
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
}
