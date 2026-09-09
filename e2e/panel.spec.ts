import { expect, test } from "@playwright/test";

const order = {
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: "FT-000021",
  sourceEventId: "event_12345678",
  customerName: "María Fernanda Rodríguez",
  customerPhone: "+57 300 123 4567",
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
        stats: { active: 1, newToday: 1, awaitingDispatch: 0 },
        pagination: { page: 0, pageSize: 50, total: 1, totalPages: 1 },
      }),
    });
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

test("filters and opens the complete order detail", async ({ page }) => {
  await page.goto("/panel#location=frutitodo-test&token=secret-test-token");
  await page.getByRole("button", { name: /Ver detalle/ }).click();
  const dialog = page.getByRole("dialog", { name: "María Fernanda Rodríguez" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Pedido completo")).toBeVisible();
  await expect(dialog.getByText("Si no hay aguacate maduro")).toBeVisible();
});
