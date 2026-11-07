import type { Metadata, Viewport } from "next";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "A4AC",
  description: "Open multilingual speech and translation data for African languages.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

/**
 * Root layout shared by every page: system fonts (no font download), the site
 * header and a narrow, phone-friendly content column.
 *
 * @param props.children The page content.
 * @returns The html/body wrapper.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <SiteHeader />
        <main className="mx-auto w-full max-w-xl px-4 pt-6 pb-16">{children}</main>
      </body>
    </html>
  );
}
