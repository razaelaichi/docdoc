import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth.jsx";
import { api } from "./api.js";

// Mirrors the server's defaults so the UI degrades gracefully if /flags is slow or down.
const DEFAULTS = { "record-contents": true, "intent-prefetch": true, "keyboard-shortcuts": true };

export function useFlag(name) {
  const { user } = useAuth();
  const flags = useQuery({
    queryKey: ["flags", user?.id ?? "anonymous"],
    queryFn: ({ signal }) => api("/flags", { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return flags.data?.[name] ?? DEFAULTS[name] ?? false;
}
