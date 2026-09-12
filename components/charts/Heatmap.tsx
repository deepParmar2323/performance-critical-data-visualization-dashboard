"use client";

/**
 * Heatmap.tsx — Performance-Critical 2D Density Heatmap
 *
 * Architecture:
 * - Canvas: 2D cell rasterization using a precomputed 256-entry color lookup table (LUT)
 *   and Float64Array buffers for zero-allocation 60 FPS redraws.
 * - SVG: Interactive cell highlight rect and detailed inspection tooltip.
 * - Interaction: Wheel zoom (time window), click-drag pan, cell hover tracking.
 * - Performance: Fixed binning buffers, typed array reuse, cached data revisions.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useDataStream } from "@/hooks/useDataStream";
import { useChartRenderer } from "@/hooks/useChartRenderer";
import {
  clipToBounds,
  getColorForCategory,
} from "@/lib/canvasUtils";
import type { ChartBounds, DataPoint, ViewTransform } from "@/lib/types";
import styles from "./charts.module.css";

const CATEGORIES = ["cpu", "memory", "network", "disk", "latency"];
const NUM_CATEGORIES = CATEGORIES.length;
const NUM_BUCKETS = 28; // 28 time intervals

// Precomputed 256-color LUT (deep navy -> violet -> magenta -> amber -> luminous white)
function generateColorLUT(): string[] {
  const lut: string[] = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r = 0, g = 0, b = 0;
    if (t < 0.25) {
      // 0.0 - 0.25: Dark navy to deep indigo (15, 23, 42) -> (59, 7, 100)
      const u = t / 0.25;
      r = Math.round(15 + u * (59 - 15));
      g = Math.round(23 + u * (7 - 23));
      b = Math.round(42 + u * (100 - 42));
    } else if (t < 0.5) {
      // 0.25 - 0.5: Deep indigo to vivid purple (59, 7, 100) -> (147, 51, 234)
      const u = (t - 0.25) / 0.25;
      r = Math.round(59 + u * (147 - 59));
      g = Math.round(7 + u * (51 - 7));
      b = Math.round(100 + u * (234 - 100));
    } else if (t < 0.75) {
      // 0.5 - 0.75: Vivid purple to bright amber/coral (147, 51, 234) -> (245, 158, 11)
      const u = (t - 0.5) / 0.25;
      r = Math.round(147 + u * (245 - 147));
      g = Math.round(51 + u * (158 - 51));
      b = Math.round(234 + u * (11 - 234));
    } else {
      // 0.75 - 1.0: Bright amber to luminous white (245, 158, 11) -> (254, 240, 138)
      const u = (t - 0.75) / 0.25;
      r = Math.round(245 + u * (255 - 245));
      g = Math.round(158 + u * (255 - 158));
      b = Math.round(11 + u * (200 - 11));
    }
    lut.push(`rgb(${r},${g},${b})`);
  }
  return lut;
}

const COLOR_LUT = generateColorLUT();

interface HoverCellInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  category: string;
  avg: number;
  count: number;
  startTime: number;
  endTime: number;
}

export const Heatmap = memo(function Heatmap() {
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
  const boundsRef = useRef<ChartBounds>({ x: 74, y: 16, width: 500, height: 180 });

  const [hoverInfo, setHoverInfo] = useState<HoverCellInfo | null>(null);

  // Pre-allocated typed buffers for 2D accumulation
  const binBufferRef = useRef<{
    dataLen: number;
    lastTs: number;
    sums: Float64Array;
    counts: Int32Array;
    minTs: number;
    maxTs: number;
    minVal: number;
    maxVal: number;
  }>({
    dataLen: 0,
    lastTs: 0,
    sums: new Float64Array(NUM_CATEGORIES * NUM_BUCKETS),
    counts: new Int32Array(NUM_CATEGORIES * NUM_BUCKETS),
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
        x: 74,
        y: 16,
        width: Math.max(10, width - 90),
        height: Math.max(10, height - 44),
      };
      boundsRef.current = bounds;

      ctx.save();
      ctx.clearRect(0, 0, width, height);

      if (rawData.length < 2) {
        ctx.restore();
        return;
      }

      // Re-bin if data updated
      const buffer = binBufferRef.current;
      const lastPoint = rawData[rawData.length - 1];

      if (
        buffer.dataLen !== rawData.length ||
        buffer.lastTs !== (lastPoint ? lastPoint.timestamp : 0)
      ) {
        let minT = Infinity;
        let maxT = -Infinity;
        for (let i = 0; i < rawData.length; i++) {
          const ts = rawData[i].timestamp;
          if (ts < minT) minT = ts;
          if (ts > maxT) maxT = ts;
        }

        buffer.minTs = minT;
        buffer.maxTs = maxT;
        buffer.dataLen = rawData.length;
        buffer.lastTs = lastPoint ? lastPoint.timestamp : 0;

        // Clear buffers
        buffer.sums.fill(0);
        buffer.counts.fill(0);

        const timeSpan = maxT - minT || 1;

        // Single-pass binning
        for (let i = 0; i < rawData.length; i++) {
          const p = rawData[i];
          const catIdx = CATEGORIES.indexOf(p.category);
          if (catIdx === -1) continue;

          const bucketIdx = Math.min(
            NUM_BUCKETS - 1,
            Math.max(0, Math.floor(((p.timestamp - minT) / timeSpan) * NUM_BUCKETS))
          );

          const cellIndex = catIdx * NUM_BUCKETS + bucketIdx;
          buffer.sums[cellIndex] += p.value;
          buffer.counts[cellIndex]++;
        }

        // Find min and max average across cells
        let minV = Infinity;
        let maxV = -Infinity;
        for (let i = 0; i < NUM_CATEGORIES * NUM_BUCKETS; i++) {
          if (buffer.counts[i] > 0) {
            const avg = buffer.sums[i] / buffer.counts[i];
            if (avg < minV) minV = avg;
            if (avg > maxV) maxV = avg;
          }
        }

        buffer.minVal = minV === Infinity ? 0 : minV;
        buffer.maxVal = maxV === -Infinity ? 100 : maxV;
      }

      const { sums, counts, minTs, maxTs, minVal, maxVal } = buffer;

      // Draw Category Y Labels
      const cellHeight = bounds.height / NUM_CATEGORIES;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.font = "600 10px system-ui, sans-serif";

      for (let c = 0; c < NUM_CATEGORIES; c++) {
        const cat = CATEGORIES[c];
        const rowCenterY = bounds.y + c * cellHeight + cellHeight / 2;
        ctx.fillStyle = getColorForCategory(cat);
        ctx.fillText(cat.toUpperCase(), bounds.x - 8, rowCenterY);
      }

      // Clip data cells to bounds
      clipToBounds(ctx, bounds);

      const totalSpan = maxTs - minTs || 1;
      const bucketDuration = totalSpan / NUM_BUCKETS;

      // Draw 2D cells
      const gap = 2;
      for (let c = 0; c < NUM_CATEGORIES; c++) {
        const cellY = bounds.y + c * cellHeight + gap / 2;
        const actualH = Math.max(1, cellHeight - gap);

        for (let b = 0; b < NUM_BUCKETS; b++) {
          const bucketStartTs = minTs + b * bucketDuration;
          const bucketEndTs = bucketStartTs + bucketDuration;

          // Compute cell X coordinates with view transform
          const normStart = (bucketStartTs - minTs) / totalSpan;
          const normEnd = (bucketEndTs - minTs) / totalSpan;

          const baseXStart = bounds.x + normStart * bounds.width;
          const baseXEnd = bounds.x + normEnd * bounds.width;

          const cellX =
            bounds.x +
            (baseXStart - bounds.x) * transform.scaleX +
            transform.offsetX +
            gap / 2;
          const cellXEnd =
            bounds.x +
            (baseXEnd - bounds.x) * transform.scaleX +
            transform.offsetX -
            gap / 2;
          const actualW = Math.max(1, cellXEnd - cellX);

          // Viewport culling
          if (cellX + actualW < bounds.x || cellX > bounds.x + bounds.width) continue;

          const idx = c * NUM_BUCKETS + b;
          const count = counts[idx];

          if (count === 0) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
          } else {
            const avg = sums[idx] / count;
            const norm = Math.max(
              0,
              Math.min(1, (avg - minVal) / (maxVal - minVal || 1))
            );
            const lutIndex = Math.floor(norm * 255);
            ctx.fillStyle = COLOR_LUT[lutIndex];
          }

          ctx.fillRect(cellX, cellY, actualW, actualH);
        }
      }

      ctx.restore(); // Restore clip

      // Draw X Time Axis ticks below bounds
      const visibleMinTs =
        minTs + ((-transform.offsetX) / (bounds.width * transform.scaleX)) * totalSpan;
      const visibleMaxTs =
        minTs +
        ((bounds.width - transform.offsetX) / (bounds.width * transform.scaleX)) *
        totalSpan;

      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = "10px monospace";
      ctx.fillStyle = "rgba(160, 170, 195, 0.6)";

      const tickCount = Math.min(6, Math.max(3, Math.floor(bounds.width / 120)));
      for (let i = 0; i < tickCount; i++) {
        const t = i / (tickCount - 1);
        const x = bounds.x + t * bounds.width;
        const ts = visibleMinTs + t * (visibleMaxTs - visibleMinTs);
        ctx.fillText(new Date(ts).toLocaleTimeString(), x, bounds.y + bounds.height + 6);
      }

      ctx.restore(); // Restore base context
    },
    []
  );

  const { canvasRef, markDirty } = useChartRenderer({ onRender, isDirtyRef });

  // ── Wheel Zoom (Time axis) ───────────────────────────────────────────────
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
    const nextScale = Math.max(1, Math.min(30, current.scaleX * zoomFactor));

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

  // ── Drag Pan ─────────────────────────────────────────────────────────────
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

      // Hover cell detection
      if (
        mouseX >= bounds.x &&
        mouseX <= bounds.x + bounds.width &&
        mouseY >= bounds.y &&
        mouseY <= bounds.y + bounds.height
      ) {
        const cellHeight = bounds.height / NUM_CATEGORIES;
        const catIdx = Math.floor((mouseY - bounds.y) / cellHeight);

        const buffer = binBufferRef.current;
        const transform = transformRef.current;
        const totalSpan = buffer.maxTs - buffer.minTs || 1;
        const bucketDuration = totalSpan / NUM_BUCKETS;

        if (catIdx >= 0 && catIdx < NUM_CATEGORIES) {
          // Find which bucket mouseX lands on
          for (let b = 0; b < NUM_BUCKETS; b++) {
            const bucketStartTs = buffer.minTs + b * bucketDuration;
            const bucketEndTs = bucketStartTs + bucketDuration;

            const normStart = (bucketStartTs - buffer.minTs) / totalSpan;
            const normEnd = (bucketEndTs - buffer.minTs) / totalSpan;

            const baseXStart = bounds.x + normStart * bounds.width;
            const baseXEnd = bounds.x + normEnd * bounds.width;

            const cellX =
              bounds.x +
              (baseXStart - bounds.x) * transform.scaleX +
              transform.offsetX;
            const cellXEnd =
              bounds.x +
              (baseXEnd - bounds.x) * transform.scaleX +
              transform.offsetX;

            if (mouseX >= cellX && mouseX <= cellXEnd) {
              const idx = catIdx * NUM_BUCKETS + b;
              const count = buffer.counts[idx];
              const avg = count > 0 ? buffer.sums[idx] / count : 0;

              setHoverInfo({
                x: cellX,
                y: bounds.y + catIdx * cellHeight,
                width: Math.max(4, cellXEnd - cellX),
                height: cellHeight,
                category: CATEGORIES[catIdx],
                avg,
                count,
                startTime: bucketStartTs,
                endTime: bucketEndTs,
              });
              return;
            }
          }
        }
      }
      setHoverInfo(null);
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

  return (
    <div className={styles.chartContainer}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.title}>Heatmap — Activity & Intensity Matrix</span>
          <span className={styles.badge}>{NUM_BUCKETS} time bins × 5 metrics</span>
        </div>

        <div className={styles.controls}>
          {/* Intensity Color Gradient Legend */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "#8b92a8" }}>Low</span>
            <div
              style={{
                width: 70,
                height: 8,
                borderRadius: 3,
                background: "linear-gradient(to right, rgb(15,23,42), rgb(147,51,234), rgb(245,158,11), rgb(254,240,138))",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            />
            <span style={{ fontSize: 10, color: "#8b92a8" }}>High</span>
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

      {/* Body */}
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
              {/* Highlight cell border */}
              <rect
                x={hoverInfo.x}
                y={hoverInfo.y}
                width={hoverInfo.width}
                height={hoverInfo.height}
                fill="none"
                stroke="#ffffff"
                strokeWidth={2}
                rx={2}
              />

              {/* Tooltip Card */}
              <g
                transform={`translate(${Math.min(
                  boundsRef.current.x + boundsRef.current.width - 150,
                  Math.max(boundsRef.current.x + 10, hoverInfo.x + hoverInfo.width + 10)
                )}, ${Math.max(boundsRef.current.y, hoverInfo.y - 20)})`}
              >
                <rect
                  width={142}
                  height={62}
                  rx={6}
                  fill="#0e1320"
                  stroke={getColorForCategory(hoverInfo.category)}
                  strokeWidth={1}
                  opacity={0.96}
                />
                <text x={8} y={16} fill="#ffffff" fontSize={11} fontWeight={700}>
                  {hoverInfo.category.toUpperCase()}
                </text>
                <text x={8} y={32} fill="#34d399" fontSize={11} fontFamily="monospace">
                  Avg: {hoverInfo.avg.toFixed(2)} ({hoverInfo.count} pts)
                </text>
                <text x={8} y={48} fill="#8b92a8" fontSize={9} fontFamily="monospace">
                  {new Date(hoverInfo.startTime).toLocaleTimeString()} –{" "}
                  {new Date(hoverInfo.endTime).toLocaleTimeString()}
                </text>
              </g>
            </g>
          )}
        </svg>

        {pointCount === 0 && (
          <div className={styles.emptyState}>
            <span>Waiting for stream data to populate heatmap…</span>
          </div>
        )}
      </div>
    </div>
  );
});
