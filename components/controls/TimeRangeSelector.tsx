"use client";

import React, { memo } from "react";
import { useData } from "@/components/providers/DataProvider";
import styles from "./controls.module.css";

const DURATIONS = [
  { label: "1 Min", value: 1 * 60 * 1000 },
  { label: "5 Min", value: 5 * 60 * 1000 },
  { label: "1 Hour", value: 60 * 60 * 1000 },
  { label: "6 Hours", value: 6 * 60 * 60 * 1000 },
  { label: "All", value: null }, // null means all available
];

export const TimeRangeSelector = memo(function TimeRangeSelector() {
  const { filterState, setFilterState } = useData();
  const activeDuration = filterState.timeRangeDuration;

  const handleSelect = (durationMs: number | null) => {
    setFilterState({ timeRangeDuration: durationMs });
  };

  return (
    <div className={styles.controlGroup}>
      <h3>Time Range</h3>
      <div className={styles.buttonRow}>
        {DURATIONS.map((dur) => {
          const isActive = activeDuration === dur.value;
          return (
            <button
              key={dur.label}
              className={`${styles.btn} ${isActive ? styles.active : ""}`}
              onClick={() => handleSelect(dur.value)}
            >
              {dur.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
