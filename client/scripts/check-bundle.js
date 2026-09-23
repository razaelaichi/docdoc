// Performance budget for the production build (gzip sizes). Run after `vite build`; exits
// non-zero when a budget is exceeded, so CI blocks the regression instead of shipping it.
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET_KB = {
  initialJs: 130, // what every first visit downloads before anything renders: entry + vendor + preloads
  css: 14,
  routeChunk: 20, // any single lazily loaded page
};

const dist = new URL("../dist/", import.meta.url);
const html = readFileSync(new URL("index.html", dist), "utf8");
const gz = (file) => gzipSync(readFileSync(new URL(file.replace(/^\//, ""), dist))).length / 1024;

const initial = [...html.matchAll(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g)].map((m) => m[1]);
const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
const lazy = readdirSync(new URL("assets/", dist)).filter((f) => f.endsWith(".js") && !initial.some((i) => i.endsWith(f)));

const rows = [
  ["initial JS", initial.reduce((n, f) => n + gz(f), 0), BUDGET_KB.initialJs],
  ["CSS", css.reduce((n, f) => n + gz(f), 0), BUDGET_KB.css],
  ...lazy.map((f) => [`route chunk ${f}`, gz(`assets/${f}`), BUDGET_KB.routeChunk]),
];

let failed = false;
for (const [name, kb, budget] of rows) {
  const over = kb > budget;
  failed ||= over;
  console.log(`${over ? "OVER" : "ok  "}  ${name.padEnd(48)} ${kb.toFixed(1).padStart(6)} kB / ${budget} kB`);
}
if (failed) {
  console.error("\nBundle budget exceeded. Split the code, drop a dependency, or raise the budget deliberately.");
  process.exit(1);
}
