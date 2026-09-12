"use client";

/**
 * usePerformanceMonitor.ts
 *
 * Tracks real FPS and memory usage and pushes them into DataContext.
 * Should be mounted once in the dashboard page (or a dedicated component).
 *
 * Phase 1: FPS + memory tracking.
 * Phase 2+: Add render timing hooks (PerformanceObserver, etc.)
 */

import { useEffect, useRef } from "react";
import { useData } from "@/components/providers/DataProvider";
import {
  createFPSTracker,
  getMemoryUsageMB,
  SlidingAverage,
} from "@/lib/performanceUtils";

export function usePerformanceMonitor(): void {
  const { setMetrics } = useData();
  const fpsAvg = useRef(new SlidingAverage(30));
  const memoryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderTimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // ── FPS via rAF ─────────────────────────
    const stopFPS = createFPSTracker((fps) => {
      const smoothed = fpsAvg.current.push(fps);
      setMetrics({ fps: Math.round(smoothed) });
    });

    // ── Memory every 2 seconds ───────────────
    memoryIntervalRef.current = setInterval(() => {
      const mem = getMemoryUsageMB();
      if (mem > 0) setMetrics({ memoryUsage: mem });
    }, 2000);

    // ── Render Time every 1 second ───────────
    renderTimeIntervalRef.current = setInterval(() => {
      if (typeof window !== "undefined" && window.__CHART_RENDER_TIMES__ && window.__CHART_RENDER_TIMES__.length > 0) {
        const times = window.__CHART_RENDER_TIMES__;
        const sum = times.reduce((a, b) => a + b, 0);
        const avg = sum / times.length;
        setMetrics({ renderTime: parseFloat(avg.toFixed(2)) });
        window.__CHART_RENDER_TIMES__ = []; // reset after sampling
      }
    }, 1000);

    return () => {
      stopFPS();
      if (memoryIntervalRef.current) {
        clearInterval(memoryIntervalRef.current);
      }
      if (renderTimeIntervalRef.current) {
        clearInterval(renderTimeIntervalRef.current);
      }
    };
  }, [setMetrics]);
}
