import { z } from "zod";

const identifier = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Solo se permiten letras, números, guion y guion bajo");

export const orderItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  quantity: z.coerce.number().positive().max(100000),
  unit: z.string().trim().min(1).max(40).optional(),
});

const itemsSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, z.array(orderItemSchema).min(1).max(100));

/* GHL sends an empty string for a custom field that was never filled, so blank means absent. */
function optionalText(max: number) {
  return z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? undefined : value),
    z.string().trim().max(max).optional().nullable(),
  );
}

const deliverySchema = z.object({
  type: z.enum(["domicilio", "recogida"]),
  address: z.string().trim().max(500).optional().nullable(),
});

function requireAddressForDelivery(
  value: { delivery: { type: "domicilio" | "recogida"; address?: string | null } },
  context: z.RefinementCtx,
) {
  if (value.delivery.type === "domicilio" && !value.delivery.address) {
    context.addIssue({
      code: "custom",
      path: ["delivery", "address"],
      message: "La dirección es obligatoria para domicilio",
    });
  }
}

export const ingestOrderSchema = z
  .object({
    sourceEventId: identifier,
    locationId: z.string().trim().min(3).max(128),
    contactId: z.string().trim().min(1).max(128),
    conversationId: optionalText(128),
    customer: z.object({
      name: z.string().trim().min(1).max(160),
      phone: z.string().trim().min(3).max(40),
      document: optionalText(40),
    }),
    delivery: deliverySchema,
    paymentMethod: optionalText(80),
    items: itemsSchema,
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine(requireAddressForDelivery);

/* Orders taken over the phone and typed in the panel. There is no GHL contact behind them,
   and the panel supplies the idempotency key so a double click creates a single order. */
export const manualOrderSchema = z
  .object({
    requestId: identifier,
    operator: optionalText(80),
    customer: z.object({
      name: z.string().trim().min(1).max(160),
      phone: z.string().trim().min(3).max(40),
      document: optionalText(40),
    }),
    delivery: deliverySchema,
    paymentMethod: optionalText(80),
    items: z.array(orderItemSchema).min(1).max(100),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine(requireAddressForDelivery);

export const helpRequestIngestSchema = z.object({
  locationId: z.string().trim().min(3).max(128),
  contactId: z.string().trim().min(1).max(128),
  conversationId: optionalText(128),
  customer: z
    .object({
      name: optionalText(160),
      phone: optionalText(40),
    })
    .optional(),
  reason: optionalText(1000),
});

export const helpRequestsQuerySchema = z.object({
  status: z.enum(["open", "resolved"]).default("open"),
});

const money = z.coerce.number().min(0).max(100_000_000);

export const quoteLineSchema = z.object({
  productId: z.uuid().optional().nullable(),
  reference: optionalText(64),
  name: z.string().trim().min(1).max(160),
  quantity: z.coerce.number().positive().max(100000),
  unit: optionalText(40),
  unitPrice: money,
});

/* The client sends prices and quantities; totals are always recomputed on the server. */
export const quoteRequestSchema = z.object({
  requestId: identifier,
  operator: optionalText(80),
  lines: z.array(quoteLineSchema).min(1).max(150),
  deliveryFee: money.default(0),
  notes: optionalText(1000),
  updateCatalogPrices: z.boolean().default(true),
  send: z.boolean().default(false),
});

export const productsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  priced: z.enum(["priced", "unpriced"]).optional(),
  page: z.coerce.number().int().min(0).max(10000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const productMatchSchema = z.object({
  names: z.array(z.string().trim().min(1).max(160)).min(1).max(150),
});

export const productUpdateSchema = z
  .object({
    operator: optionalText(80),
    name: z.string().trim().min(1).max(160).optional(),
    price: money.nullable().optional(),
    priceUnit: optionalText(40),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "operator"), "No hay cambios");

export const productCreateSchema = z.object({
  operator: optionalText(80),
  name: z.string().trim().min(1).max(160),
  reference: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9._-]*$/, "Usa solo letras, números, punto, guion o guion bajo")
    .optional(),
  category: optionalText(80),
  subcategory: optionalText(80),
  priceUnit: optionalText(40),
  price: money.nullable().optional(),
});

export const ordersQuerySchema = z
  .object({
    /* `active` covers both open states; the panel tabs ask for each one on its own. */
    scope: z.enum(["active", "pending", "printed", "dispatched"]).default("active"),
    status: z.enum(["pending", "printed"]).optional(),
    delivery: z.enum(["domicilio", "recogida"]).optional(),
    q: z.string().trim().max(100).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .superRefine((value, context) => {
    if (value.scope !== "active" && value.status) {
      context.addIssue({ code: "custom", path: ["status"], message: "No aplica al historial" });
    }
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({ code: "custom", path: ["to"], message: "Debe ser posterior a desde" });
    }
  });

export const actionRequestSchema = z.object({
  requestId: identifier,
  operator: optionalText(80),
});

export type IngestOrderInput = z.infer<typeof ingestOrderSchema>;
export type ManualOrderInput = z.infer<typeof manualOrderSchema>;
