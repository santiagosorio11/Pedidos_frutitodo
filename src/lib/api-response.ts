import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function unauthorized(): NextResponse {
  return noStoreJson({ error: "unauthorized", message: "Acceso no autorizado" }, { status: 401 });
}

export function invalidPayload(error: ZodError): NextResponse {
  return noStoreJson(
    {
      error: "invalid_payload",
      message: "Los datos enviados no cumplen el contrato",
      fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    },
    { status: 422 },
  );
}

export function serverError(): NextResponse {
  return noStoreJson(
    { error: "internal_error", message: "No fue posible completar la operación" },
    { status: 500 },
  );
}

/* Supabase errors are plain objects, not Error instances; without this every database
   failure was logged as "Unknown error" and could only be diagnosed by reproducing it. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    const code = "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
    return `${error.message}${code}`;
  }
  return "Unknown error";
}
