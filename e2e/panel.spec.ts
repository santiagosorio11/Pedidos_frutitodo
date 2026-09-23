import { expect, test } from "@playwright/test";

const order = {
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: "FT-000021",
  sourceEventId: "event_12345678",
  customerName: "María Fernanda Rodríguez",
  customerPhone: "+57 300 123 4567",
  customerDocument: "1020304050",
  paymentMethod: "Transferencia",
  ghlContactId: "contact-1",
  conversationId: "61PklkWIorEaDwT7KFAN",
  source: "ai",
  deliveryType: "domicilio",
  deliveryAddress: "Carrera 10 # 20-30, apartamento 402",
  items: [
    { name: "Leche deslactosada Alpina 1L", quantity: 2, unit: "unidad" },
    { name: "Aguacate Hass", quantity: 1.5, unit: "kg" },
    { name: "Huevos AA x30", quantity: 1, unit: "cubeta" },
  ],
  notes: "Si no hay aguacate maduro, llamar antes de reemplazar.",
  status: "pending",
  receivedAt: "2026-09-09T17:55:00.000Z",
  firstPrintedAt: null,
  lastPrintedAt: null,
  printCount: 0,
  dispatchedAt: null,
  lastAmendedAt: null,
  amendmentCount: 0,
  lastPrintedBy: null,
  dispatchedBy: null,
  quotedTotal: null,
  quotedAt: null,
};

const stats = { pending: 1, printed: 0, dispatchedToday: 0, newToday: 1, openHelpRequests: 0 };

const helpRequest = {
  id: "22222222-2222-4222-8222-222222222222",
  ghlContactId: "contact-7",
  conversationId: "conv-7",
  customerName: "Carlos Gómez",
  customerPhone: "+57 311 000 0000",
  reason: "Pregunta cuándo llega su pedido",
  orderId: null,
  status: "open",
  requestCount: 2,
  requestedAt: "2026-09-09T17:50:00.000Z",
  lastRequestedAt: "2026-09-09T17:58:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => window.dispatchEvent(new Event("afterprint"));
  });
  await page.route("**/api/orders?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        orders: [order],
        stats,
        pagination: { page: 0, pageSize: 50, total: 1, totalPages: 1 },
      }),
    });
  });
  await page.route("**/api/help-requests?**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ helpRequests: [helpRequest] }) });
  });
  await page.route("**/api/products**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ products: [] }) });
  });
});

test("loads the embedded operational panel and strips the token fragment", async ({ page }) => {
  await page.goto("/panel#location=frutitodo-test&token=secret-test-token");
  await expect(page.getByRole("heading", { name: "Panel de pedidos" })).toBeVisible();
  await expect(page.getByText("María Fernanda Rodríguez")).toBeVisible();
  await expect(page.getByText("FT-000021")).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("token=");
});

test("loads the panel from a query string link", async ({ page }) => {
  await page.goto("/panel?location=frutitodo-test&token=secret-test-token");
  await expect(page.getByRole("heading", { name: "Panel de pedidos" })).toBeVisible();
  await expect(page.getByText("María Fernanda Rodríguez")).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("token=");
});

test("explains a link GHL delivered without replacing the merge tag", async ({ page }) => {
  await page.goto("/panel?location=frutitodo-test&token={{custom_values.frutitodo_panel_token}}");
  await expect(page.getByRole("heading", { name: "Enlace de acceso incompleto" })).toBeVisible();
  await expect(page.getByText("sin reemplazar los valores dinámicos")).toBeVisible();
});

test("renders the 80 mm ticket and asks for explicit print confirmation", async ({ page }) => {
  await page.goto("/panel#location=frutitodo-test&token=secret-test-token");
  await page.getByRole("button", { name: "Imprimir", exact: true }).click();
  await expect(page.getByRole("heading", { name: "¿La impresión salió correctamente?" })).toBeVisible();

  await page.emulateMedia({ media: "print" });
  const printWidth = await page.locator(".print-host").evaluate((element) => element.getBoundingClientRect().width);
  expect(printWidth).toBeLessThanOrEqual(303);
  const ticket = page.locator(".print-host");
  await expect(ticket.getByText("ORDEN DE ALISTAMIENTO")).toBeVisible();
  await expect(ticket.getByText("Aguacate Hass")).toBeVisible();
});

test("flags an adjustment to a printed order without changing its number", async ({ page }) => {
  await page.route("**/api/orders?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        orders: [
          {
            ...order,
            status: "pending",
            firstPrintedAt: "2026-09-09T18:00:00.000Z",
            lastPrintedAt: "2026-09-09T18:00:00.000Z",
            printCount: 1,
            lastAmendedAt: "2026-09-09T18:30:00.000Z",
            amendmentCount: 1,
          },
        ],
        stats,
        pagination: { page: 0, pageSize: 50, total: 1, totalPages: 1 },
      }),
    });
  });

  await page.goto("/panel?location=frutitodo-test&token=secret-test-token");
  await expect(page.getByText("Ajuste · reimprimir").first()).toBeVisible();
  await expect(page.getByText("FT-000021")).toBeVisible();

  await page.getByRole("button", { name: "Reimprimir", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(
    page.locator(".print-host").getByText("AJUSTE AL PEDIDO FT-000021 · DESCARTA EL TIQUETE ANTERIOR")
  ).toBeVisible();
});

test("filters and opens the complete order detail", async ({ page }) => {
  await page.goto("/panel#location=frutitodo-test&token=secret-test-token");
  await page.getByRole("button", { name: /Ver detalle/ }).click();
  const dialog = page.getByRole("dialog", { name: "María Fernanda Rodríguez" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Pedido completo")).toBeVisible();
  await expect(dialog.getByText("Si no hay aguacate maduro")).toBeVisible();
  await expect(dialog.getByText("1020304050")).toBeVisible();
  await expect(dialog.getByText("Transferencia")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Abrir conversación", exact: true })).toHaveAttribute(
    "href",
    "https://app.iaorbita.com/v2/location/frutitodo-test/conversations/conversations/61PklkWIorEaDwT7KFAN",
  );
});

test("prints the operator passed by the menu link on the ticket", async ({ page }) => {
  await page.goto("/panel?location=frutitodo-test&token=secret-test-token&user=Isabel");
  await expect(page.getByRole("button", { name: /Isabel/ })).toBeVisible();
  await page.getByRole("button", { name: "Imprimir", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-host").getByText("Impreso por: Isabel")).toBeVisible();
});

test("surfaces help requests with a direct link to the GHL conversation", async ({ page }) => {
  await page.route("**/api/orders?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        orders: [order],
        stats: { ...stats, openHelpRequests: 1 },
        pagination: { page: 0, pageSize: 50, total: 1, totalPages: 1 },
      }),
    });
  });

  await page.goto("/panel?location=frutitodo-test&token=secret-test-token");
  await page.getByRole("button", { name: /1 cliente requiere ayuda/ }).click();
  await expect(page.getByRole("heading", { name: "Clientes que requieren ayuda" })).toBeVisible();
  await expect(page.getByText("Carlos Gómez")).toBeVisible();
  await expect(page.getByText("Pidió ayuda 2 veces")).toBeVisible();
  const link = page.getByRole("link", { name: "Abrir conversación", exact: true });
  await expect(link).toHaveAttribute("href", /\/conversations\/conversations\/conv-7$/);
  await expect(link).toHaveAttribute("target", "_top");
});

test("creates a manual phone order", async ({ page }) => {
  let posted: Record<string, unknown> | null = null;
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posted = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ created: true, order: { id: "x", number: "FT-000022" } }),
    });
  });

  await page.goto("/panel?location=frutitodo-test&token=secret-test-token");
  await page.getByRole("button", { name: "Pedido manual" }).click();
  await page.getByLabel("Nombre del cliente *").fill("Don Luis");
  await page.getByLabel("Teléfono *").fill("3001234567");
  await page.locator("form").getByLabel("Entrega").selectOption("recogida");
  await page.getByLabel("Producto 1", { exact: true }).fill("Tomate chonto");
  await page.getByLabel("Cantidad 1").fill("2");
  await page.getByLabel("Unidad 1").fill("lb");
  await page.getByRole("button", { name: "Crear pedido" }).click();

  await expect(page.getByText("Pedido FT-000022 creado")).toBeVisible();
  expect(posted).toMatchObject({
    customer: { name: "Don Luis", phone: "3001234567" },
    delivery: { type: "recogida" },
    items: [{ name: "Tomate chonto", quantity: 2, unit: "lb" }],
  });
});

const catalogProduct = (overrides: Record<string, unknown>) => ({
  id: "33333333-3333-4333-8333-333333333333",
  reference: "10043",
  name: "AGUACATE HASS",
  category: "Frutas y Verduras",
  subcategory: "Fruta",
  saleNote: "se vende por libra",
  price: 4000,
  priceUnit: "lb",
  priceUpdatedAt: null,
  ...overrides,
});

test("builds a quote from the catalog, totals it and sends it to the customer", async ({ page }) => {
  await page.route("**/api/products/match", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        matches: [
          { ...catalogProduct({ id: "44444444-4444-4444-8444-444444444444", reference: "7702001", name: "LECHE DESLACTOSADA ALPINA 1L", price: 5200, priceUnit: "und" }), score: 0.8 },
          { ...catalogProduct({}), score: 0.7 },
          null,
        ],
      }),
    });
  });
  let posted: Record<string, unknown> | null = null;
  await page.route("**/api/orders/*/quote", async (route) => {
    posted = route.request().postDataJSON();
    const quote = {
      lines: [],
      subtotal: 0,
      deliveryFee: 3000,
      total: 36400,
      notes: null,
      updatedAt: "2026-09-23T15:00:00.000Z",
      updatedBy: null,
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sent: true,
        order: { ...order, quote, quotedTotal: 36400, quotedAt: "2026-09-23T15:00:00.000Z", quoteSentBy: null },
      }),
    });
  });

  await page.goto("/panel?location=frutitodo-test&token=secret-test-token");
  await page.getByRole("button", { name: "Cotizar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Cotización para/ });
  await expect(dialog).toBeVisible();

  // 1.5 kg of avocado priced per libra becomes 3 lb (Colombian 500 g libra).
  await expect(dialog.getByLabel("Producto 2", { exact: true })).toHaveValue("AGUACATE HASS");
  await expect(dialog.getByLabel("Cantidad 2", { exact: true })).toHaveValue("3");
  await expect(dialog.getByText("Convertido de 1,5 kg")).toBeVisible();

  // The eggs had no catalog match: price them by hand.
  await dialog.getByLabel("Precio 3", { exact: true }).fill("14000");
  await dialog.getByLabel("Domicilio").fill("3000");
  // 2 × 5.200 + 3 × 4.000 + 1 × 14.000 + 3.000
  await expect(dialog.locator("dl").getByText(/39\.400/)).toBeVisible();

  await dialog.getByRole("button", { name: "Enviar al cliente" }).click();
  await dialog.getByRole("button", { name: /Confirmar envío/ }).click();
  await expect(page.getByText(/Cotización de .* enviada a María/)).toBeVisible();

  expect(posted).toMatchObject({
    send: true,
    deliveryFee: 3000,
    updateCatalogPrices: true,
    lines: [
      { name: "LECHE DESLACTOSADA ALPINA 1L", quantity: 2, unit: "und", unitPrice: 5200 },
      { name: "AGUACATE HASS", quantity: 3, unit: "lb", unitPrice: 4000 },
      { name: "Huevos AA x30", quantity: 1, unitPrice: 14000 },
    ],
  });
});

test("prices products from the catalog tab", async ({ page }) => {
  await page.route("**/api/products/categories", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ categories: [{ category: "Frutas y Verduras", total: 150, priced: 0 }] }),
    });
  });
  await page.route("**/api/products?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ products: [catalogProduct({ price: null })], total: 1, page: 0, pageSize: 50 }),
    });
  });
  let patched: Record<string, unknown> | null = null;
  await page.route("**/api/products/33333333-3333-4333-8333-333333333333", async (route) => {
    patched = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ product: catalogProduct({ price: 4500 }) }),
    });
  });

  await page.goto("/panel?location=frutitodo-test&token=secret-test-token");
  await page.getByRole("tab", { name: "Productos y precios" }).click();
  await expect(page.getByText("0 de 150 productos con precio")).toBeVisible();
  await page.getByLabel("Precio de AGUACATE HASS").fill("4500");
  await page.getByRole("button", { name: "Guardar AGUACATE HASS" }).click();
  await expect(page.getByRole("button", { name: "Guardar AGUACATE HASS" })).toBeDisabled();
  expect(patched).toMatchObject({ price: 4500, priceUnit: "lb" });
});
