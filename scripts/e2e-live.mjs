import { createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${response.status}`);
  }
}

async function json(response) {
  return response.json().catch(() => ({}));
}

const baseUrl = (process.argv[2] || "http://127.0.0.1:3110").replace(/\/$/, "");
const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pepper = required("EMBED_TOKEN_PEPPER");
const ingestSecret = required("GHL_INGEST_SECRET");

async function provision(ghlLocationId, name) {
  const token = randomBytes(32).toString("base64url");
  const embedTokenHash = createHmac("sha256", pepper).update(token).digest("hex");
  const { error } = await supabase.from("locations").upsert(
    { ghl_location_id: ghlLocationId, name, embed_token_hash: embedTokenHash, is_active: true },
    { onConflict: "ghl_location_id" },
  );
  if (error) throw error;
  return token;
}

async function webhook(payload, secret = ingestSecret) {
  return fetch(`${baseUrl}/api/webhooks/ghl/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function panel(path, locationId, token, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Location-Id": locationId,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

const runId = `${Date.now()}_${randomBytes(5).toString("hex")}`;
const locationId = `frutitodo-e2e-${runId}`;
const otherLocationId = `frutitodo-isolation-${runId}`;
const token = await provision(locationId, "Frutitodo E2E");
const otherToken = await provision(otherLocationId, "Frutitodo E2E Isolation");
const sourceEventId = `e2e_${runId}`;
const payload = {
  sourceEventId,
  locationId,
  contactId: `contact_${runId}`,
  customer: { name: "María Peña E2E", phone: "+57 300 555 0101" },
  delivery: { type: "domicilio", address: "Carrera 7 # 10-25, Bogotá" },
  items: [
    { name: "Aguacate Hass", quantity: 1.5, unit: "kg" },
    { name: "Huevos AA x30", quantity: 1, unit: "cubeta" },
  ],
  notes: "Prueba sintética; no preparar.",
};

let response = await webhook(payload, "invalid-secret");
expectStatus(response, 401, "invalid webhook secret");

response = await webhook({ ...payload, sourceEventId: `${sourceEventId}_invalid`, delivery: { type: "domicilio" } });
expectStatus(response, 422, "invalid delivery payload");

response = await webhook(payload);
expectStatus(response, 201, "order creation");
const created = await json(response);
if (!created.order?.id || !created.order?.number?.startsWith("FT-")) throw new Error("order creation response is incomplete");

response = await webhook(payload);
expectStatus(response, 200, "exact idempotent retry");
if (!(await json(response)).duplicate) throw new Error("exact retry was not marked as duplicate");

response = await webhook({ ...payload, notes: "Payload modificado" });
expectStatus(response, 409, "conflicting idempotent retry");

response = await panel("/api/orders?scope=active&page=0", locationId, token);
expectStatus(response, 200, "active order list");
const activeList = await json(response);
const listed = activeList.orders?.find((order) => order.id === created.order.id);
if (!listed || listed.customerName !== payload.customer.name) throw new Error("created order was not listed");

response = await panel(`/api/orders/${created.order.id}/dispatch`, locationId, token, {
  method: "POST",
  body: JSON.stringify({ requestId: `dispatch_early_${runId}` }),
});
expectStatus(response, 409, "dispatch before print");

const printRequestId = `print_${runId}`;
response = await panel(`/api/orders/${created.order.id}/print-confirmations`, locationId, token, {
  method: "POST",
  body: JSON.stringify({ requestId: printRequestId }),
});
expectStatus(response, 200, "first print confirmation");
if ((await json(response)).order?.printCount !== 1) throw new Error("first print count was not 1");

response = await panel(`/api/orders/${created.order.id}/print-confirmations`, locationId, token, {
  method: "POST",
  body: JSON.stringify({ requestId: printRequestId }),
});
expectStatus(response, 200, "idempotent print confirmation");
if ((await json(response)).order?.printCount !== 1) throw new Error("idempotent print incremented the count");

response = await panel(`/api/orders/${created.order.id}/print-confirmations`, locationId, token, {
  method: "POST",
  body: JSON.stringify({ requestId: `reprint_${runId}` }),
});
expectStatus(response, 200, "reprint confirmation");
if ((await json(response)).order?.printCount !== 2) throw new Error("reprint count was not 2");

const dispatchRequestId = `dispatch_${runId}`;
response = await panel(`/api/orders/${created.order.id}/dispatch`, locationId, token, {
  method: "POST",
  body: JSON.stringify({ requestId: dispatchRequestId }),
});
expectStatus(response, 200, "dispatch");
if ((await json(response)).order?.status !== "dispatched") throw new Error("order was not dispatched");

response = await panel(`/api/orders/${created.order.id}/dispatch`, locationId, token, {
  method: "POST",
  body: JSON.stringify({ requestId: dispatchRequestId }),
});
expectStatus(response, 200, "idempotent dispatch");

response = await panel("/api/orders?scope=dispatched&page=0", locationId, token);
expectStatus(response, 200, "dispatched history");
if (!(await json(response)).orders?.some((order) => order.id === created.order.id)) {
  throw new Error("dispatched order was not found in history");
}

response = await panel("/api/orders?scope=active&page=0", otherLocationId, otherToken);
expectStatus(response, 200, "isolated location list");
if ((await json(response)).orders?.some((order) => order.id === created.order.id)) {
  throw new Error("tenant isolation failed");
}

response = await fetch(`${baseUrl}/panel`);
expectStatus(response, 200, "panel document");
const csp = response.headers.get("content-security-policy") || "";
if (!csp.includes("frame-ancestors 'self' https://app.iaorbita.com")) throw new Error("iframe CSP is missing");
if (response.headers.has("x-frame-options")) throw new Error("X-Frame-Options must not be emitted");

process.stdout.write(
  JSON.stringify({
    ok: true,
    checks: 14,
    orderNumber: created.order.number,
    finalStatus: "dispatched",
    printCount: 2,
    tenantIsolation: true,
    iframeCsp: true,
  }),
);
