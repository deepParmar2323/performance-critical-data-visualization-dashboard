# Performance Dashboard — R&D Assignment

A production-quality real-time analytics dashboard built as an R&D performance engineering exercise. It visualizes high-frequency data streams at 60 FPS using a custom Canvas engine, Web Worker off-thread processing, and TypedArray binary transfers.

## Screenshots

![Full Dashboard](/dashboard_10k_points_1789244825076.png)
*Full Dashboard operating under 10,000 points stress mode*

![Aggregated Table](/aggregated_table_1789244999258.png)
*Virtualized Data Table in 1-minute aggregation mode*

## Setup

```bash
npm install
npm run dev
```

## Production

```bash
npm run build
npm run start
```

## Performance Testing

To evaluate the dashboard under maximum stress, follow these steps:

1. Start the production build (`npm run start`).
2. Open `http://localhost:3000/dashboard` in a modern browser.
3. Click **▶ Start Stream** to begin the live data generation.
4. Click **⚡ Stress Test** to increase the data rate.
5. Wait ~10 seconds until the data point count reaches **10,000**.
6. **Observe FPS & Memory**: Check the Diagnostics Panel and the top metric cards. You should see a stable 58-60 FPS and stable memory usage (~30-50MB) with no UI freezing.
7. **Test Filtering**: In the "Categories" control row, click any category to deselect it. Notice the instant chart update.
8. **Test Time Range**: Select "1 Min" in the Time Range selector to filter points to the last 60 seconds.
9. **Test Aggregation**: Select "1m" in the Aggregation control. 
10. **Test Virtualized Table**: Scroll down to the Data Table. In raw mode, it instantly renders only the visible rows out of up to 10,000 records. In aggregated mode, it displays statistical buckets.

## Browser Compatibility

- **Web Workers**: Required for off-thread processing.
- **Canvas API**: Required for rendering charts.
- **ResizeObserver**: Required for responsive chart scaling.
- **requestAnimationFrame**: Required for the rendering loop.
- Supports all modern browsers (Chrome 80+, Firefox 75+, Safari 13.1+, Edge 80+).

## Next.js Architecture

- **App Router**: Uses Next.js 14+ `app/` directory exclusively.
- **Server/Client Components**: Strictly splits static server shell elements and dynamic `"use client"` interactive elements.
- **Web Worker**: Leverages a dedicated Web Worker (`dataProcessor.worker.ts`) to keep heavy filtering and aggregation off the main UI thread.
- **Transferable Buffers**: Employs `Float64Array` and `Uint8Array` in the worker messaging protocol. ArrayBuffers are transferred via zero-copy `postMessage`, completely avoiding the `structuredClone` bottleneck.
- **Canvas/SVG Hybrid**: Uses `CanvasRenderingContext2D` for dense data paths and `SVG` for lightweight hover overlays (tooltips, crosshairs).
- **Dirty Rendering**: Implements a custom `isDirtyRef` `requestAnimationFrame` loop that only executes redraws when the visual state has actually changed.
- **Virtualization**: Uses absolute positioning and math to only render the exact ~15 DOM row elements currently visible in the scroll viewport.

## Project Structure

```
performance-dashboard/
├── app/
│   ├── dashboard/
│   │   ├── page.tsx          # Main dashboard (Client Component)
│   │   └── layout.tsx        # Wraps DataProvider
│   ├── api/data/route.ts     # Server-side data API
│   ├── globals.css           # Design system
│   ├── loading.tsx           # Root loading UI
│   ├── error.tsx             # Root error boundary
│   └── layout.tsx            # Root layout + metadata
├── components/
│   ├── charts/               # Canvas chart components
│   ├── controls/             # Filter/time-range controls
│   ├── ui/                   # DataTable, PerformanceMonitor
│   └── providers/DataProvider.tsx   # Central data context
├── hooks/
│   ├── useDataStream.ts      # Filtered data subscription
│   ├── useChartRenderer.ts   # rAF-based canvas loop
│   ├── usePerformanceMonitor.ts  # FPS + memory tracking
│   └── useVirtualization.ts  # Virtual scroll math
├── lib/
│   ├── types.ts              # All TypeScript interfaces
│   ├── dataGenerator.ts      # Seeded PRNG data generation
│   ├── performanceUtils.ts   # FPS, memory, debounce/throttle
│   └── canvasUtils.ts        # Canvas helpers + LTTB downsampling
└── workers/
    └── dataProcessor.worker.ts  # Filter + aggregate off-thread
```
