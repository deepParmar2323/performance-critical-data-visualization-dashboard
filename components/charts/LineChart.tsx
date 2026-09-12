"use client";

/**
 * LineChart.tsx — Performance-Critical Multi-Series Line Chart
 *
 * Architecture:
 * - Canvas: High-density multi-category time series rendering, grid, and axes (60 FPS).
 * - SVG: Crisp interactive overlay (crosshairs, active point reticles, tooltips).
 * - Interaction: Mouse wheel zoom (anchored to cursor), click-drag pan, pointer tracking.
 * - Performance: State is kept in refs (transformRef, dataRef). Data processing & downsampling
 *   (LTTB) are cached by revision, avoiding per-frame GC allocations.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useDataStream } from "@/hooks/useDataStream";
import { useChartRenderer } from "@/hooks/useChartRenderer";
import {
  CHART_COLORS,
  clipToBounds,
  downsampleLTTB,
  drawXAxis,
  drawYAxis,
  getColorForCategory,
  mapX,
  mapY,
  minMax,
} from "@/lib/canvasUtils";
import type { ChartBounds, DataPoint, ViewTransform } from "@/lib/types";
import styles from "./charts.module.css";

interface HoverInfo {
  x: number;
  y: number;
  val: number;
  ts: number;
  category: string;
}

export const LineChart = memo(function LineChart() {
  const { data, pointCount } = useDataStream({ limit: 3000 });
  const isDirtyRef = useRef(true);

  // Data & interaction refs (avoids React re-renders)
  const dataRef = useRef<DataPoint[]>(data);
  useEffect(() => {
    dataRef.current = data;
    isDirtyRef.current = true;
  }, [data]);

  const transformRef = useRef<ViewTransform>({
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
  });

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, offsetX: 0 });
  const boundsRef = useRef<ChartBounds>({ x: 55, y: 16, width: 500, height: 240 });

  // Hover state for SVG overlay
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const hoverPointRef = useRef<HoverInfo | null>(null);

  // Cached series by revision
  const cachedSeriesRef = useRef<{
    dataLen: number;
    lastTs: number;
    series: Map<string, { x: number; y: number }[]>;
    minTs: number;
    maxTs: number;
    minVal: number;
    maxVal: number;
  }>({
    dataLen: 0,
    lastTs: 0,
    series: new Map(),
    minTs: 0,
    maxTs: 1,
    minVal: 0,
    maxVal: 100,
  });

  // ── Render callback for rAF ──────────────────────────────────────────────
  const onRender = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const rawData = dataRef.current;
      const transform = transformRef.current;

      // Update bounds based on current dimensions
      const bounds: ChartBounds = {
        x: 52,
        y: 16,
        width: Math.max(10, width - 68),
        height: Math.max(10, height - 44),
      };
      boundsRef.current = bounds;

      // Clear full canvas
      ctx.save();
      ctx.clearRect(0, 0, width, height);

      if (rawData.length < 2) {
        ctx.restore();
        return;
      }

      // Recompute or use cached series
      const cache = cachedSeriesRef.current;
      const lastPoint = rawData[rawData.length - 1];
      if (
        cache.dataLen !== rawData.length ||
        cache.lastTs !== (lastPoint ? lastPoint.timestamp : 0)
      ) {
        const series = new Map<string, { x: number; y: number }[]>();
        let minT = Infinity;
        let maxT = -Infinity;
        const allVals: number[] = [];

        for (let i = 0; i < rawData.length; i++) {
          const p = rawData[i];
          if (p.timestamp < minT) minT = p.timestamp;
          if (p.timestamp > maxT) maxT = p.timestamp;
          allVals.push(p.value);

          let arr = series.get(p.category);
          if (!arr) {
            arr = [];
            series.set(p.category, arr);
          }
          arr.push({ x: p.timestamp, y: p.value });
        }

        const { min: minV, max: maxV } = minMax(allVals);
        cache.dataLen = rawData.length;
        cache.lastTs = lastPoint ? lastPoint.timestamp : 0;
        cache.series = series;
        cache.minTs = minT;
        cache.maxTs = maxT;
        cache.minVal = Math.max(0, minV);
        cache.maxVal = Math.max(10, maxV);
      }

      const { series, minTs, maxTs, minVal, maxVal } = cache;

      // Visible domain calculation
      const totalSpan = maxTs - minTs || 1;
      const visibleMinTs =
        minTs + ((-transform.offsetX) / (bounds.width * transform.scaleX)) * totalSpan;
      const visibleMaxTs =
        minTs +
        ((bounds.width - transform.offsetX) / (bounds.width * transform.scaleX)) *
        totalSpan;

      // Draw Grid & Axes
      drawXAxis(ctx, visibleMinTs, visibleMaxTs, bounds, {
        tickCount: Math.min(8, Math.max(4, Math.floor(bounds.width / 110))),
        color: "rgba(255, 255, 255, 0.05)",
        labelColor: "rgba(160, 170, 195, 0.6)",
        fontSize: 10,
      });

      drawYAxis(ctx, minVal, maxVal, bounds, {
        tickCount: Math.min(6, Math.max(3, Math.floor(bounds.height / 45))),
        color: "rgba(255, 255, 255, 0.05)",
        labelColor: "rgba(160, 170, 195, 0.6)",
        fontSize: 10,
      });

      // Clip data drawing to inner bounds
      clipToBounds(ctx, bounds);

      // Draw each series
      series.forEach((pts, category) => {
        if (pts.length === 0) return;

        // Viewport culling: only points in view (plus 1 buffer point on each edge)
        let startIdx = 0;
        let endIdx = pts.length - 1;

        // Binary search or linear scan for start and end within visible bounds
        for (let i = 0; i < pts.length; i++) {
          if (pts[i].x >= visibleMinTs) {
            startIdx = Math.max(0, i - 1);
            break;
          }
        }
        for (let i = pts.length - 1; i >= 0; i--) {
          if (pts[i].x <= visibleMaxTs) {
            endIdx = Math.min(pts.length - 1, i + 1);
            break;
          }
        }

        if (startIdx >= endIdx) return;
        let visiblePts = pts.slice(startIdx, endIdx + 1);

        // LTTB downsampling if density is too high (> 400 pts in view)
        if (visiblePts.length > 400) {
          visiblePts = downsampleLTTB(visiblePts, 400);
        }

        const color = getColorForCategory(category);

        // Path drawing
        ctx.beginPath();
        let first = true;
        for (let i = 0; i < visiblePts.length; i++) {
          const pt = visiblePts[i];
          const px = mapX(pt.x, minTs, maxTs, bounds, transform);
          const py = mapY(pt.y, minVal, maxVal, bounds);

          if (first) {
            ctx.moveTo(px, py);
            first = false;
          } else {
            ctx.lineTo(px, py);
          }
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();

        // Draw points if zoomed in close
        if (visiblePts.length < 50) {
          ctx.fillStyle = color;
          for (let i = 0; i < visiblePts.length; i++) {
            const pt = visiblePts[i];
            const px = mapX(pt.x, minTs, maxTs, bounds, transform);
            const py = mapY(pt.y, minVal, maxVal, bounds);
            ctx.beginPath();
            ctx.arc(px, py, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // Restore clipping
      ctx.restore();

      // Restore base transform
      ctx.restore();
    },
    []
  );

  const { canvasRef, markDirty } = useChartRenderer({ onRender, isDirtyRef });

  // ── Wheel Zoom (Anchored to pointer) ─────────────────────────────────────
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const bounds = boundsRef.current;

    if (mouseX < bounds.x || mouseX > bounds.x + bounds.width) return;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const current = transformRef.current;
    const nextScale = Math.max(1, Math.min(60, current.scaleX * zoomFactor));

    if (nextScale === 1) {
      transformRef.current = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
      return;
    }

    const mouseInBounds = mouseX - bounds.x;
    const nextOffset =
      mouseInBounds - (mouseInBounds - current.offsetX) * (nextScale / current.scaleX);

    // Clamp offset
    const maxOffset = 0;
    const minOffset = bounds.width * (1 - nextScale);
    const clampedOffset = Math.max(minOffset, Math.min(maxOffset, nextOffset));

    transformRef.current = {
      offsetX: clampedOffset,
      offsetY: 0,
      scaleX: nextScale,
      scaleY: 1,
    };
    markDirty();
  }, [canvasRef, markDirty]);

  // ── Click-Drag Pan ───────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (transformRef.current.scaleX <= 1) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      offsetX: transformRef.current.offsetX,
    };
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const bounds = boundsRef.current;

      // Handle dragging
      if (isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.x;
        const currentScale = transformRef.current.scaleX;
        const nextOffset = dragStartRef.current.offsetX + dx;
        const maxOffset = 0;
        const minOffset = bounds.width * (1 - currentScale);

        transformRef.current.offsetX = Math.max(
          minOffset,
          Math.min(maxOffset, nextOffset)
        );
        markDirty();
      }

      // Handle hover inspection for SVG overlay
      if (
        mouseX >= bounds.x &&
        mouseX <= bounds.x + bounds.width &&
        mouseY >= bounds.y &&
        mouseY <= bounds.y + bounds.height
      ) {
        const cache = cachedSeriesRef.current;
        const transform = transformRef.current;
        if (!cache.minTs || !cache.maxTs) return;

        // Find closest point among all series
        let bestDist = Infinity;
        let bestPoint: HoverInfo | null = null;

        cache.series.forEach((pts, category) => {
          for (let i = 0; i < pts.length; i++) {
            const pt = pts[i];
            const px = mapX(pt.x, cache.minTs, cache.maxTs, bounds, transform);
            const py = mapY(pt.y, cache.minVal, cache.maxVal, bounds);
            const dist = Math.hypot(px - mouseX, py - mouseY);
            if (dist < bestDist && dist < 60) {
              bestDist = dist;
              bestPoint = {
                x: px,
                y: py,
                val: pt.y,
                ts: pt.x,
                category,
              };
            }
          }
        });

        hoverPointRef.current = bestPoint;
        setHoverInfo(bestPoint);
      } else {
        if (hoverPointRef.current) {
          hoverPointRef.current = null;
          setHoverInfo(null);
        }
      }
    },
    [canvasRef, markDirty]
  );

  const onMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const onMouseLeave = useCallback(() => {
    isDraggingRef.current = false;
    hoverPointRef.current = null;
    setHoverInfo(null);
  }, []);

  // Attach non-passive wheel listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [canvasRef, onWheel]);

  const handleResetZoom = useCallback(() => {
    transformRef.current = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
    markDirty();
  }, [markDirty]);

  const categories = Object.keys(CHART_COLORS);

  return (
    <div className={styles.chartContainer}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.title}>Line Chart — Time Series</span>
          <span className={styles.badge}>{pointCount.toLocaleString()} pts</span>
        </div>

        <div className={styles.controls}>
          {/* Compact Legend */}
          <div className={styles.legend}>
            {categories.map((cat) => (
              <span key={cat} className={styles.legendItem}>
                <span
                  className={styles.legendDot}
                  style={{ background: CHART_COLORS[cat] }}
                />
                {cat.toUpperCase()}
              </span>
            ))}
          </div>

          <span className={styles.hint}>Wheel: zoom • Drag: pan</span>

          <button
            className={styles.resetBtn}
            onClick={handleResetZoom}
            title="Reset Zoom & Pan"
          >
            Reset View
          </button>
        </div>
      </div>

      {/* Body: Canvas + SVG Hybrid */}
      <div
        className={styles.body}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      >
        <canvas ref={canvasRef} className={styles.canvas} />

        {/* SVG Overlay: Crosshair, Reticle, Tooltip */}
        <svg className={styles.overlay}>
          {hoverInfo && (
            <g>
              {/* Vertical Crosshair Line */}
              <line
                x1={hoverInfo.x}
                y1={boundsRef.current.y}
                x2={hoverInfo.x}
                y2={boundsRef.current.y + boundsRef.current.height}
                stroke="rgba(255, 255, 255, 0.25)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              {/* Horizontal Crosshair Line */}
              <line
                x1={boundsRef.current.x}
                y1={hoverInfo.y}
                x2={boundsRef.current.x + boundsRef.current.width}
                y2={hoverInfo.y}
                stroke="rgba(255, 255, 255, 0.25)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />

              {/* Highlight Target Reticle */}
              <circle
                cx={hoverInfo.x}
                cy={hoverInfo.y}
                r={6}
                fill={getColorForCategory(hoverInfo.category)}
                stroke="#ffffff"
                strokeWidth={2}
              />

              {/* Tooltip Card */}
              <g
                transform={`translate(${Math.min(
                  boundsRef.current.x + boundsRef.current.width - 130,
                  Math.max(boundsRef.current.x + 10, hoverInfo.x + 12)
                )}, ${Math.max(
                  boundsRef.current.y + 10,
                  hoverInfo.y - 45
                )})`}
              >
                <rect
                  width={124}
                  height={42}
                  rx={5}
                  fill="#0e1320"
                  stroke={getColorForCategory(hoverInfo.category)}
                  strokeWidth={1}
                  opacity={0.95}
                />
                <text
                  x={8}
                  y={16}
                  fill="#ffffff"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="system-ui, sans-serif"
                >
                  {hoverInfo.category.toUpperCase()}: {hoverInfo.val.toFixed(2)}
                </text>
                <text
                  x={8}
                  y={32}
                  fill="#8b92a8"
                  fontSize={9}
                  fontFamily="monospace"
                >
                  {new Date(hoverInfo.ts).toLocaleTimeString()}
                </text>
              </g>
            </g>
          )}
        </svg>

        {pointCount === 0 && (
          <div className={styles.emptyState}>
            <span>Connecting to live data stream…</span>
          </div>
        )}
      </div>
    </div>
  );
});
