import { noStoreJson, serverError, unauthorized } from "@/lib/api-response";
import { getPanelAccess } from "@/lib/panel-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ProductCategory } from "@/types/orders";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();

    const { data, error } = await getSupabaseAdmin().rpc("product_categories", { p_location_id: access.locationId });
    if (error) throw error;

    const categories: ProductCategory[] = (data || []).map((row) => ({
      category: row.category,
      total: Number(row.total),
      priced: Number(row.priced),
    }));
    return noStoreJson({ categories });
  } catch (error) {
    console.error("Product categories failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
