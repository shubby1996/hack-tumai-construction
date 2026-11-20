import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteFlow – AI site assistant",
  description: "Shared two-week site plan with preventive and reactive AI support, site diary and VOB/B notice drafts.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1c1917" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
