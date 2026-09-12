/**
 * dataGenerator.ts
 *
 * Realistic synthetic data generation for the performance dashboard.
 * Runs on the main thread (for API route) but is designed to be
 * called from the Web Worker too.
 *
 * Design goals:
 * - Produce data that looks like realistic sensor / telemetry readings
 * - Support multiple categories with independent trends
 * - Be fast enough to generate 100+ points without blocking
 */

import type { DataPoint } from "./types";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

export const CATEGORIES = [
  "cpu",
  "memory",
  "network",
  "disk",
  "latency",
] as const;

export type Category = (typeof CATEGORIES)[number];

// Per-category baseline and noise characteristics
const CATEGORY_PROFILES: Record<
  Category,
  { base: number; amplitude: number; frequency: number; noise: number }
> = {
  cpu:     { base: 40,  amplitude: 30, frequency: 0.05, noise: 5  },
  memory:  { base: 55,  amplitude: 20, frequency: 0.02, noise: 3  },
  network: { base: 20,  amplitude: 40, frequency: 0.08, noise: 8  },
  disk:    { base: 15,  amplitude: 10, frequency: 0.03, noise: 2  },
  latency: { base: 100, amplitude: 80, frequency: 0.1,  noise: 15 },
};

// ─────────────────────────────────────────────
// Seeded PRNG (Mulberry32) — deterministic & fast
// ─────────────────────────────────────────────

function mulberry32(seed: number) {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Shared PRNG instance (reset each call to generateBatch for reproducibility)
let _rand = mulberry32(Date.now());

function rand() {
  return _rand();
}

// ─────────────────────────────────────────────
// Core generation functions
// ─────────────────────────────────────────────

/**
 * Generate a single data point for a given category at a given timestamp.
 */
export function generateDataPoint(
  timestamp: number,
  category: Category,
  tSec: number // t in seconds (used for sine wave)
): DataPoint {
  const profile = CATEGORY_PROFILES[category];

  // Sine wave base trend + random walk noise
  const trend = profile.base + profile.amplitude * Math.sin(2 * Math.PI * profile.frequency * tSec);
  const noise = (rand() - 0.5) * 2 * profile.noise;
  const value = Math.max(0, trend + noise);

  return {
    timestamp,
    value: parseFloat(value.toFixed(3)),
    category,
    metadata: {
      raw: value,
      trend: parseFloat(trend.toFixed(3)),
    },
  };
}

/**
 * Generate a batch of DataPoints across all categories.
 *
 * @param count  - Number of points PER category
 * @param startTs - Starting timestamp (ms). If omitted, uses now.
 * @param intervalMs - Time between points in ms (default: 100)
 */
export function generateBatch(
  count: number,
  startTs?: number,
  intervalMs = 100
): DataPoint[] {
  _rand = mulberry32(startTs ?? Date.now());
  const points: DataPoint[] = [];
  const base = startTs ?? Date.now();

  for (let i = 0; i < count; i++) {
    const ts = base + i * intervalMs;
    const tSec = ts / 1000;
    for (const category of CATEGORIES) {
      points.push(generateDataPoint(ts, category, tSec));
    }
  }

  // Sort by timestamp ascending
  points.sort((a, b) => a.timestamp - b.timestamp);
  return points;
}

/**
 * Generate a single "tick" — one new DataPoint per category.
 * Called every 100ms during real-time streaming.
 */
export function generateTick(
  timestamp: number,
  pointsPerCategory = 1
): DataPoint[] {
  const tSec = timestamp / 1000;
  const points: DataPoint[] = [];

  for (let p = 0; p < pointsPerCategory; p++) {
    for (const category of CATEGORIES) {
      points.push(generateDataPoint(timestamp + p, category, tSec));
    }
  }

  return points;
}

/**
 * Generate initial historical data to pre-populate charts.
 * Returns the last `windowSize` points up to now.
 */
export function generateInitialData(
  windowSize: number,
  intervalMs = 100
): DataPoint[] {
  const now = Date.now();
  const count = Math.ceil(windowSize / CATEGORIES.length);
  const startTs = now - count * intervalMs;
  return generateBatch(count, startTs, intervalMs).slice(-windowSize);
}
