import CircuitBreaker from "opossum";
import OpenAI from "openai";
import { config } from "../../config/index.js";
import { counter, histogram } from "../../lib/metrics.js";

// NVIDIA NIM speaks the OpenAI API. The key lives only in the worker's environment
// and is never visible to the model or its tools.
const client =
  config.NVIDIA_API_KEY &&
  new OpenAI({ apiKey: config.NVIDIA_API_KEY, baseURL: config.NIM_BASE_URL, timeout: 90_000, maxRetries: 2 });

export const aiEnabled = Boolean(client);

const latency = histogram("llm_request_duration_seconds", "LLM call latency", ["outcome"], [0.5, 1, 2, 5, 10, 20, 60, 120]);
const tokens = counter("llm_tokens_total", "LLM tokens consumed", ["type"]);

// Stop hammering a failing provider; 4xx caused by our request (other than 429) doesn't count as an outage.
const breaker =
  client &&
  new CircuitBreaker((params) => client.chat.completions.create(params), {
    timeout: false, // the SDK enforces request timeouts and retries 429/5xx with backoff
    errorThresholdPercentage: 50,
    volumeThreshold: 5,
    resetTimeout: 30_000,
    errorFilter: (err) => err.status >= 400 && err.status < 500 && err.status !== 429,
  });

export async function chat(params) {
  const end = latency.startTimer();
  try {
    const res = await breaker.fire({
      model: config.NIM_MODEL,
      temperature: 0,
      // copying facts verbatim needs no reasoning: ~4x faster and fewer tokens on Nemotron
      chat_template_kwargs: { enable_thinking: false },
      ...params,
    });
    tokens.inc({ type: "prompt" }, res.usage?.prompt_tokens ?? 0);
    tokens.inc({ type: "completion" }, res.usage?.completion_tokens ?? 0);
    end({ outcome: "ok" });
    return res;
  } catch (err) {
    end({ outcome: breaker.opened ? "circuit_open" : "error" });
    throw err;
  }
}
