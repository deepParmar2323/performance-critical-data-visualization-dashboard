"use client";

/**
 * DataProvider.tsx
 *
 * Central data context for the dashboard.
 * Responsibilities:
 *  1. Maintain the sliding data window (raw DataPoint[])
 *  2. Drive the real-time data stream via setInterval
 *  3. Coordinate with the Web Worker for filtering & aggregation
 *  4. Expose controls to pause/resume, configure, and stress-test the stream
 *  5. Expose performance metrics (updated by children via setMetrics)
 *
 * Architecture note:
 *  - Context only stores state that genuinely needs to be shared.
 *  - Charts subscribe to context but only re-render when their slice changes.
 *  - Worker communication is async and non-blocking.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { generateTick, generateInitialData, CATEGORIES } from "@/lib/dataGenerator";
import { generateId } from "@/lib/performanceUtils";
import type {
  DataContextValue,
  DataPoint,
  AggregatedDataPoint,
  DataStreamConfig,
  FilterState,
  PerformanceMetrics,
  StreamStatus,
  WorkerRequest,
  WorkerResponse,
  WorkerBinaryProcessAllResult,
} from "@/lib/types";
import { CATEGORY_MAP, REVERSE_CATEGORY_MAP } from "@/lib/types";

// ─────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────

const DEFAULT_STREAM_CONFIG: DataStreamConfig = {
  intervalMs: 100,
  pointsPerBatch: 2,  // points per category per tick
  windowSize: 10_000,
  stressMultiplier: 1,
};

const DEFAULT_FILTER: FilterState = {
  categories: [...CATEGORIES],
  valueMin: null,
  valueMax: null,
  timeRange: { start: Date.now() - 5 * 60 * 1000, end: Date.now() },
  timeRangeDuration: null,
  aggregation: "raw",
};

const DEFAULT_METRICS: PerformanceMetrics = {
  fps: 0,
  memoryUsage: 0,
  renderTime: 0,
  dataProcessingTime: 0,
  dataPointCount: 0,
  workerJobsDispatched: 0,
  workerJobsSkipped: 0,
};

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────

const DataContext = createContext<DataContextValue | null>(null);

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function DataProvider({ children }: { children: React.ReactNode }) {
  // ── State ──────────────────────────────────
  const [data, setData] = useState<DataPoint[]>(() =>
    generateInitialData(2000, 100)
  );
  const [filteredData, setFilteredData] = useState<DataPoint[]>([]);
  const [aggregatedData, setAggregatedData] = useState<AggregatedDataPoint[]>([]);

  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [streamConfig, setStreamConfigState] =
    useState<DataStreamConfig>(DEFAULT_STREAM_CONFIG);

  const [filterState, setFilterStateRaw] = useState<FilterState>(DEFAULT_FILTER);
  const [metrics, setMetricsRaw] = useState<PerformanceMetrics>({
    ...DEFAULT_METRICS,
    workerJobsDispatched: 0,
    workerJobsSkipped: 0,
  });
  const [workerReady, setWorkerReady] = useState(false);

  // ── Refs (mutable, no re-render) ──────────
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingWorkerRequests = useRef<
    Map<string, (response: WorkerResponse) => void>
  >(new Map());
  
  const dataRef = useRef<DataPoint[]>(data);
  const streamConfigRef = useRef(streamConfig);
  const filterStateRef = useRef(filterState);

  // Phase 3: Latest-Job Management Refs
  const isWorkerBusyRef = useRef(false);
  const nextWorkerJobRef = useRef<{ rawData: DataPoint[]; filter: FilterState } | null>(null);
  const jobsDispatchedRef = useRef(0);
  const jobsSkippedRef = useRef(0);

  useEffect(() => {
    streamConfigRef.current = streamConfig;
  }, [streamConfig]);

  useEffect(() => {
    filterStateRef.current = filterState;
  }, [filterState]);

  // ── Worker initialization ──────────────────

  useEffect(() => {
    // Create the worker
    const worker = new Worker(
      new URL("../../workers/dataProcessor.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const resolve = pendingWorkerRequests.current.get(response.id);
      if (resolve) {
        pendingWorkerRequests.current.delete(response.id);
        resolve(response);
      }
    };

    worker.onerror = (err) => {
      console.error("[DataProcessor Worker] Error:", err);
    };

    workerRef.current = worker;
    Promise.resolve().then(() => {
      setWorkerReady(true);
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // ── Worker dispatch helper ─────────────────

  const dispatchToWorker = useCallback(
    (request: Omit<WorkerRequest, "id">, transfer?: Transferable[]): Promise<WorkerResponse> => {
      return new Promise((resolve) => {
        const id = generateId();
        const fullRequest: WorkerRequest = { ...request, id };
        pendingWorkerRequests.current.set(id, resolve);
        workerRef.current?.postMessage(fullRequest, transfer || []);
      });
    },
    []
  );

  // ── Phase 3: Latest-Job Processing ─────────

  const scheduleWorkerJobRef = useRef<(rawData: DataPoint[], filter: FilterState) => void>(() => {});

  useEffect(() => {
    scheduleWorkerJobRef.current = (rawData: DataPoint[], filter: FilterState) => {
      if (!workerRef.current) return;

      if (isWorkerBusyRef.current) {
        if (nextWorkerJobRef.current) {
          jobsSkippedRef.current++;
        }
        nextWorkerJobRef.current = { rawData, filter };
        return;
      }

      isWorkerBusyRef.current = true;
      jobsDispatchedRef.current++;

      const process = async (data: DataPoint[], flt: FilterState) => {
        const startTotal = performance.now();
        try {
          // 1. Encode Main Thread data to Typed Arrays
          const startEncode = performance.now();
          const len = data.length;
          const timestamps = new Float64Array(len);
          const values = new Float64Array(len);
          const categories = new Uint8Array(len);
          
          for (let i = 0; i < len; i++) {
            const p = data[i];
            timestamps[i] = p.timestamp;
            values[i] = p.value;
            categories[i] = CATEGORY_MAP[p.category] ?? 0;
          }
          const encodeTime = performance.now() - startEncode;

          // 2. Dispatch to worker with transfer array
          const startDispatch = performance.now();
          const response = await dispatchToWorker({
            type: "BINARY_PROCESS_ALL",
            payload: {
              timestamps,
              values,
              categories,
              filter: flt,
              interval: flt.aggregation,
              timeRange: flt.timeRange,
            },
          }, [timestamps.buffer, values.buffer, categories.buffer]);
          const dispatchTime = performance.now() - startDispatch;
          
          let decodeTime = 0;
          let reactRenderStart = 0;

          if (response.type === "BINARY_PROCESS_ALL_RESULT") {
            const startDecode = performance.now();
            const { 
              filteredTimestamps, 
              filteredValues, 
              filteredCategories, 
              aggregated 
            } = response.payload as WorkerBinaryProcessAllResult;
            
            // 3. Decode back to DataPoint[] for UI boundary
            const filteredCount = filteredTimestamps.length;
            const filtered: DataPoint[] = new Array(filteredCount);
            
            for (let i = 0; i < filteredCount; i++) {
              filtered[i] = {
                timestamp: filteredTimestamps[i],
                value: filteredValues[i],
                category: REVERSE_CATEGORY_MAP[filteredCategories[i]] || "unknown",
              };
            }
            decodeTime = performance.now() - startDecode;
            
            reactRenderStart = performance.now();
            setData(data);
            setFilteredData(filtered);
            setAggregatedData(aggregated);
          } else {
            console.error("[Worker BINARY_PROCESS_ALL]", response.error);
          }

          const processingTime = performance.now() - startTotal;
          // React state updates might be synchronous or async, but since we are in async context, they batch.
          // Wait a tick to measure React commit time for this state update.
          setTimeout(() => {
            const reactRenderTime = performance.now() - reactRenderStart;
            setMetricsRaw((prev) => ({
              ...prev,
              dataProcessingTime: parseFloat(processingTime.toFixed(2)),
              dataPointCount: data.length,
              workerJobsDispatched: jobsDispatchedRef.current,
              workerJobsSkipped: jobsSkippedRef.current,
              encodeTime: parseFloat(encodeTime.toFixed(2)),
              decodeTime: parseFloat(decodeTime.toFixed(2)),
              workerTransferTime: parseFloat((dispatchTime - response.processingTime).toFixed(2)),
              reactRenderTime: parseFloat(reactRenderTime.toFixed(2)),
            }));
          }, 0);
        } catch (err) {
          console.error("[processWorkerJob]", err);
        } finally {
          isWorkerBusyRef.current = false;
          const nextJob = nextWorkerJobRef.current;
          if (nextJob) {
            nextWorkerJobRef.current = null;
            scheduleWorkerJobRef.current(nextJob.rawData, nextJob.filter);
          }
        }
      };

      process(rawData, filter);
    };
  }, [dispatchToWorker]);

  const scheduleWorkerJob = useCallback(
    (rawData: DataPoint[], filter: FilterState) => {
      scheduleWorkerJobRef.current(rawData, filter);
    },
    []
  );

  // ── Data stream tick ───────────────────────

  const tick = useCallback(() => {
    const cfg = streamConfigRef.current;
    const now = Date.now();
    const pointsPerCategory = cfg.pointsPerBatch * cfg.stressMultiplier;
    const newPoints = generateTick(now, pointsPerCategory);

    // Append and trim to window size purely in ref
    const prev = dataRef.current;
    const next = [...prev, ...newPoints];
    const trimmed =
      next.length > cfg.windowSize
        ? next.slice(next.length - cfg.windowSize)
        : next;
    
    dataRef.current = trimmed;

    // Auto-update filter timeRange to 'now' since we're streaming
    const currentFilter = { ...filterStateRef.current };
    if (intervalRef.current) {
      currentFilter.timeRange = {
        start: currentFilter.timeRangeDuration ? now - currentFilter.timeRangeDuration : currentFilter.timeRange.start,
        end: now,
      };
    }

    scheduleWorkerJob(trimmed, currentFilter);
  }, [scheduleWorkerJob]);

  // ── Stream controls ────────────────────────

  const startStream = useCallback(() => {
    if (intervalRef.current) return; // already running
    setStreamStatus("running");
    intervalRef.current = setInterval(tick, streamConfigRef.current.intervalMs);
  }, [tick]);

  const pauseStream = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStreamStatus("paused");
  }, []);

  const setStreamConfig = useCallback(
    (cfg: Partial<DataStreamConfig>) => {
      setStreamConfigState((prev) => {
        const next = { ...prev, ...cfg };
        streamConfigRef.current = next;

        // Restart interval if running with new interval
        if (intervalRef.current && cfg.intervalMs !== undefined) {
          clearInterval(intervalRef.current);
          intervalRef.current = setInterval(tick, next.intervalMs);
        }

        return next;
      });
    },
    [tick]
  );

  const enableStressTest = useCallback(() => {
    setStreamConfig({ stressMultiplier: 5, pointsPerBatch: 10 });
    setStreamStatus("stress");
  }, [setStreamConfig]);

  const disableStressTest = useCallback(() => {
    setStreamConfig({ stressMultiplier: 1, pointsPerBatch: 2 });
    setStreamStatus(intervalRef.current ? "running" : "paused");
  }, [setStreamConfig]);

  // ── Filter state update ────────────────────

  const setFilterState = useCallback((fs: Partial<FilterState>) => {
    setFilterStateRaw((prev) => {
      const next = { ...prev, ...fs };
      filterStateRef.current = next;
      return next;
    });
  }, []);

  // ── Metrics update ─────────────────────────

  const setMetrics = useCallback((m: Partial<PerformanceMetrics>) => {
    setMetricsRaw((prev) => ({ ...prev, ...m }));
  }, []);

  // ── Effect: process when filter/status changes ─

  useEffect(() => {
    if (!workerReady) return;

    // We do NOT depend on `data` state here anymore.
    // React state updates for `data` are now synchronized with worker completion.
    const filter = { ...filterState };
    if (streamStatus === "running" || streamStatus === "stress") {
      filter.timeRange = {
        start: filter.timeRangeDuration ? Date.now() - filter.timeRangeDuration : filter.timeRange.start,
        end: Date.now(),
      };
    }

    scheduleWorkerJob(dataRef.current, filter);
  }, [filterState, workerReady, streamStatus, scheduleWorkerJob]);

  // ── Cleanup on unmount ────────────────────

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ── Derived: available categories ─────────

  const categories = useMemo(() => [...CATEGORIES], []);

  // ── Context value (memoized to prevent unnecessary re-renders) ──

  const contextValue = useMemo<DataContextValue>(
    () => ({
      data,
      filteredData,
      aggregatedData,
      streamStatus,
      streamConfig,
      startStream,
      pauseStream,
      setStreamConfig,
      enableStressTest,
      disableStressTest,
      filterState,
      setFilterState,
      metrics,
      setMetrics,
      categories,
      workerReady,
    }),
    [
      data,
      filteredData,
      aggregatedData,
      streamStatus,
      streamConfig,
      startStream,
      pauseStream,
      setStreamConfig,
      enableStressTest,
      disableStressTest,
      filterState,
      setFilterState,
      metrics,
      setMetrics,
      categories,
      workerReady,
    ]
  );

  return (
    <DataContext.Provider value={contextValue}>{children}</DataContext.Provider>
  );
}

// ─────────────────────────────────────────────
// Consumer hook
// ─────────────────────────────────────────────

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error("useData must be used within a <DataProvider>");
  }
  return ctx;
}
