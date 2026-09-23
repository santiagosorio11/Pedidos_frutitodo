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

const STOPWORDS = new Set(["de", "del", "con", "sin", "por", "para", "los", "las", "una", "uno", "kg", "lb", "und", "gr"]);

/* Words that carry meaning, singular-ish ("pechugas" → "pechuga") so plurals still meet. */
function meaningfulWords(value: string): string[] {
  return normalizeSearch(value)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map((word) => word.replace(/(es|s)$/, (suffix) => (word.length > 4 ? "" : suffix)));
}

export type MatchCandidate = Product & { score: number };

/**
 * Picks the catalog product an order line most likely means. Whole shared words decide
 * ("pechuga de pollo troceada" → PECHUGA DE POLLO, never LECHUGA); trigram closeness and
 * having a price only break ties. `score` is the share of the line's words the product
 * covers, so callers can ignore weak guesses.
 */
export function pickBestMatch(line: string, candidates: MatchCandidate[]): MatchCandidate | null {
  const wanted = meaningfulWords(line);
  if (!wanted.length) return null;
  let best: { candidate: MatchCandidate; rank: number; coverage: number } | null = null;
  for (const candidate of candidates) {
    const words = meaningfulWords(candidate.name);
    const shared = wanted.filter((word) => words.includes(word)).length;
    if (!shared) continue;
    const leads = words[0] !== undefined && wanted.includes(words[0]);
    const extras = words.filter((word) => !wanted.includes(word)).length;
    const rank = shared + (leads ? 0.5 : 0) + candidate.score * 0.5 - extras * 0.05 + (candidate.price !== null ? 0.25 : 0);
    if (!best || rank > best.rank) best = { candidate, rank, coverage: shared / wanted.length };
  }
  return best ? { ...best.candidate, score: Math.round(best.coverage * 100) / 100 } : null;
}

/* Units the operators pick from; anything else can still be typed by hand. */
export const PRICE_UNITS = ["lb", "kg", "und", "bandeja", "paquete", "mazo", "g"] as const;
