import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Performance Dashboard — Real-Time Analytics",
  description:
    "Production-quality real-time analytics dashboard handling 10,000+ data points at 60 FPS. Built with Next.js, Canvas, and Web Workers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
