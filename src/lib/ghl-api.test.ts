import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GhlApiError, sendContactMessage, updateContactCustomFields } from "@/lib/ghl-api";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.GHL_API_TOKEN = "pit-test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GHL_API_TOKEN;
  delete process.env.GHL_MESSAGE_TYPE;
});

describe("sendContactMessage", () => {
  it("posts a WhatsApp message to the contact with the private token", async () => {
    fetchMock.mockResolvedValue(Response.json({ messageId: "m1", conversationId: "c1" }));
    await expect(sendContactMessage("contact-1", "Hola")).resolves.toEqual({ messageId: "m1", conversationId: "c1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://services.leadconnectorhq.com/conversations/messages");
    expect(init.headers.Authorization).toBe("Bearer pit-test");
    expect(init.headers.Version).toBe("2021-04-15");
    expect(JSON.parse(init.body)).toEqual({ type: "WhatsApp", contactId: "contact-1", message: "Hola" });
  });

  it("surfaces the reason GHL gives, such as a closed WhatsApp window", async () => {
    fetchMock.mockResolvedValue(Response.json({ message: "Outside 24 hour window" }, { status: 422 }));
    await expect(sendContactMessage("contact-1", "Hola")).rejects.toMatchObject({
      name: "GhlApiError",
      status: 422,
      message: "GHL rechazó el envío: Outside 24 hour window",
    });
  });

  it("fails clearly when the token is missing", async () => {
    delete process.env.GHL_API_TOKEN;
    await expect(sendContactMessage("contact-1", "Hola")).rejects.toBeInstanceOf(GhlApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("updateContactCustomFields", () => {
  it("never throws when GHL fails", async () => {
    fetchMock.mockResolvedValue(Response.json({ message: "bad" }, { status: 400 }));
    await expect(updateContactCustomFields("contact-1", [{ key: "ultimo_pedido_total", value: "1000" }])).resolves.toBeUndefined();
  });
});
