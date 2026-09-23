import mongoose from "mongoose";
import { AppError } from "../../lib/errors.js";
import { AgentLimitError } from "../agent/orchestrator.js";
import { Source } from "../sources/source.model.js";

const LEASE_MS = 20 * 60_000; // a crashed worker's job becomes claimable again after this
export const MAX_ATTEMPTS = 3;

/** Atomically claims the next due source, or a stale one whose worker died. */
export function claimNextSource() {
  const now = new Date();
  return Source.findOneAndUpdate(
    {
      $or: [
        { "processing.status": "pending", "processing.nextAttemptAt": mongoose.trusted({ $lte: now }) },
        { "processing.status": "processing", "processing.lockedUntil": mongoose.trusted({ $lt: now }) },
      ],
    },
    {
      $set: { "processing.status": "processing", "processing.lockedUntil": new Date(now.getTime() + LEASE_MS) },
      $inc: { "processing.attempts": 1 },
    },
    { sort: { "processing.nextAttemptAt": 1 }, returnDocument: "after" }
  ).lean();
}

// only messages we wrote ourselves reach the client
// provider said our request can never succeed (bad key, model retired): retrying only wastes attempts
const permanent = (err) => [401, 403, 404, 410].includes(err.status);
const safeMessage = (err) =>
  err instanceof AppError || err instanceof AgentLimitError
    ? err.message
    : permanent(err)
      ? "AI provider rejected the request (check NVIDIA_API_KEY / NIM_MODEL)"
      : "Processing failed, it will be retried";

/** Retries with exponential backoff; content errors (unsupported file) are not retried. */
export function recordFailure(source, err) {
  const final = source.processing.attempts >= MAX_ATTEMPTS || err instanceof AppError || permanent(err);
  return Source.updateOne(
    { _id: source._id },
    final
      ? { "processing.status": "failed", "processing.error": safeMessage(err), "processing.lockedUntil": null }
      : {
          "processing.status": "pending",
          "processing.error": safeMessage(err),
          "processing.lockedUntil": null,
          "processing.nextAttemptAt": new Date(Date.now() + 2 ** source.processing.attempts * 60_000),
        }
  );
}

export const requeueSource = (sourceId, caseId) =>
  Source.updateOne(
    { _id: sourceId, caseId, "processing.status": mongoose.trusted({ $in: ["done", "failed"] }) },
    {
      "processing.status": "pending",
      "processing.attempts": 0,
      "processing.error": null,
      "processing.nextAttemptAt": new Date(),
    }
  );
