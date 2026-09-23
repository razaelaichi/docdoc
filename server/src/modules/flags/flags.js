import { createHash } from "node:crypto";
import { config } from "../../config/index.js";

// Every flag is declared here with its default rollout (percent of signed-in doctors).
// FEATURE_FLAGS overrides rollouts without a frontend redeploy, e.g.
//   FEATURE_FLAGS="record-contents=100,intent-prefetch=25,keyboard-shortcuts=0"
export const FLAGS = {
  "record-contents": { rollout: 100, description: "Sticky contents list on the compiled record" },
  "intent-prefetch": { rollout: 100, description: "Prefetch a case when the doctor hovers or focuses its link" },
  "keyboard-shortcuts": { rollout: 100, description: "Ctrl/Cmd+K focuses case search" },
};

export function parseOverrides(text = "") {
  const overrides = {};
  for (const pair of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [name, value] = pair.split("=").map((s) => s.trim());
    const pct = { on: 100, off: 0 }[value] ?? Number(value);
    if (!(name in FLAGS) || !Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error(`FEATURE_FLAGS: invalid entry "${pair}"`);
    overrides[name] = pct;
  }
  return overrides;
}

const overrides = parseOverrides(config.FEATURE_FLAGS);

// Stable bucket per (flag, user): a user stays in or out of a partial rollout across sessions.
const bucket = (flag, userId) => createHash("sha256").update(`${flag}:${userId}`).digest().readUInt16BE(0) % 100;

export function evaluate(userId, rollouts = overrides) {
  return Object.fromEntries(
    Object.entries(FLAGS).map(([name, { rollout }]) => {
      const pct = rollouts[name] ?? rollout;
      const on = pct >= 100 || (pct > 0 && userId != null && bucket(name, userId) < pct);
      return [name, on];
    })
  );
}
