// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG 2.2 AA colour contrast, checked against the design tokens themselves so a palette
// change that breaks legibility fails CI. 4.5:1 for text, 3:1 for UI component boundaries.
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, k, v]) => [k, v]));
const themes = {
  light: block(/:root \{([\s\S]*?)\n\}/),
  dark: block(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n {2}\}/),
};

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = [
  ["ink", "paper"], ["ink", "surface"], ["ink-2", "surface"], ["ink-3", "surface"], ["ink-3", "paper"], ["ink-3", "surface-2"],
  ["accent", "surface"], ["accent", "paper"], ["accent", "accent-soft"], ["on-accent", "accent"],
  ["alert", "surface"], ["alert", "alert-soft"], ["flag", "surface"], ["flag", "flag-soft"],
  ["ok", "ok-soft"], ["mark-ink", "mark"], ["paper", "ink"],
];
const UI = [["field-border", "surface"], ["field-border", "surface-2"], ["accent", "surface"]];

describe.each(Object.entries(themes))("%s theme", (_name, t) => {
  it.each(TEXT)("text %s on %s is at least 4.5:1", (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(UI)("control boundary %s on %s is at least 3:1", (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });
});
