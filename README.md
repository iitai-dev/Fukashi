# Fukashi

Fukashi is a small masonry layout library for deterministic grid placement and viewport rendering. It keeps the reusable part sharp: layout math, fast vertical range queries, and a thin React adapter.

The library does not ship app opinions. There is no image component, selection state, drag handling, infinite loading, CSS framework, or app runtime integration.

## Install

```sh
npm install fukashi
```

React and React DOM are peer dependencies.

## React Usage

```tsx
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
```

## Headless Layout

```ts
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
```

## Cache

Layout caching is optional and fail-closed. It can be used through `MasonryEngine` when a stable cache key is available.

```ts
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
```

## Docs

- [Public docs](docs/public/README.md)
- [API reference](docs/public/API.md)
- [React guide](docs/public/REACT.md)

## Development

```sh
npm install
npm run check
```
