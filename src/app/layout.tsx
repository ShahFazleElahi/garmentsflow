import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";


export const metadata: Metadata = {
  title: "GarmentFlow — Outsourced Garments Operation Management",
  description:
    "From Product Planning to Global Delivery. Plan collections, procure materials, outsource embroidery & tailoring, run QC, pack and ship — with true costing and profitability.",
  icons: { icon: "/garmentflow-icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#231F33",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={"antialiased bg-background text-foreground"}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
