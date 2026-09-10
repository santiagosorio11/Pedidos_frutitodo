import { describe, expect, it } from "vitest";
import {
  canonicalOrderPayload,
  formatOrderNumber,
  needsReprint,
  payloadHash,
  startOfTodayInBogota,
} from "@/lib/order-utils";
import type { Order } from "@/types/orders";
import { ingestOrderSchema } from "@/lib/schemas";

const input = ingestOrderSchema.parse({
  sourceEventId: "event_12345678",
  locationId: "location-1",
  contactId: "contact-1",
  customer: { name: "Ana", phone: "3001234567" },
  delivery: { type: "recogida" },
  items: [{ name: "Pan", quantity: 2 }],
});

describe("order utilities", () => {
  it("formats stable display numbers", () => {
    expect(formatOrderNumber(7)).toBe("FT-000007");
    expect(formatOrderNumber(1234567)).toBe("FT-1234567");
  });

  it("hashes the normalized payload deterministically", () => {
    expect(payloadHash(input)).toHaveLength(64);
    expect(payloadHash(input)).toBe(payloadHash(JSON.parse(canonicalOrderPayload(input))));
  });

  it("calculates midnight in Bogota", () => {
    expect(startOfTodayInBogota(new Date("2026-09-09T18:00:00.000Z"))).toBe("2026-09-09T05:00:00.000Z");
  });
});

function orderWith(overrides: Partial<Order>): Order {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    orderNumber: "FT-000021",
    sourceEventId: "event_12345678",
    customerName: "Ana",
    customerPhone: "3001234567",
    deliveryType: "recogida",
    deliveryAddress: null,
    items: [{ name: "Pan", quantity: 2 }],
    notes: null,
    status: "pending",
    receivedAt: "2026-09-09T17:00:00.000Z",
    firstPrintedAt: null,
    lastPrintedAt: null,
    printCount: 0,
    dispatchedAt: null,
    lastAmendedAt: null,
    amendmentCount: 0,
    ...overrides,
  };
}

describe("needsReprint", () => {
  it("stays quiet on an order that was never printed", () => {
    expect(needsReprint(orderWith({ lastAmendedAt: "2026-09-09T18:00:00.000Z" }))).toBe(false);
  });

  it("stays quiet on a printed order that was never amended", () => {
    expect(needsReprint(orderWith({ firstPrintedAt: "2026-09-09T17:30:00.000Z" }))).toBe(false);
  });

  it("flags an order amended after the ticket came out", () => {
    expect(
      needsReprint(
        orderWith({
          firstPrintedAt: "2026-09-09T17:30:00.000Z",
          lastAmendedAt: "2026-09-09T18:00:00.000Z",
          amendmentCount: 1,
        }),
      ),
    ).toBe(true);
  });

  it("stays quiet when the amendment landed before the print", () => {
    expect(
      needsReprint(
        orderWith({
          firstPrintedAt: "2026-09-09T18:00:00.000Z",
          lastAmendedAt: "2026-09-09T17:30:00.000Z",
          amendmentCount: 1,
        }),
      ),
    ).toBe(false);
  });
});
