import { useEffect } from "react";

// Every page has a unique title: it is what screen readers announce on navigation and what tabs show.
export function usePageTitle(...parts) {
  const title = [...parts.filter(Boolean), "DocDoc"].join(" · ");
  useEffect(() => {
    document.title = title;
  }, [title]);
}
