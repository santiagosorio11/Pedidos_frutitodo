import type { Product } from "@/types/orders";

/* The catalog is uppercase and mostly unaccented ("LIMON TAHITI"), while operators and
   customers type "limón". Both sides go through this before comparing. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type ProductRow = {
  id: string;
  reference: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  sale_note: string | null;
  price: number | string | null;
  price_unit: string | null;
  price_updated_at: string | null;
};

export function rowToProduct(row: ProductRow): Product {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    saleNote: row.sale_note,
    price: row.price === null ? null : Number(row.price),
    priceUnit: row.price_unit,
    priceUpdatedAt: row.price_updated_at,
  };
}

/* Units the operators pick from; anything else can still be typed by hand. */
export const PRICE_UNITS = ["lb", "kg", "und", "bandeja", "paquete", "mazo", "g"] as const;
