export type PanelCredentials = { token: string; locationId: string };

export type CredentialIssue =
  | "no-parameters"
  | "missing-location"
  | "missing-token"
  | "unresolved-merge-tag"
  | "malformed-token"
  | "storage-blocked";

export type CredentialSource = "url" | "storage" | "none";

export type PanelAccessResult = {
  credentials: PanelCredentials | null;
  source: CredentialSource;
  issues: CredentialIssue[];
};

const TOKEN_STORAGE_KEY = "frutitodo.panel.token";
const LOCATION_STORAGE_KEY = "frutitodo.panel.location";
const PROBE_STORAGE_KEY = "frutitodo.panel.probe";

/* GHL rewrites the URL of a custom menu link in ways we do not control: it can move the
   parameters from the fragment to the query string, drop the fragment, or append its own
   query after it. Accept every shape instead of showing an empty panel. */
const LOCATION_KEYS = ["location", "locationid", "location_id", "ghl_location_id"] as const;
const TOKEN_KEYS = ["token", "paneltoken", "panel_token", "accesstoken", "access_token"] as const;

const FOREIGN_TOKEN_CHARACTER = /[^A-Za-z0-9._~-]/;
const MERGE_TAG = /\{\{|\}\}|%7b%7b|%7d%7d/i;

export function collectUrlParams(search: string, hash: string): Map<string, string> {
  const fragment = hash.replace(/^#/, "");
  const appended = fragment.indexOf("?");
  const sources =
    appended >= 0
      ? [search, fragment.slice(0, appended), fragment.slice(appended + 1)]
      : [search, fragment];

  const params = new Map<string, string>();
  for (const source of sources) {
    for (const [key, value] of new URLSearchParams(source.replace(/^\?/, ""))) {
      const name = key.trim().toLowerCase();
      const trimmed = value.trim();
      if (trimmed && !params.has(name)) params.set(name, trimmed);
    }
  }
  return params;
}

function readFirst(params: Map<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = params.get(key);
    if (value) return value;
  }
  return "";
}

export function parseUrlCredentials(search: string, hash: string): PanelAccessResult {
  const params = collectUrlParams(search, hash);
  const rawLocation = readFirst(params, LOCATION_KEYS);
  const rawToken = readFirst(params, TOKEN_KEYS);

  if (!rawLocation && !rawToken) {
    return { credentials: null, source: "none", issues: ["no-parameters"] };
  }

  const issues: CredentialIssue[] = [];
  const locationUnresolved = MERGE_TAG.test(rawLocation);
  const tokenUnresolved = MERGE_TAG.test(rawToken);
  if (locationUnresolved || tokenUnresolved) issues.push("unresolved-merge-tag");

  const locationId = locationUnresolved ? "" : rawLocation;
  /* When GHL appends its own query to the fragment it glues `?foo=bar` onto the last
     value; the token is base64url, so cut it at the first character outside that set. */
  const token = tokenUnresolved ? "" : rawToken.split(FOREIGN_TOKEN_CHARACTER)[0];
  if (rawToken && !tokenUnresolved && token !== rawToken) issues.push("malformed-token");

  if (!locationId) issues.push("missing-location");
  if (!token) issues.push("missing-token");
  if (!locationId || !token) return { credentials: null, source: "none", issues };

  return { credentials: { token, locationId }, source: "url", issues };
}

function openStorage(): Storage | null {
  for (const open of [() => window.sessionStorage, () => window.localStorage]) {
    try {
      const storage = open();
      storage.setItem(PROBE_STORAGE_KEY, "1");
      storage.removeItem(PROBE_STORAGE_KEY);
      return storage;
    } catch {
      /* Browsers that partition or block third-party storage throw inside the GHL iframe. */
    }
  }
  return null;
}

function stripCredentialsFromUrl(): void {
  const secrets = new Set<string>([...LOCATION_KEYS, ...TOKEN_KEYS]);
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(window.location.search)) {
    if (!secrets.has(key.trim().toLowerCase())) kept.append(key, value);
  }
  const query = kept.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

export function resolvePanelAccess(): PanelAccessResult {
  const storage = openStorage();
  const fromUrl = parseUrlCredentials(window.location.search, window.location.hash);

  if (fromUrl.credentials) {
    let persisted = false;
    try {
      storage?.setItem(TOKEN_STORAGE_KEY, fromUrl.credentials.token);
      storage?.setItem(LOCATION_STORAGE_KEY, fromUrl.credentials.locationId);
      persisted = storage !== null;
    } catch {
      persisted = false;
    }
    /* Hide the credentials only once they survive a reload, otherwise the next iframe
       refresh would come back to a URL with nothing in it. */
    if (persisted) stripCredentialsFromUrl();
    return {
      credentials: fromUrl.credentials,
      source: "url",
      issues: persisted ? fromUrl.issues : [...fromUrl.issues, "storage-blocked"],
    };
  }

  if (storage) {
    const token = storage.getItem(TOKEN_STORAGE_KEY)?.trim();
    const locationId = storage.getItem(LOCATION_STORAGE_KEY)?.trim();
    if (token && locationId) return { credentials: { token, locationId }, source: "storage", issues: [] };
  }

  return {
    credentials: null,
    source: "none",
    issues: storage ? fromUrl.issues : [...fromUrl.issues, "storage-blocked"],
  };
}
