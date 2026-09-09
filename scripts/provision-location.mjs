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

/* Overridable so a domain move does not mean editing this script. */
const panelBaseUrl = process.env.PANEL_BASE_URL?.trim() || "https://pedidos-frutitodo-eight.vercel.app";

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

/* The trailing newline matters: PowerShell drops an unterminated final line, which
   silently swallowed the one value this script exists to hand over. */
process.stdout.write(
  [
    "Location provisioned successfully.",
    "Supabase stores only the hash, so copy the token now; it cannot be read back later.",
    "Paste this link into the GHL custom menu link:",
    `${panelBaseUrl}/panel?location=${locationId}&token=${token}`,
    "",
  ].join("\n"),
);
