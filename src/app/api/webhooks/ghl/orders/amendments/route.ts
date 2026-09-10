import type { Json } from "@/types/database";
import { getServerEnv } from "@/lib/env";
import { invalidPayload, noStoreJson, serverError, unauthorized } from "@/lib/api-response";
import { formatOrderNumber, payloadHash } from "@/lib/order-utils";
import { ingestOrderSchema } from "@/lib/schemas";
import { readBearerToken, safeEqual } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  try {
    const providedSecret = readBearerToken(request);
    if (!providedSecret || !safeEqual(providedSecret, getServerEnv().ghlIngestSecret)) {
      return unauthorized();
    }

    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) {
      return noStoreJson(
        { error: "payload_too_large", message: "El webhook supera 256 KB" },
        { status: 413 },
      );
    }

    let raw: unknown;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
        return noStoreJson(
          { error: "payload_too_large", message: "El webhook supera 256 KB" },
          { status: 413 },
        );
      }
      raw = JSON.parse(text);
    } catch {
      return noStoreJson({ error: "invalid_json", message: "El cuerpo debe ser JSON válido" }, { status: 400 });
    }

    const parsed = ingestOrderSchema.safeParse(raw);
    if (!parsed.success) return invalidPayload(parsed.error);
    const input = parsed.data;

    const supabase = getSupabaseAdmin();
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("id")
      .eq("ghl_location_id", input.locationId)
      .eq("is_active", true)
      .maybeSingle();

    if (locationError) throw locationError;
    if (!location) {
      return noStoreJson(
        { error: "unknown_location", message: "La ubicación no está provisionada" },
        { status: 422 },
      );
    }

    const { data, error } = await supabase.rpc("amend_order", {
      p_location_id: location.id,
      p_ghl_contact_id: input.contactId,
      p_source_event_id: input.sourceEventId,
      p_customer_name: input.customer.name,
      p_customer_phone: input.customer.phone,
      p_delivery_type: input.delivery.type,
      p_delivery_address: input.delivery.address || "",
      p_items: input.items as unknown as Json,
      p_notes: input.notes || "",
      p_payload_hash: payloadHash(input),
    });

    if (error) throw error;
    const result = data?.[0];
    if (!result) throw new Error("amend_order returned no result");

    /* The caller decides what to do next, so each dead end gets its own status and code
       instead of a generic failure: a dispatched order means "create a new one". */
    if (result.outcome === "no_order") {
      return noStoreJson(
        {
          amended: false,
          error: "no_open_order",
          message: "El contacto no tiene un pedido registrado",
        },
        { status: 404 },
      );
    }

    if (result.outcome === "already_dispatched") {
      return noStoreJson(
        {
          amended: false,
          error: "already_dispatched",
          message: "El pedido ya salió y no puede modificarse; registra uno nuevo",
        },
        { status: 409 },
      );
    }

    return noStoreJson({
      amended: result.was_amended,
      duplicate: result.outcome === "duplicate",
      needsReprint: result.needs_reprint,
      order: {
        id: result.order_id,
        number: formatOrderNumber(result.display_sequence as number),
        status: "pending",
      },
    });
  } catch (error) {
    console.error("Order amendment failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
