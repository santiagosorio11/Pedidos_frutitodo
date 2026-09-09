import { noStoreJson, serverError } from "@/lib/api-response";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { error } = await getSupabaseAdmin().from("locations").select("id", { head: true, count: "exact" });
    if (error) throw error;
    return noStoreJson({ ok: true, service: "pedidos-frutitodo" });
  } catch (error) {
    console.error("Health check failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
