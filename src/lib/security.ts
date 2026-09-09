import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token, ...rest] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length) return null;
  return token;
}

export function hashEmbedToken(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token, "utf8").digest("hex");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
