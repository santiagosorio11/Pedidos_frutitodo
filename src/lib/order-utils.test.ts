import { describe, expect, it } from "vitest";
import {
  canonicalOrderPayload,
  formatOrderNumber,
  ghlConversationUrl,
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

  it("keeps the hash stable when optional fields arrive blank or absent", () => {
    const withBlanks = ingestOrderSchema.parse({
      ...input,
      conversationId: "",
      paymentMethod: "",
      customer: { name: "Ana", phone: "3001234567", document: "" },
    });
    expect(payloadHash(withBlanks)).toBe(payloadHash(input));
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
    customerDocument: null,
    paymentMethod: null,
    ghlContactId: "contact-1",
    conversationId: null,
    source: "ai",
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
    lastPrintedBy: null,
    dispatchedBy: null,
    quote: null,
    quotedTotal: null,
    quotedAt: null,
    quoteSentBy: null,
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

describe("ghlConversationUrl", () => {
  it("opens the conversation in the white label when the id is known", () => {
    expect(ghlConversationUrl("UfbKDvUAPCDEaRQWYXau", { conversationId: "61PklkWIorEaDwT7KFAN", ghlContactId: "c1" })).toBe(
      "https://app.iaorbita.com/v2/location/UfbKDvUAPCDEaRQWYXau/conversations/conversations/61PklkWIorEaDwT7KFAN",
    );
  });

  it("falls back to the contact page without a conversation id", () => {
    expect(ghlConversationUrl("loc", { conversationId: null, ghlContactId: "contact-9" }, "https://app.example.com/")).toBe(
      "https://app.example.com/v2/location/loc/contacts/detail/contact-9",
    );
  });

  it("has nowhere to go for a phone order", () => {
    expect(ghlConversationUrl("loc", { conversationId: null, ghlContactId: null })).toBeNull();
  });
});
