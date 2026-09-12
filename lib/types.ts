// ─────────────────────────────────────────────
// Core Data Types
// ─────────────────────────────────────────────

export interface DataPoint {
  timestamp: number;
  value: number;
  category: string;
  metadata?: Record<string, unknown>;
}

export interface AggregatedDataPoint {
  timestamp: number;
  min: number;
  max: number;
  avg: number;
  count: number;
  category: string;
}

// ─────────────────────────────────────────────
// Chart Configuration
// ─────────────────────────────────────────────

export type ChartType = "line" | "bar" | "scatter" | "heatmap";
export type AggregationInterval = "1m" | "5m" | "1h" | "raw";

export interface ChartConfig {
  type: ChartType;
  dataKey: string;
  color: string;
  visible: boolean;
}

// ─────────────────────────────────────────────
// Performance Metrics
// ─────────────────────────────────────────────

export interface PerformanceMetrics {
  fps: number;
  memoryUsage: number; // MB, 0 if not available
  renderTime: number;  // ms
  dataProcessingTime: number; // ms
  dataPointCount: number;
  workerJobsDispatched: number;
  workerJobsSkipped: number;
  // Phase 6 Diagnostics
  encodeTime?: number;
  decodeTime?: number;
  workerTransferTime?: number;
  reactRenderTime?: number;
  chartRenderMs?: { line: number; bar: number; scatter: number; heatmap: number };
}

// ─────────────────────────────────────────────
// Filter State
// ─────────────────────────────────────────────

export interface FilterState {
  categories: string[];
  valueMin: number | null;
  valueMax: number | null;
  timeRange: TimeRange;
  timeRangeDuration: number | null; // ms duration, null = All available
  aggregation: AggregationInterval;
}

export interface TimeRange {
  start: number; // epoch ms
  end: number;   // epoch ms
}

// ─────────────────────────────────────────────
// Data Stream State
// ─────────────────────────────────────────────

export type StreamStatus = "idle" | "running" | "paused" | "stress";

export interface DataStreamConfig {
  intervalMs: number;          // how often new data arrives (default: 100)
  pointsPerBatch: number;      // new points per interval (default: 10)
  windowSize: number;          // max points held in memory (default: 10_000)
  stressMultiplier: number;    // multiplier for stress-test mode (default: 1)
}

// ─────────────────────────────────────────────
// DataProvider Context Shape
// ─────────────────────────────────────────────

export interface DataContextValue {
  // Raw sliding window
  data: DataPoint[];

  // Derived / processed
  filteredData: DataPoint[];
  aggregatedData: AggregatedDataPoint[];

  // Stream controls
  streamStatus: StreamStatus;
  streamConfig: DataStreamConfig;
  startStream: () => void;
  pauseStream: () => void;
  setStreamConfig: (cfg: Partial<DataStreamConfig>) => void;
  enableStressTest: () => void;
  disableStressTest: () => void;

  // Filter / view controls
  filterState: FilterState;
  setFilterState: (fs: Partial<FilterState>) => void;

  // Performance
  metrics: PerformanceMetrics;
  setMetrics: (m: Partial<PerformanceMetrics>) => void;

  // Available categories (derived from data)
  categories: string[];

  // Worker ready flag
  workerReady: boolean;
}

// ─────────────────────────────────────────────
// Web Worker Message Protocol
// ─────────────────────────────────────────────

export type WorkerRequestType =
  | "FILTER"
  | "AGGREGATE"
  | "PROCESS_ALL"
  | "TRANSFORM"
  | "BINARY_PROCESS_ALL";

export type WorkerResponseType =
  | "FILTER_RESULT"
  | "AGGREGATE_RESULT"
  | "PROCESS_ALL_RESULT"
  | "TRANSFORM_RESULT"
  | "BINARY_PROCESS_ALL_RESULT"
  | "ERROR";

export interface WorkerRequest {
  id: string;
  type: WorkerRequestType;
  payload: unknown;
}

export interface WorkerFilterPayload {
  data: DataPoint[];
  filter: FilterState;
}

export interface WorkerAggregatePayload {
  data: DataPoint[];
  interval: AggregationInterval;
  timeRange: TimeRange;
}

export interface WorkerProcessAllPayload {
  data: DataPoint[];
  filter: FilterState;
  interval: AggregationInterval;
  timeRange: TimeRange;
}

export interface WorkerBinaryProcessAllPayload {
  timestamps: Float64Array;
  values: Float64Array;
  categories: Uint8Array;
  filter: FilterState;
  interval: AggregationInterval;
  timeRange: TimeRange;
}

export interface WorkerBinaryProcessAllResult {
  filteredTimestamps: Float64Array;
  filteredValues: Float64Array;
  filteredCategories: Uint8Array;
  aggregated: AggregatedDataPoint[];
}

export interface WorkerResponse {
  id: string;
  type: WorkerResponseType;
  payload: unknown;
  error?: string;
  processingTime: number; // ms
}

// ─────────────────────────────────────────────
// Category Mapping for Binary Encoding
// ─────────────────────────────────────────────

export const CATEGORY_MAP: Record<string, number> = {
  cpu: 0,
  memory: 1,
  network: 2,
  disk: 3,
  latency: 4,
};

export const REVERSE_CATEGORY_MAP: Record<number, string> = {
  0: "cpu",
  1: "memory",
  2: "network",
  3: "disk",
  4: "latency",
};

// ─────────────────────────────────────────────
// API Response Shape (Route Handler)
// ─────────────────────────────────────────────

export interface ApiDataResponse {
  data: DataPoint[];
  meta: {
    count: number;
    generatedAt: number;
    categories: string[];
  };
}

// ─────────────────────────────────────────────
// Heatmap specific
// ─────────────────────────────────────────────

export interface HeatmapCell {
  x: number; // bucket index
  y: number; // category index
  value: number;
  count: number;
}

// ─────────────────────────────────────────────
// Chart render bounds (passed into canvas hooks)
// ─────────────────────────────────────────────

export interface ChartBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewTransform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}
