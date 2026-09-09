"use client";

import {
  ArrowLeft,
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  MapPin,
  PackageCheck,
  Phone,
  Printer,
  RefreshCw,
  Search,
  ShoppingBasket,
  Store,
  Truck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolvePanelAccess } from "@/lib/panel-credentials";
import type { CredentialIssue, PanelCredentials } from "@/lib/panel-credentials";
import type { DeliveryType, Order, OrdersResponse, OrderStatus } from "@/types/orders";
import styles from "./orders-panel.module.css";

type Scope = "active" | "dispatched";
type Filters = {
  scope: Scope;
  status: "" | Exclude<OrderStatus, "dispatched">;
  delivery: "" | DeliveryType;
  q: string;
  from: string;
  to: string;
  page: number;
};

const EMPTY_FILTERS: Filters = {
  scope: "active",
  status: "",
  delivery: "",
  q: "",
  from: "",
  to: "",
  page: 0,
};

function authHeaders(credentials: PanelCredentials): HeadersInit {
  return {
    Authorization: `Bearer ${credentials.token}`,
    "X-Location-Id": credentials.locationId,
  };
}

async function responseMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || "No fue posible completar la operación";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function relativeTime(value: string): string {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (diffMinutes < 1) return "Ahora";
  if (diffMinutes < 60) return `Hace ${diffMinutes} min`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return formatDate(value);
}

function deliveryLabel(type: DeliveryType): string {
  return type === "domicilio" ? "Domicilio" : "Recogida";
}

function statusLabel(status: OrderStatus): string {
  if (status === "pending") return "Nuevo";
  if (status === "printed") return "Impreso";
  return "Despachado";
}

function quantityLabel(quantity: number, unit?: string): string {
  const number = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(quantity);
  return unit ? `${number} ${unit}` : number;
}

export function OrdersPanel() {
  const [credentials, setCredentials] = useState<PanelCredentials | null>(null);
  const [accessIssues, setAccessIssues] = useState<CredentialIssue[]>([]);
  const [accessReady, setAccessReady] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchDraft, setSearchDraft] = useState("");
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [confirmPrintedOrder, setConfirmPrintedOrder] = useState<Order | null>(null);
  const [dispatchOrder, setDispatchOrder] = useState<Order | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const printOrderRef = useRef<Order | null>(null);

  useEffect(() => {
    /* Browser storage and the URL parameters do not exist during SSR. This one-time
       hydration update intentionally happens after the component mounts. */
    const access = resolvePanelAccess();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCredentials(access.credentials);
    setAccessIssues(access.issues);
    setAccessReady(true);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters((current) => ({ ...current, q: searchDraft.trim(), page: 0 }));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  const loadOrders = useCallback(
    async (quiet = false) => {
      if (!credentials) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (quiet) setRefreshing(true);
      else setLoading(true);

      const params = new URLSearchParams({ scope: filters.scope, page: String(filters.page) });
      if (filters.status) params.set("status", filters.status);
      if (filters.delivery) params.set("delivery", filters.delivery);
      if (filters.q) params.set("q", filters.q);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);

      try {
        const response = await fetch(`/api/orders?${params.toString()}`, {
          headers: authHeaders(credentials),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await responseMessage(response));
        setData((await response.json()) as OrdersResponse);
        setError(null);
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") {
          setError(requestError instanceof Error ? requestError.message : "No fue posible cargar los pedidos");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [credentials, filters],
  );

  useEffect(() => {
    if (!credentials) return;
    const frame = window.requestAnimationFrame(() => void loadOrders());

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadOrders(true);
    }, 5000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadOrders(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      abortRef.current?.abort();
    };
  }, [credentials, loadOrders]);

  useEffect(() => {
    printOrderRef.current = printOrder;
  }, [printOrder]);

  useEffect(() => {
    const onAfterPrint = () => {
      if (printOrderRef.current) setConfirmPrintedOrder(printOrderRef.current);
    };
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, []);

  const postAction = useCallback(
    async (path: string) => {
      if (!credentials) throw new Error("Acceso no disponible");
      const response = await fetch(path, {
        method: "POST",
        headers: { ...authHeaders(credentials), "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      return (await response.json()) as { order: Order };
    },
    [credentials],
  );

  const beginPrint = (order: Order) => {
    setPrintOrder(order);
    printOrderRef.current = order;
    setSelectedOrder(null);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
  };

  const confirmPrint = async () => {
    if (!confirmPrintedOrder) return;
    setActionBusy(true);
    try {
      await postAction(`/api/orders/${confirmPrintedOrder.id}/print-confirmations`);
      setConfirmPrintedOrder(null);
      setPrintOrder(null);
      await loadOrders(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No fue posible confirmar la impresión");
    } finally {
      setActionBusy(false);
    }
  };

  const confirmDispatch = async () => {
    if (!dispatchOrder) return;
    setActionBusy(true);
    try {
      await postAction(`/api/orders/${dispatchOrder.id}/dispatch`);
      setDispatchOrder(null);
      setSelectedOrder(null);
      await loadOrders(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No fue posible despachar el pedido");
    } finally {
      setActionBusy(false);
    }
  };

  const clearFilters = () => {
    setSearchDraft("");
    setFilters((current) => ({ ...EMPTY_FILTERS, scope: current.scope }));
  };

  const hasFilters = Boolean(filters.status || filters.delivery || filters.q || filters.from || filters.to);
  const orders = data?.orders || [];

  if (!accessReady) return <LoadingScreen />;
  if (!credentials) return <AccessScreen issues={accessIssues} />;

  return (
    <>
      <main className={`${styles.screen} screen-app`}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <div className={styles.brandBlock}>
              <div className={styles.brandMark} aria-hidden="true">
                <ShoppingBasket size={22} strokeWidth={2.2} />
              </div>
              <div>
                <p className={styles.eyebrow}>Frutitodo · Operación</p>
                <h1>Panel de pedidos</h1>
                <p className={styles.subtitle}>Alista, imprime y despacha cada pedido desde un solo lugar.</p>
              </div>
            </div>
            <button
              className={styles.refreshButton}
              type="button"
              onClick={() => void loadOrders(true)}
              aria-label="Actualizar pedidos"
              title="Actualizar pedidos"
            >
              <RefreshCw size={19} className={refreshing ? styles.spinning : undefined} />
            </button>
          </header>

          {error ? (
            <div className={styles.errorBanner} role="alert">
              <CircleAlert size={18} />
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso">
                <X size={16} />
              </button>
            </div>
          ) : null}

          <section className={styles.stats} aria-label="Resumen de pedidos">
            <StatCard label="Pedidos activos" value={data?.stats.active ?? 0} icon={<Box size={19} />} />
            <StatCard label="Nuevos hoy" value={data?.stats.newToday ?? 0} icon={<Clock3 size={19} />} accent />
            <StatCard
              label="Impresos por despachar"
              value={data?.stats.awaitingDispatch ?? 0}
              icon={<PackageCheck size={19} />}
            />
          </section>

          <section className={styles.controlPanel} aria-label="Filtros">
            <div className={styles.tabs} role="tablist" aria-label="Estado general">
              <button
                type="button"
                role="tab"
                aria-selected={filters.scope === "active"}
                className={filters.scope === "active" ? styles.activeTab : undefined}
                onClick={() => setFilters((current) => ({ ...current, scope: "active", status: "", page: 0 }))}
              >
                Pendientes
                <span>{data?.stats.active ?? 0}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filters.scope === "dispatched"}
                className={filters.scope === "dispatched" ? styles.activeTab : undefined}
                onClick={() => setFilters((current) => ({ ...current, scope: "dispatched", status: "", page: 0 }))}
              >
                Despachados
              </button>
            </div>

            <div className={styles.filters}>
              <label className={styles.searchField}>
                <Search size={18} aria-hidden="true" />
                <span className={styles.srOnly}>Buscar pedidos</span>
                <input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Buscar nombre, teléfono, pedido o producto..."
                />
              </label>

              {filters.scope === "active" ? (
                <label className={styles.selectField}>
                  <span>Estado</span>
                  <select
                    value={filters.status}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        status: event.target.value as Filters["status"],
                        page: 0,
                      }))
                    }
                  >
                    <option value="">Todos</option>
                    <option value="pending">Nuevos</option>
                    <option value="printed">Impresos</option>
                  </select>
                </label>
              ) : null}

              <label className={styles.selectField}>
                <span>Entrega</span>
                <select
                  value={filters.delivery}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      delivery: event.target.value as Filters["delivery"],
                      page: 0,
                    }))
                  }
                >
                  <option value="">Todas</option>
                  <option value="domicilio">Domicilio</option>
                  <option value="recogida">Recogida</option>
                </select>
              </label>

              <label className={styles.dateField}>
                <span>Desde</span>
                <input
                  type="date"
                  value={filters.from}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, from: event.target.value, page: 0 }))
                  }
                />
              </label>
              <label className={styles.dateField}>
                <span>Hasta</span>
                <input
                  type="date"
                  value={filters.to}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, to: event.target.value, page: 0 }))
                  }
                />
              </label>

              <button className={styles.clearButton} type="button" onClick={clearFilters} disabled={!hasFilters}>
                Limpiar
              </button>
            </div>
          </section>

          <div className={styles.sectionHead}>
            <div>
              <h2>{filters.scope === "active" ? "Pedidos por alistar" : "Historial despachado"}</h2>
              <p>{data?.pagination.total ?? 0} pedido(s) en esta vista</p>
            </div>
            {refreshing ? <span className={styles.syncLabel}>Actualizando</span> : null}
          </div>

          {loading ? (
            <OrderSkeletons />
          ) : orders.length ? (
            <section className={styles.ordersGrid} aria-live="polite">
              {orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onDetails={setSelectedOrder}
                  onPrint={beginPrint}
                  onDispatch={setDispatchOrder}
                />
              ))}
            </section>
          ) : (
            <section className={styles.emptyState}>
              <ShoppingBasket size={31} />
              <h2>No hay pedidos en esta vista</h2>
              <p>{hasFilters ? "Prueba limpiando los filtros." : "Los nuevos pedidos aparecerán automáticamente."}</p>
            </section>
          )}

          {data && data.pagination.totalPages > 1 ? (
            <nav className={styles.pagination} aria-label="Paginación">
              <button
                type="button"
                disabled={filters.page === 0}
                onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
              >
                <ArrowLeft size={16} /> Anterior
              </button>
              <span>
                Página {filters.page + 1} de {data.pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={filters.page + 1 >= data.pagination.totalPages}
                onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
              >
                Siguiente <ArrowRight size={16} />
              </button>
            </nav>
          ) : null}
        </div>
      </main>

      {selectedOrder ? (
        <OrderModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onPrint={beginPrint}
          onDispatch={setDispatchOrder}
        />
      ) : null}

      {confirmPrintedOrder ? (
        <ConfirmModal
          title="¿La impresión salió correctamente?"
          description={`Confirma para registrar ${confirmPrintedOrder.orderNumber} como impreso.`}
          confirmLabel="Sí, quedó impreso"
          icon={<Printer size={22} />}
          busy={actionBusy}
          onCancel={() => {
            setConfirmPrintedOrder(null);
            setPrintOrder(null);
          }}
          onConfirm={() => void confirmPrint()}
        />
      ) : null}

      {dispatchOrder ? (
        <ConfirmModal
          title="Confirmar despacho"
          description={`${dispatchOrder.orderNumber} saldrá del listado de pendientes y pasará al historial.`}
          confirmLabel="Marcar despachado"
          icon={<Truck size={22} />}
          busy={actionBusy}
          onCancel={() => setDispatchOrder(null)}
          onConfirm={() => void confirmDispatch()}
        />
      ) : null}

      <div className={`${styles.printHost} print-host`} aria-hidden="true">
        {printOrder ? <PrintTicket order={printOrder} /> : null}
      </div>
    </>
  );
}

function StatCard({ label, value, icon, accent = false }: { label: string; value: number; icon: React.ReactNode; accent?: boolean }) {
  return (
    <article className={`${styles.statCard} ${accent ? styles.statAccent : ""}`}>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
      <span>{icon}</span>
    </article>
  );
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>
      {status === "pending" ? <Clock3 size={13} /> : <CheckCircle2 size={13} />}
      {statusLabel(status)}
    </span>
  );
}

function OrderCard({
  order,
  onDetails,
  onPrint,
  onDispatch,
}: {
  order: Order;
  onDetails: (order: Order) => void;
  onPrint: (order: Order) => void;
  onDispatch: (order: Order) => void;
}) {
  return (
    <article className={styles.orderCard}>
      <div className={styles.cardTopline} />
      <div className={styles.cardBody}>
        <div className={styles.orderHeader}>
          <div>
            <p className={styles.orderNumber}>{order.orderNumber}</p>
            <h3>{order.customerName}</h3>
          </div>
          <time dateTime={order.receivedAt}>{relativeTime(order.receivedAt)}</time>
        </div>

        <div className={styles.badges}>
          <StatusBadge status={order.status} />
          <span className={styles.deliveryBadge}>
            {order.deliveryType === "domicilio" ? <Truck size={13} /> : <Store size={13} />}
            {deliveryLabel(order.deliveryType)}
          </span>
          <span className={styles.productBadge}>{order.items.length} producto(s)</span>
        </div>

        <dl className={styles.orderInfo}>
          <dt><Phone size={14} /> Teléfono</dt>
          <dd>{order.customerPhone}</dd>
          <dt><MapPin size={14} /> Entrega</dt>
          <dd>{order.deliveryAddress || "Recoge en tienda"}</dd>
        </dl>

        <div className={styles.orderSummary}>
          <p>Resumen del pedido</p>
          <ul>
            {order.items.slice(0, 4).map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <strong>{quantityLabel(item.quantity, item.unit)}</strong>
                <span>{item.name}</span>
              </li>
            ))}
          </ul>
          {order.items.length > 4 ? <span className={styles.moreItems}>+{order.items.length - 4} producto(s) más</span> : null}
        </div>
      </div>

      <div className={styles.cardActions}>
        <button type="button" className={styles.detailsButton} onClick={() => onDetails(order)}>
          Ver detalle <ChevronRight size={16} />
        </button>
        <button type="button" className={styles.printButton} onClick={() => onPrint(order)}>
          <Printer size={17} /> {order.printCount ? "Reimprimir" : "Imprimir"}
        </button>
        {order.status === "printed" ? (
          <button type="button" className={styles.dispatchButton} onClick={() => onDispatch(order)}>
            <Truck size={17} /> Despachar
          </button>
        ) : null}
      </div>
    </article>
  );
}

function OrderModal({
  order,
  onClose,
  onPrint,
  onDispatch,
}: {
  order: Order;
  onClose: () => void;
  onPrint: (order: Order) => void;
  onDispatch: (order: Order) => void;
}) {
  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={styles.detailModal} role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
        <header className={styles.modalHeader}>
          <div>
            <p>{order.orderNumber}</p>
            <h2 id="order-detail-title">{order.customerName}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar detalle">
            <X size={19} />
          </button>
        </header>
        <div className={styles.modalBody}>
          <div className={styles.badges}>
            <StatusBadge status={order.status} />
            <span className={styles.deliveryBadge}>{deliveryLabel(order.deliveryType)}</span>
          </div>
          <dl className={styles.detailInfo}>
            <div><dt>Recibido</dt><dd>{formatDate(order.receivedAt)}</dd></div>
            <div><dt>Teléfono</dt><dd>{order.customerPhone}</dd></div>
            <div className={styles.fullRow}><dt>Dirección</dt><dd>{order.deliveryAddress || "Recoge en tienda"}</dd></div>
          </dl>
          <div className={styles.detailItems}>
            <h3>Pedido completo</h3>
            <ol>
              {order.items.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  <span>{index + 1}</span>
                  <strong>{quantityLabel(item.quantity, item.unit)}</strong>
                  <p>{item.name}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className={styles.notesBox}>
            <p>Observaciones</p>
            <strong>{order.notes || "Sin observaciones"}</strong>
          </div>
          {order.printCount > 0 ? (
            <p className={styles.auditLine}>
              <Printer size={15} /> {order.printCount} impresión(es) confirmada(s)
            </p>
          ) : null}
        </div>
        <footer className={styles.modalActions}>
          <button type="button" className={styles.printButton} onClick={() => onPrint(order)}>
            <Printer size={17} /> {order.printCount ? "Reimprimir" : "Imprimir pedido"}
          </button>
          {order.status === "printed" ? (
            <button type="button" className={styles.dispatchButton} onClick={() => onDispatch(order)}>
              <Truck size={17} /> Marcar despachado
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function ConfirmModal({
  title,
  description,
  confirmLabel,
  icon,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  icon: React.ReactNode;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className={styles.modalBackdrop}>
      <section className={styles.confirmModal} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <span className={styles.confirmIcon}>{icon}</span>
        <h2 id="confirm-title">{title}</h2>
        <p>{description}</p>
        <div>
          <button type="button" className={styles.cancelButton} onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="button" className={styles.confirmButton} onClick={onConfirm} disabled={busy}>
            {busy ? "Guardando..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function PrintTicket({ order }: { order: Order }) {
  return (
    <article className={styles.ticket}>
      <header className={styles.ticketHeader}>
        <div className={styles.ticketBrand}>FRUTITODO</div>
        <h1>ORDEN DE ALISTAMIENTO</h1>
        <strong>{order.orderNumber}</strong>
      </header>
      <dl className={styles.ticketMeta}>
        <div><dt>Recibido</dt><dd>{formatDate(order.receivedAt)}</dd></div>
        <div><dt>Cliente</dt><dd>{order.customerName}</dd></div>
        <div><dt>Teléfono</dt><dd>{order.customerPhone}</dd></div>
        <div><dt>Entrega</dt><dd>{deliveryLabel(order.deliveryType)}</dd></div>
        <div><dt>Dirección</dt><dd>{order.deliveryAddress || "Recoge en tienda"}</dd></div>
      </dl>
      <section className={styles.ticketItems}>
        <h2>PRODUCTOS · {order.items.length}</h2>
        {order.items.map((item, index) => (
          <div className={styles.ticketItem} key={`${item.name}-${index}`}>
            <span className={styles.ticketCheckbox} />
            <strong>{quantityLabel(item.quantity, item.unit)}</strong>
            <p>{item.name}</p>
          </div>
        ))}
      </section>
      <section className={styles.ticketNotes}>
        <h2>OBSERVACIONES</h2>
        <p>{order.notes || "Sin observaciones"}</p>
      </section>
      <footer className={styles.ticketFooter}>
        <div><span />Preparado por</div>
        <div><span />Verificado por</div>
        <p>Generado desde el panel de pedidos Frutitodo</p>
      </footer>
    </article>
  );
}

function LoadingScreen() {
  return <main className={styles.centerScreen}><RefreshCw size={24} className={styles.spinning} /><p>Cargando panel...</p></main>;
}

/* Ordered from the most specific diagnosis down: the first match is the one worth showing. */
const ACCESS_HINTS: ReadonlyArray<[CredentialIssue, string]> = [
  [
    "unresolved-merge-tag",
    "GHL entregó el enlace sin reemplazar los valores dinámicos ({{...}}). Escribe el location y el token literales en el menú.",
  ],
  [
    "malformed-token",
    "El token llegó con caracteres extra. Revisa que el enlace del menú no tenga parámetros adicionales al final.",
  ],
  ["missing-token", "El enlace llegó con el location pero sin el parámetro token."],
  ["missing-location", "El enlace llegó con el token pero sin el parámetro location."],
  ["no-parameters", "El enlace llegó sin parámetros de acceso."],
  [
    "storage-blocked",
    "El navegador bloqueó el almacenamiento dentro del iframe. Vuelve a abrir el menú para recargar el enlace completo.",
  ],
];

function AccessScreen({ issues }: { issues: CredentialIssue[] }) {
  const hint = ACCESS_HINTS.find(([issue]) => issues.includes(issue))?.[1];

  return (
    <main className={styles.centerScreen}>
      <span className={styles.accessIcon}><CircleAlert size={26} /></span>
      <h1>Enlace de acceso incompleto</h1>
      <p>Abre el panel desde el menú “Pedidos Frutitodo” dentro de GHL.</p>
      {hint ? <p className={styles.accessHint}>{hint}</p> : null}
      <code className={styles.accessCode}>/panel?location=&lt;LOCATION_ID&gt;&amp;token=&lt;TOKEN&gt;</code>
    </main>
  );
}

function OrderSkeletons() {
  return (
    <section className={styles.ordersGrid} aria-label="Cargando pedidos">
      {[0, 1, 2].map((value) => <div className={styles.skeleton} key={value} />)}
    </section>
  );
}
