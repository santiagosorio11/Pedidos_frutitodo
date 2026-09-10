export type OrderStatus = "pending" | "printed" | "dispatched";
export type DeliveryType = "domicilio" | "recogida";

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
};

export type OrderStats = {
  active: number;
  newToday: number;
  awaitingDispatch: number;
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
