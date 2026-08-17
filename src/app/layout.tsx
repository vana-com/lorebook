import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lorebook — your data, told back to you",
  description: "Turn the data you choose to share into a small, surprising portrait of you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
