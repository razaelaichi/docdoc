import { expect, test } from "@playwright/test";
import { enforceSecurityHeaders, sharedUser, signIn } from "./support.js";

// Lab performance on the production build, under throttled network and CPU. Budgets match the
// "good" thresholds for Core Web Vitals (LCP 2.5 s, CLS 0.1, INP 200 ms); real-user numbers come
// from the RUM telemetry in Grafana.
test.describe.configure({ mode: "serial" });

const PROFILES = {
  "4G, 4x CPU": { latency: 80, download: (9 * 1024 * 1024) / 8, upload: (1.5 * 1024 * 1024) / 8, cpu: 4, lcp: 2500 },
  "slow 3G": { latency: 400, download: (400 * 1024) / 8, upload: (400 * 1024) / 8, cpu: 4, lcp: 8000 },
};

async function throttle(page, { latency, download, upload, cpu }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency, downloadThroughput: download, uploadThroughput: upload });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  return cdp;
}

// LCP, CLS and navigation timing collected in the page with the standard observers
const collectVitals = () =>
  new Promise((resolve) => {
    const out = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (out.lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (out.cls += e.value))).observe({ type: "layout-shift", buffered: true });
    setTimeout(() => {
      const [nav] = performance.getEntriesByType("navigation");
      resolve({ ...out, ttfb: nav.responseStart - nav.requestStart, fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime });
    }, 1500);
  });

test.beforeEach(async ({ context }) => {
  await enforceSecurityHeaders(context, []);
});

for (const [name, profile] of Object.entries(PROFILES)) {
  test(`sign-in page loads within budget on ${name}`, async ({ page }, info) => {
    await throttle(page, profile);
    await page.goto("/login", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    const vitals = await page.evaluate(collectVitals);
    info.annotations.push({ type: "vitals", description: JSON.stringify(vitals) });
    expect(vitals.lcp).toBeLessThan(profile.lcp);
    expect(vitals.cls).toBeLessThan(0.1);
  });
}

test("the compiled record renders and responds quickly on 4G with a 4x slower CPU", async ({ page }, info) => {
  await signIn(page);
  await throttle(page, PROFILES["4G, 4x CPU"]);
  const started = Date.now();
  await page.goto(`/cases/${sharedUser().caseId}/record`);
  await expect(page.getByRole("heading", { name: "Critical alerts" })).toBeVisible();
  const ready = Date.now() - started;
  const vitals = await page.evaluate(collectVitals);

  // Interaction latency (the INP ingredient): open a citation, measure input -> next paint
  await page.evaluate(() => {
    window.__events = [];
    new PerformanceObserver((l) => window.__events.push(...l.getEntries().map((e) => e.duration))).observe({ type: "event", durationThreshold: 16, buffered: false });
  });
  await page.getByRole("link", { name: /\[S\d+ p\.\d+\]/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  const worstInteraction = Math.max(0, ...(await page.evaluate(() => window.__events)));

  info.annotations.push({ type: "record", description: JSON.stringify({ ready, ...vitals, worstInteraction }) });
  expect(vitals.cls).toBeLessThan(0.1);
  expect(worstInteraction).toBeLessThan(200);
  expect(ready).toBeLessThan(4000);
});
