"use client";

/**
 * BarChart.tsx — Performance-Critical Category & Metric Bar Chart
 *
 * Architecture:
 * - Canvas: Crisp GPU-rendered category bars with gradients, baseline grid, and value labels.
 * - SVG: Interactive highlight pillar and statistical tooltip overlay.
 * - Interaction: Wheel zoom (Y-scale), hover inspection, Reset View.
 * - Performance: O(N) single-pass statistics cache in ref, zero React state updates on stream ticks.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useDataStream } from "@/hooks/useDataStream";
import { useChartRenderer } from "@/hooks/useChartRenderer";
import {
  clipToBounds,
  drawYAxis,
  getColorForCategory,
  hexToRgba,
  mapY,
} from "@/lib/canvasUtils";
import type { ChartBounds, DataPoint, ViewTransform } from "@/lib/types";
import styles from "./charts.module.css";

interface CategoryStat {
  category: string;
  current: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}

interface HoverBarInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  stat: CategoryStat;
}

const CATEGORY_LIST = ["cpu", "memory", "network", "disk", "latency"];

export const BarChart = memo(function BarChart() {
  const { data, pointCount } = useDataStream({ limit: 2500 });
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

  const boundsRef = useRef<ChartBounds>({ x: 50, y: 16, width: 400, height: 220 });
  const [hoverInfo, setHoverInfo] = useState<HoverBarInfo | null>(null);

  // Cached stats per category
  const statsCacheRef = useRef<{
    dataLen: number;
    lastTs: number;
    stats: CategoryStat[];
    maxVal: number;
  }>({
    dataLen: 0,
    lastTs: 0,
    stats: [],
    maxVal: 100,
  });

  // ── Render callback for rAF ──────────────────────────────────────────────
  const onRender = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const rawData = dataRef.current;
      const transform = transformRef.current;

      const bounds: ChartBounds = {
        x: 48,
        y: 20,
        width: Math.max(10, width - 64),
        height: Math.max(10, height - 52),
      };
      boundsRef.current = bounds;

      ctx.save();
      ctx.clearRect(0, 0, width, height);

      if (rawData.length === 0) {
        ctx.restore();
        return;
      }

      // Compute statistics if data changed
      const cache = statsCacheRef.current;
      const lastPoint = rawData[rawData.length - 1];
      if (
        cache.dataLen !== rawData.length ||
        cache.lastTs !== (lastPoint ? lastPoint.timestamp : 0)
      ) {
        const catMap = new Map<
          string,
          { sum: number; count: number; min: number; max: number; current: number }
        >();

        for (const cat of CATEGORY_LIST) {
          catMap.set(cat, {
            sum: 0,
            count: 0,
            min: Infinity,
            max: -Infinity,
            current: 0,
          });
        }

        for (let i = 0; i < rawData.length; i++) {
          const p = rawData[i];
          const entry = catMap.get(p.category);
          if (entry) {
            entry.sum += p.value;
            entry.count++;
            if (p.value < entry.min) entry.min = p.value;
            if (p.value > entry.max) entry.max = p.value;
            entry.current = p.value;
          }
        }

        let overallMax = 10;
        const computedStats: CategoryStat[] = CATEGORY_LIST.map((cat) => {
          const e = catMap.get(cat)!;
          const avg = e.count > 0 ? e.sum / e.count : 0;
          const min = e.min === Infinity ? 0 : e.min;
          const max = e.max === -Infinity ? 0 : e.max;
          if (max > overallMax) overallMax = max;
          if (e.current > overallMax) overallMax = e.current;
          return {
            category: cat,
            current: e.current,
            avg,
            min,
            max,
            count: e.count,
          };
        });

        cache.dataLen = rawData.length;
        cache.lastTs = lastPoint ? lastPoint.timestamp : 0;
        cache.stats = computedStats;
        cache.maxVal = overallMax * 1.15; // 15% padding
      }

      const { stats, maxVal } = cache;
      const scaledMax = Math.max(5, maxVal / transform.scaleY);

      // Draw Y-axis & horizontal grid lines
      drawYAxis(ctx, 0, scaledMax, bounds, {
        tickCount: Math.min(6, Math.max(3, Math.floor(bounds.height / 45))),
        color: "rgba(255, 255, 255, 0.05)",
        labelColor: "rgba(160, 170, 195, 0.6)",
        fontSize: 10,
        formatY: (v) => v.toFixed(0),
      });

      // Clip drawing area
      clipToBounds(ctx, bounds);

      const barCount = stats.length;
      const colWidth = bounds.width / barCount;
      const barWidth = Math.min(54, colWidth * 0.62);

      // Draw Bars
      for (let i = 0; i < barCount; i++) {
        const stat = stats[i];
        const color = getColorForCategory(stat.category);
        const colCenter = bounds.x + i * colWidth + colWidth / 2;
        const barX = colCenter - barWidth / 2;

        const barY = mapY(stat.current, 0, scaledMax, bounds);
        const barH = Math.max(2, bounds.y + bounds.height - barY);

        // Average reference line
        const avgY = mapY(stat.avg, 0, scaledMax, bounds);

        // Bar background column slot
        ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
        ctx.fillRect(barX, bounds.y, barWidth, bounds.height);

        // Main Bar with Vertical Gradient
        const grad = ctx.createLinearGradient(0, barY, 0, bounds.y + bounds.height);
        grad.addColorStop(0, color);
        grad.addColorStop(1, hexToRgba(color, 0.25));

        ctx.fillStyle = grad;
        ctx.beginPath();
        // Rounded top corners
        const r = Math.min(4, barWidth / 2);
        ctx.roundRect(barX, barY, barWidth, barH, [r, r, 0, 0]);
        ctx.fill();

        // Average marker whisker
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(barX - 2, avgY);
        ctx.lineTo(barX + barWidth + 2, avgY);
        ctx.stroke();

        // Top value readout
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(stat.current.toFixed(1), colCenter, Math.max(bounds.y + 12, barY - 4));
      }

      ctx.restore(); // Restore clipping

      // Draw X-axis category labels below bounds
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = "600 11px system-ui, sans-serif";

      for (let i = 0; i < barCount; i++) {
        const stat = stats[i];
        const colCenter = bounds.x + i * colWidth + colWidth / 2;
        ctx.fillStyle = getColorForCategory(stat.category);
        ctx.fillText(stat.category.toUpperCase(), colCenter, bounds.y + bounds.height + 8);
      }

      ctx.restore(); // Restore base context
    },
    []
  );

  const { canvasRef, markDirty } = useChartRenderer({ onRender, isDirtyRef });

  // ── Wheel Zoom (Vertical scale) ──────────────────────────────────────────
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const current = transformRef.current;
    const nextScaleY = Math.max(0.2, Math.min(20, current.scaleY * zoomFactor));

    transformRef.current = {
      ...current,
      scaleY: nextScaleY,
    };
    markDirty();
  }, [markDirty]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [canvasRef, onWheel]);

  // ── Pointer Hover Inspection ─────────────────────────────────────────────
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const bounds = boundsRef.current;
    const stats = statsCacheRef.current.stats;

    if (
      mouseX >= bounds.x &&
      mouseX <= bounds.x + bounds.width &&
      mouseY >= bounds.y &&
      mouseY <= bounds.y + bounds.height &&
      stats.length > 0
    ) {
      const colWidth = bounds.width / stats.length;
      const idx = Math.floor((mouseX - bounds.x) / colWidth);

      if (idx >= 0 && idx < stats.length) {
        const stat = stats[idx];
        const colCenter = bounds.x + idx * colWidth + colWidth / 2;
        const barWidth = Math.min(54, colWidth * 0.62);

        setHoverInfo({
          x: colCenter - barWidth / 2,
          y: bounds.y,
          width: barWidth,
          height: bounds.height,
          stat,
        });
        return;
      }
    }
    setHoverInfo(null);
  }, [canvasRef]);

  const onMouseLeave = useCallback(() => {
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
          <span className={styles.title}>Bar Chart — Category Comparison</span>
          <span className={styles.badge}>{CATEGORY_LIST.length} categories</span>
        </div>

        <div className={styles.controls}>
          <span className={styles.hint}>Wheel: zoom Y-axis</span>
          <button
            className={styles.resetBtn}
            onClick={handleResetZoom}
            title="Reset Scale"
          >
            Reset View
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        className={styles.body}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        <canvas ref={canvasRef} className={styles.canvas} />

        {/* SVG Overlay: Highlight column & stats tooltip */}
        <svg className={styles.overlay}>
          {hoverInfo && (
            <g>
              {/* Highlight Pillar Outline */}
              <rect
                x={hoverInfo.x - 4}
                y={hoverInfo.y}
                width={hoverInfo.width + 8}
                height={hoverInfo.height}
                fill="none"
                stroke={getColorForCategory(hoverInfo.stat.category)}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                rx={4}
              />

              {/* Tooltip Card */}
              <g
                transform={`translate(${Math.min(
                  boundsRef.current.x + boundsRef.current.width - 150,
                  Math.max(boundsRef.current.x + 10, hoverInfo.x + hoverInfo.width + 12)
                )}, ${boundsRef.current.y + 10})`}
              >
                <rect
                  width={144}
                  height={78}
                  rx={6}
                  fill="#0e1320"
                  stroke={getColorForCategory(hoverInfo.stat.category)}
                  strokeWidth={1}
                  opacity={0.96}
                />
                <text
                  x={10}
                  y={18}
                  fill="#ffffff"
                  fontSize={12}
                  fontWeight={700}
                >
                  {hoverInfo.stat.category.toUpperCase()}
                </text>
                <text x={10} y={35} fill="#34d399" fontSize={11} fontFamily="monospace">
                  Current: {hoverInfo.stat.current.toFixed(1)}
                </text>
                <text x={10} y={51} fill="#60a5fa" fontSize={11} fontFamily="monospace">
                  Average: {hoverInfo.stat.avg.toFixed(1)}
                </text>
                <text x={10} y={67} fill="#8b92a8" fontSize={10} fontFamily="monospace">
                  Min: {hoverInfo.stat.min.toFixed(0)} • Max: {hoverInfo.stat.max.toFixed(0)}
                </text>
              </g>
            </g>
          )}
        </svg>

        {pointCount === 0 && (
          <div className={styles.emptyState}>
            <span>Awaiting data stream…</span>
          </div>
        )}
      </div>
    </div>
  );
});
