/**
 * dataProcessor.worker.ts
 *
 * Web Worker for CPU-intensive data operations.
 * Runs in a separate thread to keep the UI thread free.
 *
 * Supported operations:
 *  - FILTER  : filter DataPoint[] by category, value range, time range
 *  - AGGREGATE : aggregate DataPoint[] into AggregatedDataPoint[]
 *  - TRANSFORM : (reserved for future transformations)
 */

import type {
  WorkerRequest,
  WorkerResponse,
  WorkerFilterPayload,
  WorkerAggregatePayload,
  WorkerProcessAllPayload,
  WorkerBinaryProcessAllPayload,
  WorkerBinaryProcessAllResult,
  DataPoint,
  AggregatedDataPoint,
  AggregationInterval,
} from "../lib/types";

import { CATEGORY_MAP, REVERSE_CATEGORY_MAP } from "../lib/types";

// ─────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────

self.onmessage = function (event: MessageEvent<WorkerRequest>) {
  const { id, type, payload } = event.data;
  const start = performance.now();

  try {
    let result: unknown;
    let transferList: Transferable[] = [];

    switch (type) {
      case "FILTER":
        result = handleFilter(payload as WorkerFilterPayload);
        break;
      case "AGGREGATE":
        result = handleAggregate(payload as WorkerAggregatePayload);
        break;
      case "PROCESS_ALL":
        result = handleProcessAll(payload as WorkerProcessAllPayload);
        break;
      case "BINARY_PROCESS_ALL": {
        const { result: binResult, transfer } = handleBinaryProcessAll(payload as WorkerBinaryProcessAllPayload);
        result = binResult;
        transferList = transfer;
        break;
      }
      case "TRANSFORM":
        // Passthrough for now — extend as needed
        result = payload;
        break;
      default:
        throw new Error(`Unknown worker message type: ${type}`);
    }

    const processingTime = performance.now() - start;

    const response: WorkerResponse = {
      id,
      type: `${type}_RESULT` as WorkerResponse["type"],
      payload: result,
      processingTime,
    };

    if (transferList.length > 0) {
      // TypeScript treats self as Window, so we cast to avoid targetOrigin error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (self as any).postMessage(response, transferList);
    } else {
      self.postMessage(response);
    }
  } catch (err) {
    const response: WorkerResponse = {
      id,
      type: "ERROR",
      payload: null,
      error: err instanceof Error ? err.message : String(err),
      processingTime: performance.now() - start,
    };
    self.postMessage(response);
  }
};

// ─────────────────────────────────────────────
// FILTER handler
// ─────────────────────────────────────────────

function handleFilter(payload: WorkerFilterPayload): DataPoint[] {
  const { data, filter } = payload;
  const { categories, valueMin, valueMax, timeRange } = filter;

  const catSet = new Set(categories);
  const filtered: DataPoint[] = [];

  for (let i = 0; i < data.length; i++) {
    const point = data[i];

    if (catSet.size > 0 && !catSet.has(point.category)) continue;
    if (point.timestamp < timeRange.start) continue;
    if (point.timestamp > timeRange.end) continue;
    if (valueMin !== null && point.value < valueMin) continue;
    if (valueMax !== null && point.value > valueMax) continue;

    filtered.push(point);
  }

  return filtered;
}

// ─────────────────────────────────────────────
// AGGREGATE handler
// ─────────────────────────────────────────────

function getBucketMs(interval: AggregationInterval): number {
  switch (interval) {
    case "1m":  return 60_000;
    case "5m":  return 5 * 60_000;
    case "1h":  return 60 * 60_000;
    case "raw": return 0;
  }
}

function handleAggregate(payload: WorkerAggregatePayload): AggregatedDataPoint[] {
  const { data, interval, timeRange } = payload;

  if (interval === "raw" || data.length === 0) {
    // No aggregation — convert to AggregatedDataPoint format
    return data.map((p) => ({
      timestamp: p.timestamp,
      min: p.value,
      max: p.value,
      avg: p.value,
      count: 1,
      category: p.category,
    }));
  }

  const bucketMs = getBucketMs(interval);

  // Group by (bucket, category)
  const buckets = new Map<string, {
    sumValue: number;
    minValue: number;
    maxValue: number;
    count: number;
    bucket: number;
    category: string;
  }>();

  for (let i = 0; i < data.length; i++) {
    const point = data[i];
    if (point.timestamp < timeRange.start || point.timestamp > timeRange.end) continue;

    const bucket = Math.floor(point.timestamp / bucketMs) * bucketMs;
    const key = `${bucket}_${point.category}`;

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        sumValue: point.value,
        minValue: point.value,
        maxValue: point.value,
        count: 1,
        bucket,
        category: point.category,
      });
    } else {
      existing.sumValue += point.value;
      if (point.value < existing.minValue) existing.minValue = point.value;
      if (point.value > existing.maxValue) existing.maxValue = point.value;
      existing.count++;
    }
  }

  const result: AggregatedDataPoint[] = [];
  buckets.forEach((entry) => {
    result.push({
      timestamp: entry.bucket,
      min: parseFloat(entry.minValue.toFixed(3)),
      max: parseFloat(entry.maxValue.toFixed(3)),
      avg: parseFloat((entry.sumValue / entry.count).toFixed(3)),
      count: entry.count,
      category: entry.category,
    });
  });

  // Sort by timestamp
  result.sort((a, b) => a.timestamp - b.timestamp);
  return result;
}

// ─────────────────────────────────────────────
// PROCESS_ALL handler
// ─────────────────────────────────────────────

function handleProcessAll(payload: WorkerProcessAllPayload): { filtered: DataPoint[], aggregated: AggregatedDataPoint[] } {
  const { data, filter, interval, timeRange } = payload;
  const filtered = handleFilter({ data, filter });
  const aggregated = handleAggregate({ data: filtered, interval, timeRange });
  return { filtered, aggregated };
}

// ─────────────────────────────────────────────
// BINARY_PROCESS_ALL handler
// ─────────────────────────────────────────────

function handleBinaryProcessAll(payload: WorkerBinaryProcessAllPayload): { result: WorkerBinaryProcessAllResult, transfer: Transferable[] } {
  const { timestamps, values, categories, filter, interval, timeRange } = payload;
  const len = timestamps.length;
  
  // 1. Filter Pass
  const allowedCategories = new Set(filter.categories.map(c => CATEGORY_MAP[c] ?? -1));
  const filterCat = allowedCategories.size > 0;
  
  // We don't know the filtered length yet, so we could either:
  // a) use an array of indices, then allocate exact TypedArrays
  // b) allocate max-size TypedArrays, then slice (or transfer a subarray)
  // Indices array is very fast and avoids two full-size allocations.
  const indices = new Int32Array(len);
  let matchedCount = 0;
  
  for (let i = 0; i < len; i++) {
    const ts = timestamps[i];
    const val = values[i];
    const cat = categories[i];
    
    if (filterCat && !allowedCategories.has(cat)) continue;
    if (ts < timeRange.start) continue;
    if (ts > timeRange.end) continue;
    if (filter.valueMin !== null && val < filter.valueMin) continue;
    if (filter.valueMax !== null && val > filter.valueMax) continue;
    
    indices[matchedCount++] = i;
  }
  
  // Create precisely sized TypedArrays for the result
  const filteredTimestamps = new Float64Array(matchedCount);
  const filteredValues = new Float64Array(matchedCount);
  const filteredCategories = new Uint8Array(matchedCount);
  
  for (let i = 0; i < matchedCount; i++) {
    const originalIdx = indices[i];
    filteredTimestamps[i] = timestamps[originalIdx];
    filteredValues[i] = values[originalIdx];
    filteredCategories[i] = categories[originalIdx];
  }

  // 2. Aggregation Pass (directly on the filtered TypedArrays)
  let aggregated: AggregatedDataPoint[] = [];
  
  if (interval === "raw" || matchedCount === 0) {
    // Return objects for the raw aggregation
    aggregated = new Array(matchedCount);
    for (let i = 0; i < matchedCount; i++) {
      const ts = filteredTimestamps[i];
      const val = filteredValues[i];
      const catStr = REVERSE_CATEGORY_MAP[filteredCategories[i]] || "unknown";
      aggregated[i] = {
        timestamp: ts,
        min: val,
        max: val,
        avg: val,
        count: 1,
        category: catStr,
      };
    }
  } else {
    const bucketMs = getBucketMs(interval);
    const buckets = new Map<string, {
      sumValue: number;
      minValue: number;
      maxValue: number;
      count: number;
      bucket: number;
      category: string;
    }>();
    
    for (let i = 0; i < matchedCount; i++) {
      const ts = filteredTimestamps[i];
      // Time range filter is already applied during the first pass, 
      // but we should check timeRange just in case, though it's redundant.
      
      const val = filteredValues[i];
      const catStr = REVERSE_CATEGORY_MAP[filteredCategories[i]] || "unknown";
      
      const bucket = Math.floor(ts / bucketMs) * bucketMs;
      const key = `${bucket}_${catStr}`;
      
      const existing = buckets.get(key);
      if (!existing) {
        buckets.set(key, {
          sumValue: val,
          minValue: val,
          maxValue: val,
          count: 1,
          bucket,
          category: catStr,
        });
      } else {
        existing.sumValue += val;
        if (val < existing.minValue) existing.minValue = val;
        if (val > existing.maxValue) existing.maxValue = val;
        existing.count++;
      }
    }
    
    buckets.forEach((entry) => {
      aggregated.push({
        timestamp: entry.bucket,
        min: parseFloat(entry.minValue.toFixed(3)),
        max: parseFloat(entry.maxValue.toFixed(3)),
        avg: parseFloat((entry.sumValue / entry.count).toFixed(3)),
        count: entry.count,
        category: entry.category,
      });
    });
    
    aggregated.sort((a, b) => a.timestamp - b.timestamp);
  }

  return {
    result: {
      filteredTimestamps,
      filteredValues,
      filteredCategories,
      aggregated,
    },
    transfer: [
      filteredTimestamps.buffer,
      filteredValues.buffer,
      filteredCategories.buffer,
    ]
  };
}
