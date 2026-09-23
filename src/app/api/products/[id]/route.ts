import { invalidPayload, noStoreJson, serverError, unauthorized, describeError } from "@/lib/api-response";
import { normalizeSearch, rowToProduct } from "@/lib/catalog";
import { getPanelAccess } from "@/lib/panel-auth";
import { productUpdateSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { Database } from "@/types/database";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();
    const { id } = await context.params;

    const parsed = productUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);
    const input = parsed.data;

    const changes: Database["public"]["Tables"]["products"]["Update"] = {};
    if (input.name) {
      changes.name = input.name;
      changes.search_name = normalizeSearch(input.name);
    }
    if (input.priceUnit !== undefined) changes.price_unit = input.priceUnit || null;
    if (input.isActive !== undefined) changes.is_active = input.isActive;
    if (input.price !== undefined) {
      changes.price = input.price;
      changes.price_updated_at = new Date().toISOString();
      changes.price_updated_by = input.operator || null;
    }

    const { data, error } = await getSupabaseAdmin()
      .from("products")
      .update(changes)
      .eq("id", id)
      .eq("location_id", access.locationId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return noStoreJson({ error: "not_found", message: "Producto no encontrado" }, { status: 404 });

    return noStoreJson({ product: rowToProduct(data) });
  } catch (error) {
    console.error("Product update failed", describeError(error));
    return serverError();
  }
}
