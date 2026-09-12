"use client";

/**
 * useChartRenderer.ts
 *
 * Shared hook for Canvas-based chart rendering.
 * Manages:
 *  - Canvas ref + HiDPI setup
 *  - requestAnimationFrame loop
 *  - Cleanup on unmount
 *
 * Phase 1: Infrastructure only — render callback is a no-op placeholder.
 * Phase 2+: Each chart will provide its own render function.
 */

import { useCallback, useEffect, useRef } from "react";
import { setupHiDPICanvas } from "@/lib/canvasUtils";

declare global {
  interface Window {
    __CHART_RENDER_TIMES__?: number[];
  }
}

export interface UseChartRendererOptions {
  /** Called each animation frame with the 2D context and timestamp. */
  onRender: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timestamp: number
  ) => void;
  /** Whether the animation loop should be running. Default: true. */
  active?: boolean;
  /** Optional dirty flag to skip unnecessary renders */
  isDirtyRef?: React.MutableRefObject<boolean>;
}

export interface UseChartRendererResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  markDirty: () => void;
}

export function useChartRenderer(
  options: UseChartRendererOptions
): UseChartRendererResult {
  const { onRender, active = true, isDirtyRef } = options;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Stable render callback ref (avoids restarting rAF on every render)
  const onRenderRef = useRef(onRender);
  useEffect(() => {
    onRenderRef.current = onRender;
  });

  const markDirty = useCallback(() => {
    if (isDirtyRef) {
      isDirtyRef.current = true;
    }
  }, [isDirtyRef]);

  // Setup canvas dimensions on mount and resize
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const { width, height } = parent.getBoundingClientRect();
    ctxRef.current = setupHiDPICanvas(canvas, width || 600, height || 300);
    markDirty(); // Need to re-render when canvas is resized
  }, [markDirty]);

  useEffect(() => {
    setupCanvas();

    const ro = new ResizeObserver(setupCanvas);
    if (canvasRef.current?.parentElement) {
      ro.observe(canvasRef.current.parentElement);
    }

    return () => ro.disconnect();
  }, [setupCanvas]);

  // rAF loop
  useEffect(() => {
    if (!active) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    function loop(timestamp: number) {
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      
      // If we have an isDirtyRef and it's false, skip rendering
      const isClean = isDirtyRef ? !isDirtyRef.current : false;
      
      if (canvas && ctx && !isClean) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        
        const start = performance.now();
        onRenderRef.current(ctx, w, h, timestamp);
        const duration = performance.now() - start;

        if (typeof window !== "undefined") {
          window.__CHART_RENDER_TIMES__ = window.__CHART_RENDER_TIMES__ || [];
          window.__CHART_RENDER_TIMES__.push(duration);
          if (window.__CHART_RENDER_TIMES__.length > 200) {
            window.__CHART_RENDER_TIMES__.shift();
          }
        }
        
        if (isDirtyRef) {
          isDirtyRef.current = false;
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, isDirtyRef]);

  return { canvasRef, markDirty };
}
