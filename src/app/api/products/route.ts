import { randomBytes } from "node:crypto";
import { invalidPayload, noStoreJson, serverError, unauthorized } from "@/lib/api-response";
import { normalizeSearch, rowToProduct } from "@/lib/catalog";
import { getPanelAccess } from "@/lib/panel-auth";
import { productCreateSchema, productsQuerySchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ProductsResponse } from "@/types/orders";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();

    const url = new URL(request.url);
    const parsed = productsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) return invalidPayload(parsed.error);
    const filters = parsed.data;

    const { data, error } = await getSupabaseAdmin().rpc("search_products", {
      p_location_id: access.locationId,
      p_query: filters.q ? normalizeSearch(filters.q) : null,
      p_category: filters.category || null,
      p_priced: filters.priced || null,
      p_limit: filters.limit,
      p_offset: filters.page * filters.limit,
    });
    if (error) throw error;

    const rows = data || [];
    const response: ProductsResponse = {
      products: rows.map(rowToProduct),
      total: rows[0]?.total_count ?? 0,
      page: filters.page,
      pageSize: filters.limit,
    };
    return noStoreJson(response);
  } catch (error) {
    console.error("Products query failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}

/* Products that are not in Frutitodo's sheets yet. Without a reference they get a
   generated one, so a later catalog import cannot collide with them. */
export async function POST(request: Request) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();

    const parsed = productCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);
    const input = parsed.data;
    const hasPrice = input.price !== undefined && input.price !== null;

    const { data, error } = await getSupabaseAdmin()
      .from("products")
      .insert({
        location_id: access.locationId,
        reference: input.reference || `MAN-${randomBytes(4).toString("hex").toUpperCase()}`,
        name: input.name,
        search_name: normalizeSearch(input.name),
        category: input.category || null,
        subcategory: input.subcategory || null,
        price_unit: input.priceUnit || null,
        price: hasPrice ? input.price : null,
        price_updated_at: hasPrice ? new Date().toISOString() : null,
        price_updated_by: hasPrice ? input.operator || null : null,
      })
      .select("*")
      .single();

    if (error?.code === "23505") {
      return noStoreJson(
        { error: "duplicate_reference", message: "Ya existe un producto con esa referencia" },
        { status: 409 },
      );
    }
    if (error) throw error;
    return noStoreJson({ product: rowToProduct(data) }, { status: 201 });
  } catch (error) {
    console.error("Product creation failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
