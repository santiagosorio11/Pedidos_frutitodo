import { invalidPayload, noStoreJson, serverError } from "@/lib/api-response";
import { rowToHelpRequest } from "@/lib/order-utils";
import { helpRequestIngestSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readWebhookJson } from "@/lib/webhook-request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const read = await readWebhookJson(request);
    if (!read.ok) return read.response;

    const parsed = helpRequestIngestSchema.safeParse(read.body);
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

    /* Tie the request to the customer's open order when there is one, so the operator sees
       what the conversation is about before opening it. */
    const { data: openOrder, error: orderError } = await supabase
      .from("orders")
      .select("id")
      .eq("location_id", location.id)
      .eq("ghl_contact_id", input.contactId)
      .in("status", ["pending", "printed"])
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orderError) throw orderError;

    const { data, error } = await supabase.rpc("open_help_request", {
      p_location_id: location.id,
      p_ghl_contact_id: input.contactId,
      p_conversation_id: input.conversationId || "",
      p_customer_name: input.customer?.name || "",
      p_customer_phone: input.customer?.phone || "",
      p_reason: input.reason || "",
      p_order_id: openOrder?.id ?? null,
      p_details: {},
    });
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error("open_help_request returned no row");

    return noStoreJson(
      { accepted: true, repeated: row.request_count > 1, helpRequest: rowToHelpRequest(row) },
      { status: row.request_count > 1 ? 200 : 201 },
    );
  } catch (error) {
    console.error("Help request ingestion failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
