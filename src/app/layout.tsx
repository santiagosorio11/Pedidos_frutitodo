import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pedidos Frutitodo",
  description: "Panel operativo de pedidos de Frutitodo",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
