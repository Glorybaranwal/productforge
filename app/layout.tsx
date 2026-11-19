import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ProductForge AI", template: "%s · ProductForge AI" },
  description:
    "From idea to sprint-ready backlog — every AI output reviewed by a human and traceable to its source.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
