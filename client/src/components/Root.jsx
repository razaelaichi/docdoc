import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";

// Shell for every route: skip link, and focus + announcement on client-side navigation
// (a single-page app otherwise leaves screen-reader users where they were, with no cue).
export default function Root() {
  const { pathname } = useLocation();
  const [announcement, setAnnouncement] = useState("");
  const lastPath = useRef(pathname); // the initial page load is announced by the browser itself

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    // wait a frame so the new page has rendered its heading and set its title
    const id = setTimeout(() => {
      const target = document.getElementById("main");
      target?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      setAnnouncement(document.title);
    }, 60);
    return () => clearTimeout(id);
  }, [pathname]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <Outlet />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}
