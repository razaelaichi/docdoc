import { api } from "./api.js";

// Authenticated download: the API needs the bearer token, so plain <a href> links can't be used.
export async function download(path, filename) {
  const res = await api(path, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}
