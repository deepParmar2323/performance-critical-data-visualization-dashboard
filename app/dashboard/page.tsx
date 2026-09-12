"use client";

/**
 * app/dashboard/page.tsx — Dashboard shell (Client Component)
 *
 * This is the main dashboard page. At this stage it is a shell that:
 *  1. Connects to the DataProvider context
 *  2. Shows stream controls (start/pause/stress-test)
 *  3. Displays basic status metrics
 *  4. Renders placeholder areas where charts will go in subsequent phases
 *
 * Chart components, FilterPanel, PerformanceMonitor, and DataTable
 * will be added in Phase 2 once the base compiles and runs correctly.
 */

import { useEffect, useRef } from "react";
import { useData } from "@/components/providers/DataProvider";
import { PerformanceMonitor } from "@/components/ui/PerformanceMonitor";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { Heatmap } from "@/components/charts/Heatmap";
import { FilterPanel } from "@/components/controls/FilterPanel";
import { TimeRangeSelector } from "@/components/controls/TimeRangeSelector";
import { AggregationControl } from "@/components/controls/AggregationControl";
import { DataTable } from "@/components/ui/DataTable";
import controlStyles from "@/components/controls/controls.module.css";
import styles from "./page.module.css";

// ── Sub-components (inline for Phase 1 shell) ──────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    idle:    "#4a5068",
    running: "#34d399",
    paused:  "#fbbf24",
    stress:  "#f87171",
  };
  const color = colorMap[status] ?? "#4a5068";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {status === "running" || status === "stress" ? (
        <span className="live-indicator__dot" style={{ background: color }} />
      ) : (
        <span
          style={{ width: 8, height: 8, borderRadius: "50%", background: color }}
        />
      )}
      {status}
    </span>
  );
}

function MetricCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className={styles.metricCard}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>
        {value}
        {unit && <span className={styles.metricUnit}>{unit}</span>}
      </span>
    </div>
  );
}


// ── Main Page ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const {
    data,
    filteredData,
    streamStatus,
    streamConfig,
    metrics,
    workerReady,
    startStream,
    pauseStream,
    enableStressTest,
    disableStressTest,
    setStreamConfig,
  } = useData();

  const isRunning = streamStatus === "running" || streamStatus === "stress";
  const isStress  = streamStatus === "stress";

  // Diagnostic tracking
  const renderCountRef = useRef(0);
  useEffect(() => {
    renderCountRef.current++;
    if (typeof window !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__DASHBOARD_RENDER_COUNT__ = renderCountRef.current;
    }
  });
  return (
    <div className={styles.page}>
      {/* Performance tracking (headless — updates metrics in context) */}
      <PerformanceMonitor />
      {/* ── Header ─────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Performance Dashboard</h1>
          <StatusBadge status={streamStatus} />
          {!workerReady && (
            <span style={{ fontSize: 12, color: "#fbbf24" }}>
              ⚙ Worker initializing…
            </span>
          )}
        </div>

        <div className={styles.headerRight}>
          {/* Data load controls */}
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>Points/batch:</span>
            <button
              className="btn btn--secondary"
              onClick={() =>
                setStreamConfig({
                  pointsPerBatch: Math.max(1, streamConfig.pointsPerBatch - 1),
                })
              }
              aria-label="Decrease load"
            >
              −
            </button>
            <span className={styles.controlValue}>
              {streamConfig.pointsPerBatch}
            </span>
            <button
              className="btn btn--secondary"
              onClick={() =>
                setStreamConfig({
                  pointsPerBatch: Math.min(20, streamConfig.pointsPerBatch + 1),
                })
              }
              aria-label="Increase load"
            >
              +
            </button>
          </div>

          {/* Stress test */}
          <button
            className={`btn ${isStress ? "btn--danger" : "btn--secondary"}`}
            onClick={isStress ? disableStressTest : enableStressTest}
            id="stress-test-btn"
          >
            {isStress ? "⚡ Stress ON" : "⚡ Stress Test"}
          </button>

          {/* Start / Pause */}
          <button
            className={`btn ${isRunning ? "btn--secondary" : "btn--success"}`}
            onClick={isRunning ? pauseStream : startStream}
            disabled={!workerReady}
            id="stream-toggle-btn"
          >
            {isRunning ? "⏸ Pause" : "▶ Start Stream"}
          </button>
        </div>
      </header>

      {/* ── Quick metrics bar ───────────────── */}
      <div className={styles.metricsBar}>
        <MetricCard label="Data Points" value={data.length.toLocaleString()} />
        <MetricCard label="Filtered" value={filteredData.length.toLocaleString()} />
        <MetricCard label="FPS" value={metrics.fps} />
        <MetricCard
          label="Memory"
          value={metrics.memoryUsage > 0 ? metrics.memoryUsage : "N/A"}
          unit={metrics.memoryUsage > 0 ? " MB" : ""}
        />
        <MetricCard
          label="Render"
          value={metrics.renderTime.toFixed(1)}
          unit=" ms"
        />
        <MetricCard
          label="Processing"
          value={metrics.dataProcessingTime.toFixed(1)}
          unit=" ms"
        />
        <MetricCard
          label="Jobs Sent"
          value={metrics.workerJobsDispatched.toLocaleString()}
        />
        <MetricCard
          label="Skipped"
          value={metrics.workerJobsSkipped.toLocaleString()}
        />
        <MetricCard
          label="Interval"
          value={streamConfig.intervalMs}
          unit=" ms"
        />
        <MetricCard
          label="Window"
          value={streamConfig.windowSize.toLocaleString()}
        />
      </div>

      {/* ── Phase 6 Diagnostics Panel ──────────────── */}
      <div style={{ background: "#1e1e1e", padding: "10px", marginTop: "10px", fontSize: "12px", border: "1px solid #333", color: "#ccc", display: "flex", gap: "20px" }}>
        <div><strong>Worker/Main:</strong><br/>
          Encode: {metrics.encodeTime ?? 0}ms<br/>
          Decode: {metrics.decodeTime ?? 0}ms<br/>
          Transfer (RT): {metrics.workerTransferTime ?? 0}ms<br/>
          Total Process: {metrics.dataProcessingTime ?? 0}ms
        </div>
        <div><strong>React:</strong><br/>
          Dash Renders: {metrics.reactRenderTime ?? 0}
        </div>
        <div><strong>Canvas rAF (ms):</strong><br/>
          Combined Render: {metrics.renderTime.toFixed(2)}
        </div>
      </div>

      {/* ── Filter Controls Row ──────────────── */}
      <div className={controlStyles.controlsRow}>
        <FilterPanel />
        <TimeRangeSelector />
        <AggregationControl />
      </div>

      {/* ── Chart grid ─────────────────────── */}
      <main className={styles.chartGrid}>
        <div className={styles.chartCell} style={{ gridColumn: "1 / -1", minHeight: 340 }}>
          <LineChart />
        </div>
        <div className={styles.chartCell} style={{ minHeight: 290 }}>
          <BarChart />
        </div>
        <div className={styles.chartCell} style={{ minHeight: 290 }}>
          <ScatterPlot />
        </div>
        <div className={styles.chartCell} style={{ gridColumn: "1 / -1", minHeight: 250 }}>
          <Heatmap />
        </div>
      </main>

      {/* ── Virtualized DataTable ──────────────── */}
      <div style={{ marginTop: 16 }}>
        <DataTable />
      </div>

      {/* ── Footer ─────────────────────────── */}
      <footer className={styles.footer}>
        <span>
          Worker:{" "}
          <strong style={{ color: workerReady ? "#34d399" : "#fbbf24" }}>
            {workerReady ? "ready" : "initializing"}
          </strong>
        </span>
        <span>•</span>
        <span>
          Window size:{" "}
          <strong>{streamConfig.windowSize.toLocaleString()} pts</strong>
        </span>
        <span>•</span>
        <span>
          Stress multiplier: <strong>×{streamConfig.stressMultiplier}</strong>
        </span>
      </footer>
    </div>
  );
}
