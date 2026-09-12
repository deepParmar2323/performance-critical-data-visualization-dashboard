/**
 * performanceUtils.ts
 *
 * Utilities for measuring real browser performance metrics.
 * No fake numbers — everything comes from the browser APIs.
 */

// ─────────────────────────────────────────────
// FPS Tracker
// ─────────────────────────────────────────────

/**
 * Creates an FPS tracker that uses requestAnimationFrame.
 * Returns a cleanup function.
 */
export function createFPSTracker(
  onUpdate: (fps: number) => void,
  sampleWindow = 60 // frames to average over
): () => void {
  let frameCount = 0;
  let lastTime = performance.now();
  let rafId: number;
  const frameTimes: number[] = [];

  function tick() {
    const now = performance.now();
    const delta = now - lastTime;
    lastTime = now;

    frameTimes.push(delta);
    if (frameTimes.length > sampleWindow) {
      frameTimes.shift();
    }

    frameCount++;
    if (frameCount % 10 === 0) {
      // Recalculate every 10 frames
      const avgDelta =
        frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      const fps = avgDelta > 0 ? Math.round(1000 / avgDelta) : 0;
      onUpdate(Math.min(fps, 120)); // cap at 120 to avoid display spikes
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(rafId);
  };
}

// ─────────────────────────────────────────────
// Memory Usage
// ─────────────────────────────────────────────

/**
 * Returns current JS heap usage in MB.
 * Returns 0 if the Performance Memory API is not available (Firefox, Safari).
 */
export function getMemoryUsageMB(): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memory = (performance as any).memory;
  if (!memory) return 0;
  return parseFloat((memory.usedJSHeapSize / 1024 / 1024).toFixed(2));
}

// ─────────────────────────────────────────────
// Render Time Measurement
// ─────────────────────────────────────────────

/**
 * Measures the execution time of a synchronous function in ms.
 */
export function measureSync<T>(fn: () => T): { result: T; durationMs: number } {
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Measures the execution time of an async function in ms.
 */
export async function measureAsync<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

// ─────────────────────────────────────────────
// Sliding Average (for smoothing metrics)
// ─────────────────────────────────────────────

export class SlidingAverage {
  private values: number[] = [];
  constructor(private readonly windowSize: number) {}

  push(value: number): number {
    this.values.push(value);
    if (this.values.length > this.windowSize) {
      this.values.shift();
    }
    return this.average();
  }

  average(): number {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }

  reset(): void {
    this.values = [];
  }
}

// ─────────────────────────────────────────────
// Debounce (for interaction handlers)
// ─────────────────────────────────────────────

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function (...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

// ─────────────────────────────────────────────
// Throttle (for scroll / resize events)
// ─────────────────────────────────────────────

export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limitMs: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  return function (...args: Parameters<T>) {
    const now = Date.now();
    if (now - lastCall >= limitMs) {
      lastCall = now;
      fn(...args);
    }
  };
}

// ─────────────────────────────────────────────
// Unique ID generator (for Worker messages)
// ─────────────────────────────────────────────

let _idCounter = 0;
export function generateId(): string {
  return `msg_${++_idCounter}_${Date.now()}`;
}
