const BASE = "https://docdoc.invalid";

// Only same-origin paths may be used as a post-login destination: "//evil.example",
// "/\evil.example" and "https://evil.example" all fall back, so a crafted link can't
// bounce a doctor to a look-alike site after they sign in.
export function safeInternalPath(value, fallback = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  try {
    const url = new URL(value, BASE);
    return url.origin === BASE ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}
