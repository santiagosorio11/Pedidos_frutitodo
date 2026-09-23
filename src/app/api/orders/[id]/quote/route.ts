import { after } from "next/server";
import type { Json } from "@/types/database";
import { invalidPayload, noStoreJson, serverError, unauthorized } from "@/lib/api-response";
import { GhlApiError, isGhlApiConfigured, sendContactMessage, updateContactCustomFields } from "@/lib/ghl-api";
import { rowToOrder } from "@/lib/order-utils";
import { getPanelAccess } from "@/lib/panel-auth";
import { computeQuote, formatQuoteMessage } from "@/lib/quote";
import { quoteRequestSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const TOTAL_FIELD_KEY = () => process.env.GHL_CF_ULTIMO_PEDIDO_TOTAL?.trim() || "ultimo_pedido_total";

/* Saves the priced quote of an order and, with `send`, delivers it to the customer through
   the GHL API. The draft is stored before sending, so a failed delivery never loses the
   operator's pricing work. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();
    const { id } = await context.params;

    const parsed = quoteRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);
    const input = parsed.data;
    const operator = input.operator || null;

    const supabase = getSupabaseAdmin();
    const { data: row, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .eq("location_id", access.locationId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return noStoreJson({ error: "not_found", message: "Pedido no encontrado" }, { status: 404 });

    if (input.send) {
      if (!row.ghl_contact_id) {
        return noStoreJson(
          { error: "no_contact", message: "El pedido manual no tiene un contacto de WhatsApp asociado" },
          { status: 409 },
        );
      }
      if (!isGhlApiConfigured()) {
        return noStoreJson(
          { error: "not_configured", message: "Falta configurar GHL_API_TOKEN para enviar mensajes" },
          { status: 503 },
        );
      }
      if (input.lines.some((line) => line.unitPrice <= 0)) {
        return noStoreJson(
          { error: "unpriced_lines", message: "Todos los productos necesitan precio antes de enviar la cotización" },
          { status: 422 },
        );
      }
      /* A retried click must not message the customer twice. */
      if (row.quote_request_id === input.requestId && row.quote_message_id) {
        return noStoreJson({ order: rowToOrder(row), sent: true, duplicate: true });
      }
    }

    const quote = computeQuote(input.lines, input.deliveryFee, { notes: input.notes, updatedBy: operator });

    if (input.updateCatalogPrices) {
      const now = new Date().toISOString();
      const priced = input.lines.filter((line) => line.productId && line.unitPrice > 0);
      const results = await Promise.all(
        priced.map((line) =>
          supabase
            .from("products")
            .update({
              price: line.unitPrice,
              ...(line.unit ? { price_unit: line.unit } : {}),
              price_updated_at: now,
              price_updated_by: operator,
            })
            .eq("id", line.productId as string)
            .eq("location_id", access.locationId),
        ),
      );
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
    }

    const { data: saved, error: saveError } = await supabase
      .from("orders")
      .update({ quote: quote as unknown as Json })
      .eq("id", row.id)
      .select("*")
      .single();
    if (saveError) throw saveError;

    if (!input.send) return noStoreJson({ order: rowToOrder(saved), sent: false });

    const order = rowToOrder(saved);
    let sent;
    try {
      sent = await sendContactMessage(row.ghl_contact_id as string, formatQuoteMessage(order, quote));
    } catch (sendError) {
      if (!(sendError instanceof GhlApiError)) throw sendError;
      console.error(`Quote delivery failed for ${order.orderNumber}: ${sendError.message}`);
      return noStoreJson(
        { error: "delivery_failed", message: sendError.message, order, sent: false },
        { status: 502 },
      );
    }

    const { data: delivered, error: deliveredError } = await supabase
      .from("orders")
      .update({
        quoted_total: quote.total,
        quoted_at: new Date().toISOString(),
        quote_sent_by: operator,
        quote_message_id: sent.messageId ?? "sent",
        quote_request_id: input.requestId,
        ...(sent.conversationId && !row.conversation_id ? { conversation_id: sent.conversationId } : {}),
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (deliveredError) throw deliveredError;

    after(() =>
      updateContactCustomFields(row.ghl_contact_id as string, [{ key: TOTAL_FIELD_KEY(), value: String(quote.total) }]),
    );

    return noStoreJson({ order: rowToOrder(delivered), sent: true });
  } catch (error) {
    console.error("Quote failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
