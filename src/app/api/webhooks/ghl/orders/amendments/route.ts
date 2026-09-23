import type { Json } from "@/types/database";
import { invalidPayload, noStoreJson, serverError, describeError } from "@/lib/api-response";
import { formatOrderNumber, payloadHash } from "@/lib/order-utils";
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
      p_customer_document: input.customer.document || null,
      p_payment_method: input.paymentMethod || null,
      p_conversation_id: input.conversationId || null,
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

    /* An amendment is an adjustment to the same order, never a new one: the number stays,
       so the customer and the pickers keep referring to a single order. */
    const number = formatOrderNumber(result.display_sequence as number);
    return noStoreJson({
      amended: result.was_amended,
      duplicate: result.outcome === "duplicate",
      needsReprint: result.needs_reprint,
      message: `Ajuste aplicado al pedido ${number}`,
      order: {
        id: result.order_id,
        number,
        status: "pending",
      },
    });
  } catch (error) {
    console.error("Order amendment failed", describeError(error));
    return serverError();
  }
}
