import type { Database } from "@/types/database";
import type { IngestOrderInput } from "@/lib/schemas";
import type { Order, OrderItem } from "@/types/orders";
import { sha256 } from "@/lib/security";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

export function formatOrderNumber(sequence: number): string {
  return `FT-${String(sequence).padStart(6, "0")}`;
}

export function canonicalOrderPayload(input: IngestOrderInput): string {
  return JSON.stringify({
    sourceEventId: input.sourceEventId,
    locationId: input.locationId,
    contactId: input.contactId,
    customer: { name: input.customer.name, phone: input.customer.phone },
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
  };
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
