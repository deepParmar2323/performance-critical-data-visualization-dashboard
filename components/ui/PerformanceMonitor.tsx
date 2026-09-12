"use client";
// PerformanceMonitor.tsx — Phase 1 stub
// Mounts the usePerformanceMonitor hook and renders the metrics overlay.
import { usePerformanceMonitor } from "@/hooks/usePerformanceMonitor";

export function PerformanceMonitor() {
  usePerformanceMonitor();
  // Metrics are displayed in the metrics bar on the dashboard page.
  // A floating overlay will be added in Phase 2.
  return null;
}
