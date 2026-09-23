import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "must be a mongodb:// or mongodb+srv:// URI"),
  CORS_ORIGINS: z
    .string()
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(z.url()).min(1)),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  PUBLIC_APP_URL: z.url().default("http://localhost:5173"), // base for links we hand to patients
  UPLOAD_DIR: z.string().default("storage/uploads"), // outside any served/executable path
  UPLOAD_LINK_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SMTP_URL: z.string().regex(/^smtps?:\/\//, "must be an smtp:// or smtps:// URL").optional(),
  MAIL_FROM: z.string().default("DocDoc <no-reply@localhost>"),
  // AI structuring (NVIDIA NIM, OpenAI-compatible). Without a key, documents are extracted but not structured.
  NVIDIA_API_KEY: z.string().min(1).optional(),
  NIM_BASE_URL: z.url({ protocol: /^https$/ }).default("https://integrate.api.nvidia.com/v1"),
  NIM_MODEL: z.string().default("nvidia/nemotron-3-super-120b-a12b"),
  // test harnesses run many sign-ins from one IP; multiplies every per-IP limit. Must be 1 in production.
  RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(100).default(1),
  FEATURE_FLAGS: z.string().max(2000).default(""), // rollout overrides, see modules/flags/flags.js
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  WORKER_METRICS_PORT: z.coerce.number().int().positive().default(9464),
  WORKER_METRICS_HOST: z.string().default("127.0.0.1"), // 0.0.0.0 only on a private network (e.g. for Prometheus)
})
  .refine((c) => c.NODE_ENV !== "production" || c.SMTP_URL, {
    path: ["SMTP_URL"],
    message: "is required in production",
  })
  .refine((c) => c.NODE_ENV !== "production" || c.RATE_LIMIT_SCALE === 1, {
    path: ["RATE_LIMIT_SCALE"],
    message: "must be 1 in production",
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // fail fast at boot; print which keys are wrong, never their values
  console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = Object.freeze(parsed.data);
export const isProd = config.NODE_ENV === "production";
