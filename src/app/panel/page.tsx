import type { Metadata } from "next";
import { OrdersPanel } from "@/components/orders-panel";

/* The access link can carry the embed token in the query string, so keep the page out of
   search engines even though it renders nothing without valid credentials. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PanelPage() {
  return <OrdersPanel />;
}
