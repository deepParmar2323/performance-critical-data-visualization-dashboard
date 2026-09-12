"use client";

import React, { memo } from "react";
import { useData } from "@/components/providers/DataProvider";
import type { AggregationInterval } from "@/lib/types";
import styles from "./controls.module.css";

const INTERVALS: { label: string; value: AggregationInterval }[] = [
  { label: "Raw", value: "raw" },
  { label: "1 Min", value: "1m" },
  { label: "5 Min", value: "5m" },
  { label: "1 Hour", value: "1h" },
];

export const AggregationControl = memo(function AggregationControl() {
  const { filterState, setFilterState } = useData();

  return (
    <div className={styles.controlGroup}>
      <h3>Aggregation</h3>
      <div className={styles.buttonRow}>
        {INTERVALS.map((int) => {
          const isActive = filterState.aggregation === int.value;
          return (
            <button
              key={int.value}
              className={`${styles.btn} ${isActive ? styles.active : ""}`}
              onClick={() => setFilterState({ aggregation: int.value })}
            >
              {int.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
