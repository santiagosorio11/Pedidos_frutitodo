import type { Order } from "@/types/orders";

type EventBase = {
  requestId: string;
  ghlLocationId: string;
  ghlContactId: string | null;
  operator: string | null;
  order: Order;
};

export type OrderPrintedEvent = EventBase & { event: "order.printed" };
export type OrderDispatchedEvent = EventBase & { event: "order.dispatched" };

/* Quotes are not relayed: the panel sends them straight through the GHL API so the
   operator sees whether the message really went out. */
export type OrderEvent = OrderPrintedEvent | OrderDispatchedEvent;

type WebhookTarget = { url: string; secret: string | null };

const TIMEOUT_MS = 8_000;
const ATTEMPTS = 2;

/* Read outside getServerEnv: the panel has to keep working when no downstream
   automation is configured, so a missing URL is a no-op, never a crash. The variable keeps
   its original name; it now receives every order event, told apart by `event`. */
function getTarget(): WebhookTarget | null {
  const url = process.env.N8N_DISPATCH_WEBHOOK_URL?.trim();
  if (!url) return null;
  return { url, secret: process.env.N8N_WEBHOOK_SECRET?.trim() || null };
}

async function post(target: WebhookTarget, event: OrderEvent): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (target.secret) headers.Authorization = `Bearer ${target.secret}`;

  return fetch(target.url, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export type DeliveryResult = { delivered: boolean; status: number | null };

/**
 * Sends an order event to the downstream automation. Never throws: the change it reports
 * is already committed, so a failure here must not turn into an error the operator sees.
 */
export async function sendOrderEvent(event: OrderEvent): Promise<DeliveryResult> {
  const target = getTarget();
  if (!target) return { delivered: false, status: null };
  const label = `${event.event} ${event.order.orderNumber}`;
  let status: number | null = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await post(target, event);
      status = response.status;
      if (response.ok) return { delivered: true, status };
      /* A rejected payload will be rejected again; only a server-side failure is
         worth a second attempt. */
      if (response.status < 500) {
        console.error(`Order webhook rejected ${label} with ${response.status}`);
        return { delivered: false, status };
      }
      console.error(`Order webhook attempt ${attempt} failed for ${label} with ${response.status}`);
    } catch (error) {
      console.error(
        `Order webhook attempt ${attempt} errored for ${label}:`,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  console.error(`Order webhook gave up on ${label}; replay it manually if the CRM matters`);
  return { delivered: false, status };
}

/** Fire-and-forget form for events that run after the response with `after()`. */
export async function notifyOrderEvent(event: OrderEvent): Promise<void> {
  await sendOrderEvent(event);
}
