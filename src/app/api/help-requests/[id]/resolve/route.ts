import { invalidPayload, noStoreJson, serverError, unauthorized } from "@/lib/api-response";
import { rowToHelpRequest } from "@/lib/order-utils";
import { getPanelAccess } from "@/lib/panel-auth";
import { actionRequestSchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();
    const { id } = await context.params;

    const parsed = actionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);

    const supabase = getSupabaseAdmin();
    /* Only an open request changes; resolving twice returns the row as it already is. */
    const { data: updated, error } = await supabase
      .from("help_requests")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: parsed.data.operator || null,
      })
      .eq("id", id)
      .eq("location_id", access.locationId)
      .eq("status", "open")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (updated) return noStoreJson({ helpRequest: rowToHelpRequest(updated) });

    const { data: existing, error: readError } = await supabase
      .from("help_requests")
      .select("*")
      .eq("id", id)
      .eq("location_id", access.locationId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return noStoreJson({ error: "not_found", message: "Solicitud no encontrada" }, { status: 404 });
    return noStoreJson({ helpRequest: rowToHelpRequest(existing) });
  } catch (error) {
    console.error("Help request resolution failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
