"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  CreditCard,
  IdCard,
  LifeBuoy,
  MapPin,
  MessageCircle,
  PackageCheck,
  Phone,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  ShoppingBasket,
  Store,
  Trash2,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { playAlert, unlockAlerts } from "@/lib/alert-sound";
import { cashChange, formatPesos } from "@/lib/quote";
import { DEFAULT_GHL_APP_URL, ghlConversationUrl, needsReprint } from "@/lib/order-utils";
import { resolvePanelAccess } from "@/lib/panel-credentials";
import type { CredentialIssue, PanelCredentials } from "@/lib/panel-credentials";
import { normalizeOperator, resolveOperator, saveOperator } from "@/lib/panel-operator";
import type {
  DeliveryType,
  HelpRequest,
  HelpRequestsResponse,
  HelpRequestStatus,
  Order,
  OrderItem,
  OrdersResponse,
  OrderStats,
  OrderStatus,
  Product,
} from "@/types/orders";
import { CatalogView } from "./catalog-view";
import { authHeaders, responseMessage } from "./panel-api";
import { QuoteEditor } from "./quote-editor";
import styles from "./orders-panel.module.css";

type Tab = OrderStatus | "help" | "catalog";
type Filters = {
  delivery: "" | DeliveryType;
  q: string;
  from: string;
  to: string;
  page: number;
};

/* The operation watches this panel on a shared screen all day; a slower beat is
   enough to catch a new order and keeps the tab from hammering the API. */
const REFRESH_INTERVAL_MS = 30_000;
const SOUND_STORAGE_KEY = "frutitodo.panel.sound";
const GHL_APP_URL = process.env.NEXT_PUBLIC_GHL_APP_URL || DEFAULT_GHL_APP_URL;
const PAYMENT_METHODS = ["Efectivo", "Transferencia", "Tarjeta (datáfono)"];
const PAGE_TITLE = "Pedidos Frutitodo";

const EMPTY_FILTERS: Filters = { delivery: "", q: "", from: "", to: "", page: 0 };

const TAB_TITLES: Record<Tab, string> = {
  pending: "Pedidos nuevos",
  printed: "En preparación",
  dispatched: "Historial despachado",
  help: "Clientes que requieren ayuda",
  catalog: "Catálogo y precios",
};

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
  if (status === "printed") return "En preparación";
  return "Despachado";
}

function quantityLabel(quantity: number, unit?: string): string {
  const number = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(quantity);
  return unit ? `${number} ${unit}` : number;
}

function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function writeSoundPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    /* Storage blocked in the iframe: the preference just lasts for this visit. */
  }
}

export function OrdersPanel() {
  const [credentials, setCredentials] = useState<PanelCredentials | null>(null);
  const [accessIssues, setAccessIssues] = useState<CredentialIssue[]>([]);
  const [accessReady, setAccessReady] = useState(false);
  const [operator, setOperator] = useState<string | null>(null);
  const [operatorDialogOpen, setOperatorDialogOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [tab, setTab] = useState<Tab>("pending");
  const [helpView, setHelpView] = useState<HelpRequestStatus>("open");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchDraft, setSearchDraft] = useState("");
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [confirmPrintedOrder, setConfirmPrintedOrder] = useState<Order | null>(null);
  const [dispatchOrder, setDispatchOrder] = useState<Order | null>(null);
  const [quoteOrder, setQuoteOrder] = useState<Order | null>(null);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const printOrderRef = useRef<Order | null>(null);
  const previousStatsRef = useRef<OrderStats | null>(null);
  const soundEnabledRef = useRef(false);

  useEffect(() => {
    /* Browser storage and the URL parameters do not exist during SSR. This one-time
       hydration update intentionally happens after the component mounts. */
    const access = resolvePanelAccess();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCredentials(access.credentials);
    setAccessIssues(access.issues);
    setOperator(resolveOperator());
    setSoundEnabled(readSoundPreference());
    setAccessReady(true);
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    if (!soundEnabled) return;
    /* Audio stays locked until a gesture; the first click anywhere unlocks it again after
       a reload, so a remembered preference keeps working without a second prompt. */
    const unlock = () => void unlockAlerts();
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => document.removeEventListener("pointerdown", unlock);
  }, [soundEnabled]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters((current) => ({ ...current, q: searchDraft.trim(), page: 0 }));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  const onStats = useCallback((stats: OrderStats) => {
    const previous = previousStatsRef.current;
    previousStatsRef.current = stats;
    document.title = stats.openHelpRequests ? `(${stats.openHelpRequests}) Ayuda · ${PAGE_TITLE}` : PAGE_TITLE;
    if (!previous || !soundEnabledRef.current) return;
    if (stats.openHelpRequests > previous.openHelpRequests) playAlert("help");
    else if (stats.newToday > previous.newToday || stats.pending > previous.pending) playAlert("order");
  }, []);

  const loadData = useCallback(
    async (quiet = false) => {
      if (!credentials) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (quiet) setRefreshing(true);
      else setLoading(true);

      /* The help and catalog tabs still need the order counters for the tabs and the
         alerts, so they ask for the smallest order view alongside their own content. */
      const orderTab = tab === "pending" || tab === "printed" || tab === "dispatched";
      const scope = orderTab ? tab : "pending";
      const params = new URLSearchParams({ scope, page: String(orderTab ? filters.page : 0) });
      if (orderTab) {
        if (filters.delivery) params.set("delivery", filters.delivery);
        if (filters.q) params.set("q", filters.q);
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
      }
      const request = { headers: authHeaders(credentials), cache: "no-store" as const, signal: controller.signal };

      try {
        const [ordersResponse, helpResponse] = await Promise.all([
          fetch(`/api/orders?${params.toString()}`, request),
          tab === "help" ? fetch(`/api/help-requests?status=${helpView}`, request) : Promise.resolve(null),
        ]);
        if (!ordersResponse.ok) throw new Error(await responseMessage(ordersResponse));
        if (helpResponse && !helpResponse.ok) throw new Error(await responseMessage(helpResponse));
        const orders = (await ordersResponse.json()) as OrdersResponse;
        setData(orders);
        onStats(orders.stats);
        if (helpResponse) setHelpRequests(((await helpResponse.json()) as HelpRequestsResponse).helpRequests);
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
    [credentials, filters, tab, helpView, onStats],
  );

  useEffect(() => {
    if (!credentials) return;
    const frame = window.requestAnimationFrame(() => void loadData());

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadData(true);
    }, REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadData(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      abortRef.current?.abort();
    };
  }, [credentials, loadData]);

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

  const postJson = useCallback(
    async <T,>(path: string, body: Record<string, unknown> = {}): Promise<T> => {
      if (!credentials) throw new Error("Acceso no disponible");
      const response = await fetch(path, {
        method: "POST",
        headers: { ...authHeaders(credentials), "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), operator, ...body }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      return (await response.json()) as T;
    },
    [credentials, operator],
  );

  /* Runs a panel action with the shared busy flag and error banner. */
  const runAction = async (action: () => Promise<void>, fallback: string) => {
    setActionBusy(true);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : fallback);
    } finally {
      setActionBusy(false);
    }
  };

  const changeTab = (next: Tab) => {
    setTab(next);
    setFilters((current) => ({ ...current, page: 0 }));
  };

  const beginPrint = (order: Order) => {
    setPrintOrder(order);
    printOrderRef.current = order;
    setSelectedOrder(null);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
  };

  const confirmPrint = () =>
    runAction(async () => {
      if (!confirmPrintedOrder) return;
      await postJson(`/api/orders/${confirmPrintedOrder.id}/print-confirmations`);
      setConfirmPrintedOrder(null);
      setPrintOrder(null);
      await loadData(true);
    }, "No fue posible confirmar la impresión");

  const confirmDispatch = () =>
    runAction(async () => {
      if (!dispatchOrder) return;
      await postJson(`/api/orders/${dispatchOrder.id}/dispatch`);
      setDispatchOrder(null);
      setSelectedOrder(null);
      await loadData(true);
    }, "No fue posible despachar el pedido");

  const onQuoteSaved = (order: Order, sent: boolean) => {
    setQuoteOrder(null);
    setSelectedOrder((current) => (current?.id === order.id ? order : current));
    setNotice(
      sent
        ? `Cotización de ${formatPesos(order.quotedTotal ?? 0)} enviada a ${order.customerName}`
        : `Cotización de ${order.orderNumber} guardada`,
    );
    void loadData(true);
  };

  const createManualOrder = (payload: Record<string, unknown>) =>
    runAction(async () => {
      const result = await postJson<{ order: { number: string } }>("/api/orders", payload);
      setManualOrderOpen(false);
      setNotice(`Pedido ${result.order.number} creado`);
      if (tab === "pending") await loadData(true);
      else changeTab("pending");
    }, "No fue posible crear el pedido");

  const resolveHelp = (helpRequest: HelpRequest) =>
    runAction(async () => {
      await postJson(`/api/help-requests/${helpRequest.id}/resolve`);
      await loadData(true);
    }, "No fue posible marcar la solicitud como resuelta");

  const toggleSound = async () => {
    const next = !soundEnabled;
    if (next) {
      await unlockAlerts();
      playAlert("order");
    }
    setSoundEnabled(next);
    writeSoundPreference(next);
  };

  const updateOperator = (value: string | null) => {
    const normalized = normalizeOperator(value);
    setOperator(normalized);
    saveOperator(normalized);
    setOperatorDialogOpen(false);
  };

  const clearFilters = () => {
    setSearchDraft("");
    setFilters(EMPTY_FILTERS);
  };

  const hasFilters = Boolean(filters.delivery || filters.q || filters.from || filters.to);
  const orders = data?.orders || [];
  const stats = data?.stats;
  const helpCount = stats?.openHelpRequests ?? 0;

  if (!accessReady) return <LoadingScreen />;
  if (!credentials) return <AccessScreen issues={accessIssues} />;

  const conversationUrl = (target: { conversationId: string | null; ghlContactId: string | null }) =>
    ghlConversationUrl(credentials.locationId, target, GHL_APP_URL);

  return (
    <>
      <main className={`${styles.screen} screen-app`}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <h1>Panel de pedidos</h1>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.operatorChip}
                onClick={() => setOperatorDialogOpen(true)}
                title="Cambiar quién está de turno"
              >
                <UserRound size={16} />
                {operator ? <span>{operator}</span> : <span className={styles.operatorMissing}>¿Quién está de turno?</span>}
              </button>
              <button
                className={`${styles.iconButton} ${soundEnabled ? styles.iconButtonOn : ""}`}
                type="button"
                onClick={() => void toggleSound()}
                aria-pressed={soundEnabled}
                aria-label={soundEnabled ? "Silenciar alertas" : "Activar sonido de alertas"}
                title={soundEnabled ? "Silenciar alertas" : "Activar sonido de alertas"}
              >
                {soundEnabled ? <Bell size={19} /> : <BellOff size={19} />}
              </button>
              <button className={styles.newOrderButton} type="button" onClick={() => setManualOrderOpen(true)}>
                <Plus size={17} /> Pedido manual
              </button>
              <button
                className={styles.iconButton}
                type="button"
                onClick={() => void loadData(true)}
                aria-label="Actualizar pedidos"
                title="Actualizar pedidos"
              >
                <RefreshCw size={19} className={refreshing ? styles.spinning : undefined} />
              </button>
            </div>
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

          {notice ? (
            <div className={styles.noticeBanner} role="status">
              <CheckCircle2 size={18} />
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso">
                <X size={16} />
              </button>
            </div>
          ) : null}

          {helpCount > 0 && tab !== "help" ? (
            <button type="button" className={styles.helpBanner} onClick={() => changeTab("help")}>
              <LifeBuoy size={18} />
              <span>
                {helpCount === 1 ? "1 cliente requiere ayuda" : `${helpCount} clientes requieren ayuda`}
              </span>
              <strong>
                Atender <ChevronRight size={16} />
              </strong>
            </button>
          ) : null}

          <section className={styles.stats} aria-label="Resumen de pedidos">
            <StatCard label="Nuevos" value={stats?.pending ?? 0} icon={<Clock3 size={19} />} accent />
            <StatCard label="En preparación" value={stats?.printed ?? 0} icon={<PackageCheck size={19} />} />
            <StatCard label="Despachados hoy" value={stats?.dispatchedToday ?? 0} icon={<Truck size={19} />} />
            <StatCard label="Requieren ayuda" value={helpCount} icon={<LifeBuoy size={19} />} danger={helpCount > 0} />
          </section>

          <section className={styles.controlPanel} aria-label="Filtros">
            <div className={styles.tabs} role="tablist" aria-label="Estado de los pedidos">
              <TabButton active={tab === "pending"} onClick={() => changeTab("pending")} count={stats?.pending}>
                Nuevos
              </TabButton>
              <TabButton active={tab === "printed"} onClick={() => changeTab("printed")} count={stats?.printed}>
                En preparación
              </TabButton>
              <TabButton active={tab === "dispatched"} onClick={() => changeTab("dispatched")}>
                Despachados
              </TabButton>
              <TabButton active={tab === "help"} onClick={() => changeTab("help")} count={helpCount} alert={helpCount > 0}>
                Requiere ayuda
              </TabButton>
              <TabButton active={tab === "catalog"} onClick={() => changeTab("catalog")}>
                Productos y precios
              </TabButton>
            </div>

            {tab === "help" ? (
              <div className={styles.helpViewToggle}>
                <button
                  type="button"
                  className={helpView === "open" ? styles.helpViewActive : undefined}
                  onClick={() => setHelpView("open")}
                >
                  Pendientes
                </button>
                <button
                  type="button"
                  className={helpView === "resolved" ? styles.helpViewActive : undefined}
                  onClick={() => setHelpView("resolved")}
                >
                  Resueltas
                </button>
              </div>
            ) : tab === "catalog" ? null : (
              <div className={styles.filters}>
                <label className={styles.searchField}>
                  <Search size={18} aria-hidden="true" />
                  <span className={styles.srOnly}>Buscar pedidos</span>
                  <input
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    placeholder="Buscar nombre, teléfono, cédula, pedido o producto..."
                  />
                </label>

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
                    onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value, page: 0 }))}
                  />
                </label>
                <label className={styles.dateField}>
                  <span>Hasta</span>
                  <input
                    type="date"
                    value={filters.to}
                    onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value, page: 0 }))}
                  />
                </label>

                <button className={styles.clearButton} type="button" onClick={clearFilters} disabled={!hasFilters}>
                  Limpiar
                </button>
              </div>
            )}
          </section>

          <div className={styles.sectionHead}>
            <div>
              <h2>{TAB_TITLES[tab]}</h2>
              <p>
                {tab === "catalog"
                  ? "Busca, filtra y actualiza los precios que usan las cotizaciones."
                  : tab === "help"
                    ? `${helpRequests.length} solicitud(es) ${helpView === "open" ? "pendiente(s)" : "resuelta(s)"}`
                    : `${data?.pagination.total ?? 0} pedido(s) en esta vista`}
              </p>
            </div>
            {refreshing ? <span className={styles.syncLabel}>Actualizando</span> : null}
          </div>

          {tab === "catalog" ? (
            <CatalogView credentials={credentials} operator={operator} />
          ) : loading ? (
            <OrderSkeletons />
          ) : tab === "help" ? (
            helpRequests.length ? (
              <section className={styles.ordersGrid} aria-live="polite">
                {helpRequests.map((helpRequest) => (
                  <HelpCard
                    key={helpRequest.id}
                    helpRequest={helpRequest}
                    conversationUrl={conversationUrl({
                      conversationId: helpRequest.conversationId,
                      ghlContactId: helpRequest.ghlContactId,
                    })}
                    busy={actionBusy}
                    onResolve={(item) => void resolveHelp(item)}
                  />
                ))}
              </section>
            ) : (
              <section className={styles.emptyState}>
                <LifeBuoy size={31} />
                <h2>{helpView === "open" ? "Nadie está esperando ayuda" : "Aún no hay solicitudes resueltas"}</h2>
                <p>Cuando la IA pida ayuda, el cliente aparecerá aquí con un acceso directo a su conversación.</p>
              </section>
            )
          ) : orders.length ? (
            <section className={styles.ordersGrid} aria-live="polite">
              {orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  conversationUrl={conversationUrl(order)}
                  onDetails={setSelectedOrder}
                  onPrint={beginPrint}
                  onDispatch={setDispatchOrder}
                  onQuote={setQuoteOrder}
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

          {(tab === "pending" || tab === "printed" || tab === "dispatched") && data && data.pagination.totalPages > 1 ? (
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
          conversationUrl={conversationUrl(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          onPrint={beginPrint}
          onDispatch={setDispatchOrder}
          onQuote={setQuoteOrder}
        />
      ) : null}

      {confirmPrintedOrder ? (
        <ConfirmModal
          title="¿La impresión salió correctamente?"
          description={`Confirma para pasar ${confirmPrintedOrder.orderNumber} a "En preparación".`}
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
          description={`${dispatchOrder.orderNumber} pasará al historial y el cliente recibirá el aviso de que su pedido va en camino.`}
          confirmLabel="Marcar despachado"
          icon={<Truck size={22} />}
          busy={actionBusy}
          onCancel={() => setDispatchOrder(null)}
          onConfirm={() => void confirmDispatch()}
        />
      ) : null}

      {quoteOrder ? (
        <QuoteEditor
          order={quoteOrder}
          credentials={credentials}
          operator={operator}
          onClose={() => setQuoteOrder(null)}
          onSaved={onQuoteSaved}
        />
      ) : null}

      {manualOrderOpen && credentials ? (
        <ManualOrderModal
          credentials={credentials}
          busy={actionBusy}
          onCancel={() => setManualOrderOpen(false)}
          onCreate={(payload) => void createManualOrder(payload)}
        />
      ) : null}

      {operatorDialogOpen ? (
        <OperatorModal current={operator} onCancel={() => setOperatorDialogOpen(false)} onSave={updateOperator} />
      ) : null}

      <div className={`${styles.printHost} print-host`} aria-hidden="true">
        {printOrder ? <PrintTicket order={printOrder} operator={operator} /> : null}
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  count,
  alert = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  alert?: boolean;
  children: React.ReactNode;
}) {
  const classes = [active ? styles.activeTab : "", alert ? styles.alertTab : ""].filter(Boolean).join(" ");
  return (
    <button type="button" role="tab" aria-selected={active} className={classes || undefined} onClick={onClick}>
      {children}
      {count !== undefined ? <span>{count}</span> : null}
    </button>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent = false,
  danger = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: boolean;
  danger?: boolean;
}) {
  const classes = [styles.statCard, accent ? styles.statAccent : "", danger ? styles.statDanger : ""].join(" ");
  return (
    <article className={classes}>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
      <span>{icon}</span>
    </article>
  );
}

/* A ticket printed before the adjustment is already wrong in the picker's hands, so this
   has to be louder than the status pill next to it. */
function AdjustmentBadge({ order }: { order: Order }) {
  if (needsReprint(order)) {
    return (
      <span className={styles.amendedBadge}>
        <CircleAlert size={13} /> Ajuste · reimprimir
      </span>
    );
  }
  if (order.amendmentCount > 0) {
    return (
      <span className={styles.adjustedBadge}>
        <CircleAlert size={13} /> Ajustado por el cliente
      </span>
    );
  }
  return null;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>
      {status === "pending" ? <Clock3 size={13} /> : <CheckCircle2 size={13} />}
      {statusLabel(status)}
    </span>
  );
}

/* `_top` swaps the GHL window itself to the chat: the operator stays in the same tab,
   never a new one. */
function ConversationLink({ url, variant = "inline" }: { url: string | null; variant?: "inline" | "button" }) {
  if (!url) return null;
  return (
    <span className={variant === "button" ? styles.chatButtonGroup : styles.chatLinkGroup}>
      <a href={url} target="_top" className={variant === "button" ? styles.chatButton : styles.chatLink}>
        <MessageCircle size={15} /> Abrir conversación
      </a>
    </span>
  );
}

function OrderCard({
  order,
  conversationUrl,
  onDetails,
  onPrint,
  onDispatch,
  onQuote,
}: {
  order: Order;
  conversationUrl: string | null;
  onDetails: (order: Order) => void;
  onPrint: (order: Order) => void;
  onDispatch: (order: Order) => void;
  onQuote: (order: Order) => void;
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
          <AdjustmentBadge order={order} />
          <span className={styles.deliveryBadge}>
            {order.deliveryType === "domicilio" ? <Truck size={13} /> : <Store size={13} />}
            {deliveryLabel(order.deliveryType)}
          </span>
          {order.source === "manual" ? <span className={styles.productBadge}>Manual</span> : null}
          <span className={styles.productBadge}>{order.items.length} producto(s)</span>
          {order.quote ? (
            <span className={order.quotedAt ? styles.quoteSentBadge : styles.quoteDraftBadge}>
              <Receipt size={13} /> {order.quotedAt ? "Cotización enviada" : "Cotización sin enviar"} ·{" "}
              {formatPesos(order.quote.total)}
            </span>
          ) : null}
        </div>

        <dl className={styles.orderInfo}>
          <dt><Phone size={14} /> Teléfono</dt>
          <dd>{order.customerPhone}</dd>
          {order.customerDocument ? (
            <>
              <dt><IdCard size={14} /> Cédula</dt>
              <dd>{order.customerDocument}</dd>
            </>
          ) : null}
          <dt><MapPin size={14} /> Entrega</dt>
          <dd>{order.deliveryAddress || "Recoge en tienda"}</dd>
          {order.paymentMethod ? (
            <>
              <dt><CreditCard size={14} /> Pago</dt>
              <dd>{order.paymentMethod}</dd>
            </>
          ) : null}
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

        <div className={styles.cardChat}>
          <ConversationLink url={conversationUrl} />
          <button type="button" className={styles.quoteLink} onClick={() => onQuote(order)}>
            <Receipt size={15} /> {order.quote ? "Editar cotización" : "Cotizar"}
          </button>
        </div>
      </div>

      <div className={styles.cardActions}>
        <button type="button" className={styles.detailsButton} onClick={() => onDetails(order)}>
          Ver detalle <ChevronRight size={16} />
        </button>
        {order.status !== "dispatched" ? (
          <button type="button" className={styles.printButton} onClick={() => onPrint(order)}>
            <Printer size={17} /> {order.printCount ? "Reimprimir" : "Imprimir"}
          </button>
        ) : null}
        {order.status === "printed" ? (
          <button type="button" className={styles.dispatchButton} onClick={() => onDispatch(order)}>
            <Truck size={17} /> Despachar
          </button>
        ) : null}
      </div>
    </article>
  );
}

function HelpCard({
  helpRequest,
  conversationUrl,
  busy,
  onResolve,
}: {
  helpRequest: HelpRequest;
  conversationUrl: string | null;
  busy: boolean;
  onResolve: (helpRequest: HelpRequest) => void;
}) {
  const open = helpRequest.status === "open";
  return (
    <article className={`${styles.orderCard} ${open ? styles.helpCardOpen : ""}`}>
      <div className={open ? styles.helpTopline : styles.cardTopline} />
      <div className={styles.cardBody}>
        <div className={styles.orderHeader}>
          <div>
            <p className={open ? styles.helpLabel : styles.orderNumber}>{open ? "REQUIERE AYUDA" : "RESUELTA"}</p>
            <h3>{helpRequest.customerName || "Cliente sin nombre"}</h3>
          </div>
          <time dateTime={helpRequest.requestedAt}>{relativeTime(helpRequest.requestedAt)}</time>
        </div>

        <div className={styles.badges}>
          {helpRequest.requestCount > 1 ? (
            <span className={styles.amendedBadge}>Pidió ayuda {helpRequest.requestCount} veces</span>
          ) : null}
          {helpRequest.orderId ? <span className={styles.productBadge}>Tiene un pedido abierto</span> : null}
        </div>

        <dl className={styles.orderInfo}>
          {helpRequest.customerPhone ? (
            <>
              <dt><Phone size={14} /> Teléfono</dt>
              <dd>{helpRequest.customerPhone}</dd>
            </>
          ) : null}
          <dt><Clock3 size={14} /> Último aviso</dt>
          <dd>{formatDate(helpRequest.lastRequestedAt)}</dd>
          {helpRequest.resolvedAt ? (
            <>
              <dt><CheckCircle2 size={14} /> Resuelta</dt>
              <dd>
                {formatDate(helpRequest.resolvedAt)}
                {helpRequest.resolvedBy ? ` · ${helpRequest.resolvedBy}` : ""}
              </dd>
            </>
          ) : null}
        </dl>

        <div className={styles.notesBox}>
          <p>Motivo</p>
          <strong>{helpRequest.reason || "La IA solicitó que un asesor continúe la conversación."}</strong>
        </div>
      </div>

      <div className={styles.cardActions}>
        <ConversationLink url={conversationUrl} variant="button" />
        {open ? (
          <button type="button" className={styles.detailsButton} disabled={busy} onClick={() => onResolve(helpRequest)}>
            <CheckCircle2 size={16} /> Marcar resuelta
          </button>
        ) : null}
      </div>
    </article>
  );
}

function OrderModal({
  order,
  conversationUrl,
  onClose,
  onPrint,
  onDispatch,
  onQuote,
}: {
  order: Order;
  conversationUrl: string | null;
  onClose: () => void;
  onPrint: (order: Order) => void;
  onDispatch: (order: Order) => void;
  onQuote: (order: Order) => void;
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
            <AdjustmentBadge order={order} />
            <span className={styles.deliveryBadge}>{deliveryLabel(order.deliveryType)}</span>
            {order.source === "manual" ? <span className={styles.productBadge}>Pedido manual</span> : null}
          </div>
          <dl className={styles.detailInfo}>
            <div><dt>Recibido</dt><dd>{formatDate(order.receivedAt)}</dd></div>
            <div><dt>Teléfono</dt><dd>{order.customerPhone}</dd></div>
            <div><dt>Cédula</dt><dd>{order.customerDocument || "Sin registrar"}</dd></div>
            <div><dt>Método de pago</dt><dd>{order.paymentMethod || "Sin registrar"}</dd></div>
            <div className={styles.fullRow}><dt>Dirección</dt><dd>{order.deliveryAddress || "Recoge en tienda"}</dd></div>
            {order.quotedAt && order.quotedTotal !== null ? (
              <div className={styles.fullRow}>
                <dt>Cotización enviada al cliente</dt>
                <dd>
                  {formatPesos(order.quotedTotal)} · {formatDate(order.quotedAt)}
                  {order.quoteSentBy ? ` por ${order.quoteSentBy}` : ""}
                </dd>
              </div>
            ) : null}
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
          {order.quote ? <QuoteSummary order={order} /> : null}
          {order.printCount > 0 ? (
            <p className={styles.auditLine}>
              <Printer size={15} /> {order.printCount} impresión(es) confirmada(s)
              {order.lastPrintedBy ? ` · última por ${order.lastPrintedBy}` : ""}
            </p>
          ) : null}
          {order.amendmentCount > 0 ? (
            <p className={styles.auditLine}>
              <CircleAlert size={15} /> El cliente ajustó este pedido {order.amendmentCount} vez/veces
              {order.lastAmendedAt ? ` · último ajuste ${formatDate(order.lastAmendedAt)}` : ""}
            </p>
          ) : null}
          {order.dispatchedAt ? (
            <p className={styles.auditLine}>
              <Truck size={15} /> Despachado {formatDate(order.dispatchedAt)}
              {order.dispatchedBy ? ` por ${order.dispatchedBy}` : ""}
            </p>
          ) : null}
        </div>
        <footer className={styles.modalActions}>
          <ConversationLink url={conversationUrl} variant="button" />
          <button type="button" className={styles.detailsButton} onClick={() => onQuote(order)}>
            <Receipt size={17} /> {order.quote ? "Editar cotización" : "Cotizar"}
          </button>
          {order.status !== "dispatched" ? (
            <button type="button" className={styles.printButton} onClick={() => onPrint(order)}>
              <Printer size={17} /> {order.printCount ? "Reimprimir" : "Imprimir pedido"}
            </button>
          ) : null}
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

function QuoteSummary({ order }: { order: Order }) {
  const quote = order.quote;
  if (!quote) return null;
  return (
    <div className={styles.quoteSummary}>
      <h3>
        Cotización {order.quotedAt ? "enviada" : "sin enviar"}
        {quote.updatedBy ? <small> · {quote.updatedBy}</small> : null}
      </h3>
      <ul>
        {quote.lines.map((line, index) => (
          <li key={`${line.name}-${index}`}>
            <span>
              {quantityLabel(line.quantity, line.unit ?? undefined)} {line.name}
            </span>
            <strong>{formatPesos(line.lineTotal)}</strong>
          </li>
        ))}
      </ul>
      <dl>
        {quote.deliveryFee > 0 ? (
          <div><dt>Domicilio</dt><dd>{formatPesos(quote.deliveryFee)}</dd></div>
        ) : null}
        <div><dt>Total</dt><dd>{formatPesos(quote.total)}</dd></div>
      </dl>
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

type ItemDraft = { key: number; name: string; quantity: string; unit: string };

function ManualOrderModal({
  credentials,
  busy,
  onCancel,
  onCreate,
}: {
  credentials: PanelCredentials;
  busy: boolean;
  onCancel: () => void;
  onCreate: (payload: Record<string, unknown>) => void;
}) {
  /* One key per form, so a double click or a retry after an error never creates two orders. */
  const [requestId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [customerDocument, setCustomerDocument] = useState("");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("domicilio");
  const [address, setAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ key: 0, name: "", quantity: "1", unit: "" }]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const nextKey = useRef(1);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(productQuery ? { q: productQuery } : {});
      fetch(`/api/products?${params.toString()}`, {
        headers: authHeaders(credentials),
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : { products: [] }))
        .then((body: { products: Product[] }) => setProducts(body.products))
        .catch(() => {
          /* The catalog only helps typing; free text still works without it. */
        });
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [credentials, productQuery]);

  const updateItem = (key: number, patch: Partial<ItemDraft>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    if (patch.name !== undefined) {
      setProductQuery(patch.name.trim());
      const match = products.find((product) => product.name.toLowerCase() === patch.name?.trim().toLowerCase());
      if (match?.priceUnit) {
        setItems((current) => current.map((item) => (item.key === key && !item.unit ? { ...item, unit: match.priceUnit || "" } : item)));
      }
    }
  };

  const validItems: OrderItem[] = items
    .map((item) => ({
      name: item.name.trim(),
      quantity: Number(item.quantity.replace(",", ".")),
      unit: item.unit.trim() || undefined,
    }))
    .filter((item) => item.name && item.quantity > 0);
  const canSubmit =
    name.trim() && phone.trim().length >= 3 && validItems.length > 0 && (deliveryType === "recogida" || address.trim());

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onCreate({
      requestId,
      customer: { name: name.trim(), phone: phone.trim(), document: customerDocument.trim() || undefined },
      delivery: { type: deliveryType, address: deliveryType === "domicilio" ? address.trim() : undefined },
      paymentMethod: paymentMethod.trim() || undefined,
      items: validItems,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className={styles.modalBackdrop}>
      <form className={`${styles.formModal} ${styles.formModalWide}`} aria-labelledby="manual-title" onSubmit={submit}>
        <header className={styles.modalHeader}>
          <div>
            <p>PEDIDO TELEFÓNICO</p>
            <h2 id="manual-title">Nuevo pedido manual</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cerrar">
            <X size={19} />
          </button>
        </header>
        <div className={styles.modalBody}>
          <div className={styles.formGrid}>
            <label className={styles.formField}>
              <span>Nombre del cliente *</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} autoFocus />
            </label>
            <label className={styles.formField}>
              <span>Teléfono *</span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} required inputMode="tel" maxLength={40} />
            </label>
            <label className={styles.formField}>
              <span>Cédula</span>
              <input value={customerDocument} onChange={(event) => setCustomerDocument(event.target.value)} maxLength={40} />
            </label>
            <label className={styles.formField}>
              <span>Método de pago</span>
              <input
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                list="payment-methods"
                maxLength={80}
              />
              <datalist id="payment-methods">
                {PAYMENT_METHODS.map((method) => <option key={method} value={method} />)}
              </datalist>
            </label>
            <label className={styles.formField}>
              <span>Entrega</span>
              <select value={deliveryType} onChange={(event) => setDeliveryType(event.target.value as DeliveryType)}>
                <option value="domicilio">Domicilio</option>
                <option value="recogida">Recoge en tienda</option>
              </select>
            </label>
            {deliveryType === "domicilio" ? (
              <label className={`${styles.formField} ${styles.formFieldWide}`}>
                <span>Dirección y barrio *</span>
                <input value={address} onChange={(event) => setAddress(event.target.value)} required maxLength={500} />
              </label>
            ) : null}
          </div>

          <div className={styles.itemsEditor}>
            <h3>Productos</h3>
            <datalist id="catalog-products">
              {products.map((product) => <option key={product.id} value={product.name} />)}
            </datalist>
            {items.map((item, index) => (
              <div className={styles.itemRow} key={item.key}>
                <input
                  aria-label={`Producto ${index + 1}`}
                  placeholder="Producto (ej: pechuga troceada)"
                  list="catalog-products"
                  value={item.name}
                  maxLength={160}
                  onChange={(event) => updateItem(item.key, { name: event.target.value })}
                />
                <input
                  aria-label={`Cantidad ${index + 1}`}
                  inputMode="decimal"
                  value={item.quantity}
                  onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                />
                <input
                  aria-label={`Unidad ${index + 1}`}
                  placeholder="kg, lb, und"
                  value={item.unit}
                  maxLength={40}
                  onChange={(event) => updateItem(item.key, { unit: event.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Quitar producto ${index + 1}`}
                  disabled={items.length === 1}
                  onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.addItemButton}
              onClick={() => {
                const key = nextKey.current;
                nextKey.current += 1;
                setItems((current) => [...current, { key, name: "", quantity: "1", unit: "" }]);
              }}
            >
              <Plus size={15} /> Agregar producto
            </button>
          </div>

          <label className={styles.formField}>
            <span>Observaciones</span>
            <textarea rows={3} value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>
        <footer className={styles.modalActions}>
          <button type="button" className={styles.cancelButton} onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className={styles.confirmButton} disabled={busy || !canSubmit}>
            {busy ? "Creando..." : "Crear pedido"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function OperatorModal({
  current,
  onCancel,
  onSave,
}: {
  current: string | null;
  onCancel: () => void;
  onSave: (operator: string | null) => void;
}) {
  const [draft, setDraft] = useState(current || "");
  return (
    <div className={styles.modalBackdrop}>
      <form
        className={styles.confirmModal}
        aria-labelledby="operator-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <span className={styles.confirmIcon}><UserRound size={22} /></span>
        <h2 id="operator-title">¿Quién está de turno?</h2>
        <p>El nombre sale en el tiquete y queda registrado en cada impresión y despacho.</p>
        <label className={styles.formField}>
          <span className={styles.srOnly}>Nombre</span>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={80} autoFocus placeholder="Ej: Isabel" />
        </label>
        <div>
          <button type="button" className={styles.cancelButton} onClick={onCancel}>Cancelar</button>
          <button type="submit" className={styles.confirmButton}>Guardar</button>
        </div>
      </form>
    </div>
  );
}

function PrintTicket({ order, operator }: { order: Order; operator: string | null }) {
  const cash = order.quote ? cashChange(order.paymentMethod, order.quote.total) : null;
  return (
    <article className={styles.ticket}>
      <header className={styles.ticketHeader}>
        <div className={styles.ticketBrand}>FRUTITODO</div>
        <h1>ORDEN DE ALISTAMIENTO</h1>
        <strong>{order.orderNumber}</strong>
        {needsReprint(order) ? (
          <p className={styles.ticketAmended}>
            AJUSTE AL PEDIDO {order.orderNumber} · DESCARTA EL TIQUETE ANTERIOR
          </p>
        ) : null}
      </header>
      <dl className={styles.ticketMeta}>
        <div><dt>Recibido</dt><dd>{formatDate(order.receivedAt)}</dd></div>
        <div><dt>Cliente</dt><dd>{order.customerName}</dd></div>
        {order.customerDocument ? <div><dt>Cédula</dt><dd>{order.customerDocument}</dd></div> : null}
        <div><dt>Teléfono</dt><dd>{order.customerPhone}</dd></div>
        <div><dt>Entrega</dt><dd>{deliveryLabel(order.deliveryType)}</dd></div>
        <div><dt>Dirección</dt><dd>{order.deliveryAddress || "Recoge en tienda"}</dd></div>
        {order.paymentMethod ? <div><dt>Pago</dt><dd>{order.paymentMethod}</dd></div> : null}
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
      {order.quote ? (
        <section className={styles.ticketQuote}>
          <h2>COTIZACIÓN{order.quotedAt ? " · ENVIADA" : ""}</h2>
          {order.quote.lines.map((line, index) => (
            <div className={styles.ticketQuoteLine} key={`${line.name}-${index}`}>
              <p>{line.name}</p>
              <span>
                {quantityLabel(line.quantity, line.unit ?? undefined)} × {formatPesos(line.unitPrice)}
              </span>
              <strong>{formatPesos(line.lineTotal)}</strong>
            </div>
          ))}
          <dl>
            <div><dt>Subtotal</dt><dd>{formatPesos(order.quote.subtotal)}</dd></div>
            {order.quote.deliveryFee > 0 ? (
              <div><dt>Domicilio</dt><dd>{formatPesos(order.quote.deliveryFee)}</dd></div>
            ) : null}
            <div className={styles.ticketTotal}><dt>TOTAL</dt><dd>{formatPesos(order.quote.total)}</dd></div>
            {cash ? (
              <>
                <div><dt>Paga con</dt><dd>{formatPesos(cash.tendered)}</dd></div>
                <div className={styles.ticketTotal}><dt>CAMBIO</dt><dd>{formatPesos(cash.change)}</dd></div>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}
      <section className={styles.ticketNotes}>
        <h2>OBSERVACIONES</h2>
        <p>{order.notes || "Sin observaciones"}</p>
      </section>
      <footer className={styles.ticketFooter}>
        {operator ? <p className={styles.ticketOperator}>Impreso por: {operator}</p> : null}
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
