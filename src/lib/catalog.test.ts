import { describe, expect, it } from "vitest";
import { normalizeSearch, rowToProduct } from "@/lib/catalog";

describe("normalizeSearch", () => {
  it("matches how the catalog is stored regardless of accents and case", () => {
    expect(normalizeSearch("  Limón   Tahití ")).toBe("limon tahiti");
    expect(normalizeSearch("VÍSCERA")).toBe("viscera");
  });
});

describe("rowToProduct", () => {
  it("turns the numeric price Postgres returns as text into a number", () => {
    const product = rowToProduct({
      id: "p1",
      reference: "20199",
      name: "ALA BLANCA",
      category: "Carnes",
      subcategory: "Pollo",
      sale_note: "solo se vende en bandeja",
      price: "12500.00",
      price_unit: "bandeja",
      price_updated_at: null,
    });
    expect(product.price).toBe(12500);
    expect(product.saleNote).toBe("solo se vende en bandeja");
  });
});
