import type { Json } from "@/types/database";
import { invalidPayload, noStoreJson, serverError, unauthorized, describeError } from "@/lib/api-response";
import { formatOrderNumber, payloadHash, rowToOrder, startOfTodayInBogota } from "@/lib/order-utils";
import { getPanelAccess } from "@/lib/panel-auth";
import { manualOrderSchema, ordersQuerySchema } from "@/lib/schemas";
import type { IngestOrderInput } from "@/lib/schemas";
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

    if (filters.scope === "active") {
      query = filters.status ? query.eq("status", filters.status) : query.in("status", ["pending", "printed"]);
    } else {
      query = query.eq("status", filters.scope);
    }

    if (filters.delivery) query = query.eq("delivery_type", filters.delivery);
    if (filters.q) query = query.ilike("search_text", `%${filters.q.toLowerCase()}%`);
    if (filters.from) query = query.gte("received_at", new Date(`${filters.from}T00:00:00-05:00`).toISOString());
    if (filters.to) query = query.lte("received_at", endOfBogotaDay(filters.to));

    /* Open orders are worked oldest first so nobody waits behind newer ones; the dispatched
       history reads newest first. */
    const ascending = filters.scope === "pending" || filters.scope === "printed";
    const start = filters.page * PAGE_SIZE;
    const countOrders = () =>
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("location_id", access.locationId);
    const today = startOfTodayInBogota();

    const [ordersResult, pendingResult, printedResult, todayResult, dispatchedTodayResult, helpResult] =
      await Promise.all([
        query.order("received_at", { ascending }).range(start, start + PAGE_SIZE - 1),
        countOrders().eq("status", "pending"),
        countOrders().eq("status", "printed"),
        countOrders().gte("received_at", today),
        countOrders().eq("status", "dispatched").gte("dispatched_at", today),
        supabase
          .from("help_requests")
          .select("id", { count: "exact", head: true })
          .eq("location_id", access.locationId)
          .eq("status", "open"),
      ]);

    const firstError = [
      ordersResult.error,
      pendingResult.error,
      printedResult.error,
      todayResult.error,
      dispatchedTodayResult.error,
      helpResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const total = ordersResult.count || 0;
    const response: OrdersResponse = {
      orders: (ordersResult.data || []).map(rowToOrder),
      stats: {
        pending: pendingResult.count || 0,
        printed: printedResult.count || 0,
        newToday: todayResult.count || 0,
        dispatchedToday: dispatchedTodayResult.count || 0,
        openHelpRequests: helpResult.count || 0,
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
    console.error("Orders query failed", describeError(error));
    return serverError();
  }
}

/* Orders taken over the phone. They go through the same ingestion as the agent's, so they
   get a number, show up in "Nuevos" and follow the same print and dispatch rules. */
export async function POST(request: Request) {
  try {
    const access = await getPanelAccess(request);
    if (!access) return unauthorized();

    const parsed = manualOrderSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidPayload(parsed.error);
    const input = parsed.data;

    const sourceEventId = `manual_${input.requestId}`;
    const hashInput: IngestOrderInput = {
      sourceEventId,
      locationId: access.ghlLocationId,
      contactId: "",
      customer: input.customer,
      delivery: input.delivery,
      paymentMethod: input.paymentMethod,
      items: input.items,
      notes: input.notes,
    };

    const { data, error } = await getSupabaseAdmin().rpc("ingest_order", {
      p_location_id: access.locationId,
      p_source_event_id: sourceEventId,
      p_ghl_contact_id: "",
      p_customer_name: input.customer.name,
      p_customer_phone: input.customer.phone,
      p_delivery_type: input.delivery.type,
      p_delivery_address: input.delivery.address || "",
      p_items: input.items as unknown as Json,
      p_notes: input.notes || "",
      p_payload_hash: payloadHash(hashInput),
      p_customer_document: input.customer.document || null,
      p_payment_method: input.paymentMethod || null,
      p_conversation_id: null,
      p_source: "manual",
    });
    if (error) throw error;
    const result = data?.[0];
    if (!result) throw new Error("ingest_order returned no result");

    return noStoreJson(
      {
        created: result.was_created,
        order: { id: result.order_id, number: formatOrderNumber(result.display_sequence) },
      },
      { status: result.was_created ? 201 : 200 },
    );
  } catch (error) {
    console.error("Manual order failed", describeError(error));
    return serverError();
  }
}
