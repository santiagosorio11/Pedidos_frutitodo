export type OrderStatus = "pending" | "printed" | "dispatched";
export type DeliveryType = "domicilio" | "recogida";
export type OrderSource = "ai" | "manual";

export type OrderItem = {
  name: string;
  quantity: number;
  unit?: string;
};

export type Order = {
  id: string;
  orderNumber: string;
  sourceEventId: string;
  customerName: string;
  customerPhone: string;
  customerDocument: string | null;
  paymentMethod: string | null;
  ghlContactId: string | null;
  conversationId: string | null;
  source: OrderSource;
  deliveryType: DeliveryType;
  deliveryAddress: string | null;
  items: OrderItem[];
  notes: string | null;
  status: OrderStatus;
  receivedAt: string;
  firstPrintedAt: string | null;
  lastPrintedAt: string | null;
  printCount: number;
  dispatchedAt: string | null;
  lastAmendedAt: string | null;
  amendmentCount: number;
  lastPrintedBy: string | null;
  dispatchedBy: string | null;
  /** Draft or sent quote; `quotedAt` is set only once it reached the customer. */
  quote: Quote | null;
  quotedTotal: number | null;
  quotedAt: string | null;
  quoteSentBy: string | null;
};

export type OrderStats = {
  pending: number;
  printed: number;
  dispatchedToday: number;
  newToday: number;
  openHelpRequests: number;
};

export type OrdersResponse = {
  orders: Order[];
  stats: OrderStats;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type HelpRequestStatus = "open" | "resolved";

export type HelpRequest = {
  id: string;
  ghlContactId: string;
  conversationId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  reason: string | null;
  orderId: string | null;
  status: HelpRequestStatus;
  requestCount: number;
  requestedAt: string;
  lastRequestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export type HelpRequestsResponse = {
  helpRequests: HelpRequest[];
};

export type Product = {
  id: string;
  reference: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  saleNote: string | null;
  price: number | null;
  priceUnit: string | null;
  priceUpdatedAt: string | null;
};

export type ProductsResponse = {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
};

export type ProductCategory = { category: string; total: number; priced: number };

export type QuoteLine = {
  productId: string | null;
  reference: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  lineTotal: number;
};

export type Quote = {
  lines: QuoteLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  notes: string | null;
  updatedAt: string;
  updatedBy: string | null;
};
