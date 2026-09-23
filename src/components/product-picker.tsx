"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PanelCredentials } from "@/lib/panel-credentials";
import { formatPesos } from "@/lib/quote";
import type { Product, ProductsResponse } from "@/types/orders";
import { panelFetch } from "./panel-api";
import styles from "./orders-panel.module.css";

const RESULT_LIMIT = 8;

/* Free-text product field backed by the catalog: typing searches, picking a result fills
   the line with the catalog name, unit and price. Text that matches nothing stays valid. */
export function ProductPicker({
  credentials,
  value,
  onChange,
  onPick,
  ariaLabel,
  placeholder = "Buscar producto…",
}: {
  credentials: PanelCredentials;
  value: string;
  onChange: (value: string) => void;
  onPick: (product: Product) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [touched, setTouched] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open || !touched) return;
    const query = value.trim();
    if (query.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, limit: String(RESULT_LIMIT) });
      panelFetch<ProductsResponse>(credentials, `/api/products?${params.toString()}`, { signal: controller.signal })
        .then((body) => {
          setResults(body.products);
          setHighlight(0);
        })
        .catch(() => {
          /* Search is a convenience; the typed text still works as a product name. */
        });
    }, 200);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [credentials, value, open, touched]);

  const pick = (product: Product) => {
    onPick(product);
    setOpen(false);
    setTouched(false);
  };

  return (
    <div className={styles.picker}>
      <input
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        maxLength={160}
        role="combobox"
        aria-controls={listId}
        aria-expanded={open && results.length > 0}
        aria-autocomplete="list"
        onChange={(event) => {
          onChange(event.target.value);
          setTouched(true);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          closeTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(event) => {
          if (!open || !results.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((current) => Math.min(results.length - 1, current + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((current) => Math.max(0, current - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(results[highlight]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && results.length ? (
        <ul id={listId} className={styles.pickerList} role="listbox">
          {results.map((product, index) => (
            <li
              key={product.id}
              role="option"
              aria-selected={index === highlight}
              className={index === highlight ? styles.pickerActive : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                if (closeTimer.current) window.clearTimeout(closeTimer.current);
                pick(product);
              }}
            >
              <span>
                <strong>{product.name}</strong>
                <small>
                  {product.reference}
                  {product.category ? ` · ${product.category}` : ""}
                </small>
              </span>
              <em>
                {product.price !== null
                  ? `${formatPesos(product.price)}${product.priceUnit ? `/${product.priceUnit}` : ""}`
                  : "Sin precio"}
              </em>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
