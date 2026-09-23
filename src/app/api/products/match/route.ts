import { invalidPayload, noStoreJson, serverError, unauthorized, describeError } from "@/lib/api-response";
import { normalizeSearch, pickBestMatch, rowToProduct } from "@/lib/catalog";
import type { MatchCandidate } from "@/lib/catalog";
import { getPanelAccess } from "@/lib/panel-auth";
import { productMatchSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/* Suggests a catalog product for each order line when a quote is opened for the first
   time. The database returns close candidates; the final pick is by shared words. The
   operator confirms or changes every suggestion before anything is sent. */
export async function POST(request: Request) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();

    const parsed = productMatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);
    const names = parsed.data.names;

    const { data, error } = await getSupabaseAdmin().rpc("match_products", {
      p_location_id: access.locationId,
      p_names: names.map(normalizeSearch),
    });
    if (error) throw error;

    const candidates: MatchCandidate[][] = names.map(() => []);
    for (const row of data || []) {
      candidates[row.input_index]?.push({ ...rowToProduct(row), score: row.score });
    }
    const matches = names.map((name, index) => pickBestMatch(name, candidates[index]));
    return noStoreJson({ matches });
  } catch (error) {
    console.error("Product match failed", describeError(error));
    return serverError();
  }
}
