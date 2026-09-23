import { collectUrlParams } from "@/lib/panel-credentials";

/* Who is at the tablet. It only labels tickets and the audit trail; it is not a
   credential, so reading it from the URL or letting the operator type it is fine. */
const OPERATOR_STORAGE_KEY = "frutitodo.panel.operator";

/* The menu link can pass `{{user.name}}`; GHL fills it with the signed-in user. */
const OPERATOR_KEYS = ["user", "user_name", "username", "operator", "operador"] as const;
const MERGE_TAG = /\{\{|\}\}|%7b%7b|%7d%7d/i;
const MAX_LENGTH = 80;

export function normalizeOperator(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed || MERGE_TAG.test(trimmed)) return null;
  return trimmed.slice(0, MAX_LENGTH);
}

export function operatorFromUrl(search: string, hash: string): string | null {
  const params = collectUrlParams(search, hash);
  for (const key of OPERATOR_KEYS) {
    const value = normalizeOperator(params.get(key));
    if (value) return value;
  }
  return null;
}

function withStorage<T>(action: (storage: Storage) => T): T | null {
  for (const open of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      return action(open());
    } catch {
      /* Blocked inside the iframe; try the next storage or keep it in memory. */
    }
  }
  return null;
}

export function resolveOperator(): string | null {
  const fromUrl = operatorFromUrl(window.location.search, window.location.hash);
  if (fromUrl) {
    saveOperator(fromUrl);
    return fromUrl;
  }
  return normalizeOperator(withStorage((storage) => storage.getItem(OPERATOR_STORAGE_KEY)));
}

export function saveOperator(operator: string | null): void {
  withStorage((storage) => {
    if (operator) storage.setItem(OPERATOR_STORAGE_KEY, operator);
    else storage.removeItem(OPERATOR_STORAGE_KEY);
  });
}
