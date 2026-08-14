// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CheCaldo!",
  description: "Chi contattare per primo, oggi.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
