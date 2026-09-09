import { invalidPayload, noStoreJson, serverError, unauthorized } from "@/lib/api-response";
import { rowToOrder, startOfTodayInBogota } from "@/lib/order-utils";
import { getPanelAccess } from "@/lib/panel-auth";
import { ordersQuerySchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { OrdersResponse } from "@/types/orders";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

function endOfBogotaDay(date: string): string {
  return new Date(`${date}T23:59:59.999-05:00`).toISOString();
}

export async function GET(request: Request) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();

    const url = new URL(request.url);
    const parsed = ordersQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) return invalidPayload(parsed.error);
    const filters = parsed.data;
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("orders")
      .select("*", { count: "exact" })
      .eq("location_id", access.locationId);

    if (filters.scope === "dispatched") {
      query = query.eq("status", "dispatched");
    } else if (filters.status) {
      query = query.eq("status", filters.status);
    } else {
      query = query.in("status", ["pending", "printed"]);
    }

    if (filters.delivery) query = query.eq("delivery_type", filters.delivery);
    if (filters.q) query = query.ilike("search_text", `%${filters.q.toLowerCase()}%`);
    if (filters.from) query = query.gte("received_at", new Date(`${filters.from}T00:00:00-05:00`).toISOString());
    if (filters.to) query = query.lte("received_at", endOfBogotaDay(filters.to));

    const start = filters.page * PAGE_SIZE;
    const [ordersResult, activeResult, todayResult, printedResult] = await Promise.all([
      query.order("received_at", { ascending: false }).range(start, start + PAGE_SIZE - 1),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("location_id", access.locationId)
        .in("status", ["pending", "printed"]),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("location_id", access.locationId)
        .gte("received_at", startOfTodayInBogota()),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("location_id", access.locationId)
        .eq("status", "printed"),
    ]);

    const firstError = [ordersResult.error, activeResult.error, todayResult.error, printedResult.error].find(Boolean);
    if (firstError) throw firstError;

    const total = ordersResult.count || 0;
    const response: OrdersResponse = {
      orders: (ordersResult.data || []).map(rowToOrder),
      stats: {
        active: activeResult.count || 0,
        newToday: todayResult.count || 0,
        awaitingDispatch: printedResult.count || 0,
      },
      pagination: {
        page: filters.page,
        pageSize: PAGE_SIZE,
        total,
        totalPages: Math.ceil(total / PAGE_SIZE),
      },
    };

    return noStoreJson(response);
  } catch (error) {
    console.error("Orders query failed", error instanceof Error ? error.message : "Unknown error");
    return serverError();
  }
}
