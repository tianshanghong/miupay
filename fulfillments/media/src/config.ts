export const config = {
  port: Number.parseInt(process.env.PORT ?? "4001", 10),
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",
  tokenSecret: process.env.TOKEN_SECRET ?? "",
  tokenTtlMs: Number.parseInt(process.env.TOKEN_TTL_MS ?? "900000", 10),
  mediaRoot: process.env.MEDIA_ROOT ?? "./media",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:4001",
  webhookRateLimitMax: Number.parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX ?? "60", 10),
  webhookRateLimitWindowMs: Number.parseInt(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS ?? "60000", 10),
  mediaRateLimitMax: Number.parseInt(process.env.MEDIA_RATE_LIMIT_MAX ?? "120", 10),
  mediaRateLimitWindowMs: Number.parseInt(process.env.MEDIA_RATE_LIMIT_WINDOW_MS ?? "60000", 10),
};

export function validateConfig() {
  if (!config.webhookSecret) {
    throw new Error("WEBHOOK_SECRET is required");
  }
  if (!config.tokenSecret) {
    throw new Error("TOKEN_SECRET is required");
  }
  if (Number.isNaN(config.port) || config.port <= 0) {
    throw new Error("PORT must be a valid number");
  }
  if (Number.isNaN(config.tokenTtlMs) || config.tokenTtlMs <= 0) {
    throw new Error("TOKEN_TTL_MS must be a valid number");
  }
  if (Number.isNaN(config.webhookRateLimitMax) || config.webhookRateLimitMax <= 0) {
    throw new Error("WEBHOOK_RATE_LIMIT_MAX must be a valid number");
  }
  if (Number.isNaN(config.webhookRateLimitWindowMs) || config.webhookRateLimitWindowMs <= 0) {
    throw new Error("WEBHOOK_RATE_LIMIT_WINDOW_MS must be a valid number");
  }
  if (Number.isNaN(config.mediaRateLimitMax) || config.mediaRateLimitMax <= 0) {
    throw new Error("MEDIA_RATE_LIMIT_MAX must be a valid number");
  }
  if (Number.isNaN(config.mediaRateLimitWindowMs) || config.mediaRateLimitWindowMs <= 0) {
    throw new Error("MEDIA_RATE_LIMIT_WINDOW_MS must be a valid number");
  }
}
