import { after } from "next/server";
import { actionRequestSchema } from "@/lib/schemas";
import { notifyOrderEvent } from "@/lib/outbound-webhook";
import { getPanelAccess } from "@/lib/panel-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { invalidPayload, noStoreJson, serverError, unauthorized, describeError } from "@/lib/api-response";
import { rowToOrder } from "@/lib/order-utils";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();
    const { id } = await context.params;

    const parsed = actionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);

    const { data, error } = await getSupabaseAdmin().rpc("confirm_order_print", {
      p_order_id: id,
      p_location_id: access.locationId,
      p_request_id: parsed.data.requestId,
      p_operator: parsed.data.operator || null,
    });

    if (error?.message.includes("ORDER_NOT_FOUND")) {
      return noStoreJson({ error: "not_found", message: "Pedido no encontrado" }, { status: 404 });
    }
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error("confirm_order_print returned no order");
    const order = rowToOrder(row);

    /* Lets n8n mark the contact's order as "en preparación" in GHL, which is what the agent
       reads to tell the customer a change will be an adjustment to an order in progress. */
    after(() =>
      notifyOrderEvent({
        event: "order.printed",
        requestId: parsed.data.requestId,
        ghlLocationId: access.ghlLocationId,
        ghlContactId: row.ghl_contact_id,
        operator: parsed.data.operator || null,
        order,
      }),
    );

    return noStoreJson({ order });
  } catch (error) {
    console.error("Print confirmation failed", describeError(error));
    return serverError();
  }
}
