import type { Database } from "@/types/database";
import type { IngestOrderInput } from "@/lib/schemas";
import type { HelpRequest, Order, OrderItem, Quote } from "@/types/orders";
import { sha256 } from "@/lib/security";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type HelpRequestRow = Database["public"]["Tables"]["help_requests"]["Row"];

export const DEFAULT_GHL_APP_URL = "https://app.iaorbita.com";

export function formatOrderNumber(sequence: number): string {
  return `FT-${String(sequence).padStart(6, "0")}`;
}

export function canonicalOrderPayload(input: IngestOrderInput): string {
  return JSON.stringify({
    sourceEventId: input.sourceEventId,
    locationId: input.locationId,
    contactId: input.contactId,
    conversationId: input.conversationId || null,
    customer: {
      name: input.customer.name,
      phone: input.customer.phone,
      document: input.customer.document || null,
    },
    paymentMethod: input.paymentMethod || null,
    delivery: {
      type: input.delivery.type,
      address: input.delivery.address || null,
    },
    items: input.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit || null,
    })),
    notes: input.notes || null,
  });
}

export function payloadHash(input: IngestOrderInput): string {
  return sha256(canonicalOrderPayload(input));
}

export function needsReprint(order: Order): boolean {
  if (!order.lastAmendedAt || !order.firstPrintedAt) return false;
  return new Date(order.lastAmendedAt).getTime() > new Date(order.firstPrintedAt).getTime();
}

export function rowToOrder(row: OrderRow): Order {
  return {
    id: row.id,
    orderNumber: formatOrderNumber(row.display_sequence),
    sourceEventId: row.source_event_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerDocument: row.customer_document,
    paymentMethod: row.payment_method,
    ghlContactId: row.ghl_contact_id,
    conversationId: row.conversation_id,
    source: row.source === "manual" ? "manual" : "ai",
    deliveryType: row.delivery_type,
    deliveryAddress: row.delivery_address,
    items: row.items as OrderItem[],
    notes: row.notes,
    status: row.status,
    receivedAt: row.received_at,
    firstPrintedAt: row.first_printed_at,
    lastPrintedAt: row.last_printed_at,
    printCount: row.print_count,
    dispatchedAt: row.dispatched_at,
    lastAmendedAt: row.last_amended_at,
    amendmentCount: row.amendment_count,
    lastPrintedBy: row.last_printed_by,
    dispatchedBy: row.dispatched_by,
    quote: (row.quote as Quote | null) ?? null,
    quotedTotal: row.quoted_total === null ? null : Number(row.quoted_total),
    quotedAt: row.quoted_at,
    quoteSentBy: row.quote_sent_by,
  };
}

export function rowToHelpRequest(row: HelpRequestRow): HelpRequest {
  return {
    id: row.id,
    ghlContactId: row.ghl_contact_id,
    conversationId: row.conversation_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    reason: row.reason,
    orderId: row.order_id,
    status: row.status,
    requestCount: row.request_count,
    requestedAt: row.requested_at,
    lastRequestedAt: row.last_requested_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

/* Opens the chat in the GHL white label. Without a conversation id the contact page is the
   closest place, since its side panel shows the same thread. */
export function ghlConversationUrl(
  ghlLocationId: string,
  target: { conversationId: string | null; ghlContactId: string | null },
  appBaseUrl = DEFAULT_GHL_APP_URL,
): string | null {
  const base = `${appBaseUrl.replace(/\/$/, "")}/v2/location/${encodeURIComponent(ghlLocationId)}`;
  if (target.conversationId) {
    return `${base}/conversations/conversations/${encodeURIComponent(target.conversationId)}`;
  }
  if (target.ghlContactId) return `${base}/contacts/detail/${encodeURIComponent(target.ghlContactId)}`;
  return null;
}

export function startOfTodayInBogota(now = new Date()): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${date}T00:00:00-05:00`).toISOString();
}
