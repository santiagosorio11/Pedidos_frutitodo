import type { Order, Quote, QuoteLine } from "@/types/orders";

export type QuoteLineInput = {
  productId?: string | null;
  reference?: string | null;
  name: string;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
};

/* Colombian pesos have no cents in practice, so every amount is rounded to whole pesos
   at the line, which is what the customer sees and what the total adds up. */
function pesos(value: number): number {
  return Math.round(value);
}

export function computeQuote(
  lines: QuoteLineInput[],
  deliveryFee: number,
  meta: { notes?: string | null; updatedBy?: string | null; now?: Date } = {},
): Quote {
  const quoteLines: QuoteLine[] = lines.map((line) => ({
    productId: line.productId || null,
    reference: line.reference || null,
    name: line.name.trim(),
    quantity: line.quantity,
    unit: line.unit?.trim() || null,
    unitPrice: pesos(line.unitPrice),
    lineTotal: pesos(line.quantity * line.unitPrice),
  }));
  const subtotal = quoteLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const fee = pesos(Math.max(0, deliveryFee));
  return {
    lines: quoteLines,
    subtotal,
    deliveryFee: fee,
    total: subtotal + fee,
    notes: meta.notes?.trim() || null,
    updatedAt: (meta.now ?? new Date()).toISOString(),
    updatedBy: meta.updatedBy || null,
  };
}

const UNIT_ALIASES: Record<string, string> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogramo: "kg",
  kilogramos: "kg",
  lb: "lb",
  lbs: "lb",
  libra: "lb",
  libras: "lb",
  g: "g",
  gr: "g",
  grs: "g",
  gramo: "g",
  gramos: "g",
  und: "und",
  un: "und",
  unid: "und",
  unidad: "und",
  unidades: "und",
};

export function normalizeUnit(unit: string | null | undefined): string | null {
  const key = unit?.trim().toLowerCase().replace(/\.$/, "");
  if (!key) return null;
  return UNIT_ALIASES[key] ?? key;
}

/* In Colombia a "libra" is 500 g, not the imperial pound: 1 kg is 2 lb at the counter. */
const GRAMS: Record<string, number> = { kg: 1000, lb: 500, g: 1 };

/** Converts between mass units; null when the units are not both masses. */
export function convertQuantity(quantity: number, from: string | null, to: string | null): number | null {
  const source = normalizeUnit(from);
  const target = normalizeUnit(to);
  if (!source || !target) return null;
  if (source === target) return quantity;
  if (!(source in GRAMS) || !(target in GRAMS)) return null;
  return Math.round(((quantity * GRAMS[source]) / GRAMS[target]) * 1000) / 1000;
}

export function formatPesos(value: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
    .format(value)
    .replace(/ /g, " ");
}

function formatQuantity(quantity: number, unit: string | null): string {
  const number = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(quantity);
  return unit ? `${number} ${unit}` : number;
}

/** The WhatsApp message the customer receives; also shown as a preview in the panel. */
export function formatQuoteMessage(order: Pick<Order, "orderNumber" | "customerName" | "paymentMethod" | "deliveryType">, quote: Quote): string {
  const firstName = order.customerName.trim().split(/\s+/)[0] || "";
  const lines = [
    `Hola ${firstName} 👋 Esta es la cotización de tu pedido ${order.orderNumber} en Frutitodo:`,
    "",
    ...quote.lines.map((line) => {
      const quantity = formatQuantity(line.quantity, line.unit);
      const each = line.quantity === 1 ? "" : ` (${formatPesos(line.unitPrice)}${line.unit ? `/${line.unit}` : " c/u"})`;
      return `• ${quantity} ${line.name}${each}: ${formatPesos(line.lineTotal)}`;
    }),
    "",
    `Subtotal: ${formatPesos(quote.subtotal)}`,
  ];
  if (quote.deliveryFee > 0) lines.push(`Domicilio: ${formatPesos(quote.deliveryFee)}`);
  lines.push(`*Total: ${formatPesos(quote.total)}*`);
  if (order.paymentMethod) lines.push(`Método de pago: ${order.paymentMethod}`);
  if (quote.notes) lines.push("", quote.notes);
  lines.push("", order.deliveryType === "domicilio" ? "Te avisamos cuando salga tu domicilio 🛵" : "Te avisamos cuando esté listo para recoger 🛍️");
  return lines.join("\n");
}
