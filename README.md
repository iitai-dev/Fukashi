# Fukashi

**Lightweight virtualized masonry for React — no scroll-parent discovery, persistent layout cache, headless engine.**

[![npm](https://img.shields.io/npm/v/fukashi)](https://www.npmjs.com/package/fukashi)
[![bundle size](https://img.shields.io/bundlephobia/minzip/fukashi)](https://bundlephobia.com/package/fukashi)
[![license](https://img.shields.io/npm/l/fukashi)](./LICENSE)

Fukashi is a deterministic masonry layout engine with a thin React adapter. It places rectangles in columns, tracks which ones are visible, and gets out of the way. No image loader, no drag system, no CSS framework, no opinions about what you're rendering.

## Why Fukashi?

Most masonry libraries either skip virtualization entirely or bundle a heavy runtime with scroll-parent discovery, per-item resize observers, and built-in components you have to work around.

Fukashi takes a different approach:

- **Scroll-container agnostic.** Uses `getBoundingClientRect()` on the grid root to derive viewport position. Works inside any scroll container, Tauri webviews, or nested layouts — no ref to a scroll parent, no scroll-parent traversal.
- **Layout persistence.** Optional `LayoutCache` serializes computed positions to `localStorage` with TTL, version invalidation, and partial prefix reuse. Revisiting a 10,000-item grid skips layout entirely on cache hit. No other masonry library does this.
- **Headless engine.** The layout engine is a pure function — no React, no DOM. Use it for Canvas rendering, SSR precomputation, worker threads, or tests. React is just one adapter.
- **Column-aware spatial index.** Binary search per column for O(log n) viewport queries instead of brute-force iteration. Correctly handles items taller than the viewport.
- **Small.** Zero runtime dependencies. ~30 KB unpacked, tree-shakeable.

## Install

```sh
npm install fukashi
```

React 18+ is a peer dependency.

## Quick Start

```tsx
import { MasonryGrid } from "fukashi";

function Gallery({ images }) {
  return (
    <MasonryGrid
      items={images}
      getKey={(img) => img.id}
      getItemSize={(img) => ({ width: img.width, height: img.height })}
      columns={{ minWidth: 220, min: 1, max: 6 }}
      gap={{ x: 12, y: 12 }}
      overscan={800}
      renderItem={(img) => (
        <img src={img.src} alt={img.alt} style={{ width: "100%", display: "block" }} />
      )}
    />
  );
}
```

The library positions the rectangles. You decide what goes inside them — images, videos, cards, canvas elements, anything.

## Headless Hook

Own the markup. `useMasonry` returns positions, visible items, and viewport state without rendering anything.

```tsx
import { useMasonry } from "fukashi";

function CustomGrid({ items }) {
  const masonry = useMasonry({
    items,
    getKey: (item) => item.id,
    getItemSize: (item) => ({ width: item.width, height: item.height }),
    columns: { minWidth: 240, max: 6 },
    gap: { x: 12, y: 8 },
  });

  return (
    <div ref={masonry.rootRef} style={masonry.containerStyle}>
      {masonry.visibleItems.map((v) => (
        <div key={v.key} style={v.style}>
          <YourComponent item={v.item} width={v.width} />
        </div>
      ))}
    </div>
  );
}
```

## Pure Layout Engine

No React. No DOM. Just math.

```ts
import { computeMasonryLayout } from "fukashi";

const layout = computeMasonryLayout({
  items,
  width: 960,
  columns: 4,
  gap: { x: 12, y: 12 },
  getKey: (item) => item.id,
  getItemSize: (item) => item.size,
});

// layout.positions — every item with x, y, width, height, column
// layout.containerHeight — total grid height
// layout.signature — deterministic layout fingerprint
```

Use this for Canvas rendering, SSR precomputation, tests, or anywhere React isn't available.

## Layout Cache

Persist computed layouts across page visits. Cache hits skip layout computation entirely.

```ts
import { createLayoutCache, createMasonryEngine } from "fukashi";

const cache = createLayoutCache({ namespace: "my-app", ttlMs: 1000 * 60 * 60 });
const engine = createMasonryEngine({ cache, cacheKey: "album-42" });

const layout = engine.compute({
  items,
  width: 960,
  columns: { minWidth: 240 },
  gap: 12,
  getKey: (item) => item.id,
  getItemSize: (item) => item.size,
});

// layout.source → "cache" | "cache-partial" | "computed"
```

The cache handles exact hits, partial prefix reuse (appended items reuse existing positions), TTL expiry, version invalidation, and quota-safe storage. Cache failures are swallowed — it's an optimization, not a requirement.

## Spatial Index

Exported for standalone use. Fast vertical range queries over positioned items.

```ts
import { SpatialIndex } from "fukashi";

const index = new SpatialIndex(entries, { order: "source" });
const visible = index.queryRange(viewportTop, viewportBottom);
```

Column-aware binary search. O(log n + m) where m is the number of returned items.

## API

### `MasonryGrid` Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `T[]` | — | Source items |
| `getKey` | `(item, index) => string \| number` | — | Stable item key |
| `renderItem` | `(item, context) => ReactNode` | — | Render function |
| `getItemSize` | `(item, index) => { width, height }` | — | Known dimensions |
| `columns` | `number \| { minWidth, min?, max? } \| (width) => number` | `{ minWidth: 240 }` | Column configuration |
| `gap` | `number \| { x?, y? }` | `0` | Gap between items |
| `overscan` | `number` | `800` | Pixel buffer above/below viewport |
| `estimateHeight` | `number \| (item, index, colWidth) => number` | `columnWidth` | Fallback for unknown dimensions |

### Exports

```ts
// React
export { MasonryGrid, Masonry, useMasonry, useRectViewport };

// Engine
export { computeMasonryLayout, createMasonryEngine, MasonryEngine };

// Utilities
export { SpatialIndex, createSpatialIndexFromLayout };
export { LayoutCache, createLayoutCache };

// Constants
export { FUKASHI_LAYOUT_ALGORITHM_VERSION };

// Types
export type { MasonryLayout, MasonryPosition, MasonryGridProps, ... };
```

## Architecture

Fukashi is structured as three independent layers:

```
┌─────────────────────────────────────────────┐
│  MasonryGrid / useMasonry                   │  React adapter
│  useContainerSize · useRectViewport         │  DOM measurement
├─────────────────────────────────────────────┤
│  MasonryEngine                              │  Cache-aware orchestrator
│  LayoutCache · SpatialIndex                 │  Persistence + queries
├─────────────────────────────────────────────┤
│  computeMasonryLayout                       │  Pure deterministic engine
│  resolveColumns · resolveGap · signature    │  Zero dependencies
└─────────────────────────────────────────────┘
```

The engine is deterministic and framework-independent. The cache lives in the layout pipeline, not as a React side effect. The React layer only measures the container, tracks the viewport, and renders visible items.

## Origin

Fukashi was extracted from a production Tauri application where the original implementation handled 10,000+ item grids with virtualization, variable aspect ratios, and multiple content types. The library is the layout engine without the application — no Tauri IPC, no selection state, no content-type rendering, no drag handling. Just the grid math that makes it fast.

Named after 不可視境界線 (Fukashi Kyoukaisen) — the Invisible Boundary Line. The boundary between visible and invisible is what a virtualized grid computes every frame.

## License

[MIT](./LICENSE)
