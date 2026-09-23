import { readFileSync } from "node:fs";
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
const file = argument("file");
if (!locationId || !file) {
  throw new Error("Usage: npm run import:products -- --location-id <GHL_LOCATION_ID> --file catalogo.csv");
}

/* Same normalization as src/lib/catalog.ts, so imported names are searchable. */
function normalizeSearch(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/* Minimal CSV reader: `;`, tab or `,` (detected from the header), quoted fields with
   doubled quotes inside. Excel in Spanish exports with `;`. */
function parseCsv(text) {
  const clean = text.replace(/^﻿/, "");
  const header = clean.slice(0, clean.search(/\r?\n/));
  const delimiter = [";", "\t", ","].find((candidate) => header.includes(candidate)) ?? ";";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const character = clean[index];
    if (quoted) {
      if (character === '"' && clean[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && clean[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim()));
}

/* Columns by header name, so the file can come straight from a spreadsheet. `nombre` is
   the only required one; without `referencia` the name becomes the key. */
const COLUMNS = {
  reference: ["referencia", "referencias", "reference", "codigo", "sku"],
  name: ["nombre", "descripcion", "name", "producto"],
  category: ["categoria", "category"],
  subcategory: ["subcategoria", "subcategory", "especie"],
  note: ["nota", "nota_conversacional", "note"],
  unit: ["unidad", "unit", "unidad_venta"],
  price: ["precio", "price"],
};

const rows = parseCsv(readFileSync(file, "utf8"));
const header = rows.shift().map((value) => normalizeSearch(value).replace(/\s+/g, "_"));
const column = Object.fromEntries(
  Object.entries(COLUMNS).map(([key, names]) => [key, header.findIndex((value) => names.includes(value))]),
);
if (column.name < 0) throw new Error(`The file needs a "nombre" column. Found: ${header.join(", ")}`);

const read = (entry, key) => (column[key] >= 0 ? entry[column[key]]?.trim() || null : null);

const products = new Map();
for (const entry of rows) {
  const name = read(entry, "name");
  if (!name) continue;
  const reference = (read(entry, "reference") || normalizeSearch(name).replace(/[^a-z0-9]+/g, "-")).slice(0, 64);
  const rawPrice = read(entry, "price");
  const price = rawPrice ? Number(rawPrice.replace(/[^\d]/g, "")) : null;
  if (products.has(reference)) continue;
  products.set(reference, {
    reference,
    name: name.slice(0, 160),
    search_name: normalizeSearch(name),
    category: read(entry, "category")?.slice(0, 80) ?? null,
    subcategory: read(entry, "subcategory")?.slice(0, 80) ?? null,
    sale_note: read(entry, "note")?.slice(0, 300) ?? null,
    price_unit: read(entry, "unit")?.slice(0, 40) ?? null,
    price: price && price > 0 ? price : null,
  });
}

const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: location, error: locationError } = await supabase
  .from("locations")
  .select("id")
  .eq("ghl_location_id", locationId)
  .maybeSingle();
if (locationError) throw locationError;
if (!location) throw new Error(`Location ${locationId} is not provisioned; run provision:location first`);

/* Rows without a price are sent without the price columns, so re-importing the sheet
   never wipes prices the operators already set from the panel. */
const now = new Date().toISOString();
const all = [...products.values()].map((product) => ({ ...product, location_id: location.id, is_active: true }));
const withPrice = all.filter((product) => product.price !== null).map((product) => ({ ...product, price_updated_at: now }));
const withoutPrice = all
  .filter((product) => product.price === null)
  .map((product) => Object.fromEntries(Object.entries(product).filter(([key]) => key !== "price")));

const BATCH = 500;
for (const group of [withoutPrice, withPrice]) {
  for (let start = 0; start < group.length; start += BATCH) {
    const { error } = await supabase
      .from("products")
      .upsert(group.slice(start, start + BATCH), { onConflict: "location_id,reference" });
    if (error) throw error;
  }
}

process.stdout.write(
  `Imported ${all.length} product(s) for ${locationId} (${withPrice.length} with price, ${rows.length - all.length} skipped).\n`,
);
