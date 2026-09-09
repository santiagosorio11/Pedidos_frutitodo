import { getServerEnv } from "@/lib/env";
import { hashEmbedToken, readBearerToken } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type PanelAccess = {
  locationId: string;
  ghlLocationId: string;
  locationName: string;
};

export async function getPanelAccess(request: Request): Promise<PanelAccess | null> {
  const token = readBearerToken(request);
  const ghlLocationId = request.headers.get("x-location-id")?.trim();
  if (!token || !ghlLocationId) return null;

  const tokenHash = hashEmbedToken(token, getServerEnv().embedTokenPepper);
  const { data, error } = await getSupabaseAdmin()
    .from("locations")
    .select("id, ghl_location_id, name")
    .eq("ghl_location_id", ghlLocationId)
    .eq("embed_token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { locationId: data.id, ghlLocationId: data.ghl_location_id, locationName: data.name };
}
