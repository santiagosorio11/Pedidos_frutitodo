import { describe, expect, it } from "vitest";
import { ingestOrderSchema } from "@/lib/schemas";

const validOrder = {
  sourceEventId: "order_12345678",
  locationId: "location-123",
  contactId: "contact-123",
  customer: { name: "María Pérez", phone: "+57 300 123 4567" },
  delivery: { type: "domicilio", address: "Calle 10 # 20-30" },
  items: [{ name: "Aguacate Hass", quantity: 1.5, unit: "kg" }],
  notes: "Llamar al llegar",
};

describe("ingestOrderSchema", () => {
  it("accepts a complete deterministic order", () => {
    expect(ingestOrderSchema.parse(validOrder)).toMatchObject(validOrder);
  });

  it("parses the GHL long-text products field", () => {
    const parsed = ingestOrderSchema.parse({
      ...validOrder,
      items: JSON.stringify(validOrder.items),
    });
    expect(parsed.items).toEqual(validOrder.items);
  });

  it("requires an address for delivery", () => {
    const parsed = ingestOrderSchema.safeParse({
      ...validOrder,
      delivery: { type: "domicilio", address: "" },
    });
    expect(parsed.success).toBe(false);
  });

  it("allows pickup without an address", () => {
    const parsed = ingestOrderSchema.safeParse({
      ...validOrder,
      delivery: { type: "recogida" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty, negative or oversized product lists", () => {
    expect(ingestOrderSchema.safeParse({ ...validOrder, items: [] }).success).toBe(false);
    expect(
      ingestOrderSchema.safeParse({ ...validOrder, items: [{ name: "Arroz", quantity: -1 }] }).success,
    ).toBe(false);
    expect(
      ingestOrderSchema.safeParse({ ...validOrder, items: Array.from({ length: 101 }, () => validOrder.items[0]) }).success,
    ).toBe(false);
  });
});
