import type { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { noStoreJson, unauthorized } from "@/lib/api-response";
import { readBearerToken, safeEqual } from "@/lib/security";

const MAX_BODY_BYTES = 256 * 1024;

type WebhookBody = { ok: true; body: unknown } | { ok: false; response: NextResponse };

/** Authenticates an inbound GHL/n8n webhook and reads its JSON body within the size cap. */
export async function readWebhookJson(request: Request): Promise<WebhookBody> {
  const providedSecret = readBearerToken(request);
  if (!providedSecret || !safeEqual(providedSecret, getServerEnv().ghlIngestSecret)) {
    return { ok: false, response: unauthorized() };
  }

  const tooLarge = () =>
    noStoreJson({ error: "payload_too_large", message: "El webhook supera 256 KB" }, { status: 413 });

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) return { ok: false, response: tooLarge() };

  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { ok: false, response: tooLarge() };
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: noStoreJson({ error: "invalid_json", message: "El cuerpo debe ser JSON válido" }, { status: 400 }),
    };
  }
}
