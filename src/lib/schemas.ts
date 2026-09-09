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

export const ingestOrderSchema = z
  .object({
    sourceEventId: identifier,
    locationId: z.string().trim().min(3).max(128),
    contactId: z.string().trim().min(1).max(128),
    customer: z.object({
      name: z.string().trim().min(1).max(160),
      phone: z.string().trim().min(3).max(40),
    }),
    delivery: z.object({
      type: z.enum(["domicilio", "recogida"]),
      address: z.string().trim().max(500).optional().nullable(),
    }),
    items: itemsSchema,
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine((value, context) => {
    if (value.delivery.type === "domicilio" && !value.delivery.address) {
      context.addIssue({
        code: "custom",
        path: ["delivery", "address"],
        message: "La dirección es obligatoria para domicilio",
      });
    }
  });

export const ordersQuerySchema = z
  .object({
    scope: z.enum(["active", "dispatched"]).default("active"),
    status: z.enum(["pending", "printed"]).optional(),
    delivery: z.enum(["domicilio", "recogida"]).optional(),
    q: z.string().trim().max(100).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .superRefine((value, context) => {
    if (value.scope === "dispatched" && value.status) {
      context.addIssue({ code: "custom", path: ["status"], message: "No aplica al historial" });
    }
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({ code: "custom", path: ["to"], message: "Debe ser posterior a desde" });
    }
  });

export const actionRequestSchema = z.object({
  requestId: identifier,
});

export type IngestOrderInput = z.infer<typeof ingestOrderSchema>;
