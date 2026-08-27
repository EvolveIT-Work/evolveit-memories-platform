import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "EvolveIT Staff",
  description: "Memories Night Club operations — staff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
