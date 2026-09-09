import { describe, expect, it } from "vitest";
import { canonicalOrderPayload, formatOrderNumber, payloadHash, startOfTodayInBogota } from "@/lib/order-utils";
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
