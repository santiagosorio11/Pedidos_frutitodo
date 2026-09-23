import { describe, expect, it } from "vitest";
import { normalizeSearch, pickBestMatch, rowToProduct } from "@/lib/catalog";

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

describe("pickBestMatch", () => {
  const product = (name: string, score: number, price: number | null = null) => ({
    ...rowToProduct({
      id: name,
      reference: name,
      name,
      category: null,
      subcategory: null,
      sale_note: null,
      price,
      price_unit: "lb",
      price_updated_at: null,
    }),
    score,
  });

  it("prefers shared words over letters that merely look alike", () => {
    const best = pickBestMatch("pechuga de pollo troceada", [
      product("LECHUGA", 0.62),
      product("PECHUGA BLANCA", 0.5),
      product("PECHUGA DE POLLO REFRIGERADA", 0.48),
    ]);
    expect(best?.name).toBe("PECHUGA DE POLLO REFRIGERADA");
    expect(best?.score).toBe(0.67);
  });

  it("matches plurals and ignores lines with nothing in common", () => {
    expect(pickBestMatch("2 pechugas", [product("PECHUGA BLANCA", 0.4)])?.name).toBe("PECHUGA BLANCA");
    expect(pickBestMatch("tomate", [product("LECHUGA", 0.3)])).toBeNull();
  });

  it("breaks ties in favor of a product that already has a price", () => {
    const best = pickBestMatch("banano", [product("BANANO CRIOLLO", 0.5), product("BANANO URABA", 0.5, 2000)]);
    expect(best?.name).toBe("BANANO URABA");
  });
});
