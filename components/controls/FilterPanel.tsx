"use client";

import React, { memo } from "react";
import { useData } from "@/components/providers/DataProvider";
import { CATEGORIES } from "@/lib/dataGenerator";
import { getColorForCategory } from "@/lib/canvasUtils";
import styles from "./controls.module.css";

export const FilterPanel = memo(function FilterPanel() {
  const { filterState, setFilterState } = useData();

  const handleToggleCategory = (cat: string) => {
    const current = filterState.categories;
    if (current.includes(cat)) {
      setFilterState({ categories: current.filter((c) => c !== cat) });
    } else {
      setFilterState({ categories: [...current, cat] });
    }
  };

  const handleSelectAll = () => {
    setFilterState({ categories: [...CATEGORIES] });
  };

  const handleClear = () => {
    setFilterState({ categories: [] });
  };

  return (
    <div className={styles.controlGroup}>
      <h3>Categories</h3>
      <div className={styles.buttonRow}>
        {CATEGORIES.map((cat) => {
          const isActive = filterState.categories.includes(cat);
          return (
            <button
              key={cat}
              className={`${styles.btn} ${isActive ? styles.activeCategory : ""}`}
              style={{ color: isActive ? getColorForCategory(cat) : undefined }}
              onClick={() => handleToggleCategory(cat)}
            >
              {cat.toUpperCase()}
            </button>
          );
        })}
        <div style={{ width: "8px" }} />
        <button className={styles.btn} onClick={handleSelectAll}>
          All
        </button>
        <button className={`${styles.btn} ${styles.clearBtn}`} onClick={handleClear}>
          None
        </button>
      </div>
    </div>
  );
});
