# API Reference

## computeMasonryLayout(input)

Computes deterministic masonry positions for every item.

Required input:

- items: source items.
- width: container width in pixels.
- getKey(item, index): stable item key.

Common optional input:

- getItemSize(item, index): returns width and height for aspect-ratio based sizing.
- getItemLayoutKey(item, index): stable key for cache invalidation when layout-relevant metadata changes.
- columns: fixed count, function, or minWidth object.
- gap: number or x/y object.
- estimateHeight: number or callback used when dimensions are missing.

Returns a MasonryLayout with positions, containerHeight, column metadata, signature data, and cache metadata.

## MasonryEngine

Wraps layout computation with optional cache load/save behavior.

    const engine = createMasonryEngine({ cache, cacheKey: "gallery" });
    const layout = engine.compute(input);

The returned layout includes cache status:

- cache.status: disabled, miss, hit, or partial.
- cache.reason: miss reason or partial-reuse reason.
- cache.validUntil: prefix length used for partial cache hits.
- cache.saveStatus: saved, skipped, or failed.

MasonryEngine also exposes invalidate:

    engine.invalidate();
    engine.invalidate("other-cache-key");

## useMasonry

The React hook returns the same cache metadata plus invalidateCache.

    const masonry = useMasonry({ items, cache, cacheKey, getKey, getItemSize });
    masonry.invalidateCache();

Use invalidateCache after deleting or mutating a persisted data set when you want the next render to recompute from scratch.

## SpatialIndex

Indexes positioned items by column for fast vertical range queries.

    const visible = index.queryRange(viewportTop, viewportBottom, "source");

Supported orders are source, visual, and none.

## LayoutCache

Optional cache adapter backed by a storage-like object. Browser localStorage is used when available. Cache failures are swallowed because caching is an optimization.

    const cache = createLayoutCache({
      namespace: "my-app",
      ttlMs: 1000 * 60 * 60,
      maxEntries: 50,
      onError: (error, context) => report(error, context)
    });

Cache load results are hit, partial, or miss. Partial hits include append, remove, insert, reorder, or size-change reasons. Save results are saved, skipped, or failed.
