# RectMasonry architecture spec

Working package name: **`rect-masonry`**. Internally, I would keep the project name distinct from Rikka because the extracted library should contain none of Rikka’s app domain: no Tauri IPC, no selection context, no Tailwind tokens, no image/text/favorite/tag branches. The assessment identifies the portable core as shortest-column layout, `SpatialIndex`, `LayoutCache`, and BoundingClientRect-based virtualization, while also calling out that the current component is still application-coupled and that the cache load path is unwired.   

The design below deliberately does **not** reproduce masonic’s architecture. masonic is a mature, versatile virtualized masonry library with exported internals, TypeScript support, an interval-tree lookup strategy, autosizing, render props, and item resize handling. ([GitHub][1]) Its documented composition uses container/window measurement hooks and a lower-level mode where consumers provide `width`, `height`, and `scrollTop`; it also has SSR-oriented `initialWidth` / `initialHeight` props. ([GitHub][2]) This library should instead be data-first, smaller, scroll-container-agnostic within a document, cache-aware, and useful in headless mode.

---

## 0. Design thesis

**RectMasonry is a deterministic layout engine with a thin React adapter.**

The core engine takes:

```ts
items + getKey + getItemSize/estimate + width + columns + gaps
```

and returns:

```ts
positions + containerHeight + SpatialIndex + cache signature
```

React then does only four things:

1. Measure the grid container width.
2. Track viewport-relative scroll using the grid root’s `getBoundingClientRect()`.
3. Query `SpatialIndex` for visible items.
4. Render wrappers around `renderItem`.

The library wins by keeping those boundaries clean.

It should exclude anything that is not layout infrastructure: no built-in infinite loader, no selection state, no drag behavior, no themed components, no image renderer, no CSS framework, no “Pinterest card” assumptions, no scroll-parent discovery API.

---

# 1. Novel technique audit and enhancement

## 1.1 BoundingClientRect scroll tracking

### What is original

The browser API itself is standard: `getBoundingClientRect()` returns an element rectangle relative to the viewport, and its edges change as scrolling changes. ([MDN Web Docs][3]) The original part is using the grid’s own rect as the coordinate origin:

```ts
virtualScrollTop = -gridElement.getBoundingClientRect().top
```

That turns “where is the scroll container?” into “where is my layout root relative to the viewport?” The current implementation listens to `scroll` on `window` with capture and then queries the spatial index against that virtual scroll range. 

### Enhancement

Package it as an internal hook:

```ts
useRectViewport(rootRef, { overscan, disabled })
```

It returns:

```ts
{
  viewportTop: number;       // may be negative before the grid reaches the viewport
  viewportBottom: number;
  viewportHeight: number;
  rootRect: DOMRectReadOnly | null;
  refresh(): void;
}
```

It must be **rAF-scheduled**, not `setState` directly from scroll events. Multiple scroll events in the same frame collapse into one rect read and one React state update.

### Precise success boundary

It works when:

* The masonry root is part of the same document as the scrolling ancestors.
* The root element physically moves relative to the document viewport when any relevant scroll container scrolls.
* Over-rendering is acceptable when the actual clipping scroll container is smaller than `window.innerHeight`.

This makes it work in normal browser documents, Tauri webviews, same-document nested scroll containers, and same-document iframe contents.

### Precise failure boundary

It does **not** magically observe outside its document. In a cross-origin iframe, the child document cannot know that the iframe element itself has moved in the parent page. The library should document this as “scroll-container-agnostic inside the current document, not cross-document omniscient.”

It also fails if the masonry root is itself the scroll viewport. Example:

```tsx
<MasonryGrid style={{ overflow: "auto", height: 600 }} />
```

When the root scrolls its own contents, the root’s `rect.top` does not change. The architecture should require the positioning root to be inside scrollable content:

```tsx
<div style={{ overflow: "auto", height: 600 }}>
  <MasonryGrid />
</div>
```

or, in a future opt-in escape hatch, expose `scrollMode: "rect" | "self"`; but `self` is deliberately **not** the default because it reintroduces scroll-container configuration.

CSS transforms are the other hard boundary. `getBoundingClientRect()` reflects transforms, while masonry positions are computed in CSS layout pixels. A translated ancestor can create false scroll deltas; a scaled ancestor can make rect movement and layout coordinates disagree. The hook should detect scale drift with:

```ts
scaleY = rootRect.height / root.offsetHeight
```

If `Math.abs(scaleY - 1) > 0.01`, dev mode warns:

> RectMasonry detected a scaled transform ancestor. Virtualization coordinates may be inaccurate. Move the masonry root outside the transformed subtree or disable virtualization.

Do **not** add complex transform compensation in v0.1. It would bloat the library and still fail for rotations/perspective transforms.

`position: fixed` is fine only if the masonry root’s content still moves relative to the viewport when its ancestor scrolls. A fixed panel containing an inner scrolling content element works if the masonry root is inside the scrolling content. A fixed masonry root with its own scroll area does not.

Layout shifts above the grid without a scroll/resize event can temporarily stale the visible range. The mitigation is simple: call `refresh()` after mount, after width measurement, after layout commit, after cache load, and expose `refresh()` to consumers. No polling loop.

---

## 1.2 SpatialIndex

### What is original

A sorted-array plus binary-search visibility index is not novel as a data structure, but it is original in this context because masonry virtualization often reaches for heavier interval trees or per-item measurement systems. The assessment identifies the current `SpatialIndex` as a clean, portable, zero-dependency implementation. 

### Enhancement

Use a **column-aware sorted-array index**, not one global interval tree.

Masonry positions produced by the engine have a crucial invariant:

```ts
within each column, items are vertically non-overlapping and sorted by y
```

So `SpatialIndex` stores one sorted array per column. Querying a viewport range becomes:

```ts
for each column:
  binary search first item where bottom >= viewportTop
  scan forward until top > viewportBottom
```

Complexity:

```ts
O(c * log(n / c) + m)
```

where `c` is column count and `m` is returned items. Since `c` is small and bounded, this is effectively `O(log n + m)` without an interval tree.

This is a better fit than a global sorted array because a single very tall item that starts above the viewport must still be found. A naïve “first top >= viewportTop” lookup misses that item. Column-local monotonic `bottom` order avoids the miss.

### Edge cases

A custom consumer could feed `SpatialIndex` entries that overlap within a column. In dev mode, `replace()` should validate the invariant when `assertInvariant: true`. In production, invalid input degrades to possibly incorrect query results; the engine’s own output must always satisfy the invariant.

Very tall items are handled correctly because the binary search uses `bottom >= viewportTop`, not `top >= viewportTop`.

If `overscan` is huge or the viewport is huge, `m` can be large. That is not an index failure; it is a render workload decision.

---

## 1.3 LayoutCache

### What is original

The idea of persisting a computed masonry layout across visits is the strongest product differentiator. The assessment says the current `LayoutCache` class already has TTL and key-based invalidation, but the component never calls the load path, so the advertised feature is not functional yet. 

### Enhancement

Make cache integration part of the engine pipeline, not a React afterthought.

The load path runs before layout computation:

```ts
resolve columns/gap/width
build layout signature
load cache
if exact hit: hydrate layout
if partial hit: hydrate prefix and compute suffix
if miss: compute full layout
save after stable commit
```

The cache must store positions, column assignments, column heights, checkpoints, item keys, item layout keys, and the layout parameters that generated them.

It should never store consumer item objects.

### Edge cases

`localStorage` may be unavailable in SSR, private browsing, sandboxed iframes, Tauri origin changes, or quota pressure. `LayoutCache` must fail closed: cache miss, no thrown render-time error.

Corrupt JSON should be caught, removed, and reported through optional `onError`.

Version upgrades must invalidate by `schemaVersion` and `algorithmVersion`.

Dynamic item insertion/removal cannot always preserve a layout. The safe rule is:

```ts
reuse the longest prefix whose item key and item layout key both match
recompute everything after that prefix
```

Column-count changes cannot safely migrate positions. Store separate cache entries per resolved responsive bucket.

---

# 2. Public API specification

## 2.1 Package exports

```ts
export {
  MasonryGrid,
  MasonryGrid as Masonry,
  useMasonry,
  computeMasonryLayout,
  createMasonryEngine,
  MasonryEngine,
  SpatialIndex,
  LayoutCache,
};

export type {
  MasonryKey,
  MasonryGap,
  ResolvedMasonryGap,
  MasonryColumns,
  ResolvedMasonryColumns,
  MasonryItemSize,
  MasonryKeyGetter,
  MasonrySizeGetter,
  MasonryLayoutKeyGetter,
  MasonryEstimateHeight,
  MasonryPosition,
  MasonryVisibleItem,
  MasonryLayout,
  MasonryLayoutInput,
  MasonryEngineOptions,
  MasonryEngineLayoutInput,
  UseMasonryOptions,
  UseMasonryResult,
  MasonryGridProps,
  MasonryRenderContext,
  MasonrySSRConfig,
  MasonryMeasurementMode,
  MasonryDomOrder,
  MasonryStatus,
  SpatialEntry,
  SpatialIndexOptions,
  SpatialQueryOrder,
  LayoutCacheOptions,
  LayoutCacheEntry,
  LayoutCacheLoadResult,
  LayoutCacheSaveResult,
  LayoutSignature,
  StorageLike,
};
```

No default export.

---

## 2.2 Shared public types

```ts
import * as React from "react";

export type MasonryKey = string | number;

export interface MasonryItemSize {
  width: number;
  height: number;
}

export type MasonryGap =
  | number
  | {
      x?: number;
      y?: number;
      horizontal?: number;
      vertical?: number;
    };

export interface ResolvedMasonryGap {
  x: number;
  y: number;
}

export type MasonryColumns =
  | number
  | ((containerWidth: number) => number)
  | {
      minWidth: number;
      min?: number;
      max?: number;
    };

export interface ResolvedMasonryColumns {
  count: number;
  width: number;
}

export type MasonryKeyGetter<T> = (item: T, index: number) => MasonryKey;

export type MasonrySizeGetter<T> = (
  item: T,
  index: number
) => MasonryItemSize | null | undefined;

export type MasonryLayoutKeyGetter<T> = (
  item: T,
  index: number
) => string | number;

export type MasonryEstimateHeight<T> =
  | number
  | ((item: T, index: number, columnWidth: number) => number);

export type MasonryMeasurementMode =
  | "provided"       // use getItemSize / estimate only
  | "visible";       // observe rendered visible wrappers and correct estimates

export type MasonryDomOrder =
  | "source"         // default: DOM follows original item order
  | "visual";        // sort visible slice by y, then x

export type MasonryStatus =
  | "ssr"
  | "measuring"
  | "computed"
  | "cache-hit"
  | "cache-partial"
  | "cache-compatible"
  | "cache-miss";

export interface MasonryPosition {
  key: MasonryKey;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  estimated: boolean;
}

export interface MasonryVisibleItem<T> extends MasonryPosition {
  item: T;
  style: React.CSSProperties;
}

export interface LayoutSignature {
  schemaVersion: 1;
  algorithmVersion: string;
  cacheVersion?: string | number;
  width: number;
  columnCount: number;
  columnWidth: number;
  gapX: number;
  gapY: number;
  itemCount: number;
  itemKeysHash: string;
  itemLayoutHash: string;
}

export interface MasonryLayout<T = unknown> {
  width: number;
  columnCount: number;
  columnWidth: number;
  gap: ResolvedMasonryGap;
  containerHeight: number;
  positions: readonly MasonryPosition[];
  items?: readonly T[];
  signature: LayoutSignature;
  source:
    | "computed"
    | "cache"
    | "cache-partial"
    | "cache-compatible"
    | "ssr-estimate";
}
```

`MasonryLayoutKeyGetter` is important. It preserves the assessment’s good `layoutKey` idea: metadata updates should not trigger layout recomputation when dimensions and order did not change. 

Default behavior:

```ts
getItemLayoutKey(item, index) =
  getItemSize(item, index)
    ? `${width}x${height}`
    : "unknown"
```

Consumers with image data can override:

```ts
getItemLayoutKey={(img) => `${img.width}:${img.height}`}
```

and ignore tags, selection, favorite state, etc.

---

## 2.3 Pure layout engine API

```ts
export interface MasonryLayoutInput<T> {
  items: readonly T[];
  getKey: MasonryKeyGetter<T>;
  getItemSize?: MasonrySizeGetter<T>;
  getItemLayoutKey?: MasonryLayoutKeyGetter<T>;
  estimateHeight?: MasonryEstimateHeight<T>;
  width: number;
  columns?: MasonryColumns;
  gap?: MasonryGap;
  cacheVersion?: string | number;
  algorithmVersion?: string;
  seed?: MasonryLayoutSeed | null;
}

export interface MasonryLayoutSeed {
  positions: readonly MasonryPosition[];
  validUntil: number;
  columnHeights: readonly number[];
}

export function computeMasonryLayout<T>(
  input: MasonryLayoutInput<T>
): MasonryLayout<T>;
```

Rules:

* `width <= 0` returns an empty layout with `containerHeight = 0`.
* `columns` defaults to `{ minWidth: 240, min: 1 }`.
* `gap` defaults to `0`.
* Separate `x` and `y` gaps are first-class; the current bug becomes an explicit feature.
* `getItemSize` returning valid dimensions computes `height = columnWidth * size.height / size.width`.
* Missing dimensions use `estimateHeight`, defaulting to `columnWidth`.
* Invalid dimensions in dev mode warn once per key.
* `seed` allows partial cache reuse. Positions `[0, validUntil)` are trusted; layout resumes with `columnHeights`.

---

## 2.4 Engine class API

```ts
export interface MasonryEngineOptions<T> {
  getKey: MasonryKeyGetter<T>;
  getItemSize?: MasonrySizeGetter<T>;
  getItemLayoutKey?: MasonryLayoutKeyGetter<T>;
  estimateHeight?: MasonryEstimateHeight<T>;
  columns?: MasonryColumns;
  gap?: MasonryGap;
  cacheVersion?: string | number;
  algorithmVersion?: string;
}

export interface MasonryEngineLayoutInput<T> {
  items: readonly T[];
  width: number;
  seed?: MasonryLayoutSeed | null;
}

export interface MasonryViewport {
  top: number;
  bottom: number;
  overscan?: number;
}

export function createMasonryEngine<T>(
  options: MasonryEngineOptions<T>
): MasonryEngine<T>;

export class MasonryEngine<T> {
  constructor(options: MasonryEngineOptions<T>);

  setOptions(options: Partial<MasonryEngineOptions<T>>): void;

  layout(input: MasonryEngineLayoutInput<T>): MasonryLayout<T>;

  getLayout(): MasonryLayout<T> | null;

  getIndex(): SpatialIndex<MasonryPosition> | null;

  query(viewport: MasonryViewport): readonly MasonryPosition[];

  invalidate(from?: number | MasonryKey): void;
}
```

The engine is useful outside React for Canvas, WebGL, custom virtualization, precomputing layouts in workers, or tests.

---

## 2.5 SpatialIndex API

```ts
export interface SpatialEntry<Meta = unknown> {
  key: MasonryKey;
  index: number;
  top: number;
  bottom: number;
  column: number;
  meta: Meta;
}

export type SpatialQueryOrder =
  | "source"
  | "visual"
  | "none";

export interface SpatialIndexOptions {
  columnCount?: number;
  assertInvariant?: boolean;
}

export class SpatialIndex<Meta = unknown> {
  constructor(
    entries?: readonly SpatialEntry<Meta>[],
    options?: SpatialIndexOptions
  );

  readonly size: number;

  replace(
    entries: readonly SpatialEntry<Meta>[],
    options?: SpatialIndexOptions
  ): void;

  queryRange(
    top: number,
    bottom: number,
    order?: SpatialQueryOrder
  ): SpatialEntry<Meta>[];

  clear(): void;
}
```

`order: "source"` is the default for React reconciliation and keyboard predictability. `order: "visual"` sorts returned visible items by `top`, then `x`. The library should not claim true row-wise accessibility unless it implements a dedicated roving-tabindex strategy; the assessment correctly identifies the current claim as overstated. 

---

## 2.6 LayoutCache API

```ts
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key?(index: number): string | null;
  readonly length?: number;
}

export interface LayoutCacheOptions {
  namespace?: string;
  ttlMs?: number;
  maxEntries?: number;
  storage?: StorageLike | null;
  algorithmVersion?: string;
  onError?: (
    error: unknown,
    context: {
      operation: "load" | "save" | "remove" | "clear" | "prune";
      key?: string;
    }
  ) => void;
}

export interface LayoutCacheCheckpoint {
  index: number;
  columnHeights: readonly number[];
}

export interface LayoutCacheEntry {
  schemaVersion: 1;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  cacheKey: string;
  signature: LayoutSignature;
  positions: readonly MasonryPosition[];
  itemKeys: readonly MasonryKey[];
  itemLayoutKeys: readonly (string | number)[];
  columnHeights: readonly number[];
  checkpoints: readonly LayoutCacheCheckpoint[];
}

export type LayoutCacheLoadResult =
  | {
      status: "hit";
      entry: LayoutCacheEntry;
      seed: MasonryLayoutSeed;
    }
  | {
      status: "partial";
      entry: LayoutCacheEntry;
      seed: MasonryLayoutSeed;
      validUntil: number;
      reason: "append" | "remove" | "insert" | "reorder" | "size-change";
    }
  | {
      status: "compatible";
      entry: LayoutCacheEntry;
      seed: MasonryLayoutSeed;
      reason: "same-columns-different-width";
    }
  | {
      status: "miss";
      reason:
        | "disabled"
        | "not-found"
        | "expired"
        | "schema-version"
        | "algorithm-version"
        | "cache-version"
        | "columns"
        | "gap"
        | "width"
        | "corrupt"
        | "item-mismatch";
    };

export type LayoutCacheSaveResult =
  | { status: "saved"; key: string; bytes: number }
  | { status: "skipped"; reason: "disabled" | "empty" }
  | { status: "failed"; reason: "quota" | "storage" | "serialization" };

export class LayoutCache {
  constructor(options?: LayoutCacheOptions);

  load(
    cacheKey: string,
    signature: LayoutSignature,
    currentItemKeys: readonly MasonryKey[],
    currentItemLayoutKeys: readonly (string | number)[]
  ): LayoutCacheLoadResult;

  save(cacheKey: string, entry: LayoutCacheEntry): LayoutCacheSaveResult;

  remove(cacheKey: string): void;

  clear(): void;

  prune(now?: number): number;
}
```

`storage: null` disables persistence. On the server, default storage is `null`; in browsers, default storage is `window.localStorage` behind a `try/catch`.

---

## 2.7 Headless React hook API

```ts
export interface MasonrySSRConfig {
  mode?: "shell" | "static";
  initialWidth?: number;
  initialHeight?: number;
  initialItemCount?: number;
  initialLayout?: MasonryLayout<unknown>;
  hydration?: "preserve" | "hide-until-measured";
}

export interface UseMasonryOptions<T> {
  items: readonly T[];
  getKey: MasonryKeyGetter<T>;
  getItemSize?: MasonrySizeGetter<T>;
  getItemLayoutKey?: MasonryLayoutKeyGetter<T>;
  estimateHeight?: MasonryEstimateHeight<T>;

  columns?: MasonryColumns;
  gap?: MasonryGap;
  overscan?: number;

  cache?: false | LayoutCache | LayoutCacheOptions;
  cacheKey?: string;
  cacheVersion?: string | number;

  measurement?: MasonryMeasurementMode;
  domOrder?: MasonryDomOrder;
  ssr?: MasonrySSRConfig;

  onLayout?: (layout: MasonryLayout<T>) => void;
  onVisibleRangeChange?: (
    range: {
      startIndex: number;
      stopIndex: number;
      items: readonly MasonryVisibleItem<T>[];
    }
  ) => void;
}

export interface UseMasonryResult<T> {
  containerRef: React.RefCallback<HTMLElement>;

  status: MasonryStatus;
  layout: MasonryLayout<T>;
  positions: readonly MasonryPosition[];
  visibleItems: readonly MasonryVisibleItem<T>[];

  containerHeight: number;
  columnCount: number;
  columnWidth: number;
  scrollTop: number;
  viewportHeight: number;

  getContainerProps<E extends HTMLElement = HTMLDivElement>(
    props?: React.HTMLAttributes<E>
  ): React.HTMLAttributes<E> & {
    ref: React.RefCallback<E>;
    style: React.CSSProperties;
  };

  getItemProps<E extends HTMLElement = HTMLDivElement>(
    item: MasonryVisibleItem<T>,
    props?: React.HTMLAttributes<E>
  ): React.HTMLAttributes<E> & {
    key: React.Key;
    ref?: React.RefCallback<E>;
    style: React.CSSProperties;
    "data-masonry-key": string;
    "data-masonry-index": number;
  };

  measureItem(key: MasonryKey, element: HTMLElement | null): void;

  refresh(): void;

  recompute(from?: number | MasonryKey): void;

  invalidateCache(): void;
}

export function useMasonry<T>(
  options: UseMasonryOptions<T>
): UseMasonryResult<T>;
```

This is the real headless mode. A consumer can render HTML, SVG overlays, Canvas labels, WebGL sprites, or nothing at all. They get raw positions, visible ranges, cache status, and measurement hooks without accepting the library’s DOM rendering.

Example consumer shape:

```tsx
const masonry = useMasonry({
  items,
  getKey: (x) => x.id,
  getItemSize: (x) => x.width && x.height ? x : null,
  columns: { minWidth: 220, max: 6 },
  gap: { x: 12, y: 8 },
  cacheKey: "omote:asset-grid",
});

return (
  <section {...masonry.getContainerProps()}>
    {masonry.visibleItems.map((v) => (
      <article {...masonry.getItemProps(v)}>
        <Card item={v.item} width={v.width} />
      </article>
    ))}
  </section>
);
```

---

## 2.8 Reactive component API

```ts
export interface MasonryRenderContext<T> {
  item: T;
  index: number;
  key: MasonryKey;
  width: number;
  height: number;
  position: MasonryPosition;
  estimated: boolean;
  status: MasonryStatus;
}

export interface MasonryGridProps<T>
  extends Omit<UseMasonryOptions<T>, "onVisibleRangeChange"> {
  renderItem: (context: MasonryRenderContext<T>) => React.ReactNode;

  as?: React.ElementType;
  itemAs?: React.ElementType;

  className?: string;
  style?: React.CSSProperties;

  itemClassName?:
    | string
    | ((context: MasonryRenderContext<T>) => string | undefined);

  itemStyle?:
    | React.CSSProperties
    | ((context: MasonryRenderContext<T>) => React.CSSProperties | undefined);

  role?: React.AriaRole;
  tabIndex?: number;

  onVisibleRangeChange?: UseMasonryOptions<T>["onVisibleRangeChange"];
}

export function MasonryGrid<T>(
  props: MasonryGridProps<T>
): React.ReactElement;
```

No `onClick`, `onCopy`, `onTag`, `onFavorite`, `onDragStart`, or app callbacks. The consumer handles all behavior inside `renderItem`.

---

# 3. Internal module decomposition

## File contracts

```txt
src/
  index.ts
  types.ts
  engine.ts
  spatial-index.ts
  layout-cache.ts
  signature.ts
  use-container-size.ts
  use-rect-viewport.ts
  use-visible-measurement.ts
  use-masonry.tsx
  MasonryGrid.tsx
```

### `engine.ts`

Contains the deterministic shortest-column layout.

Responsibilities:

* Normalize width, columns, and gap.
* Resolve item heights from dimensions or estimates.
* Compute positions.
* Accept `seed` for partial cache reuse.
* Track max container height without `Math.max(...columnHeights)`.
* Build layout signature.
* Build `SpatialIndex` entries.

No React. No DOM. No storage.

### `spatial-index.ts`

Contains the column-aware sorted-array index.

Responsibilities:

* Store entries by column.
* Binary-search first visible candidate in each column.
* Return ordered visible entries.
* Validate non-overlap in dev mode.

No React. No layout calculation.

### `layout-cache.ts`

Contains persistence.

Responsibilities:

* Safe storage adapter selection.
* TTL.
* Schema/algorithm/cache-version invalidation.
* Exact/partial/compatible cache load.
* Save/prune/quota handling.
* Convert cached prefix into `MasonryLayoutSeed`.

No React. No DOM.

### `signature.ts`

Contains small stable hashing helpers and cache key composition.

Responsibilities:

* Hash item keys.
* Hash item layout keys.
* Build storage keys.
* Compare signatures.
* Find longest valid prefix.

Hashing can be simple FNV-1a over strings. No crypto dependency.

### `use-container-size.ts`

Contains one `ResizeObserver` on the masonry root.

Responsibilities:

* Measure container width.
* Fallback to `window.resize` + `getBoundingClientRect().width` when `ResizeObserver` is unavailable.
* Return width `0` until mounted.

`ResizeObserver` is widely available and reports element size changes, but the hook must still have a fallback because older/sandboxed environments exist. ([MDN Web Docs][4])

### `use-rect-viewport.ts`

Contains BoundingClientRect scroll tracking.

Responsibilities:

* Attach `scroll` listener to `window` with capture.
* Attach `resize` listener.
* Schedule rect reads in `requestAnimationFrame`.
* Compute `viewportTop`, `viewportBottom`, and `viewportHeight`.
* Expose `refresh()`.
* Detect transformed-scale coordinate mismatch in dev.

### `use-visible-measurement.ts`

Contains optional visible item measurement.

Responsibilities:

* One `ResizeObserver` instance, observing only currently rendered item wrappers.
* Map measured heights by key.
* Batch measurement updates in rAF.
* Fallback to mount-time `getBoundingClientRect().height` when `ResizeObserver` is missing.
* Trigger `recompute(fromIndex)` only when height changes beyond a threshold, for example `1px`.

This is deliberately not masonic-style “measure every item forever.” It is a correction layer for unknown dimensions, not the primary layout strategy.

### `use-masonry.tsx`

Composes all primitives.

Responsibilities:

* Manage root ref.
* Measure width.
* Build layout signature.
* Load cache.
* Compute or hydrate layout.
* Build/query `SpatialIndex`.
* Save cache after stable layout.
* Return headless API.

### `MasonryGrid.tsx`

Thin renderer.

Responsibilities:

* Call `useMasonry`.
* Render container.
* Render visible item wrappers.
* Call consumer `renderItem`.
* Merge item styles and refs.

No app behavior.

---

# 4. Data flow

## 4.1 Reactive mode

```txt
consumer items
  ↓
getKey + getItemLayoutKey
  ↓
layout signature
  ↓
container width measurement
  ↓
resolve columns + gap
  ↓
LayoutCache.load(cacheKey, signature)
  ↓
hit? ───────────────→ hydrate positions
partial? ───────────→ hydrate prefix + compute suffix
miss? ──────────────→ compute full layout
  ↓
SpatialIndex.replace(positions)
  ↓
useRectViewport reads -rootRect.top
  ↓
SpatialIndex.queryRange(viewTop - overscan, viewBottom + overscan)
  ↓
visibleItems
  ↓
MasonryGrid renderItem
  ↓
optional visible measurement corrections
  ↓
recompute affected suffix
  ↓
debounced LayoutCache.save
```

## 4.2 Headless hook mode

Same pipeline, but it stops before rendering.

The consumer receives:

```ts
positions       // all computed positions
visibleItems    // item + position + style for current viewport
layout          // full metadata
refresh         // rect refresh
recompute       // manual suffix invalidation
```

## 4.3 Pure engine mode

No DOM, no React, no scroll.

```ts
const engine = createMasonryEngine({
  getKey: (x) => x.id,
  getItemSize: (x) => x.size,
  columns: 4,
  gap: { x: 12, y: 8 },
});

const layout = engine.layout({ items, width: 1000 });
const visible = engine.query({ top: 1200, bottom: 2000, overscan: 400 });
```

This is useful for tests, prerendering, Canvas, and worker experimentation.

---

# 5. Layout persistence integration

## 5.1 Cache key composition

The storage key should **not** include item hashes. If it does, dynamic insertions/removals cannot find prior layouts for partial reuse.

Use:

```txt
${namespace}:${cacheKey}:${algorithmVersion}:${cacheVersion}:${columnCount}:${gapX}:${gapY}
```

The entry itself stores:

```ts
signature.width
signature.columnWidth
signature.itemKeysHash
signature.itemLayoutHash
itemKeys[]
itemLayoutKeys[]
positions[]
columnHeights[]
checkpoints[]
```

Width is checked inside the entry.

## 5.2 Exact hit

Exact hit requires:

```txt
schemaVersion matches
algorithmVersion matches
cacheVersion matches
columnCount matches
gapX/gapY match
width and columnWidth match within tolerance
itemKeysHash matches
itemLayoutHash matches
not expired
```

Result:

```ts
status: "hit"
seed.validUntil = itemCount
```

The engine can skip layout calculation entirely and hydrate positions.

## 5.3 Partial prefix hit

Partial hit requires same layout parameters but item sequence changed.

Algorithm:

```txt
p = longest index where:
  cached.itemKeys[i] === current.itemKeys[i]
  cached.itemLayoutKeys[i] === current.itemLayoutKeys[i]
```

Then:

* Reuse cached positions `[0, p)`.
* Restore column heights at `p`.
* Compute positions `[p, n)` normally.

This handles append cheaply. It handles deletion/insertion/reorder honestly by recomputing the affected suffix.

For large caches, checkpoints prevent restoring the prefix from becoming O(p) every time:

```txt
nearest checkpoint <= p
replay cached positions from checkpoint to p
then compute suffix
```

Checkpoint interval: `256` items.

## 5.4 Compatible same-column reflow

If the item keys/layout keys match and `columnCount` matches, but `width`/`columnWidth` changed, the cache can return:

```ts
status: "compatible"
reason: "same-columns-different-width"
```

This mode preserves cached column assignments and recomputes x/y/height under the new width.

It is **not** mathematically identical to rerunning shortest-column greedy at the new width in every case, because vertical gaps can change the column-height competition. Therefore it should be controlled by an internal policy:

```ts
sameColumnWidthChange: "exact-only" | "stable-reflow"
```

Default: `"exact-only"` in v0.2. Consider `"stable-reflow"` in v0.3 only after visual testing.

## 5.5 Column-count change

Column-count changes are separate layout worlds.

When 4 columns becomes 3 columns, exact greedy placement can diverge almost immediately. The library should not pretend it can migrate positions safely.

Correct behavior:

1. Try cache entry for the new column count.
2. If found, hydrate it.
3. Otherwise compute full layout.

## 5.6 Save lifecycle

Save only after:

* Width is known.
* Layout is not SSR estimate.
* No measurement changes have occurred for one frame.
* Cache is enabled and `cacheKey` is provided.

Save should be debounced with `requestIdleCallback` when available, falling back to `setTimeout(0)`.

On quota failure:

1. `prune()` expired entries.
2. Remove oldest entries over `maxEntries`.
3. Retry once.
4. Return `status: "failed"` if still over quota.

---

# 6. SSR and hydration strategy

The standard “don’t SSR masonry” answer is avoidable if the library treats SSR as a deterministic estimate, not as clairvoyant layout.

## 6.1 Server render modes

### `ssr.mode: "shell"`

Server renders:

```html
<div style="position:relative;height:0"></div>
```

or a consumer-provided class/style. No items. No mismatch. Best for app dashboards where SEO does not matter.

### `ssr.mode: "static"`

Server computes a deterministic estimated layout using:

```ts
ssr.initialWidth ?? 1024
ssr.initialHeight ?? 720
ssr.initialItemCount ?? enough items to cover initialHeight + overscan
```

Server renders only that first slice as absolutely positioned items.

This is not “true measured SSR.” It is deterministic, useful, and hydratable.

### `ssr.initialLayout`

For advanced apps, the server may pass a serialized layout from its own cache:

```ts
ssr: {
  mode: "static",
  initialLayout,
}
```

The library should trust it only for the first render. Client-side signature validation still runs after hydration.

## 6.2 Hydration rule

The first client render must produce exactly the same layout as the server render.

Therefore:

* Do not read `window`.
* Do not read `localStorage`.
* Do not call `getBoundingClientRect()`.
* Do not load `LayoutCache`.
* Do not use actual container width.

All browser reads happen in layout/effect after hydration.

## 6.3 After hydration

Client sequence:

```txt
hydrate with SSR estimate
  ↓
measure root width
  ↓
load local LayoutCache
  ↓
if exact cache hit: swap to cached layout before/near first paint
  ↓
else compute actual layout
  ↓
query viewport using rect tracking
```

`useLayoutEffect` should be used in the browser; on the server it must become a no-op isomorphic effect to avoid warnings.

## 6.4 Avoiding layout flash

Expose:

```ts
ssr.hydration: "preserve" | "hide-until-measured"
```

`"preserve"` shows the estimated layout immediately and accepts possible reflow.

`"hide-until-measured"` applies:

```css
visibility: hidden;
```

until the first actual client layout is ready. This avoids visual flash at the cost of a brief blank grid.

Default: `"preserve"` for content visibility.

## 6.5 Unknown dimensions

Do not silently pretend unknown dimensions are square without surfacing it. The current implementation does that and the assessment calls it a real correctness issue. 

Rules:

* If `getItemSize` returns dimensions, layout is deterministic before images load.
* If dimensions are unknown and `estimateHeight` is absent, default to square **and warn in dev once**.
* If `measurement: "visible"`, visible item wrapper heights correct estimates after mount.
* Corrections recompute from the changed item’s index, not the whole array unless index `0` changed.

---

# 7. Responsive reflow design

## 7.1 Column resolution

```ts
columns: 4
```

means fixed.

```ts
columns: { minWidth: 220, min: 2, max: 6 }
```

means:

```ts
count = clamp(floor((containerWidth + gapX) / (minWidth + gapX)), min, max)
columnWidth = (containerWidth - gapX * (count - 1)) / count
```

```ts
columns: (width) => width < 700 ? 2 : 4
```

means consumer-defined.

## 7.2 What can be incremental

Dynamic item changes can be incremental by suffix:

```txt
append at end       → compute appended suffix
remove at end       → trim positions
change item at i    → recompute [i, n)
insert at i         → recompute [i, n)
reorder at i        → recompute [i, n)
```

This is exact because shortest-column greedy is prefix-deterministic: the suffix depends only on the column heights produced by the prefix.

## 7.3 What cannot be honestly incremental

A column-count change from 4 to 3 cannot preserve exact shortest-column layout without recalculating from the beginning. The first few items may land differently, and every later column height depends on those choices.

So the correct v0.1/v0.2 behavior is:

```txt
column count changed → exact full O(n) recompute
```

This is acceptable because the layout algorithm is linear with a tiny column factor. For 10k–50k items, array math is usually cheaper than React work, image decoding, or DOM rendering.

## 7.4 Practical optimization instead of fake complexity

The lightweight answer is:

1. Recompute only on resolved column-count changes or width changes above `1px`.
2. rAF-batch resize updates.
3. Use `React.startTransition` when available for large recomputes.
4. Cache per column bucket.
5. Query/render only visible items after recompute.

## 7.5 Optional v0.3 stable reflow

For same `columnCount` but changed `columnWidth`, a `stable-reflow` cache mode may preserve column assignments and recompute each column’s y stack. It reduces jitter and skips shortest-column decisions, but it is not guaranteed to match fresh greedy layout.

Do not make this the default until the library has visual tests proving the tradeoff is worth it.

---

# 8. Competitive gap architecture

## What this library offers that masonic does not emphasize

1. **Scroll-container-agnostic by default.** No scroll parent ref, no scrollTop prop, no scroll parent traversal. The rect root is the coordinate system.

2. **Small exported engine.** The engine is not an implementation detail of a large component. It is a named export for headless rendering, Canvas, testing, and app-specific UI.

3. **Layout persistence.** Exact cache hits skip layout calculation entirely on revisit. Partial hits reuse stable prefixes.

4. **SSR-safe deterministic first render.** Not perfect SSR, but deterministic, hydratable SSR with explicit tradeoffs.

5. **Separate horizontal/vertical gaps.** The current bug becomes an intentional API feature.

6. **Known-dimensions-first philosophy.** For asset grids, image/video dimensions usually exist or can be known. The library should reward that with simpler runtime behavior.

## What masonic offers that this library deliberately excludes

masonic offers a broader “batteries included” surface: interval tree indexing, autosizing, lower-level scroller/container hooks, item resize handling, infinite loading utilities, and many customization props. Its docs position it as versatile and export-heavy. ([GitHub][1]) ([GitHub][2])

RectMasonry excludes:

* Built-in infinite loading.
* Built-in item components.
* Built-in selection/focus model.
* Built-in drag/drop.
* Built-in image loading.
* ScrollTop-controlled low-level component in v0.1.
* Generic interval tree.
* Per-item permanent resize observers.
* CSS/theming system.

Tradeoff:

```txt
masonic       → maximum flexibility and mature feature surface
RectMasonry   → minimum weight, rect-scroll virtualization, headless engine, layout cache
```

---

# 9. Incremental build order

## v0.1 — shippable core

Goal: someone can install it and render a fast virtualized masonry grid today.

Included:

* TypeScript strict.
* React 18+ peer dependency.
* `computeMasonryLayout`.
* `MasonryEngine`.
* `SpatialIndex`.
* `useMasonry`.
* `MasonryGrid`.
* BoundingClientRect scroll tracking.
* Container width measurement.
* Fixed and responsive columns.
* Separate `gap.x` / `gap.y`.
* Pixel overscan.
* Known dimensions and estimated heights.
* SSR-safe no-crash behavior, but only `shell` mode.

Excluded:

* Persistent cache.
* Partial cache hits.
* Visible measurement correction.
* Static SSR item rendering.
* Stable same-column reflow.
* Dev warning polish beyond essentials.

Why useful: it is already “masonic but smaller” for known-dimension asset grids.

## v0.2 — differentiator release

Goal: the reason to choose this library over alternatives.

Included:

* `LayoutCache`.
* Cache load path wired before layout.
* Exact cache hits.
* Partial prefix hits.
* TTL/version invalidation.
* Quota-safe save/prune.
* Cache status in hook/component.
* `invalidateCache`.
* Dynamic append/remove/reorder suffix recompute.
* Cache docs with examples for Rikka/Omote-style asset grids.

Excluded:

* Compatible same-column reflow.
* Visible ResizeObserver correction.
* Static SSR first slice.

Why useful: persistent layouts make revisiting large grids feel instant.

## v0.3 — complete vision

Goal: robust infrastructure for years of reuse.

Included:

* `ssr.mode: "static"`.
* `ssr.initialLayout`.
* `hydration: "preserve" | "hide-until-measured"`.
* `measurement: "visible"` with one shared `ResizeObserver`.
* Fallback measurement path when `ResizeObserver` is absent.
* Responsive cache buckets.
* Optional compatible same-column reflow behind policy.
* Dev diagnostics for transforms, missing dimensions, unstable keys, self-scroll root.
* Focus retention for currently focused virtualized item.

Excluded permanently:

* App-specific UI.
* Built-in infinite loader.
* Drag/drop.
* A full generic interval tree.
* Mandatory scroll container refs.

---

# 10. Failure mode catalog

## BoundingClientRect scroll tracking

| Failure                           | Condition                                          |                        Severity | Mitigation                                                                                                                    |
| --------------------------------- | -------------------------------------------------- | ------------------------------: | ----------------------------------------------------------------------------------------------------------------------------- |
| Root is its own scroll viewport   | `overflow:auto` on masonry root                    |             Visible range stale | Document required structure; dev warning if `root.scrollHeight > root.clientHeight` and rect top does not change after scroll |
| Cross-origin iframe parent scroll | Parent page scrolls iframe, child cannot observe   | Over/under-render inside iframe | Document “same document only”; no fake fix                                                                                    |
| Scaled transform ancestor         | `transform: scale(...)`                            |           Incorrect coordinates | Detect `rect.height / offsetHeight`; warn; recommend disabling virtualization or moving root                                  |
| Translated/animated ancestor      | transform changes without scroll                   |  Spurious visible range updates | `refresh()` after animations; document unsupported for animated layout roots                                                  |
| Layout shift above grid           | Content above changes height without scroll/resize |           Temporary stale range | Refresh after mount/layout/cache; expose `refresh()`                                                                          |
| Fixed root                        | Root does not move during scroll                   |                     Stale range | Require inner content root inside scroll area                                                                                 |
| Tiny subpixel scrolls             | fractional `rect.top`                              |                 Harmless jitter | Preserve floats; avoid rounding until style string                                                                            |

## SpatialIndex

| Failure                                  | Condition                      |                            Severity | Mitigation                                                                |
| ---------------------------------------- | ------------------------------ | ----------------------------------: | ------------------------------------------------------------------------- |
| Overlap within a column                  | Bad external entries           |        Missed/duplicated visibility | Engine guarantees invariant; dev validation for standalone `SpatialIndex` |
| Very tall item spans many screens        | Item starts far above viewport | Could be missed by naïve top search | Query by `bottom >= viewportTop` per column                               |
| Huge overscan                            | Overscan renders thousands     |             Performance degradation | Pixel overscan default; document tuning                                   |
| 50k+ positions as objects                | Large memory use               |                     Memory pressure | Keep entries compact internally; cache serializes only primitives         |
| Visual order conflicts with source order | `domOrder: "visual"`           |         Keyboard order may surprise | Default `source`; no false accessibility claim                            |

## LayoutCache

| Failure                      | Condition                            |                   Severity | Mitigation                                            |
| ---------------------------- | ------------------------------------ | -------------------------: | ----------------------------------------------------- |
| Corrupt JSON                 | Manual storage edit/version bug      |   Cache miss or crash risk | Catch, remove entry, `onError`                        |
| Quota exceeded               | Large layouts/localStorage full      |               Save failure | Prune expired/old entries; retry once                 |
| Wrong `getKey` collisions    | Consumer returns duplicate keys      |   Silent layout corruption | Dev duplicate-key warning; docs mark as invariant     |
| Metadata-only item updates   | New item objects but same dimensions |         Unneeded recompute | `getItemLayoutKey` ignores metadata                   |
| Item inserted near beginning | Prefix small                         |        Near full recompute | Honest suffix recompute; no unsafe migration          |
| Column count changed         | Responsive breakpoint                |             Full recompute | Separate cache entry per column count                 |
| Width changed by 1px         | Browser resize noise                 | Cache miss/recompute churn | rAF batch; optional tolerance; future compatible mode |
| Version upgrade              | Algorithm/schema changes             |            Stale positions | `schemaVersion` + `algorithmVersion` invalidation     |
| SSR                          | No `localStorage`                    |                 Crash risk | `storage: null` on server                             |

## SSR/hydration

| Failure                        | Condition                                       |                      Severity | Mitigation                                              |
| ------------------------------ | ----------------------------------------------- | ----------------------------: | ------------------------------------------------------- |
| Hydration mismatch             | Client first render reads actual width/cache    | React warning/DOM replacement | First client render must use SSR estimate only          |
| Layout flash                   | Actual client width differs from `initialWidth` |                 Visible shift | `hydration: "hide-until-measured"` option               |
| Bad initial height             | Server renders too few/many items               |           Blank/extra content | `initialHeight` and `initialItemCount` controls         |
| Unknown dimensions             | No sizes on server                              |        Estimated layout shift | `estimateHeight`; dev warning; visible measurement v0.3 |
| Cache unavailable until client | Local cache cannot help server HTML             |         Initial estimate only | Optional `ssr.initialLayout`                            |

## Responsive reflow

| Failure                  | Condition                       |             Severity | Mitigation                                          |
| ------------------------ | ------------------------------- | -------------------: | --------------------------------------------------- |
| Rapid resize             | Dragging window/mobile rotation |            CPU churn | rAF batch; only commit changed resolved width/count |
| 4→3 columns on 50k items | Breakpoint crossed              |     Linear recompute | Use transition/idle; cache per bucket               |
| Same-column width drift  | Width changes but count same    | Many y values change | Exact recompute default; compatible mode optional   |
| Container width zero     | Hidden tab/display none         |         Empty layout | Recompute when width becomes positive               |

## Visible measurement

| Failure                   | Condition                             |               Severity | Mitigation                                                |
| ------------------------- | ------------------------------------- | ---------------------: | --------------------------------------------------------- |
| `ResizeObserver` absent   | Older/sandboxed environment           | Estimates remain wrong | Fallback mount measurement; dev warning                   |
| ResizeObserver loop       | Sync layout writes inside callback    |        Browser warning | Batch in rAF; never recompute inside observer callback    |
| Async image decode        | Rendered height changes               |           Layout shift | `measurement: "visible"`; recompute suffix                |
| Early item changes height | Index near 0                          |  Full suffix recompute | Encourage provided dimensions; threshold updates          |
| Unmounted focused item    | Virtualization removes active element |                 UX bug | v0.3 focus retention: keep active item mounted until blur |

## React rendering

| Failure                              | Condition                           |                  Severity | Mitigation                                                     |
| ------------------------------------ | ----------------------------------- | ------------------------: | -------------------------------------------------------------- |
| Consumer uses array index key        | Reorder/delete                      | Cache corruption/remounts | Require `getKey`; dev warnings for duplicates                  |
| `renderItem` closes over heavy state | Frequent visible updates            |            React slowdown | Headless API lets consumer memoize; docs examples              |
| Permanent `will-change`              | Many visible items                  |       GPU memory pressure | Do not set by default; assessment warns against this pattern.  |
| Overclaimed accessibility            | Visual masonry != DOM reading order |           Misleading docs | Default source DOM order; document tradeoff                    |

---

# 11. Concrete file tree with line-count estimates

Implementation target: **~760 lines excluding types, tests, and docs**.

```txt
rect-masonry/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts                    ~10 lines
    types.ts                   ~170 lines   excluded from implementation target
    engine.ts                  ~145 lines
    spatial-index.ts           ~105 lines
    signature.ts                ~45 lines
    layout-cache.ts            ~135 lines
    use-container-size.ts       ~45 lines
    use-rect-viewport.ts        ~65 lines
    use-visible-measurement.ts  ~50 lines
    use-masonry.tsx            ~135 lines
    MasonryGrid.tsx             ~45 lines
  test/
    engine.test.ts
    spatial-index.test.ts
    layout-cache.test.ts
    use-masonry.test.tsx
    ssr.test.tsx
  examples/
    basic-known-dimensions.tsx
    headless-canvas.tsx
    cache-persistence.tsx
    ssr-static.tsx
```

Line budget by version:

```txt
v0.1 implementation: ~445 lines
  engine, spatial-index, use-container-size, use-rect-viewport, use-masonry, MasonryGrid

v0.2 implementation: ~625 lines
  add layout-cache, signature, cache integration

v0.3 implementation: ~760 lines
  add visible measurement, SSR static mode, diagnostics
```

---

# 12. Final architecture summary

The library should be built around three invariants:

1. **The layout engine is deterministic and independent of React.**
2. **The viewport is derived from the root rect, not from scroll-parent discovery.**
3. **Cache is part of layout input resolution, not an after-render optimization.**

The most important design restraint is to avoid turning this into a smaller masonic clone. masonic is already the mature maximum-flexibility option. RectMasonry should be the lightweight infrastructure option: known dimensions first, rect-scroll virtualization, column-aware `SpatialIndex`, persistent layouts, SSR-safe estimates, and a headless API that lets Omote, Rikka, and future tools render however they want.

[1]: https://github.com/jaredLunde/masonic "GitHub - jaredLunde/masonic:  High-performance masonry layouts for React · GitHub"
[2]: https://github.com/jaredLunde/masonic/blob/main/docs/v2.md "masonic/docs/v2.md at main · jaredLunde/masonic · GitHub"
[3]: https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect?utm_source=chatgpt.com "Element: getBoundingClientRect() method - Web APIs | MDN"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver?utm_source=chatgpt.com "ResizeObserver - Web APIs | MDN"
