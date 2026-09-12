/**
 * app/dashboard/layout.tsx — Dashboard layout (Server Component)
 *
 * Wraps dashboard pages with the DataProvider (which is a Client Component).
 * Server Component pattern: pass children into the Client provider
 * so server-rendered subtrees still benefit from server rendering.
 */

import type { Metadata } from "next";
import { DataProvider } from "@/components/providers/DataProvider";

export const metadata: Metadata = {
  title: "Dashboard | Performance Analytics",
  description: "Real-time analytics dashboard — 10,000+ data points at 60 FPS",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DataProvider>{children}</DataProvider>;
}
