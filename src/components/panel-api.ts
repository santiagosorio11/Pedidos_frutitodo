import type { PanelCredentials } from "@/lib/panel-credentials";

export function authHeaders(credentials: PanelCredentials): HeadersInit {
  return {
    Authorization: `Bearer ${credentials.token}`,
    "X-Location-Id": credentials.locationId,
  };
}

export async function responseMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || "No fue posible completar la operación";
}

/** Panel request with the embed credentials; throws with the API's message on failure. */
export async function panelFetch<T>(
  credentials: PanelCredentials,
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: init.method || "GET",
    headers: {
      ...authHeaders(credentials),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: init.signal,
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  return (await response.json()) as T;
}

/* Operators type amounts the Colombian way ("128.000"), so separators are dropped. */
export function parsePesos(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

/* Quantities accept a decimal comma ("1,5"). */
export function parseQuantity(value: string): number {
  const number = Number(value.trim().replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}
