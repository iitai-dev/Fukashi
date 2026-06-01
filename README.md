# Fukashi

Fukashi is a small masonry layout library extracted from Rikka. It keeps the reusable part sharp: deterministic layout math, fast vertical range queries, and a thin React adapter for viewport rendering.

The library does not ship app opinions. There is no image component, selection state, drag handling, infinite loading, CSS framework, or Tauri integration.

## Install

    npm install fukashi

React and React DOM are peer dependencies.

## React Usage

    import { MasonryGrid } from "fukashi";

    function Gallery({ images }) {
      return (
        <MasonryGrid
          items={images}
          getKey={(image) => image.id}
          getItemSize={(image) => ({ width: image.width, height: image.height })}
          columns={{ minWidth: 220, min: 1, max: 6 }}
          gap={{ x: 12, y: 12 }}
          overscan={800}
          renderItem={(image) => (
            <img src={image.src} alt={image.alt} style={{ width: "100%", display: "block" }} />
          )}
        />
      );
    }

## Headless Layout

    import { computeMasonryLayout } from "fukashi";

    const layout = computeMasonryLayout({
      items,
      width: 960,
      columns: 4,
      gap: 12,
      getKey: (item) => item.id,
      getItemSize: (item) => item.size
    });

    console.log(layout.positions, layout.containerHeight);

## Cache

Layout caching is optional and fail-closed. It can be used through MasonryEngine when a stable cache key is available.

    import { createLayoutCache, createMasonryEngine } from "fukashi";

    const cache = createLayoutCache({ namespace: "my-gallery" });
    const engine = createMasonryEngine({ cache, cacheKey: "album-42" });

    const layout = engine.compute({
      items,
      width: 960,
      columns: { minWidth: 240 },
      gap: 12,
      getKey: (item) => item.id,
      getItemSize: (item) => item.size
    });

## Public Surface

- MasonryGrid and Masonry
- useMasonry
- useRectViewport
- computeMasonryLayout
- createMasonryEngine and MasonryEngine
- SpatialIndex
- LayoutCache and createLayoutCache
- TypeScript types

## Development

    npm install
    npm run check

The original extraction plan is saved in FUKASHI_ARCHITECTURE.md.
