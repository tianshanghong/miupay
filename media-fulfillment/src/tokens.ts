import crypto from "crypto";
import { config } from "./config.js";

export type TokenPayload = {
  entitlementId: string;
  assetId: string;
  exp: number;
};

export function signToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", config.tokenSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) {
    return null;
  }
  const expected = crypto.createHmac("sha256", config.tokenSecret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return null;
  }
}
