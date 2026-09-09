import { after } from "next/server";
import { actionRequestSchema } from "@/lib/schemas";
import { notifyOrderDispatched } from "@/lib/outbound-webhook";
import { getPanelAccess } from "@/lib/panel-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { invalidPayload, noStoreJson, serverError, unauthorized } from "@/lib/api-response";
import { rowToOrder } from "@/lib/order-utils";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();
    const { id } = await context.params;

    const parsed = actionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);

    const { data, error } = await getSupabaseAdmin().rpc("dispatch_order", {
      p_order_id: id,
      p_location_id: access.locationId,
      p_request_id: parsed.data.requestId,
    });

    if (error?.message.includes("ORDER_NOT_FOUND")) {
      return noStoreJson({ error: "not_found", message: "Pedido no encontrado" }, { status: 404 });
    }
    if (error?.message.includes("ORDER_NOT_PRINTED")) {
      return noStoreJson(
        { error: "invalid_transition", message: "Debes confirmar la impresión antes de despachar" },
        { status: 409 },
      );
    }
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error("dispatch_order returned no order");
    const order = rowToOrder(row);

    /* The dispatch is already committed, so the CRM update runs after the response:
       the operator never waits on n8n, and n8n being down never fails the action. */
    after(() =>
      notifyOrderDispatched({
        event: "order.dispatched",
        requestId: parsed.data.requestId,
        ghlLocationId: access.ghlLocationId,
        ghlContactId: row.ghl_contact_id,
        order,
      }),
    );

    return noStoreJson({ order });
  } catch (error) {
    console.error("Dispatch failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
