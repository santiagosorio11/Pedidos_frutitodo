import type { Json } from "@/types/database";
import { invalidPayload, noStoreJson, serverError } from "@/lib/api-response";
import { payloadHash, formatOrderNumber } from "@/lib/order-utils";
import { ingestOrderSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readWebhookJson } from "@/lib/webhook-request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const read = await readWebhookJson(request);
    if (!read.ok) return read.response;

    const parsed = ingestOrderSchema.safeParse(read.body);
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

    const { data, error } = await supabase.rpc("ingest_order", {
      p_location_id: location.id,
      p_source_event_id: input.sourceEventId,
      p_ghl_contact_id: input.contactId,
      p_customer_name: input.customer.name,
      p_customer_phone: input.customer.phone,
      p_delivery_type: input.delivery.type,
      p_delivery_address: input.delivery.address || "",
      p_items: input.items as unknown as Json,
      p_notes: input.notes || "",
      p_payload_hash: payloadHash(input),
      p_customer_document: input.customer.document || null,
      p_payment_method: input.paymentMethod || null,
      p_conversation_id: input.conversationId || null,
    });

    if (error) throw error;
    const result = data?.[0];
    if (!result) throw new Error("ingest_order returned no result");

    if (result.payload_conflict) {
      return noStoreJson(
        {
          accepted: false,
          duplicate: true,
          error: "idempotency_conflict",
          message: "El identificador ya existe con datos diferentes",
        },
        { status: 409 },
      );
    }

    return noStoreJson(
      {
        accepted: true,
        duplicate: !result.was_created,
        order: {
          id: result.order_id,
          number: formatOrderNumber(result.display_sequence),
          status: "pending",
        },
      },
      { status: result.was_created ? 201 : 200 },
    );
  } catch (error) {
    console.error("Order ingestion failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
