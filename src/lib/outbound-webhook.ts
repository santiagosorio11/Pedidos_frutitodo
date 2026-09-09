import type { Order } from "@/types/orders";

export type OrderDispatchedEvent = {
  event: "order.dispatched";
  requestId: string;
  ghlLocationId: string;
  ghlContactId: string;
  order: Order;
};

type WebhookTarget = { url: string; secret: string | null };

const TIMEOUT_MS = 8_000;
const ATTEMPTS = 2;

/* Read outside getServerEnv: the panel has to keep working when no downstream
   automation is configured, so a missing URL is a no-op, never a crash. */
function getTarget(): WebhookTarget | null {
  const url = process.env.N8N_DISPATCH_WEBHOOK_URL?.trim();
  if (!url) return null;
  return { url, secret: process.env.N8N_WEBHOOK_SECRET?.trim() || null };
}

async function post(target: WebhookTarget, event: OrderDispatchedEvent): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (target.secret) headers.Authorization = `Bearer ${target.secret}`;

  return fetch(target.url, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Announces a dispatch to the downstream automation. Never throws: the order is
 * already dispatched in the database by the time this runs, so a failure here must
 * not turn a completed action into an error the operator sees.
 */
export async function notifyOrderDispatched(event: OrderDispatchedEvent): Promise<void> {
  const target = getTarget();
  if (!target) return;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await post(target, event);
      if (response.ok) return;
      /* A rejected payload will be rejected again; only a server-side failure is
         worth a second attempt. */
      if (response.status < 500) {
        console.error(`Dispatch webhook rejected ${event.order.orderNumber} with ${response.status}`);
        return;
      }
      console.error(`Dispatch webhook attempt ${attempt} failed for ${event.order.orderNumber} with ${response.status}`);
    } catch (error) {
      console.error(
        `Dispatch webhook attempt ${attempt} errored for ${event.order.orderNumber}:`,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  console.error(`Dispatch webhook gave up on ${event.order.orderNumber}; replay it manually if the CRM matters`);
}
