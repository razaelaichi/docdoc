import { z } from "zod";
import { counter, histogram } from "../../lib/metrics.js";

const runs = counter("agent_runs_total", "Agent runs", ["agent", "outcome"]);
const iterations = histogram("agent_iterations", "Model turns per agent run", ["agent"], [1, 2, 4, 8, 16, 32, 64]);
const toolCalls = counter("agent_tool_calls_total", "Agent tool calls", ["agent", "tool", "outcome"]);

const MAX_ARGUMENT_BYTES = 200_000;

// The provider's reply is untrusted too: check its shape before acting on it.
const modelReply = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({ name: z.string(), arguments: z.string() }),
              })
            )
            .nullish(),
        }),
      })
    )
    .min(1),
  usage: z.object({ total_tokens: z.number() }).nullish(),
});

export class AgentLimitError extends Error {}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("tool timed out")), ms).unref())]);

/**
 * Runs a tool-using agent inside hard limits. The model only *proposes* tool calls;
 * this loop decides whether each one runs:
 *   allowlist → per-tool call cap → argument size → JSON → schema validation → timeout → audit
 *
 * tools: { [name]: { description, input: zodSchema, run(args), maxCalls, timeoutMs?, terminal? } }
 * Tools close over their scope (case, source) on the server side; nothing the model sends can widen it.
 */
export async function runAgent({ agent, chat, system, prompt, tools, limits, audit }) {
  const specs = Object.entries(tools).map(([name, tool]) => ({
    type: "function",
    function: { name, description: tool.description, parameters: z.toJSONSchema(tool.input) },
  }));
  const messages = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];
  const callCounts = {};
  const deadline = Date.now() + limits.maxDurationMs;
  let tokensUsed = 0;

  const stop = (reason) => {
    runs.inc({ agent, outcome: `limit_${reason}` });
    return new AgentLimitError(`Agent stopped: ${reason} limit reached`);
  };

  for (let turn = 1; turn <= limits.maxTurns; turn++) {
    if (Date.now() > deadline) throw stop("time");

    const reply = modelReply.safeParse(await chat({ messages, tools: specs, max_tokens: limits.maxTokensPerTurn }));
    if (!reply.success) {
      runs.inc({ agent, outcome: "bad_reply" });
      throw new Error("Malformed model reply");
    }
    tokensUsed += reply.data.usage?.total_tokens ?? 0;
    if (tokensUsed > limits.maxTotalTokens) throw stop("token");

    const { content, tool_calls: calls } = reply.data.choices[0].message;
    messages.push({ role: "assistant", content: content ?? "", ...(calls?.length && { tool_calls: calls }) });
    if (!calls?.length) {
      messages.push({ role: "user", content: "Reply only with tool calls. Call finish when you are done." });
      continue;
    }

    for (const call of calls) {
      const { result, terminal } = await execute(agent, call, tools, callCounts, audit);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      if (terminal) {
        runs.inc({ agent, outcome: "completed" });
        iterations.observe({ agent }, turn);
        return { turns: turn, tokensUsed };
      }
    }
  }
  throw stop("turn");
}

async function execute(agent, call, tools, callCounts, audit) {
  const name = call.function.name;
  // Object.hasOwn: names like "constructor" or "__proto__" never resolve to a tool
  const tool = Object.hasOwn(tools, name) ? tools[name] : undefined;
  const outcome = (label, result) => {
    toolCalls.inc({ agent, tool: tool ? name : "unknown", outcome: label });
    return { result };
  };

  if (!tool) {
    await audit("agent.tool_denied", { tool: name.slice(0, 64), reason: "not allowlisted" });
    return outcome("denied", { error: `Unknown tool. Allowed: ${Object.keys(tools).join(", ")}` });
  }
  callCounts[name] = (callCounts[name] ?? 0) + 1;
  if (callCounts[name] > tool.maxCalls) {
    await audit("agent.tool_denied", { tool: name, reason: "call limit" });
    return outcome("denied", { error: "Call limit for this tool reached" });
  }
  if (call.function.arguments.length > MAX_ARGUMENT_BYTES) return outcome("invalid", { error: "Arguments too large" });

  let args;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return outcome("invalid", { error: "Arguments must be valid JSON" });
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`);
    return outcome("invalid", { error: "Invalid arguments", issues });
  }

  try {
    const result = await withTimeout(tool.run(parsed.data), tool.timeoutMs ?? 10_000);
    await audit("agent.tool_call", { tool: name });
    return { ...outcome("ok", result), terminal: Boolean(tool.terminal) };
  } catch (err) {
    await audit("agent.tool_error", { tool: name });
    return outcome("error", { error: err.message === "tool timed out" ? "Tool timed out" : "Tool failed" });
  }
}
