import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The gateway's security headers, so `vite preview` behaves like production. Only preview uses them:
// a build context without deploy/ (e.g. a Docker stage that copies only client/) still builds.
function readSecurityHeaders() {
  let conf;
  try {
    conf = readFileSync(new URL("../deploy/security-headers.conf", import.meta.url), "utf8");
  } catch {
    return {};
  }
  return Object.fromEntries([...conf.matchAll(/^add_header ([\w-]+) (["'])(.+)\2 always;/gm)].map(([, name, , value]) => [name, value]));
}
const securityHeaders = readSecurityHeaders();

// Preload the two fonts every page renders above the fold, so text paints in its final face
// without a late swap (less layout shift, earlier LCP).
const CRITICAL_FONTS = [/ibm-plex-sans-latin-400-normal-[\w-]+\.woff2$/, /source-serif-4-latin-wght-normal-[\w-]+\.woff2$/];
const preloadFonts = () => ({
  name: "docdoc:preload-fonts",
  transformIndexHtml(_html, { bundle }) {
    if (!bundle) return [];
    return Object.keys(bundle)
      .filter((file) => CRITICAL_FONTS.some((re) => re.test(file)))
      .map((file) => ({
        tag: "link",
        attrs: { rel: "preload", href: `/${file}`, as: "font", type: "font/woff2", crossorigin: "" },
        injectTo: "head",
      }));
  },
});

// Writes .br and .gz next to each compressible file, at maximum compression, once at build
// time; the gateway/CDN serves them without compressing on every request.
const COMPRESSIBLE = /\.(js|css|html|svg|json)$/;
const precompress = () => ({
  name: "docdoc:precompress",
  apply: "build",
  async writeBundle({ dir }, bundle) {
    await Promise.all(
      Object.values(bundle)
        .filter((f) => COMPRESSIBLE.test(f.fileName))
        .flatMap((f) => {
          const data = Buffer.from(f.type === "chunk" ? f.code : f.source);
          if (data.length < 1024) return [];
          const out = path.join(dir, f.fileName);
          return [
            writeFile(`${out}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })),
            writeFile(`${out}.gz`, gzipSync(data, { level: 9 })),
          ];
        })
    );
  },
});

export default defineConfig({
  plugins: [react(), preloadFonts(), precompress()],
  // same-origin in dev: the browser talks to Vite, Vite forwards /api to the server
  server: { proxy: { "/api": process.env.API_URL ?? "http://localhost:4000" } },
  preview: { headers: securityHeaders },
  build: {
    sourcemap: false, // never ship source to the browser; stacks in reports are scrubbed file:line only
    rolldownOptions: {
      output: {
        // framework code changes rarely: its own long-cached chunk survives app deploys
        codeSplitting: { groups: [{ name: "vendor", test: /node_modules[\\/](react|react-dom|react-router|scheduler|@tanstack)[\\/]/ }] },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.js"],
    css: false,
  },
});
