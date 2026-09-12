"use client";

import React, { memo } from "react";
import { useData } from "@/components/providers/DataProvider";
import { useVirtualization } from "@/hooks/useVirtualization";
import { getColorForCategory } from "@/lib/canvasUtils";
import styles from "./DataTable.module.css";

const ROW_HEIGHT = 32;
const OVERSCAN = 10;

export const DataTable = memo(function DataTable() {
  const { filterState, filteredData, aggregatedData } = useData();

  const isAggregated = filterState.aggregation !== "raw";
  const displayData = isAggregated ? aggregatedData : filteredData;
  const itemCount = displayData.length;

  const {
    containerRef,
    totalHeight,
    visibleRange,
    offsetY,
    onScroll,
  } = useVirtualization({
    itemCount,
    itemHeight: ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Calculate the subset of data to render
  const visibleRows = [];
  for (let i = visibleRange.start; i <= visibleRange.end; i++) {
    if (i < itemCount) {
      visibleRows.push({ index: i, item: displayData[i] });
    }
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString() + "." + String(d.getMilliseconds()).padStart(3, "0");
  };

  return (
    <div
      className={styles.container}
      ref={containerRef}
      onScroll={onScroll}
    >
      <div className={styles.scrollInner} style={{ height: totalHeight }}>
        <table
          className={styles.table}
          style={{ transform: `translateY(${offsetY}px)` }}
        >
          <thead className={styles.header}>
            <tr>
              <th className={styles.th} style={{ width: 80 }}>#</th>
              <th className={styles.th} style={{ width: 140 }}>Timestamp</th>
              <th className={styles.th} style={{ width: 120 }}>Category</th>
              {isAggregated ? (
                <>
                  <th className={styles.th}>Avg</th>
                  <th className={styles.th}>Min</th>
                  <th className={styles.th}>Max</th>
                  <th className={styles.th}>Count</th>
                </>
              ) : (
                <>
                  <th className={styles.th}>Value</th>
                  <th className={styles.th}>Status</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={isAggregated ? 7 : 5} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
                  No matching data
                </td>
              </tr>
            ) : (
              visibleRows.map(({ index, item }) => (
                <tr
                  key={item.timestamp + "-" + item.category + "-" + index}
                  className={styles.row}
                  style={{ height: ROW_HEIGHT }}
                >
                  <td className={styles.td} style={{ color: "var(--text-muted)" }}>
                    {index + 1}
                  </td>
                  <td className={styles.td}>{formatTime(item.timestamp)}</td>
                  <td className={styles.td}>
                    <span
                      className={styles.categoryDot}
                      style={{ backgroundColor: getColorForCategory(item.category) }}
                    />
                    {item.category.toUpperCase()}
                  </td>
                  {isAggregated ? (
                    <>
                      <td className={styles.td}>{"avg" in item ? item.avg.toFixed(2) : "-"}</td>
                      <td className={styles.td}>{"min" in item ? item.min.toFixed(2) : "-"}</td>
                      <td className={styles.td}>{"max" in item ? item.max.toFixed(2) : "-"}</td>
                      <td className={styles.td}>{"count" in item ? item.count : "-"}</td>
                    </>
                  ) : (
                    <>
                      <td className={styles.td}>{"value" in item ? item.value.toFixed(2) : "-"}</td>
                      <td className={styles.td}>
                        <span className={styles.badge}>OK</span>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});
