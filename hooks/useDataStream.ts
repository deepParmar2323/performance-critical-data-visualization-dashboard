"use client";

/**
 * useDataStream.ts
 *
 * Hook for components that want to subscribe to the live data stream
 * without pulling the entire DataContext. Provides a thin selector API
 * to minimize unnecessary re-renders.
 *
 * Phase 1: Thin wrapper around useData().
 * Phase 2+: Add subscription filtering, sampling, etc.
 */

import { useMemo } from "react";
import { useData } from "@/components/providers/DataProvider";
import type { DataPoint } from "@/lib/types";

export interface UseDataStreamOptions {
  /** If provided, only return points for these categories. */
  categories?: string[];
  /** Maximum number of most-recent points to return. */
  limit?: number;
}

export interface UseDataStreamResult {
  data: DataPoint[];
  isLive: boolean;
  pointCount: number;
}

export function useDataStream(
  options: UseDataStreamOptions = {}
): UseDataStreamResult {
  const { filteredData, streamStatus } = useData();
  const { categories, limit } = options;

  const data = useMemo(() => {
    let result = filteredData;

    if (categories && categories.length > 0) {
      const catSet = new Set(categories);
      result = result.filter((p) => catSet.has(p.category));
    }

    if (limit && result.length > limit) {
      result = result.slice(result.length - limit);
    }

    return result;
  }, [filteredData, categories, limit]);

  return {
    data,
    isLive: streamStatus === "running" || streamStatus === "stress",
    pointCount: data.length,
  };
}
