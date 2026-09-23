import { invalidPayload, noStoreJson, serverError, unauthorized } from "@/lib/api-response";
import { normalizeSearch, rowToProduct } from "@/lib/catalog";
import { getPanelAccess } from "@/lib/panel-auth";
import { productMatchSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { Product } from "@/types/orders";

export const runtime = "nodejs";

/* Suggests a catalog product for each order line when a quote is opened for the first
   time. The operator confirms or changes every suggestion before anything is sent. */
export async function POST(request: Request) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();

    const parsed = productMatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);
    const names = parsed.data.names.map(normalizeSearch);

    const { data, error } = await getSupabaseAdmin().rpc("match_products", {
      p_location_id: access.locationId,
      p_names: names,
    });
    if (error) throw error;

    const matches: Array<(Product & { score: number }) | null> = names.map(() => null);
    for (const row of data || []) {
      matches[row.input_index] = { ...rowToProduct(row), score: row.score };
    }
    return noStoreJson({ matches });
  } catch (error) {
    console.error("Product match failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
