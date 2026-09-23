import { invalidPayload, noStoreJson, serverError, unauthorized, describeError } from "@/lib/api-response";
import { rowToHelpRequest } from "@/lib/order-utils";
import { getPanelAccess } from "@/lib/panel-auth";
import { helpRequestsQuerySchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { HelpRequestsResponse } from "@/types/orders";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();

    const url = new URL(request.url);
    const parsed = helpRequestsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) return invalidPayload(parsed.error);
    const open = parsed.data.status === "open";

    /* Open requests oldest first, so the customer who has waited longest is on top;
       resolved ones newest first, as a log. */
    const { data, error } = await getSupabaseAdmin()
      .from("help_requests")
      .select("*")
      .eq("location_id", access.locationId)
      .eq("status", parsed.data.status)
      .order(open ? "requested_at" : "resolved_at", { ascending: open })
      .limit(PAGE_SIZE);
    if (error) throw error;

    const response: HelpRequestsResponse = { helpRequests: (data || []).map(rowToHelpRequest) };
    return noStoreJson(response);
  } catch (error) {
    console.error("Help requests query failed", describeError(error));
    return serverError();
  }
}
