import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyOrderDispatched, type OrderDispatchedEvent } from "@/lib/outbound-webhook";

const event: OrderDispatchedEvent = {
  event: "order.dispatched",
  requestId: "request_12345678",
  ghlLocationId: "UfbKDvUAPCDEaRQWYXau",
  ghlContactId: "contacto-1",
  order: {
    id: "11111111-1111-4111-8111-111111111111",
    orderNumber: "FT-000021",
    sourceEventId: "event_12345678",
    customerName: "María Peña",
    customerPhone: "+57 300 123 4567",
    deliveryType: "domicilio",
    deliveryAddress: "Carrera 10 # 20-30",
    items: [{ name: "Aguacate Hass", quantity: 1.5, unit: "kg" }],
    notes: null,
    status: "dispatched",
    receivedAt: "2026-09-09T17:55:00.000Z",
    firstPrintedAt: null,
    lastPrintedAt: null,
    printCount: 1,
    dispatchedAt: "2026-09-09T18:10:00.000Z",
    lastAmendedAt: null,
    amendmentCount: 0,
  },
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.N8N_DISPATCH_WEBHOOK_URL = "https://n8n.example.com/webhook/despacho";
  delete process.env.N8N_WEBHOOK_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.N8N_DISPATCH_WEBHOOK_URL;
  delete process.env.N8N_WEBHOOK_SECRET;
});

describe("notifyOrderDispatched", () => {
  it("does nothing when no downstream automation is configured", async () => {
    delete process.env.N8N_DISPATCH_WEBHOOK_URL;
    await notifyOrderDispatched(event);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the event once when the webhook accepts it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await notifyOrderDispatched(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://n8n.example.com/webhook/despacho");
    expect(JSON.parse(init.body)).toMatchObject({
      event: "order.dispatched",
      ghlContactId: "contacto-1",
      order: { orderNumber: "FT-000021", status: "dispatched" },
    });
  });

  it("sends the shared secret as a bearer token when one is set", async () => {
    process.env.N8N_WEBHOOK_SECRET = "secreto-compartido";
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await notifyOrderDispatched(event);

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer secreto-compartido");
  });

  it("does not retry a payload the webhook rejected", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
    await notifyOrderDispatched(event);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once when the webhook fails on its side", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await notifyOrderDispatched(event);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up quietly instead of throwing at the caller", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(notifyOrderDispatched(event)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
