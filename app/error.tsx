"use client";

/**
 * app/error.tsx — Root error boundary (Client Component)
 * Required to be a Client Component by Next.js.
 */

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to monitoring in production
    console.error("[Dashboard Error]", error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: "16px",
        background: "#0a0c10",
        color: "#e8eaf0",
        fontFamily: "Inter, system-ui, sans-serif",
        textAlign: "center",
        padding: "24px",
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "#f87171" }}>
        Something went wrong
      </h1>
      <p style={{ fontSize: 14, color: "#8b92a8", maxWidth: 480 }}>
        {error.message || "An unexpected error occurred in the dashboard."}
      </p>
      {error.digest && (
        <code
          style={{
            fontSize: 11,
            color: "#4a5068",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          Error ID: {error.digest}
        </code>
      )}
      <button
        onClick={reset}
        style={{
          marginTop: 16,
          padding: "8px 20px",
          background: "#3b82f6",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        Try again
      </button>
    </div>
  );
}
