"use client";

import { ArrowLeft, ArrowRight, CircleAlert, PackageSearch, Plus, Save, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PRICE_UNITS } from "@/lib/catalog";
import type { PanelCredentials } from "@/lib/panel-credentials";
import { formatPesos } from "@/lib/quote";
import type { Product, ProductCategory, ProductsResponse } from "@/types/orders";
import { panelFetch, parsePesos } from "./panel-api";
import styles from "./orders-panel.module.css";

type PricedFilter = "" | "priced" | "unpriced";
type Draft = { price: string; unit: string };

const PAGE_SIZE = 50;

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short" }).format(new Date(value));
}

export function CatalogView({ credentials, operator }: { credentials: PanelCredentials; operator: string | null }) {
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [priced, setPriced] = useState<PricedFilter>("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setQuery(searchDraft.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  const loadCategories = useCallback(() => {
    panelFetch<{ categories: ProductCategory[] }>(credentials, "/api/products/categories")
      .then((body) => setCategories(body.categories))
      .catch(() => {
        /* The filter just stays empty. */
      });
  }, [credentials]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const loadProducts = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      if (priced) params.set("priced", priced);
      try {
        setData(await panelFetch<ProductsResponse>(credentials, `/api/products?${params.toString()}`, { signal }));
        setError(null);
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el catálogo");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [credentials, page, query, category, priced],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProducts(controller.signal);
    return () => controller.abort();
  }, [loadProducts]);

  const draftFor = (product: Product): Draft =>
    drafts[product.id] ?? { price: product.price !== null ? String(product.price) : "", unit: product.priceUnit || "" };

  const isDirty = (product: Product) => {
    const draft = drafts[product.id];
    if (!draft) return false;
    const price = draft.price ? parsePesos(draft.price) : null;
    return price !== product.price || (draft.unit.trim() || null) !== product.priceUnit;
  };

  const save = async (product: Product) => {
    const draft = draftFor(product);
    setSavingId(product.id);
    try {
      const { product: updated } = await panelFetch<{ product: Product }>(credentials, `/api/products/${product.id}`, {
        method: "PATCH",
        body: {
          operator,
          price: draft.price ? parsePesos(draft.price) : null,
          priceUnit: draft.unit.trim() || undefined,
        },
      });
      setData((current) =>
        current ? { ...current, products: current.products.map((entry) => (entry.id === updated.id ? updated : entry)) } : current,
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
      if ((product.price === null) !== (updated.price === null)) loadCategories();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar el precio");
    } finally {
      setSavingId(null);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const pricedCount = categories.reduce((sum, entry) => sum + entry.priced, 0);
  const totalCount = categories.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <section className={styles.catalog} aria-label="Catálogo de productos">
      <div className={styles.catalogToolbar}>
        <label className={styles.searchField}>
          <Search size={18} aria-hidden="true" />
          <span className={styles.srOnly}>Buscar productos</span>
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Buscar por nombre o referencia…"
          />
        </label>
        <label className={styles.selectField}>
          <span>Categoría</span>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(0);
            }}
          >
            <option value="">Todas</option>
            {categories.map((entry) => (
              <option key={entry.category} value={entry.category}>
                {entry.category} ({entry.priced}/{entry.total} con precio)
              </option>
            ))}
          </select>
        </label>
        <label className={styles.selectField}>
          <span>Precio</span>
          <select
            value={priced}
            onChange={(event) => {
              setPriced(event.target.value as PricedFilter);
              setPage(0);
            }}
          >
            <option value="">Todos</option>
            <option value="priced">Con precio</option>
            <option value="unpriced">Sin precio</option>
          </select>
        </label>
        <button type="button" className={styles.newOrderButton} onClick={() => setCreating(true)}>
          <Plus size={16} /> Añadir producto
        </button>
      </div>

      <p className={styles.catalogSummary}>
        {totalCount
          ? `${pricedCount} de ${totalCount} productos con precio`
          : "El catálogo está vacío. Impórtalo con npm run import:products."}
        {data ? ` · ${data.total} en esta vista` : ""}
      </p>

      {error ? (
        <div className={styles.errorBanner} role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className={styles.skeleton} />
      ) : data && data.products.length ? (
        <div className={styles.catalogTableWrap}>
          <table className={styles.catalogTable}>
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Unidad</th>
                <th>Precio</th>
                <th><span className={styles.srOnly}>Guardar</span></th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((product) => {
                const draft = draftFor(product);
                const dirty = isDirty(product);
                const setDraft = (patch: Partial<Draft>) =>
                  setDrafts((current) => ({ ...current, [product.id]: { ...draftFor(product), ...patch } }));
                return (
                  <tr key={product.id} className={dirty ? styles.catalogRowDirty : undefined}>
                    <td className={styles.catalogRef}>{product.reference}</td>
                    <td>
                      <strong>{product.name}</strong>
                      {product.saleNote && product.saleNote !== "-" ? <small>{product.saleNote}</small> : null}
                    </td>
                    <td>
                      {product.category}
                      {product.subcategory ? <small>{product.subcategory}</small> : null}
                    </td>
                    <td>
                      <input
                        aria-label={`Unidad de ${product.name}`}
                        list="catalog-units"
                        value={draft.unit}
                        maxLength={40}
                        onChange={(event) => setDraft({ unit: event.target.value })}
                        onKeyDown={(event) => event.key === "Enter" && dirty && void save(product)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Precio de ${product.name}`}
                        inputMode="numeric"
                        placeholder="Sin precio"
                        className={product.price === null && !draft.price ? styles.missingPrice : undefined}
                        value={draft.price ? formatPesos(parsePesos(draft.price)) : ""}
                        onChange={(event) => setDraft({ price: String(parsePesos(event.target.value) || "") })}
                        onKeyDown={(event) => event.key === "Enter" && dirty && void save(product)}
                      />
                      {product.priceUpdatedAt ? <small>Actualizado {formatDay(product.priceUpdatedAt)}</small> : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.saveRowButton}
                        disabled={!dirty || savingId === product.id}
                        onClick={() => void save(product)}
                        aria-label={`Guardar ${product.name}`}
                      >
                        <Save size={15} /> {savingId === product.id ? "…" : "Guardar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="catalog-units">
            {PRICE_UNITS.map((unit) => <option key={unit} value={unit} />)}
          </datalist>
        </div>
      ) : (
        <section className={styles.emptyState}>
          <PackageSearch size={31} />
          <h2>No hay productos en esta vista</h2>
          <p>Prueba con otra búsqueda o añade el producto.</p>
        </section>
      )}

      {data && totalPages > 1 ? (
        <nav className={styles.pagination} aria-label="Paginación del catálogo">
          <button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>
            <ArrowLeft size={16} /> Anterior
          </button>
          <span>
            Página {page + 1} de {totalPages}
          </span>
          <button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((current) => current + 1)}>
            Siguiente <ArrowRight size={16} />
          </button>
        </nav>
      ) : null}

      {creating ? (
        <NewProductModal
          credentials={credentials}
          operator={operator}
          categories={categories.map((entry) => entry.category)}
          onCancel={() => setCreating(false)}
          onCreated={(product) => {
            setCreating(false);
            setSearchDraft(product.name);
            loadCategories();
          }}
        />
      ) : null}
    </section>
  );
}

function NewProductModal({
  credentials,
  operator,
  categories,
  onCancel,
  onCreated,
}: {
  credentials: PanelCredentials;
  operator: string | null;
  categories: string[];
  onCancel: () => void;
  onCreated: (product: Product) => void;
}) {
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [category, setCategory] = useState(categories[0] || "");
  const [unit, setUnit] = useState("lb");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { product } = await panelFetch<{ product: Product }>(credentials, "/api/products", {
        method: "POST",
        body: {
          operator,
          name: name.trim(),
          reference: reference.trim() || undefined,
          category: category.trim() || undefined,
          priceUnit: unit.trim() || undefined,
          price: price ? parsePesos(price) : undefined,
        },
      });
      onCreated(product);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "No fue posible crear el producto");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.modalBackdrop}>
      <form className={styles.formModal} aria-labelledby="new-product-title" onSubmit={submit}>
        <header className={styles.modalHeader}>
          <div>
            <p>CATÁLOGO</p>
            <h2 id="new-product-title">Añadir producto</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cerrar">
            <X size={19} />
          </button>
        </header>
        <div className={styles.modalBody}>
          <div className={styles.formGrid}>
            <label className={`${styles.formField} ${styles.formFieldWide}`}>
              <span>Nombre *</span>
              <input value={name} onChange={(event) => setName(event.target.value.toUpperCase())} required maxLength={160} autoFocus />
            </label>
            <label className={styles.formField}>
              <span>Referencia (opcional)</span>
              <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={64} placeholder="Se genera sola" />
            </label>
            <label className={styles.formField}>
              <span>Categoría</span>
              <input value={category} onChange={(event) => setCategory(event.target.value)} list="product-categories" maxLength={80} />
              <datalist id="product-categories">
                {categories.map((entry) => <option key={entry} value={entry} />)}
              </datalist>
            </label>
            <label className={styles.formField}>
              <span>Unidad de venta</span>
              <input value={unit} onChange={(event) => setUnit(event.target.value)} list="new-product-units" maxLength={40} />
              <datalist id="new-product-units">
                {PRICE_UNITS.map((entry) => <option key={entry} value={entry} />)}
              </datalist>
            </label>
            <label className={styles.formField}>
              <span>Precio</span>
              <input
                inputMode="numeric"
                value={price ? formatPesos(parsePesos(price)) : ""}
                onChange={(event) => setPrice(String(parsePesos(event.target.value) || ""))}
                placeholder="$ 0"
              />
            </label>
          </div>
          {error ? (
            <p className={styles.quoteError} role="alert">
              <CircleAlert size={15} /> {error}
            </p>
          ) : null}
        </div>
        <footer className={styles.modalActions}>
          <button type="button" className={styles.cancelButton} onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className={styles.confirmButton} disabled={busy || !name.trim()}>
            {busy ? "Guardando…" : "Añadir producto"}
          </button>
        </footer>
      </form>
    </div>
  );
}
