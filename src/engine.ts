import {
  type LayoutSignature,
  type MasonryCacheAdapter,
  type MasonryColumns,
  type MasonryEngineLayoutInput,
  type MasonryEngineOptions,
  type MasonryEstimateHeight,
  type MasonryGap,
  type MasonryItemLayoutKeyGetter,
  type MasonryItemSize,
  type MasonryItemSizeGetter,
  type MasonryLayout,
  type MasonryLayoutInput,
  type MasonryLayoutSeed,
  type MasonryLayoutSource,
  type MasonryPosition,
  type ResolvedMasonryColumns,
  type ResolvedMasonryGap
} from "./types";
import { hashList, hashRecord, stringifyKey } from "./signature";

export const FUKASHI_LAYOUT_ALGORITHM_VERSION = "fukashi-shortest-column-v1";

let warnedAboutMissingSize = false;

interface PreparedLayout<T> {
  input: MasonryLayoutInput<T>;
  items: readonly T[];
  width: number;
  gap: ResolvedMasonryGap;
  columns: ResolvedMasonryColumns;
  itemKeys: string[];
  itemLayoutKeys: string[];
  sizes: Array<MasonryItemSize | null>;
  signature: LayoutSignature;
}

function finitePixel(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function resolveGap(gap: MasonryGap | undefined): ResolvedMasonryGap {
  if (typeof gap === "number") {
    const value = finitePixel(gap, 0);
    return { x: value, y: value };
  }

  if (!gap) {
    return { x: 0, y: 0 };
  }

  const x = finitePixel(gap.x ?? gap.column ?? gap.horizontal, 0);
  const y = finitePixel(gap.y ?? gap.row ?? gap.vertical, 0);
  return { x, y };
}

function clampColumnCount(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, safe));
}

export function resolveColumns(
  width: number,
  columns: MasonryColumns | undefined,
  gap: ResolvedMasonryGap
): ResolvedMasonryColumns {
  const safeWidth = finitePixel(width, 0);

  if (safeWidth <= 0) {
    return { count: 0, width: 0, gap };
  }

  let count: number;

  if (typeof columns === "number") {
    count = clampColumnCount(columns, 1, Number.MAX_SAFE_INTEGER);
  } else if (typeof columns === "function") {
    count = clampColumnCount(columns(safeWidth), 1, Number.MAX_SAFE_INTEGER);
  } else {
    const min = clampColumnCount(columns?.min ?? 1, 1, Number.MAX_SAFE_INTEGER);
    const max = clampColumnCount(columns?.max ?? Number.MAX_SAFE_INTEGER, min, Number.MAX_SAFE_INTEGER);

    if (typeof columns?.count === "number") {
      count = clampColumnCount(columns.count, min, max);
    } else {
      const minWidth = finitePixel(columns?.minWidth, 240) || 240;
      const fitted = Math.floor((safeWidth + gap.x) / (minWidth + gap.x));
      count = clampColumnCount(fitted || 1, min, max);
    }
  }

  const columnWidth = Math.max(0, (safeWidth - gap.x * (count - 1)) / count);
  return { count, width: columnWidth, gap };
}

function normalizeSize(size: unknown): MasonryItemSize | null {
  if (!size || typeof size !== "object") {
    return null;
  }

  const candidate = size as MasonryItemSize;
  if (
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    Number.isFinite(candidate.width) &&
    Number.isFinite(candidate.height) &&
    candidate.width > 0 &&
    candidate.height > 0
  ) {
    return { width: candidate.width, height: candidate.height };
  }

  return null;
}

function layoutKeyFromExplicit<T>(
  getter: MasonryItemLayoutKeyGetter<T> | undefined,
  item: T,
  index: number
): string | null {
  if (!getter) {
    return null;
  }

  const value = getter(item, index);

  if (value == null) {
    return null;
  }

  if (typeof value === "object") {
    const size = normalizeSize(value);
    return size ? "size:" + size.width + "x" + size.height : "estimate";
  }

  return stringifyKey(value);
}

function layoutKeyFromSize(size: MasonryItemSize | null): string {
  return size ? "size:" + size.width + "x" + size.height : "estimate";
}

function estimateHeight<T>(
  estimate: MasonryEstimateHeight<T> | undefined,
  item: T,
  index: number,
  columnWidth: number
): number {
  if (typeof estimate === "function") {
    return finitePixel(estimate(item, index, columnWidth), columnWidth);
  }

  if (typeof estimate === "number") {
    return finitePixel(estimate, columnWidth);
  }

  return columnWidth;
}

function warnMissingSizeOnce(enabled: boolean): void {
  if (!enabled || warnedAboutMissingSize) {
    return;
  }

  warnedAboutMissingSize = true;

  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("[fukashi] Some items have no valid dimensions. Estimated heights are being used.");
  }
}

function prepareLayout<T>(input: MasonryLayoutInput<T>): PreparedLayout<T> {
  const width = finitePixel(input.width, 0);
  const gap = resolveGap(input.gap);
  const columns = resolveColumns(width, input.columns, gap);
  const itemKeys: string[] = [];
  const itemLayoutKeys: string[] = [];
  const sizes: Array<MasonryItemSize | null> = [];

  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    const size = normalizeSize(input.getItemSize?.(item, index));
    const explicitKey = layoutKeyFromExplicit(input.getItemLayoutKey, item, index);
    itemKeys.push(stringifyKey(input.getKey(item, index)));
    itemLayoutKeys.push(explicitKey ?? layoutKeyFromSize(size));
    sizes.push(size);
  }

  const algorithmVersion = input.algorithmVersion ?? FUKASHI_LAYOUT_ALGORITHM_VERSION;
  const itemKeysHash = hashList(itemKeys);
  const itemLayoutHash = hashList(itemLayoutKeys);
  const signatureBase = {
    algorithmVersion,
    width,
    columnCount: columns.count,
    columnWidth: columns.width,
    gapX: gap.x,
    gapY: gap.y,
    itemCount: input.items.length,
    itemKeysHash,
    itemLayoutHash
  };

  const signature: LayoutSignature = {
    ...signatureBase,
    id: hashRecord(signatureBase)
  };

  return {
    input,
    items: input.items,
    width,
    gap,
    columns,
    itemKeys,
    itemLayoutKeys,
    sizes,
    signature
  };
}

function isSeedCompatible<T>(seed: MasonryLayoutSeed<T>, signature: LayoutSignature): boolean {
  if (!seed.signature) {
    return true;
  }

  const seedSignature = seed.signature;
  return (
    (seedSignature.algorithmVersion == null || seedSignature.algorithmVersion === signature.algorithmVersion) &&
    (seedSignature.width == null || seedSignature.width === signature.width) &&
    (seedSignature.columnCount == null || seedSignature.columnCount === signature.columnCount) &&
    (seedSignature.columnWidth == null || seedSignature.columnWidth === signature.columnWidth) &&
    (seedSignature.gapX == null || seedSignature.gapX === signature.gapX) &&
    (seedSignature.gapY == null || seedSignature.gapY === signature.gapY)
  );
}

function shortestColumn(columnHeights: number[]): number {
  let column = 0;

  for (let index = 1; index < columnHeights.length; index += 1) {
    if (columnHeights[index] < columnHeights[column]) {
      column = index;
    }
  }

  return column;
}

function computeContainerHeight(columnHeights: number[], gapY: number, hasItems: boolean): number {
  if (!hasItems) {
    return 0;
  }

  return Math.max(0, Math.max(...columnHeights, 0) - gapY);
}

function computePreparedLayout<T>(
  prepared: PreparedLayout<T>,
  seed: MasonryLayoutSeed<T> | null | undefined,
  sourceOverride?: MasonryLayoutSource
): MasonryLayout<T> {
  const { columns, gap, input, itemKeys, itemLayoutKeys, items, signature, sizes } = prepared;
  const columnCount = columns.count;
  const columnWidth = columns.width;
  const positions: MasonryPosition<T>[] = [];
  const columnHeights = Array.from({ length: columnCount }, () => 0);
  let estimatedCount = 0;
  let seedAccepted = 0;

  if (items.length === 0 || columnCount <= 0 || columnWidth <= 0) {
    return {
      positions,
      containerHeight: 0,
      columnHeights,
      columnCount,
      columnWidth,
      gap,
      signature,
      itemKeys,
      itemLayoutKeys,
      estimatedCount: 0,
      source: "empty"
    };
  }

  if (seed && isSeedCompatible(seed, signature)) {
    const limit = Math.min(seed.validUntil, seed.positions.length, items.length);

    for (let index = 0; index < limit; index += 1) {
      const cached = seed.positions[index];

      if (stringifyKey(cached.key) !== itemKeys[index] || cached.layoutKey !== itemLayoutKeys[index]) {
        break;
      }

      if (cached.column < 0 || cached.column >= columnCount) {
        break;
      }

      const position: MasonryPosition<T> = {
        key: cached.key,
        item: items[index],
        index,
        column: cached.column,
        x: cached.x,
        y: cached.y,
        width: cached.width,
        height: cached.height,
        bottom: cached.y + cached.height,
        estimated: cached.estimated,
        layoutKey: cached.layoutKey
      };

      positions.push(position);
      columnHeights[position.column] = Math.max(columnHeights[position.column], position.bottom + gap.y);
      seedAccepted += 1;
      if (position.estimated) {
        estimatedCount += 1;
      }
    }
  }

  for (let index = seedAccepted; index < items.length; index += 1) {
    const item = items[index];
    const size = sizes[index];
    const column = shortestColumn(columnHeights);
    const x = column * (columnWidth + gap.x);
    const y = columnHeights[column];
    const hasSize = Boolean(size);
    const height = size
      ? (columnWidth * size.height) / size.width
      : estimateHeight(input.estimateHeight, item, index, columnWidth);

    if (!hasSize) {
      estimatedCount += 1;
      warnMissingSizeOnce(input.warnOnMissingSize !== false);
    }

    const position: MasonryPosition<T> = {
      key: input.getKey(item, index),
      item,
      index,
      column,
      x,
      y,
      width: columnWidth,
      height,
      bottom: y + height,
      estimated: !hasSize,
      layoutKey: itemLayoutKeys[index]
    };

    positions.push(position);
    columnHeights[column] = position.bottom + gap.y;
  }

  let source: MasonryLayoutSource = "computed";

  if (sourceOverride) {
    source = sourceOverride;
  } else if (seedAccepted > 0 && seedAccepted === items.length) {
    source = "cache";
  } else if (seedAccepted > 0) {
    source = "cache-partial";
  }

  return {
    positions,
    containerHeight: computeContainerHeight(columnHeights, gap.y, positions.length > 0),
    columnHeights,
    columnCount,
    columnWidth,
    gap,
    signature,
    itemKeys,
    itemLayoutKeys,
    estimatedCount,
    source
  };
}

export function computeMasonryLayout<T>(input: MasonryLayoutInput<T>): MasonryLayout<T> {
  return computePreparedLayout(prepareLayout(input), input.seed);
}

export class MasonryEngine<T = unknown> {
  private readonly defaults: MasonryEngineOptions<T>;

  constructor(options: MasonryEngineOptions<T> = {}) {
    this.defaults = options;
  }

  compute(input: MasonryEngineLayoutInput<T>): MasonryLayout<T> {
    const merged: MasonryLayoutInput<T> = {
      ...this.defaults,
      ...input,
      items: input.items,
      width: input.width,
      getKey: input.getKey
    };
    const prepared = prepareLayout(merged);
    const cache = input.cache !== undefined ? input.cache : this.defaults.cache;
    const cacheKey = input.cacheKey ?? this.defaults.cacheKey;
    let seed = input.seed ?? null;
    let sourceOverride: MasonryLayoutSource | undefined;

    if (!seed && cache && cacheKey) {
      const hit = cache.load(cacheKey, {
        signature: prepared.signature,
        itemKeys: prepared.itemKeys,
        itemLayoutKeys: prepared.itemLayoutKeys
      });

      if (hit.seed) {
        seed = hit.seed as MasonryLayoutSeed<T>;
        sourceOverride = hit.status === "hit" ? "cache" : "cache-partial";
      }
    }

    const layout = computePreparedLayout(prepared, seed, sourceOverride);

    if (cache && cacheKey && layout.source !== "empty") {
      cache.save(cacheKey, layout);
    }

    return layout;
  }
}

export function createMasonryEngine<T = unknown>(options: MasonryEngineOptions<T> = {}): MasonryEngine<T> {
  return new MasonryEngine<T>(options);
}
