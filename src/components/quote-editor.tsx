"use client";

import { CircleAlert, MessageCircle, Plus, Receipt, Send, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PRICE_UNITS } from "@/lib/catalog";
import type { PanelCredentials } from "@/lib/panel-credentials";
import { computeQuote, convertQuantity, formatPesos, formatQuoteMessage, normalizeUnit } from "@/lib/quote";
import type { Order, Product } from "@/types/orders";
import { panelFetch, parsePesos, parseQuantity } from "./panel-api";
import { ProductPicker } from "./product-picker";
import styles from "./orders-panel.module.css";

type DraftLine = {
  key: number;
  productId: string | null;
  reference: string | null;
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  /** What the customer asked for, when the line comes from the order. */
  requested: string | null;
  hint: string | null;
};

type Match = (Product & { score: number }) | null;

/* React keys for editable rows; only uniqueness matters, so a module counter is enough. */
let lineKeySequence = 0;
const newKey = () => (lineKeySequence += 1);

/* Below this the suggestion is more likely wrong than helpful; the operator picks instead. */
const MIN_MATCH_SCORE = 0.45;

function quantityText(value: number): string {
  return String(value).replace(".", ",");
}

function lineFromProduct(line: DraftLine, product: Product): DraftLine {
  const current = parseQuantity(line.quantity);
  const converted = product.priceUnit ? convertQuantity(current, line.unit, product.priceUnit) : null;
  const changedUnit = converted !== null && normalizeUnit(line.unit) !== normalizeUnit(product.priceUnit);
  return {
    ...line,
    productId: product.id,
    reference: product.reference,
    name: product.name,
    quantity: converted !== null ? quantityText(converted) : line.quantity,
    unit: product.priceUnit || line.unit,
    unitPrice: product.price !== null ? String(product.price) : line.unitPrice,
    hint: changedUnit ? `Convertido de ${line.quantity} ${line.unit} (1 lb = 500 g)` : product.saleNote || null,
  };
}

export function QuoteEditor({
  order,
  credentials,
  operator,
  onClose,
  onSaved,
}: {
  order: Order;
  credentials: PanelCredentials;
  operator: string | null;
  onClose: () => void;
  onSaved: (order: Order, sent: boolean) => void;
}) {
  /* One key per editor: a double click or a retry after a network error sends once. */
  const [requestId] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<DraftLine[]>(() =>
    order.quote
      ? order.quote.lines.map((line) => ({
          key: newKey(),
          productId: line.productId,
          reference: line.reference,
          name: line.name,
          quantity: quantityText(line.quantity),
          unit: line.unit || "",
          unitPrice: String(line.unitPrice),
          requested: null,
          hint: null,
        }))
      : order.items.map((item) => ({
          key: newKey(),
          productId: null,
          reference: null,
          name: item.name,
          quantity: quantityText(item.quantity),
          unit: item.unit || "",
          unitPrice: "",
          requested: `${quantityText(item.quantity)}${item.unit ? ` ${item.unit}` : ""} ${item.name}`,
          hint: null,
        })),
  );
  const [deliveryFee, setDeliveryFee] = useState(order.quote ? String(order.quote.deliveryFee) : "");
  const [notes, setNotes] = useState(order.quote?.notes || "");
  const [updateCatalog, setUpdateCatalog] = useState(true);
  const [matching, setMatching] = useState(!order.quote);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  useEffect(() => {
    /* A fresh quote starts from the order lines; suggest a catalog product for each so
       the operator mostly confirms prices instead of searching 12.000 references. */
    if (order.quote) return;
    const controller = new AbortController();
    panelFetch<{ matches: Match[] }>(credentials, "/api/products/match", {
      method: "POST",
      body: { names: order.items.map((item) => item.name) },
      signal: controller.signal,
    })
      .then(({ matches }) => {
        /* Applying a suggestion twice would convert units twice; only the live request counts. */
        if (controller.signal.aborted) return;
        setLines((current) =>
          current.map((line, index) => {
            const match = matches[index];
            return match && match.score >= MIN_MATCH_SCORE ? lineFromProduct(line, match) : line;
          }),
        );
      })
      .catch(() => {
        /* Without suggestions the operator searches each line by hand. */
      })
      .finally(() => {
        if (!controller.signal.aborted) setMatching(false);
      });
    return () => controller.abort();
  }, [credentials, order]);

  const parsedLines = lines.map((line) => ({
    productId: line.productId,
    reference: line.reference,
    name: line.name.trim(),
    quantity: parseQuantity(line.quantity),
    unit: line.unit.trim() || null,
    unitPrice: parsePesos(line.unitPrice),
  }));
  const quote = computeQuote(
    parsedLines.filter((line) => line.name && line.quantity > 0),
    parsePesos(deliveryFee),
    { notes, updatedBy: operator },
  );
  const invalidLines = parsedLines.filter((line) => !line.name || line.quantity <= 0).length;
  const unpricedLines = parsedLines.filter((line) => line.name && line.quantity > 0 && line.unitPrice <= 0).length;
  const canSave = quote.lines.length > 0 && invalidLines === 0;
  const canSend = canSave && unpricedLines === 0 && Boolean(order.ghlContactId);

  const updateLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const submit = async (send: boolean) => {
    setBusy(send ? "send" : "save");
    setError(null);
    try {
      const result = await panelFetch<{ order: Order; sent: boolean }>(credentials, `/api/orders/${order.id}/quote`, {
        method: "POST",
        body: {
          requestId: send ? requestId : crypto.randomUUID(),
          operator,
          lines: quote.lines.map(({ productId, reference, name, quantity, unit, unitPrice }) => ({
            productId,
            reference,
            name,
            quantity,
            unit,
            unitPrice,
          })),
          deliveryFee: quote.deliveryFee,
          notes: notes.trim() || undefined,
          updateCatalogPrices: updateCatalog,
          send,
        },
      });
      onSaved(result.order, result.sent);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No fue posible guardar la cotización");
      setConfirmSend(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.modalBackdrop}>
      <section className={`${styles.formModal} ${styles.quoteModal}`} role="dialog" aria-modal="true" aria-labelledby="quote-title">
        <header className={styles.modalHeader}>
          <div>
            <p>{order.orderNumber} · {order.deliveryType === "domicilio" ? "Domicilio" : "Recoge en tienda"}</p>
            <h2 id="quote-title">Cotización para {order.customerName}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar cotización">
            <X size={19} />
          </button>
        </header>

        <div className={styles.modalBody}>
          {order.quotedAt ? (
            <p className={styles.quoteSentNote}>
              <MessageCircle size={15} /> Ya se envió una cotización de {formatPesos(order.quotedTotal ?? 0)}. Si la
              cambias, puedes reenviarla.
            </p>
          ) : null}
          {matching ? <p className={styles.formHint}>Buscando los productos en el catálogo…</p> : null}

          <div className={styles.quoteTable} role="table" aria-label="Líneas de la cotización">
            <div className={styles.quoteHead} role="row">
              <span role="columnheader">Producto</span>
              <span role="columnheader">Cant.</span>
              <span role="columnheader">Unidad</span>
              <span role="columnheader">Precio unit.</span>
              <span role="columnheader">Total</span>
              <span role="columnheader" className={styles.srOnly}>Quitar</span>
            </div>
            {lines.map((line, index) => {
              const parsed = parsedLines[index];
              const total = Math.round(parsed.quantity * parsed.unitPrice);
              return (
                <div className={styles.quoteRow} role="row" key={line.key}>
                  <div className={styles.quoteProduct}>
                    <ProductPicker
                      credentials={credentials}
                      ariaLabel={`Producto ${index + 1}`}
                      value={line.name}
                      onChange={(value) => updateLine(line.key, { name: value, productId: null, reference: null })}
                      onPick={(product) => setLines((current) => current.map((entry) => (entry.key === line.key ? lineFromProduct(entry, product) : entry)))}
                    />
                    <small>
                      {line.reference ? <span className={styles.refTag}>{line.reference}</span> : <span className={styles.freeTag}>Sin enlazar al catálogo</span>}
                      {line.requested ? ` Pidió: ${line.requested}` : ""}
                      {line.hint ? ` · ${line.hint}` : ""}
                    </small>
                  </div>
                  <input
                    aria-label={`Cantidad ${index + 1}`}
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  />
                  <input
                    aria-label={`Unidad ${index + 1}`}
                    list="quote-units"
                    value={line.unit}
                    maxLength={40}
                    onChange={(event) => updateLine(line.key, { unit: event.target.value })}
                  />
                  <input
                    aria-label={`Precio ${index + 1}`}
                    inputMode="numeric"
                    placeholder="$ 0"
                    className={parsed.unitPrice <= 0 ? styles.missingPrice : undefined}
                    value={line.unitPrice ? formatPesos(parsePesos(line.unitPrice)) : ""}
                    onChange={(event) => updateLine(line.key, { unitPrice: String(parsePesos(event.target.value) || "") })}
                  />
                  <strong className={styles.quoteLineTotal}>{formatPesos(total)}</strong>
                  <button
                    type="button"
                    aria-label={`Quitar producto ${index + 1}`}
                    onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
            <datalist id="quote-units">
              {PRICE_UNITS.map((unit) => <option key={unit} value={unit} />)}
            </datalist>
          </div>

          <button
            type="button"
            className={styles.addItemButton}
            onClick={() =>
              setLines((current) => [
                ...current,
                { key: newKey(), productId: null, reference: null, name: "", quantity: "1", unit: "", unitPrice: "", requested: null, hint: null },
              ])
            }
          >
            <Plus size={15} /> Agregar producto
          </button>

          <div className={styles.quoteBottom}>
            <div>
              <label className={styles.formField}>
                <span>Nota para el cliente (opcional)</span>
                <textarea
                  rows={3}
                  value={notes}
                  maxLength={1000}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Ej: No había aguacate maduro, lo cambiamos por papelillo."
                />
              </label>
              <label className={styles.checkField}>
                <input type="checkbox" checked={updateCatalog} onChange={(event) => setUpdateCatalog(event.target.checked)} />
                Guardar estos precios en el catálogo
              </label>
            </div>
            <dl className={styles.quoteTotals}>
              <div><dt>Subtotal</dt><dd>{formatPesos(quote.subtotal)}</dd></div>
              <div>
                <dt>
                  <label htmlFor="quote-delivery">Domicilio</label>
                </dt>
                <dd>
                  <input
                    id="quote-delivery"
                    inputMode="numeric"
                    placeholder="$ 0"
                    value={deliveryFee ? formatPesos(parsePesos(deliveryFee)) : ""}
                    onChange={(event) => setDeliveryFee(String(parsePesos(event.target.value) || ""))}
                  />
                </dd>
              </div>
              <div className={styles.quoteGrandTotal}><dt>Total</dt><dd>{formatPesos(quote.total)}</dd></div>
            </dl>
          </div>

          {unpricedLines ? (
            <p className={styles.quoteWarning}>
              <CircleAlert size={15} /> {unpricedLines} producto(s) sin precio. Ponles precio o quítalos antes de enviar.
            </p>
          ) : null}
          {!order.ghlContactId ? (
            <p className={styles.quoteWarning}>
              <CircleAlert size={15} /> Pedido manual sin WhatsApp: puedes guardar e imprimir la cotización, pero no enviarla.
            </p>
          ) : null}

          <details className={styles.quotePreview}>
            <summary>Ver el mensaje que recibirá el cliente</summary>
            <pre>{formatQuoteMessage(order, quote)}</pre>
          </details>

          {error ? (
            <p className={styles.quoteError} role="alert">
              <CircleAlert size={15} /> {error}
            </p>
          ) : null}
        </div>

        <footer className={styles.modalActions}>
          <button type="button" className={styles.cancelButton} onClick={onClose} disabled={busy !== null}>
            Cancelar
          </button>
          <button type="button" className={styles.detailsButton} onClick={() => void submit(false)} disabled={!canSave || busy !== null}>
            <Receipt size={16} /> {busy === "save" ? "Guardando…" : "Guardar"}
          </button>
          {confirmSend ? (
            <button type="button" className={styles.dispatchButton} onClick={() => void submit(true)} disabled={!canSend || busy !== null}>
              <Send size={16} /> {busy === "send" ? "Enviando…" : `Confirmar envío de ${formatPesos(quote.total)}`}
            </button>
          ) : (
            <button type="button" className={styles.printButton} onClick={() => setConfirmSend(true)} disabled={!canSend || busy !== null}>
              <Send size={16} /> Enviar al cliente
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
