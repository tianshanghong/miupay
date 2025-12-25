export const config = {
  port: Number.parseInt(process.env.PORT ?? "4001", 10),
  grpcHost: process.env.GRPC_HOST ?? "0.0.0.0",
  grpcPort: Number.parseInt(process.env.GRPC_PORT ?? "50051", 10),
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",
  tokenSecret: process.env.TOKEN_SECRET ?? "",
  tokenTtlMs: Number.parseInt(process.env.TOKEN_TTL_MS ?? "900000", 10),
  mediaRoot: process.env.MEDIA_ROOT ?? "./media",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:4001",
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
  if (Number.isNaN(config.grpcPort) || config.grpcPort <= 0) {
    throw new Error("GRPC_PORT must be a valid number");
  }
  if (Number.isNaN(config.tokenTtlMs) || config.tokenTtlMs <= 0) {
    throw new Error("TOKEN_TTL_MS must be a valid number");
  }
}
