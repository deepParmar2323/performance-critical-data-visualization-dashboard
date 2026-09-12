/**
 * canvasUtils.ts
 *
 * Low-level canvas drawing helpers.
 * These are pure functions with no React dependencies — safe to call
 * from inside requestAnimationFrame callbacks and Web Workers (OffscreenCanvas).
 */

import type { ChartBounds, ViewTransform } from "./types";

// ─────────────────────────────────────────────
// DPR-aware canvas setup
// ─────────────────────────────────────────────

/**
 * Sets up a canvas element for crisp rendering on hi-DPI / Retina displays.
 * Returns the rendering context.
 */
export function setupHiDPICanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

// ─────────────────────────────────────────────
// Coordinate mapping
// ─────────────────────────────────────────────

/**
 * Map a data value to canvas pixel Y coordinate (inverted: high value = low Y).
 */
export function mapY(
  value: number,
  minVal: number,
  maxVal: number,
  bounds: ChartBounds
): number {
  if (maxVal === minVal) return bounds.y + bounds.height / 2;
  const normalized = (value - minVal) / (maxVal - minVal);
  return bounds.y + bounds.height - normalized * bounds.height;
}

/**
 * Map a timestamp to canvas pixel X coordinate.
 */
export function mapX(
  timestamp: number,
  minTs: number,
  maxTs: number,
  bounds: ChartBounds,
  transform?: ViewTransform
): number {
  if (maxTs === minTs) return bounds.x + bounds.width / 2;
  const normalized = (timestamp - minTs) / (maxTs - minTs);
  const baseX = bounds.x + normalized * bounds.width;
  if (!transform) return baseX;
  return bounds.x + (baseX - bounds.x) * transform.scaleX + transform.offsetX;
}

// ─────────────────────────────────────────────
// Axis drawing
// ─────────────────────────────────────────────

export interface AxisOptions {
  tickCount?: number;
  color?: string;
  labelColor?: string;
  fontSize?: number;
  fontFamily?: string;
  formatX?: (ts: number) => string;
  formatY?: (val: number) => string;
}

const DEFAULT_AXIS: Required<AxisOptions> = {
  tickCount: 6,
  color: "rgba(255,255,255,0.15)",
  labelColor: "rgba(255,255,255,0.5)",
  fontSize: 11,
  fontFamily: "Inter, system-ui, sans-serif",
  formatX: (ts) => new Date(ts).toLocaleTimeString(),
  formatY: (v) => v.toFixed(1),
};

/**
 * Draw X axis (timestamps) below the chart bounds.
 */
export function drawXAxis(
  ctx: CanvasRenderingContext2D,
  minTs: number,
  maxTs: number,
  bounds: ChartBounds,
  options?: AxisOptions
): void {
  const opts = { ...DEFAULT_AXIS, ...options };
  ctx.save();
  ctx.strokeStyle = opts.color;
  ctx.fillStyle = opts.labelColor;
  ctx.font = `${opts.fontSize}px ${opts.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineWidth = 1;

  const step = (maxTs - minTs) / (opts.tickCount - 1);
  for (let i = 0; i < opts.tickCount; i++) {
    const ts = minTs + i * step;
    const x = bounds.x + (i / (opts.tickCount - 1)) * bounds.width;
    const y = bounds.y + bounds.height;

    // Grid line
    ctx.beginPath();
    ctx.moveTo(x, bounds.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    // Label
    ctx.fillText(opts.formatX(ts), x, y + 4);
  }
  ctx.restore();
}

/**
 * Draw Y axis (values) to the left of the chart bounds.
 */
export function drawYAxis(
  ctx: CanvasRenderingContext2D,
  minVal: number,
  maxVal: number,
  bounds: ChartBounds,
  options?: AxisOptions
): void {
  const opts = { ...DEFAULT_AXIS, ...options };
  ctx.save();
  ctx.strokeStyle = opts.color;
  ctx.fillStyle = opts.labelColor;
  ctx.font = `${opts.fontSize}px ${opts.fontFamily}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;

  const step = (maxVal - minVal) / (opts.tickCount - 1);
  for (let i = 0; i < opts.tickCount; i++) {
    const val = minVal + i * step;
    const y = mapY(val, minVal, maxVal, bounds);

    // Grid line
    ctx.beginPath();
    ctx.moveTo(bounds.x, y);
    ctx.lineTo(bounds.x + bounds.width, y);
    ctx.stroke();

    // Label
    ctx.fillText(opts.formatY(val), bounds.x - 6, y);
  }
  ctx.restore();
}

// ─────────────────────────────────────────────
// Clip region helper
// ─────────────────────────────────────────────

/**
 * Clip ctx to the chart bounds before drawing data.
 * Always call ctx.restore() after.
 */
export function clipToBounds(
  ctx: CanvasRenderingContext2D,
  bounds: ChartBounds
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.clip();
}

// ─────────────────────────────────────────────
// Data min/max helpers (typed arrays for speed)
// ─────────────────────────────────────────────

/**
 * Compute min/max of a numeric array using a tight loop.
 * Faster than Math.min(...arr) for large arrays.
 */
export function minMax(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  // Add 10% padding
  const padding = (max - min) * 0.1 || 1;
  return { min: min - padding, max: max + padding };
}

// ─────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────

export const CHART_COLORS: Record<string, string> = {
  cpu:     "#60a5fa", // blue-400
  memory:  "#34d399", // emerald-400
  network: "#f472b6", // pink-400
  disk:    "#fbbf24", // amber-400
  latency: "#a78bfa", // violet-400
};

export function getColorForCategory(category: string): string {
  return CHART_COLORS[category] ?? "#94a3b8";
}

/**
 * Convert a hex color + alpha to rgba string.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────
// Downsampling (LTTB - Largest Triangle Three Buckets)
// ─────────────────────────────────────────────

/**
 * LTTB downsampling — preserves visual shape while reducing point count.
 * Returns at most `threshold` points from `data`.
 *
 * Reference: Sveinn Steinarsson (2013)
 */
export function downsampleLTTB(
  data: { x: number; y: number }[],
  threshold: number
): { x: number; y: number }[] {
  const len = data.length;
  if (threshold >= len || threshold === 0) return data;

  const sampled: { x: number; y: number }[] = [];
  let a = 0; // Previous selected point
  sampled.push(data[a]);

  const bucketSize = (len - 2) / (threshold - 2);

  for (let i = 0; i < threshold - 2; i++) {
    // Next bucket range
    const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextBucketEnd = Math.min(
      Math.floor((i + 2) * bucketSize) + 1,
      len
    );

    // Average of the next bucket (used as 'c')
    let avgX = 0;
    let avgY = 0;
    const nextBucketLen = nextBucketEnd - nextBucketStart;
    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      avgX += data[j].x;
      avgY += data[j].y;
    }
    avgX /= nextBucketLen;
    avgY /= nextBucketLen;

    // Current bucket range
    const currBucketStart = Math.floor(i * bucketSize) + 1;
    const currBucketEnd = Math.floor((i + 1) * bucketSize) + 1;

    // Find point in current bucket with largest triangle area
    let maxArea = -1;
    let maxAreaIdx = currBucketStart;
    const ax = data[a].x;
    const ay = data[a].y;

    for (let j = currBucketStart; j < currBucketEnd; j++) {
      const area =
        Math.abs(
          (ax - avgX) * (data[j].y - ay) - (ax - data[j].x) * (avgY - ay)
        ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxAreaIdx = j;
      }
    }

    sampled.push(data[maxAreaIdx]);
    a = maxAreaIdx;
  }

  sampled.push(data[len - 1]);
  return sampled;
}
