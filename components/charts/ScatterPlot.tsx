"use client";

/**
 * ScatterPlot.tsx — High-Density Performance-Critical Scatter Plot
 *
 * Architecture:
 * - Canvas: High-throughput batch point rendering (5 draw calls total across thousands of points).
 * - SVG: Crisp interactive target reticle, crosshair lines, and detailed tooltip.
 * - Interaction: Wheel zoom (anchored to pointer), click-drag pan, nearest-neighbor inspection.
 * - Performance: Viewport domain culling, batched category paths, zero React state re-renders on ticks.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useDataStream } from "@/hooks/useDataStream";
import { useChartRenderer } from "@/hooks/useChartRenderer";
import {
  CHART_COLORS,
  clipToBounds,
  drawXAxis,
  drawYAxis,
  getColorForCategory,
  hexToRgba,
  mapX,
  mapY,
  minMax,
} from "@/lib/canvasUtils";
import type { ChartBounds, DataPoint, ViewTransform } from "@/lib/types";
import styles from "./charts.module.css";

interface HoverScatterInfo {
  x: number;
  y: number;
  val: number;
  ts: number;
  category: string;
}

export const ScatterPlot = memo(function ScatterPlot() {
  const { data, pointCount } = useDataStream({ limit: 4000 });
  const isDirtyRef = useRef(true);

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
  const boundsRef = useRef<ChartBounds>({ x: 52, y: 16, width: 400, height: 220 });

  const [hoverInfo, setHoverInfo] = useState<HoverScatterInfo | null>(null);

  // Cached data points grouped by category
  const cacheRef = useRef<{
    dataLen: number;
    lastTs: number;
    grouped: Map<string, { ts: number; val: number }[]>;
    minTs: number;
    maxTs: number;
    minVal: number;
    maxVal: number;
  }>({
    dataLen: 0,
    lastTs: 0,
    grouped: new Map(),
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

      const bounds: ChartBounds = {
        x: 52,
        y: 16,
        width: Math.max(10, width - 68),
        height: Math.max(10, height - 46),
      };
      boundsRef.current = bounds;

      ctx.save();
      ctx.clearRect(0, 0, width, height);

      if (rawData.length < 2) {
        ctx.restore();
        return;
      }

      // Group by category if data updated
      const cache = cacheRef.current;
      const lastPoint = rawData[rawData.length - 1];
      if (
        cache.dataLen !== rawData.length ||
        cache.lastTs !== (lastPoint ? lastPoint.timestamp : 0)
      ) {
        const grouped = new Map<string, { ts: number; val: number }[]>();
        let minT = Infinity;
        let maxT = -Infinity;
        const allVals: number[] = [];

        for (let i = 0; i < rawData.length; i++) {
          const p = rawData[i];
          if (p.timestamp < minT) minT = p.timestamp;
          if (p.timestamp > maxT) maxT = p.timestamp;
          allVals.push(p.value);

          let arr = grouped.get(p.category);
          if (!arr) {
            arr = [];
            grouped.set(p.category, arr);
          }
          arr.push({ ts: p.timestamp, val: p.value });
        }

        const { min: minV, max: maxV } = minMax(allVals);
        cache.dataLen = rawData.length;
        cache.lastTs = lastPoint ? lastPoint.timestamp : 0;
        cache.grouped = grouped;
        cache.minTs = minT;
        cache.maxTs = maxT;
        cache.minVal = Math.max(0, minV);
        cache.maxVal = Math.max(10, maxV);
      }

      const { grouped, minTs, maxTs, minVal, maxVal } = cache;

      // Visible time window
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

      // Clip drawing region
      clipToBounds(ctx, bounds);

      const radius = transform.scaleX > 3 ? 3.5 : 2.5;

      // Batched draw by category — only 1 fill call per category!
      grouped.forEach((points, category) => {
        const color = getColorForCategory(category);
        ctx.fillStyle = hexToRgba(color, 0.7);

        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          // Viewport culling
          if (pt.ts < visibleMinTs || pt.ts > visibleMaxTs) continue;

          const px = mapX(pt.ts, minTs, maxTs, bounds, transform);
          const py = mapY(pt.val, minVal, maxVal, bounds);

          ctx.moveTo(px + radius, py);
          ctx.arc(px, py, radius, 0, Math.PI * 2);
        }
        ctx.fill();
      });

      ctx.restore(); // Restore clip
      ctx.restore(); // Restore base
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [canvasRef, onWheel]);

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

      // Nearest point search for tooltip
      if (
        mouseX >= bounds.x &&
        mouseX <= bounds.x + bounds.width &&
        mouseY >= bounds.y &&
        mouseY <= bounds.y + bounds.height
      ) {
        const cache = cacheRef.current;
        const transform = transformRef.current;
        if (!cache.minTs || !cache.maxTs) return;

        let bestDist = Infinity;
        let bestPoint: HoverScatterInfo | null = null;

        cache.grouped.forEach((pts, category) => {
          for (let i = 0; i < pts.length; i++) {
            const pt = pts[i];
            const px = mapX(pt.ts, cache.minTs, cache.maxTs, bounds, transform);
            const py = mapY(pt.val, cache.minVal, cache.maxVal, bounds);

            const dist = Math.hypot(px - mouseX, py - mouseY);
            if (dist < bestDist && dist < 30) {
              bestDist = dist;
              bestPoint = {
                x: px,
                y: py,
                val: pt.val,
                ts: pt.ts,
                category,
              };
            }
          }
        });

        setHoverInfo(bestPoint);
      } else {
        setHoverInfo(null);
      }
    },
    [canvasRef, markDirty]
  );

  const onMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const onMouseLeave = useCallback(() => {
    isDraggingRef.current = false;
    setHoverInfo(null);
  }, []);

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
          <span className={styles.title}>Scatter Plot — Value Distribution</span>
          <span className={styles.badge}>{pointCount.toLocaleString()} pts</span>
        </div>

        <div className={styles.controls}>
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
            title="Reset View"
          >
            Reset View
          </button>
        </div>
      </div>

      {/* Body: Canvas + SVG Overlay */}
      <div
        className={styles.body}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      >
        <canvas ref={canvasRef} className={styles.canvas} />

        {/* SVG Overlay */}
        <svg className={styles.overlay}>
          {hoverInfo && (
            <g>
              {/* Crosshair */}
              <line
                x1={hoverInfo.x}
                y1={boundsRef.current.y}
                x2={hoverInfo.x}
                y2={boundsRef.current.y + boundsRef.current.height}
                stroke="rgba(255, 255, 255, 0.25)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <line
                x1={boundsRef.current.x}
                y1={hoverInfo.y}
                x2={boundsRef.current.x + boundsRef.current.width}
                y2={hoverInfo.y}
                stroke="rgba(255, 255, 255, 0.25)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />

              {/* Point Reticle Ring */}
              <circle
                cx={hoverInfo.x}
                cy={hoverInfo.y}
                r={8}
                fill="none"
                stroke="#ffffff"
                strokeWidth={2}
              />
              <circle
                cx={hoverInfo.x}
                cy={hoverInfo.y}
                r={4}
                fill={getColorForCategory(hoverInfo.category)}
              />

              {/* Tooltip Card */}
              <g
                transform={`translate(${Math.min(
                  boundsRef.current.x + boundsRef.current.width - 130,
                  Math.max(boundsRef.current.x + 10, hoverInfo.x + 14)
                )}, ${Math.max(
                  boundsRef.current.y + 10,
                  hoverInfo.y - 45
                )})`}
              >
                <rect
                  width={126}
                  height={44}
                  rx={5}
                  fill="#0e1320"
                  stroke={getColorForCategory(hoverInfo.category)}
                  strokeWidth={1}
                  opacity={0.96}
                />
                <text
                  x={8}
                  y={17}
                  fill="#ffffff"
                  fontSize={11}
                  fontWeight={600}
                >
                  {hoverInfo.category.toUpperCase()}: {hoverInfo.val.toFixed(2)}
                </text>
                <text
                  x={8}
                  y={33}
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
