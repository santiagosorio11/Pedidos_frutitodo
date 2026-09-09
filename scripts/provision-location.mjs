import { createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const locationId = argument("location-id");
const locationName = argument("name") || "Frutitodo";
if (!locationId) {
  throw new Error("Usage: npm run provision:location -- --location-id <GHL_LOCATION_ID> [--name Frutitodo]");
}

const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const token = randomBytes(32).toString("base64url");
const tokenHash = createHmac("sha256", required("EMBED_TOKEN_PEPPER")).update(token).digest("hex");

const { error } = await supabase.from("locations").upsert(
  {
    ghl_location_id: locationId,
    name: locationName,
    embed_token_hash: tokenHash,
    is_active: true,
  },
  { onConflict: "ghl_location_id" },
);

if (error) throw error;

process.stdout.write(
  [
    "Location provisioned successfully.",
    "Copy this token to the GHL custom value frutitodo_panel_token; it will not be recoverable from Supabase:",
    token,
  ].join("\n"),
);
