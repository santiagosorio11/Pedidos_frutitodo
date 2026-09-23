import { describe, expect, it } from "vitest";
import { computeQuote, convertQuantity, formatPesos, formatQuoteMessage, normalizeUnit } from "@/lib/quote";

describe("computeQuote", () => {
  it("rounds each line to whole pesos and adds the delivery fee", () => {
    const quote = computeQuote(
      [
        { productId: "p1", reference: "20199", name: "Pechuga", quantity: 1.5, unit: "lb", unitPrice: 12_333 },
        { name: "Banano criollo", quantity: 2, unit: "lb", unitPrice: 2_000 },
      ],
      3_000,
      { notes: "  Sin aguacate  ", updatedBy: "Isabel", now: new Date("2026-09-23T15:00:00.000Z") },
    );
    expect(quote.lines.map((line) => line.lineTotal)).toEqual([18_500, 4_000]);
    expect(quote.subtotal).toBe(22_500);
    expect(quote.deliveryFee).toBe(3_000);
    expect(quote.total).toBe(25_500);
    expect(quote.notes).toBe("Sin aguacate");
    expect(quote.lines[1].productId).toBeNull();
  });

  it("never lets a negative delivery fee lower the total", () => {
    expect(computeQuote([{ name: "Pan", quantity: 1, unitPrice: 5_000 }], -2_000).total).toBe(5_000);
  });
});

describe("units", () => {
  it("normalizes the ways people write a unit", () => {
    expect(normalizeUnit("Libras")).toBe("lb");
    expect(normalizeUnit("kilo")).toBe("kg");
    expect(normalizeUnit("Und.")).toBe("und");
    expect(normalizeUnit("bandeja")).toBe("bandeja");
    expect(normalizeUnit("")).toBeNull();
  });

  it("uses the Colombian 500 g libra", () => {
    expect(convertQuantity(2, "kg", "lb")).toBe(4);
    expect(convertQuantity(3, "lb", "kg")).toBe(1.5);
    expect(convertQuantity(250, "g", "lb")).toBe(0.5);
  });

  it("refuses to convert between a mass and a count", () => {
    expect(convertQuantity(2, "kg", "und")).toBeNull();
    expect(convertQuantity(2, null, "lb")).toBeNull();
  });
});

describe("formatQuoteMessage", () => {
  const quote = computeQuote(
    [
      { name: "PECHUGA", quantity: 2, unit: "lb", unitPrice: 12_000 },
      { name: "AGUACATE HASS", quantity: 1, unit: "und", unitPrice: 3_500 },
    ],
    3_000,
    { notes: "Cambiamos el aguacate por uno más maduro." },
  );
  const message = formatQuoteMessage(
    { orderNumber: "FT-000021", customerName: "María Fernanda", paymentMethod: "Transferencia", deliveryType: "domicilio" },
    quote,
  );

  it("itemizes every line with its total", () => {
    expect(message).toContain("Hola María");
    expect(message).toContain("FT-000021");
    expect(message).toContain(`• 2 lb PECHUGA (${formatPesos(12_000)}/lb): ${formatPesos(24_000)}`);
    expect(message).toContain(`• 1 und AGUACATE HASS: ${formatPesos(3_500)}`);
  });

  it("closes with delivery, total, payment method and the note", () => {
    expect(message).toContain(`Domicilio: ${formatPesos(3_000)}`);
    expect(message).toContain(`*Total: ${formatPesos(30_500)}*`);
    expect(message).toContain("Método de pago: Transferencia");
    expect(message).toContain("Cambiamos el aguacate");
  });
});
