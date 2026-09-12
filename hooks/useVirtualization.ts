"use client";

/**
 * useVirtualization.ts
 *
 * Virtualization hook for large data tables.
 * Only renders the rows that are visible in the scroll viewport,
 * keeping DOM node count constant regardless of data size.
 *
 * Phase 1: Core math + API — DataTable will use this in Phase 2.
 */

import { useMemo, useRef, useState, useCallback, useEffect } from "react";

export interface UseVirtualizationOptions {
  itemCount: number;
  itemHeight: number;  // px, fixed row height (simplest approach for Phase 1)
  overscan?: number;   // extra rows to render above/below viewport
}

export interface UseVirtualizationResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  totalHeight: number;
  visibleRange: { start: number; end: number };
  offsetY: number;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
}

export function useVirtualization({
  itemCount,
  itemHeight,
  overscan = 5,
}: UseVirtualizationOptions): UseVirtualizationResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement;
    setScrollTop(el.scrollTop);
    if (el.clientHeight > 0 && el.clientHeight !== viewportHeight) {
      setViewportHeight(el.clientHeight);
    }
  }, [viewportHeight]);

  useEffect(() => {
    if (containerRef.current?.clientHeight) {
      setViewportHeight(containerRef.current.clientHeight);
    }
  }, []);

  const { visibleRange, offsetY } = useMemo(() => {
    const start = Math.max(
      0,
      Math.floor(scrollTop / itemHeight) - overscan
    );
    const end = Math.min(
      itemCount - 1,
      Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan
    );

    return {
      visibleRange: { start, end },
      offsetY: start * itemHeight,
    };
  }, [scrollTop, viewportHeight, itemHeight, itemCount, overscan]);

  return {
    containerRef,
    totalHeight: itemCount * itemHeight,
    visibleRange,
    offsetY,
    onScroll,
  };
}
