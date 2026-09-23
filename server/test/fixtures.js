import { createCanvas } from "@napi-rs/canvas";
import PDFDocument from "pdfkit";

export function pdf(build) {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    build(doc);
    doc.end();
  });
}

export function textImage(lines) {
  const canvas = createCanvas(1200, 80 + lines.length * 70);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.font = "48px sans-serif";
  lines.forEach((line, i) => ctx.fillText(line, 40, 80 + i * 70));
  return canvas.toBuffer("image/png");
}

// Minimal DICOM Part 10 file, explicit VR little endian
export function dicom(tags) {
  const element = (group, elem, vr, value) => {
    let v = Buffer.from(value, "latin1");
    if (v.length % 2) v = Buffer.concat([v, Buffer.from(vr === "UI" ? "\0" : " ")]);
    const header = Buffer.alloc(8);
    header.writeUInt16LE(group, 0);
    header.writeUInt16LE(elem, 2);
    header.write(vr, 4, "latin1");
    header.writeUInt16LE(v.length, 6);
    return Buffer.concat([header, v]);
  };
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from("DICM"),
    element(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"),
    ...tags.map(([g, e, vr, v]) => element(g, e, vr, v)),
  ]);
}

// Scripted stand-in for the model: returns queued replies, then finishes.
export const toolReply = (...calls) => ({
  choices: [
    {
      message: {
        content: null,
        tool_calls: calls.map(([name, args], i) => ({
          id: `call_${i}`,
          type: "function",
          function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
        })),
      },
    },
  ],
  usage: { total_tokens: 500 },
});

export function scriptedModel(replies) {
  const requests = [];
  return {
    requests,
    chat: async (params) => {
      requests.push(structuredClone(params));
      return replies.shift() ?? toolReply(["finish", {}]);
    },
  };
}

export const CATEGORY = { Hemoglobin: "lab_result", "Penicillin V": "medication", Allergies: "allergy", "Chest X-ray": "imaging_finding" };

// Stand-in model: records every "Label: value" line it is shown, quoting the line exactly.
export async function lineModel({ messages }) {
  if (messages.some((m) => m.role === "tool")) return toolReply(["finish", {}]);
  const facts = [...messages[1].content.matchAll(/page="(\d+)">\n([\s\S]*?)\n<\/untrusted_document>/g)].flatMap(([, page, body]) =>
    body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes(": "))
      .map((l) => {
        const label = l.slice(0, l.indexOf(": "));
        return { category: CATEGORY[label] ?? "other", label, value: l.slice(l.indexOf(": ") + 2), page: Number(page), quote: l };
      })
  );
  return toolReply(["record_facts", { facts }]);
}
