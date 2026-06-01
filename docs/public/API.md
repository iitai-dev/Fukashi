# API Reference

## `computeMasonryLayout(input)`

Computes deterministic masonry positions for every item.

Required input:

- `items`: source items.
- `width`: container width in pixels.
- `getKey(item, index)`: stable item key.

Common optional input:

- `getItemSize(item, index)`: returns `{ width, height }` for aspect-ratio based sizing.
- `getItemLayoutKey(item, index)`: stable key for cache invalidation when layout-relevant metadata changes.
- `columns`: fixed count, function, or `{ minWidth, min, max }` object.
- `gap`: number or `{ x, y }` object.
- `estimateHeight`: number or callback used when dimensions are missing.

Returns a `MasonryLayout` with `positions`, `containerHeight`, column metadata, signature data, and cache metadata.

## `MasonryEngine`

Wraps layout computation with optional cache load/save behavior.

```ts
const engine = createMasonryEngine({ cache, cacheKey: "gallery" });
const layout = engine.compute(input);
```

## `SpatialIndex`

Indexes positioned items by column for fast vertical range queries.

```ts
const visible = index.queryRange(viewportTop, viewportBottom, "source");
```

Supported orders are `source`, `visual`, and `none`.

## `LayoutCache`

Optional cache adapter backed by a storage-like object. Browser `localStorage` is used when available. Cache failures are swallowed because caching is an optimization.