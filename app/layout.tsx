import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ProductForge AI", template: "%s · ProductForge AI" },
  description:
    "From idea to sprint-ready backlog — every AI output reviewed by a human and traceable to its source.",
};

/** Rendered per request: a page needs that request's CSP nonce for its scripts (PF-019). */
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
