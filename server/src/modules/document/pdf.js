import { createRequire } from "node:module";
import path from "node:path";
import PDFDocument from "pdfkit";

const require = createRequire(import.meta.url);
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
// WOFF (not WOFF2): the PDF font subsetter can't re-embed these WOFF2 files. Plex Mono comes from IBM's
// complete files, because the Latin-subset webfont breaks subsetting.
const plex = (file) => path.join(pkgDir("@fontsource/ibm-plex-sans"), "files", `ibm-plex-sans-latin-${file}.woff`);
const plexMono = (weight) => path.join(pkgDir("@ibm/plex-mono"), "fonts", "complete", "woff", `IBMPlexMono-${weight}.woff`);
const serif = path.join(pkgDir("@fontsource/source-serif-4"), "files", "source-serif-4-latin-600-normal.woff");
const dejavu = (file) => path.join(pkgDir("dejavu-fonts-ttf"), "ttf", `${file}.ttf`);

// The Compiled Record screen's light theme (client/src/styles.css): warm paper, white panels on
// hairline rules, one green accent, oxblood alerts, ochre analyser flags.
const C = {
  paper: "#f5f4ef",
  surface: "#ffffff",
  surface2: "#faf9f5",
  ink: "#1b1d1c",
  ink2: "#444946",
  ink3: "#676c68",
  line: "#e2e0d8",
  lineStrong: "#c9c6bc",
  accent: "#1f5a45",
  accentSoft: "#e7efe9",
  alert: "#9b2c2c",
  alertSoft: "#f8ecea",
  alertLine: "#e7c8c3",
  flag: "#855600",
  flagSoft: "#fbf2df",
  flagLine: "#ecd7a8",
  imageBg: "#0d0f0e",
};
const M = 40; // page side margin
const TOPBAR = 34;
const TOP = TOPBAR + 22;
const FOOTER = 34;
const RADIUS = 6;
const PAD = 11; // panel and cell padding

// The app's fonts cover Latin script; anything else (e.g. a name in Devanagari) falls back to DejaVu per string.
const LATIN = /^[\t\n\r\u0020-\u024f\u2000-\u206f\u20ac\u2122\u2190-\u2193\u2212\u2215]*$/;
const FACES = {
  regular: ["plex", "dejavu"],
  medium: ["plex-medium", "dejavu-bold"],
  bold: ["plex-bold", "dejavu-bold"],
  italic: ["plex-italic", "dejavu-italic"],
  mono: ["plex-mono", "dejavu-mono"],
  monoMedium: ["plex-mono-medium", "dejavu-mono"],
  serif: ["serif", "dejavu-bold"],
};

// Identity facts are gathered into one identification panel instead of repeating in every section.
const IDENTITY = [
  ["Name", /^(patient('s)?\s*)?(full\s*)?name$/i],
  ["Date of birth", /^(date of birth|dob|birth ?date)$/i],
  ["Age", /^age$/i],
  ["Sex", /^(sex|gender)$/i],
  ["Record numbers", /^(mrn|uhid|patient ?id|hospital (no|number)|ip ?no|registration (no|number)|medical record number)\b/i],
];
const identityField = (f) => IDENTITY.find(([, re]) => re.test(f.label.trim()))?.[0];
const cite = (c) => `[${c.ref} p.${c.page}]`; // the app's citation format
const norm = (s) => (s ?? "").toString().trim().replace(/\s+/g, " ").toLowerCase();

/** Identical entries (same label, value and date) from several sources become one row with every citation. */
function merge(facts) {
  const rows = new Map();
  for (const f of facts) {
    const key = [f.category, norm(f.label), norm(f.value), norm(f.date)].join("|");
    const row = rows.get(key) ?? { ...f, citations: [], patientReported: false };
    if (!row.citations.some((c) => c.ref === f.citation.ref && c.page === f.citation.page)) row.citations.push(f.citation);
    row.patientReported ||= f.origin === "patient-reported";
    rows.set(key, row);
  }
  return [...rows.values()];
}

function yearSpan(facts) {
  const years = facts.map((f) => (f.date ?? "").match(/\b(19|20)\d{2}\b/)?.[0]).filter(Boolean).map(Number);
  if (!years.length) return null;
  const [min, max] = [Math.min(...years), Math.max(...years)];
  return min === max ? String(min) : `${min}–${max}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Writes the compiled record as a PDF that looks like the Compiled Record screen (light theme):
 * a cover with identification, summary and contents, then the same panels as the app (critical
 * alerts, one panel per section, lab results grouped by test, source index), then appendices.
 * Nothing is generated: every row is a stored fact with its citation.
 * assets: { images: Map<sourceId, Buffer>, pages: Map<"sourceId:page", Buffer>, texts: [{ ref, name, pages }] }
 */
export function writePdf(doc, assets, out) {
  const pdf = new PDFDocument({
    size: "A4",
    margins: { top: TOP, bottom: FOOTER + 14, left: M, right: M },
    bufferPages: true,
    info: { Title: `Compiled record: ${doc.case.patientName}`, Author: "DocDoc", Subject: "Compiled patient record with citations" },
  });
  const register = { plex: plex("400-normal"), "plex-medium": plex("500-normal"), "plex-bold": plex("600-normal"), "plex-italic": plex("400-italic") };
  for (const [name, file] of Object.entries(register)) pdf.registerFont(name, file);
  pdf.registerFont("plex-mono", plexMono("Regular"));
  pdf.registerFont("plex-mono-medium", plexMono("Medium"));
  pdf.registerFont("serif", serif);
  pdf.registerFont("dejavu", dejavu("DejaVuSans"));
  pdf.registerFont("dejavu-bold", dejavu("DejaVuSans-Bold"));
  pdf.registerFont("dejavu-italic", dejavu("DejaVuSans-Oblique"));
  pdf.registerFont("dejavu-mono", dejavu("DejaVuSansMono"));
  pdf.pipe(out);

  const W = pdf.page.width - 2 * M;
  const paintPaper = () => pdf.rect(0, 0, pdf.page.width, pdf.page.height).fill(C.paper);
  paintPaper();
  pdf.on("pageAdded", paintPaper);

  // ---------- text primitives ----------
  const face = (kind, str) => {
    const [app, fallback] = FACES[kind] ?? FACES.regular;
    return LATIN.test(String(str ?? "")) ? app : fallback;
  };
  const setFont = (kind, size, str) => pdf.font(face(kind, str)).fontSize(size);
  const text = (str, x, y, { font = "regular", size = 8.5, color = C.ink, ...opts } = {}) => {
    setFont(font, size, str).fillColor(color).text(String(str ?? ""), x, y, { lineGap: 1.2, ...opts });
  };
  const heightOf = (str, width, font = "regular", size = 8.5) =>
    str ? setFont(font, size, str).heightOfString(String(str), { width, lineGap: 1.2 }) : 0;
  const widthOf = (str, font = "regular", size = 8.5) => setFont(font, size, str).widthOfString(String(str));
  const hline = (x1, x2, y, color = C.line, weight = 0.6) => pdf.moveTo(x1, y).lineTo(x2, y).lineWidth(weight).strokeColor(color).stroke();

  // small stroke icons, as in the app
  const icon = {
    info(x, y, color = C.ink3) {
      pdf.circle(x + 5, y + 5, 4.6).lineWidth(0.9).strokeColor(color).stroke();
      pdf.moveTo(x + 5, y + 4.4).lineTo(x + 5, y + 7.4).stroke();
      pdf.circle(x + 5, y + 2.9, 0.5).fill(color);
    },
    alert(x, y, color = C.alert) {
      pdf.moveTo(x + 5.5, y + 0.8).lineTo(x + 10.6, y + 9.6).lineTo(x + 0.4, y + 9.6).closePath().lineWidth(0.9).strokeColor(color).stroke();
      pdf.moveTo(x + 5.5, y + 4).lineTo(x + 5.5, y + 6.6).stroke();
      pdf.circle(x + 5.5, y + 8, 0.5).fill(color);
    },
    flag(x, y, color = C.flag) {
      pdf.moveTo(x + 1.5, y + 10).lineTo(x + 1.5, y + 0.8).lineTo(x + 8.8, y + 0.8).lineTo(x + 7.2, y + 3.4).lineTo(x + 8.8, y + 6).lineTo(x + 1.5, y + 6)
        .lineWidth(0.9).strokeColor(color).stroke();
    },
    brand(x, y) {
      pdf.roundedRect(x, y, 14, 14, 3.2).fill(C.accent);
      pdf.moveTo(x + 5.6, y + 3.8).lineTo(x + 4.2, y + 3.8).lineTo(x + 4.2, y + 10.2).lineTo(x + 5.6, y + 10.2)
        .moveTo(x + 8.4, y + 3.8).lineTo(x + 9.8, y + 3.8).lineTo(x + 9.8, y + 10.2).lineTo(x + 8.4, y + 10.2)
        .lineWidth(1.1).lineCap("round").lineJoin("round").strokeColor("#ffffff").stroke();
    },
  };

  // chips and pills, measured so rows can be sized before they are drawn
  const CHIP_H = 12.5;
  const chipWidth = (label) => widthOf(label, "monoMedium", 7) + 8;
  const chip = (label, x, y) => {
    pdf.roundedRect(x, y, chipWidth(label), CHIP_H, 2.5).lineWidth(0.6).fillAndStroke(C.surface2, C.line);
    text(label, x + 4, y + 2.6, { font: "monoMedium", size: 7, color: C.accent, lineBreak: false });
  };
  function chipLines(labels, width) {
    const lines = [[]];
    let used = 0;
    for (const l of labels) {
      const w = chipWidth(l) + 4;
      if (used + w > width && lines.at(-1).length) {
        lines.push([]);
        used = 0;
      }
      lines.at(-1).push(l);
      used += w;
    }
    return lines;
  }
  const pill = (label, x, y, { fill = C.surface, stroke = C.line, color = C.ink2 } = {}) => {
    const w = widthOf(label, "medium", 6.8) + 10;
    pdf.roundedRect(x, y, w, 11.5, 5.75).lineWidth(0.6).fillAndStroke(fill, stroke);
    text(label, x + 5, y + 2.3, { font: "medium", size: 6.8, color, lineBreak: false });
    return w;
  };

  // ---------- pages and panels ----------
  const bottom = () => pdf.page.height - pdf.page.margins.bottom;
  const currentPage = () => pdf.bufferedPageRange().start + pdf.bufferedPageRange().count - 1;
  let panel = null; // { top, variant, title }

  // Rounded panel border for the part of a panel on this page; corners outside the curve are
  // painted back to paper, since rows are filled square.
  function closeSegment(y) {
    const { top } = panel;
    for (const [cx, cy, sx, sy] of [
      [M, y, 1, -1],
      [M + W, y, -1, -1],
    ]) {
      pdf.moveTo(cx, cy + sy * RADIUS).lineTo(cx, cy).lineTo(cx + sx * RADIUS, cy)
        .quadraticCurveTo(cx, cy, cx, cy + sy * RADIUS).fill(C.paper);
    }
    pdf.roundedRect(M, top, W, y - top, RADIUS).lineWidth(0.7).strokeColor(panel.variant === "alert" ? C.alertLine : C.line).stroke();
  }

  function drawPanelHead({ title, count, variant, continued }) {
    const y = pdf.y;
    const h = 26;
    const alert = variant === "alert";
    pdf.moveTo(M, y + RADIUS).quadraticCurveTo(M, y, M + RADIUS, y).lineTo(M + W - RADIUS, y).quadraticCurveTo(M + W, y, M + W, y + RADIUS)
      .lineTo(M + W, y + h).lineTo(M, y + h).closePath().fill(alert ? C.alertSoft : C.surface);
    let x = M + PAD;
    if (alert) {
      icon.alert(x, y + 8);
      x += 16;
    }
    const label = continued ? `${title} (continued)` : title;
    text(label, x, y + 7.8, { font: "bold", size: 9.5, color: alert ? C.alert : C.ink, lineBreak: false });
    if (count != null && !continued) text(String(count), x + widthOf(label, "bold", 9.5) + 6, y + 7.8, { size: 9.5, color: C.ink3, lineBreak: false });
    pdf.y = y + h;
    hline(M, M + W, pdf.y, alert ? C.alertLine : C.line);
  }

  /** Makes room for `height`; inside a panel, closes it on this page and reopens it on the next. */
  function ensure(height) {
    if (pdf.y + height <= bottom()) return;
    if (panel) closeSegment(pdf.y);
    pdf.addPage();
    if (panel) {
      panel.top = pdf.y;
      drawPanelHead({ ...panel, continued: true });
    }
  }

  function openPanel(options) {
    pdf.y += 12;
    ensure(80);
    panel = { ...options, top: pdf.y };
    drawPanelHead(panel);
  }

  function closePanel() {
    closeSegment(pdf.y);
    panel = null;
  }

  /** A block inside the current panel: white background of known height, then its content. */
  function block(height, draw, fill = C.surface) {
    ensure(height);
    const y = pdf.y;
    pdf.rect(M, y, W, height).fill(fill);
    draw(y);
    pdf.y = y + height;
  }

  // ---------- tables (the app's table: muted header band, hairline rows, padded cells) ----------
  const cellLines = (cell) => (cell && typeof cell === "object" && !Array.isArray(cell) ? cell : { lines: [{ text: cell ?? "" }] });
  function measureCell(cell, width) {
    const c = cellLines(cell);
    let h = 0;
    for (const l of c.lines ?? []) if (l.text) h += heightOf(l.text, width, l.font, l.size ?? 8.5) + (l.gap ?? 2);
    if (c.pills?.length) h += 14;
    if (c.chips?.length) h += chipLines(c.chips, width).length * (CHIP_H + 3);
    return h;
  }
  function drawCell(cell, x, y, width, align) {
    const c = cellLines(cell);
    let cy = y;
    for (const l of c.lines ?? []) {
      if (!l.text) continue;
      if (l.icon) icon[l.icon](x, cy + 0.5);
      const indent = l.icon ? 13 : 0;
      text(l.text, x + indent, cy, { font: l.font, size: l.size ?? 8.5, color: l.color ?? C.ink, width: width - indent, align });
      cy += heightOf(l.text, width - indent, l.font, l.size ?? 8.5) + (l.gap ?? 2);
    }
    if (c.pills?.length) {
      let px = x;
      for (const p of c.pills) px += pill(p, px, cy) + 4;
      cy += 14;
    }
    if (c.chips?.length) {
      for (const line of chipLines(c.chips, width)) {
        const lineWidth = line.reduce((n, l) => n + chipWidth(l) + 4, -4);
        let cx = align === "right" ? x + width - lineWidth : x;
        for (const l of line) {
          chip(l, cx, cy);
          cx += chipWidth(l) + 4;
        }
        cy += CHIP_H + 3;
      }
    }
  }

  function table(columns, rows, { header = true } = {}) {
    const total = columns.reduce((n, c) => n + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * W);
    const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const inner = (i) => widths[i] - 2 * PAD;
    const drawHeader = () =>
      block(20, (y) => {
        columns.forEach((c, i) => text(c.header, xs[i] + PAD, y + 6.3, { font: "medium", size: 7.2, color: C.ink3, width: inner(i), align: c.align, lineBreak: false }));
        hline(M, M + W, y + 20);
      }, C.surface2);

    if (header) drawHeader();
    rows.forEach((row, r) => {
      const h = Math.max(...row.map((cell, i) => measureCell(cell, inner(i)))) + 2 * 8.5 - 2;
      if (pdf.y + h > bottom()) {
        ensure(h + 30); // new page: the panel reopens, the header row repeats
        if (header) drawHeader();
      }
      block(h, (y) => {
        row.forEach((cell, i) => drawCell(cell, xs[i] + PAD, y + 8.5, inner(i), columns[i].align));
        if (r < rows.length - 1) hline(M, M + W, y + h);
      }, row.highlight ?? C.surface);
    });
  }

  // one fact row, drawn like the app: label bold, pill, details, italic quote; value with flag; date; citation chips
  const FACT_COLUMNS = [
    { header: "Entry", width: 38 },
    { header: "Value", width: 30 },
    { header: "Date (as written)", width: 15 },
    { header: "Source", width: 17, align: "right" },
  ];
  const factRow = (f, { grouped = false } = {}) => [
    {
      lines: [
        !grouped && { text: f.label, font: "bold", size: 8.8, gap: 1 },
        f.details && { text: f.details, size: 7.8, color: C.ink2, gap: 1 },
        { text: `“${f.quote}”`, font: "italic", size: 7.6, color: C.ink3 },
      ].filter(Boolean),
      pills: f.patientReported ? ["Patient-reported"] : [],
    },
    {
      lines: [
        { text: f.value ?? "" },
        f.flag && { text: `${f.flag} printed range (analyser)`, icon: "flag", font: "medium", size: 7.8, color: C.flag },
      ].filter(Boolean),
    },
    { lines: [{ text: f.date || "—", color: f.date ? C.ink2 : C.ink3 }] },
    { chips: f.citations.map(cite) },
  ];

  function notice(message, { tone = "flag" } = {}) {
    const color = tone === "flag" ? C.ink : C.ink2;
    const inset = PAD;
    const width = W - 2 * inset - 30;
    const h = heightOf(message, width, "regular", 8.5) + 18;
    block(h + 12, (y) => {
      pdf.roundedRect(M + inset, y + 6, W - 2 * inset, h, 4).lineWidth(0.6).fillAndStroke(tone === "flag" ? C.flagSoft : C.surface2, tone === "flag" ? C.flagLine : C.line);
      if (tone === "flag") icon.flag(M + inset + 10, y + 15);
      else icon.info(M + inset + 10, y + 15);
      text(message, M + inset + 26, y + 15, { size: 8.5, color, width });
    });
  }

  // ---------- derived content ----------
  const allFacts = doc.sections.flatMap((s) => s.facts);
  const identity = new Map(IDENTITY.map(([field]) => [field, []]));
  for (const f of allFacts) {
    const field = identityField(f);
    if (!field) continue;
    const values = identity.get(field);
    const existing = values.find((v) => norm(v.value) === norm(f.value));
    if (existing) existing.citations.push(f.citation);
    else values.push({ value: f.value, citations: [f.citation] });
  }
  const clinical = (s) => merge(s.facts.filter((f) => !identityField(f)));
  const bySection = new Map(doc.sections.map((s) => [s.key, s]));
  const { allergies, conflicts, abnormalLabs } = doc.alerts;
  const { pending, failed, notStructured } = doc.completeness;

  const plan = [
    { key: "alerts", title: "Critical alerts", count: allergies.length + conflicts.length },
    ...doc.sections
      .filter((s) => s.key !== "allergy")
      .map((s) => ({ key: s.key, title: s.title, count: clinical(s).length + (s.images?.length ?? 0) })),
    { key: "sources", title: "Source index", count: doc.sources.length },
  ];
  const appendix = { title: "Appendix: full extracted text" };
  const imagesAppendix = { title: "Appendix: images and cited pages" };
  const mark = (entry, level = 0) => {
    entry.page = currentPage();
    pdf.outline.addItem(entry.title, { expanded: level === 0 });
  };

  // ---------- cover: the page head of the Compiled Record screen ----------
  const generated = new Date(doc.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  text("DocDoc  /  Compiled record", M, pdf.y, { size: 8.5, color: C.ink3 });
  pdf.y += 6;
  text(doc.case.patientName, M, pdf.y, { font: "serif", size: 25, color: C.ink });
  pdf.y += 2;
  const span = yearSpan(allFacts);
  text([`Compiled from ${plural(doc.sources.length, "source")}`, `generated ${generated}`, span && `documents dated ${span}`].filter(Boolean).join("  ·  "), M, pdf.y, {
    size: 9,
    color: C.ink3,
  });
  pdf.y += 12;
  hline(M, M + W, pdf.y);
  pdf.y += 12;
  icon.info(M, pdf.y + 1);
  text(
    "Every entry is copied from its cited source and quoted verbatim; nothing is inferred. Items marked (analyser) are automatic cross-checks, not source data. A chip such as [S3 p.2] means source 3 in the source index, page 2.",
    M + 16,
    pdf.y,
    { size: 8.2, color: C.ink3, width: W - 16 }
  );

  openPanel({ title: "At a glance" });
  const allergyText = merge(allergies).map((a) => [a.label, a.value].filter(Boolean).join(": ")).join("; ");
  table(
    [
      { header: "", width: 28 },
      { header: "", width: 72 },
    ],
    [
      [{ lines: [{ text: "Allergies", font: "bold" }] }, { lines: [{ text: allergyText || "None recorded in any source", font: allergyText ? "bold" : "regular", color: allergyText ? C.alert : C.ink }] }],
      [{ lines: [{ text: "Cross-check warnings", font: "bold" }] }, { lines: [{ text: conflicts.length ? `${conflicts.length}, listed under Critical alerts` : "None", color: conflicts.length ? C.flag : C.ink }] }],
      [{ lines: [{ text: "Results outside range", font: "bold" }] }, { lines: [{ text: abnormalLabs.length ? `${abnormalLabs.length}, flagged in Lab results` : "None" }] }],
      [
        { lines: [{ text: "Completeness", font: "bold" }] },
        {
          lines: [
            {
              text:
                pending.length + failed.length + notStructured.length
                  ? [pending.length && `still processing: ${pending.join(", ")}`, failed.length && `could not be read: ${failed.join(", ")}`, notStructured.length && `text only: ${notStructured.join(", ")}`]
                      .filter(Boolean)
                      .join("; ")
                  : "Every source was read and structured",
              color: pending.length + failed.length ? C.alert : C.ink,
            },
          ],
        },
      ],
    ],
    { header: false }
  );
  closePanel();

  // contents: the app's section list with counts; page numbers are filled in at the end
  openPanel({ title: "Contents" });
  const imaging = bySection.get("imaging_finding");
  const cited = (imaging?.renderedPages ?? []).map((p) => ({ ...p, buffer: assets.pages.get(`${p.sourceId}:${p.page}`) })).filter((p) => p.buffer);
  const contentsRows = [...plan, ...(cited.length ? [imagesAppendix] : []), appendix];
  const ROW = 17;
  let contentsAt;
  block(contentsRows.length * ROW + 6, (y) => (contentsAt = { page: currentPage(), y })); // written once pages are known
  closePanel();

  // patient identification, as the sources write it; disagreements are shown, never resolved
  const idRows = [...identity.entries()].filter(([, v]) => v.length);
  openPanel({ title: "Patient identification" });
  if (idRows.length) {
    table(
      [
        { header: "Field", width: 24 },
        { header: "As written in the sources", width: 46 },
        { header: "Source", width: 30, align: "right" },
      ],
      idRows.flatMap(([field, values]) =>
        values.map((v, i) => [
          i === 0 ? { lines: [{ text: field, font: "bold" }] } : "",
          {
            lines: [
              { text: v.value ?? "" },
              i === 0 && values.length > 1 && field !== "Record numbers" && { text: "Sources disagree (analyser): every value is listed", icon: "flag", font: "medium", size: 7.8, color: C.flag },
            ].filter(Boolean),
          },
          { chips: [...v.citations.slice(0, 5).map(cite), ...(v.citations.length > 5 ? [`+${v.citations.length - 5}`] : [])] },
        ])
      )
    );
  } else {
    notice("No identifying details were found in the sources. Confirm the patient's identity before relying on this record.");
  }
  closePanel();


  // ---------- critical alerts (the red panel) ----------
  pdf.addPage();
  mark(plan[0]);
  openPanel({ title: "Critical alerts", variant: "alert" });
  if (allergies.length) {
    table(FACT_COLUMNS, merge(allergies).map((f) => factRow(f)));
  } else {
    block(30, (y) => text("No allergies recorded in any source.", M + PAD, y + 10, { size: 8.8, color: C.ink2 }));
  }
  if (conflicts.length) {
    hline(M, M + W, pdf.y);
    block(4, () => {});
    for (const c of conflicts) {
      const refs = c.factIds.map((id) => allFacts.find((f) => f.id === id)?.citation).filter(Boolean).map(cite);
      notice(`${c.message} (analyser)${refs.length ? `  ·  entries ${refs.join(", ")}` : ""}`);
    }
    block(6, () => {});
  }
  closePanel();

  // ---------- one panel per section, as on screen ----------
  for (const entry of plan.slice(1, -1)) {
    const section = bySection.get(entry.key);
    const rows = clinical(section);
    const images = section.images ?? [];
    if (!rows.length && !images.length) continue;
    mark(entry);
    openPanel({ title: section.title, count: entry.count });

    if (section.key === "lab_result") {
      const groups = Object.entries(Object.groupBy(rows, (r) => r.label));
      groups.forEach(([label, facts], i) => {
        // the lab group's summary line: chevron, test name, count
        ensure(70);
        block(24, (y) => {
          if (i > 0) hline(M, M + W, y);
          pdf.moveTo(M + PAD + 1, y + 9).lineTo(M + PAD + 4, y + 12.5).lineTo(M + PAD + 7, y + 9).lineWidth(0.9).strokeColor(C.ink3).stroke();
          text(label, M + PAD + 14, y + 7.5, { font: "medium", size: 9, lineBreak: false });
          text(String(facts.length), M + PAD + 20 + widthOf(label, "medium", 9), y + 7.5, { size: 9, color: C.ink3, lineBreak: false });
        });
        table(FACT_COLUMNS, facts.map((f) => factRow(f, { grouped: true })));
      });
    } else if (rows.length) {
      table(FACT_COLUMNS, rows.map((f) => factRow(f)));
    }

    // images: the app's figure grid (dark frame, caption below), two per row
    if (images.length) {
      const cols = 2;
      const gap = 10;
      const fw = (W - 2 * PAD - gap) / cols;
      const fh = 150;
      for (let i = 0; i < images.length; i += cols) {
        const rowImages = images.slice(i, i + cols);
        const captionH = Math.max(...rowImages.map((img) => heightOf(`${img.ref} · ${img.name}${img.citedBy.length ? "" : " · no findings extracted"}`, fw - 12, "regular", 7.6))) + 10;
        block(fh + captionH + 14, (y) => {
          if (i === 0 && rows.length) hline(M, M + W, y);
          rowImages.forEach((img, j) => {
            const x = M + PAD + j * (fw + gap);
            const top = y + 10;
            pdf.roundedRect(x, top, fw, fh + captionH, 4).lineWidth(0.6).fillAndStroke(C.surface2, C.line);
            pdf.rect(x + 0.5, top + 0.5, fw - 1, fh).fill(C.imageBg);
            const buffer = assets.images.get(img.sourceId);
            try {
              if (buffer) pdf.image(buffer, x + 0.5, top + 0.5, { fit: [fw - 1, fh], align: "center", valign: "center" });
            } catch {
              text("Image unavailable", x, top + fh / 2 - 5, { size: 8, color: "#ffffff", width: fw, align: "center" });
            }
            hline(x, x + fw, top + fh);
            text(`${img.ref} · ${img.name}${img.citedBy.length ? "" : " · no findings extracted"}`, x + 6, top + fh + 5, { size: 7.6, color: C.ink2, width: fw - 12 });
          });
        });
      }
    }
    closePanel();
  }

  const empty = plan.slice(1, -1).filter((e) => !e.count);
  if (empty.length) {
    pdf.y += 10;
    ensure(24);
    text(`Not recorded in any source: ${empty.map((e) => e.title.toLowerCase()).join(", ")}.`, M, pdf.y, { size: 8.2, color: C.ink3, width: W });
  }

  // ---------- source index ----------
  mark(plan.at(-1));
  openPanel({ title: "Source index", count: doc.sources.length });
  table(
    [
      { header: "Ref", width: 8 },
      { header: "Source", width: 40 },
      { header: "From", width: 20 },
      { header: "Result", width: 32 },
    ],
    doc.sources.map((s) => [
      { chips: [s.ref] },
      { lines: [{ text: s.name }] },
      { lines: [{ text: `${s.uploadedBy === "patient" ? "Patient" : "Doctor"} · ${new Date(s.uploadedAt).toLocaleDateString("en-GB")}`, color: C.ink3 }] },
      {
        lines: [
          { text: [s.status, s.pages && plural(s.pages, "page"), plural(s.factCount, "entry", "entries")].filter(Boolean).join(" · ") },
          s.uncoveredPages.length && { text: `No entries on page ${s.uncoveredPages.join(", ")}`, size: 7.6, color: C.flag },
          s.lowConfidencePages.length && { text: `Low OCR confidence on page ${s.lowConfidencePages.join(", ")}`, size: 7.6, color: C.flag },
          s.error && { text: s.error, size: 7.6, color: C.alert },
        ].filter(Boolean),
      },
    ])
  );
  closePanel();

  // ---------- appendix: cited PDF pages from imaging reports ----------
  if (cited.length) {
    pdf.addPage();
    mark(imagesAppendix);
    openPanel({ title: imagesAppendix.title, count: cited.length });
    for (const p of cited) {
      block(360, (y) => {
        text(`${p.ref} page ${p.page}, cited in Imaging & radiology`, M + PAD, y + 10, { size: 8, color: C.ink3 });
        pdf.roundedRect(M + PAD, y + 26, W - 2 * PAD, 320, 4).lineWidth(0.6).fillAndStroke(C.surface2, C.line);
        try {
          pdf.image(p.buffer, M + PAD + 4, y + 30, { fit: [W - 2 * PAD - 8, 312], align: "center", valign: "center" });
        } catch {
          text("(page could not be embedded)", M + PAD, y + 170, { size: 8, color: C.ink3, width: W - 2 * PAD, align: "center" });
        }
      });
    }
    closePanel();
  }

  // ---------- appendix: full text, as the citation viewer shows it ----------
  pdf.addPage();
  mark(appendix);
  text("Full extracted text", M, pdf.y, { font: "serif", size: 18 });
  pdf.y += 4;
  text("Everything read from each source, so nothing that wasn't captured as an entry is lost.", M, pdf.y, { size: 8.5, color: C.ink3 });
  const methods = { "text-layer": "text layer", ocr: "read by OCR", metadata: "file metadata", entered: "typed in" };
  for (const t of assets.texts) {
    openPanel({ title: `${t.ref}  ${t.name}` });
    for (const p of t.pages) {
      const meta = `Page ${p.page} · ${methods[p.method] ?? p.method}${p.confidence != null ? `, ${p.confidence}% confidence` : ""}`;
      block(22, (y) => text(meta, M + PAD, y + 8, { font: "medium", size: 7.4, color: C.ink3 }));
      // line by line, so long pages break cleanly across PDF pages
      const width = W - 4 * PAD;
      const lines = (p.text || "(no text)").split("\n");
      lines.forEach((line, i) => {
        const h = Math.max(heightOf(line || " ", width, "mono", 7.4), 9.5);
        block(h + (i === lines.length - 1 ? 12 : 0), (y) => {
          pdf.rect(M + PAD, y, W - 2 * PAD, h + (i === lines.length - 1 ? 4 : 0)).fill(C.surface2);
          text(line, M + 2 * PAD, y, { font: "mono", size: 7.4, color: C.ink2, width });
        });
      });
    }
    closePanel();
  }

  // ---------- contents, now that page numbers are known ----------
  const { start, count } = pdf.bufferedPageRange();
  pdf.switchToPage(contentsAt.page);
  contentsRows.forEach((e, i) => {
    const y = contentsAt.y + 5 + i * ROW;
    const listed = e.page != null;
    text(e.title, M + PAD, y + 3, { size: 9, color: e.key === "alerts" && e.count ? C.alert : listed ? C.ink : C.ink3, lineBreak: false });
    if (e.count != null) text(String(e.count), M + W - 130, y + 3, { size: 9, color: C.ink3, width: 40, align: "right", lineBreak: false });
    text(listed ? `page ${e.page - start + 1}` : "none recorded", M + W - 80 - PAD, y + 3, { size: 8.5, color: C.ink3, width: 80, align: "right", lineBreak: false });
    if (i < contentsRows.length - 1) hline(M + PAD, M + W - PAD, y + ROW, "#efede6", 0.5);
  });

  // ---------- the app's top bar, and a footer, on every page ----------
  const dob = identity.get("Date of birth")[0]?.value;
  for (let i = start; i < start + count; i++) {
    pdf.switchToPage(i);
    const saved = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0; // drawing in the margin must not trigger a page break
    pdf.rect(0, 0, pdf.page.width, TOPBAR).fill(C.surface);
    hline(0, pdf.page.width, TOPBAR, C.line);
    icon.brand(M, 10);
    text("DocDoc", M + 20, 11.5, { font: "bold", size: 10, lineBreak: false });
    text(`${doc.case.patientName}${dob ? `  ·  born ${dob}` : ""}  ·  Compiled record`, M, 12.5, { size: 8, color: C.ink2, width: W, align: "right", lineBreak: false });
    const fy = pdf.page.height - FOOTER + 10;
    text(`Generated ${generated} by DocDoc  ·  Confidential patient information`, M, fy, { size: 7, color: C.ink3, lineBreak: false });
    text(`Page ${i - start + 1} of ${count}`, M, fy, { size: 7, color: C.ink3, width: W, align: "right", lineBreak: false });
    pdf.page.margins.bottom = saved;
  }
  pdf.end();
}
