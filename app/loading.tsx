/**
 * app/loading.tsx — Root loading UI (Server Component)
 * Shown by Next.js while the root page is loading.
 */
export default function Loading() {
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
        color: "#8b92a8",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div className="spinner" />
      <p style={{ fontSize: 14 }}>Loading Performance Dashboard…</p>
    </div>
  );
}
