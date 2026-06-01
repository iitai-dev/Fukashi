import type * as React from "react";

export type MasonryKey = string | number;

export interface MasonryItemSize {
  width: number;
  height: number;
}

export type MasonryItemSizeInput = MasonryItemSize | null | undefined;

export type MasonryGap =
  | number
  | {
      x?: number;
      y?: number;
      column?: number;
      row?: number;
      horizontal?: number;
      vertical?: number;
    };

export interface ResolvedMasonryGap {
  x: number;
  y: number;
}

export type MasonryColumns =
  | number
  | ((width: number) => number)
  | {
      count?: number;
      minWidth?: number;
      min?: number;
      max?: number;
    };

export interface ResolvedMasonryColumns {
  count: number;
  width: number;
  gap: ResolvedMasonryGap;
}

export type MasonryItemKeyGetter<T> = (item: T, index: number) => MasonryKey;
export type MasonryItemSizeGetter<T> = (item: T, index: number) => MasonryItemSizeInput;
export type MasonryItemLayoutKeyGetter<T> = (
  item: T,
  index: number
) => MasonryKey | MasonryItemSizeInput | null | undefined;
export type MasonryEstimateHeight<T> =
  | number
  | ((item: T, index: number, columnWidth: number) => number);

export interface LayoutSignature {
  id: string;
  algorithmVersion: string;
  width: number;
  columnCount: number;
  columnWidth: number;
  gapX: number;
  gapY: number;
  itemCount: number;
  itemKeysHash: string;
  itemLayoutHash: string;
}

export interface MasonryPosition<T = unknown> {
  key: MasonryKey;
  item: T;
  index: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bottom: number;
  estimated: boolean;
  layoutKey: string;
}

export type MasonrySeedPosition<T = unknown> = Omit<MasonryPosition<T>, "item"> & {
  item?: T;
};

export interface MasonryLayoutSeed<T = unknown> {
  positions: MasonrySeedPosition<T>[];
  columnHeights: number[];
  containerHeight: number;
  validUntil: number;
  signature?: Partial<LayoutSignature>;
  source?: "cache" | "cache-partial" | "manual";
}

export type MasonryLayoutSource = "empty" | "computed" | "cache" | "cache-partial";

export interface MasonryLayout<T = unknown> {
  positions: MasonryPosition<T>[];
  containerHeight: number;
  columnHeights: number[];
  columnCount: number;
  columnWidth: number;
  gap: ResolvedMasonryGap;
  signature: LayoutSignature;
  itemKeys: string[];
  itemLayoutKeys: string[];
  estimatedCount: number;
  source: MasonryLayoutSource;
}

export interface MasonryLayoutInput<T> {
  items: readonly T[];
  width: number;
  getKey: MasonryItemKeyGetter<T>;
  getItemSize?: MasonryItemSizeGetter<T>;
  getItemLayoutKey?: MasonryItemLayoutKeyGetter<T>;
  estimateHeight?: MasonryEstimateHeight<T>;
  columns?: MasonryColumns;
  gap?: MasonryGap;
  seed?: MasonryLayoutSeed<T> | null;
  warnOnMissingSize?: boolean;
  algorithmVersion?: string;
}

export interface LayoutCacheLoadRequest {
  signature: LayoutSignature;
  itemKeys: readonly string[];
  itemLayoutKeys: readonly string[];
}

export type LayoutCacheLoadStatus = "hit" | "partial" | "miss";

export interface LayoutCacheLoadResult {
  status: LayoutCacheLoadStatus;
  reason?: string;
  validUntil?: number;
  seed?: MasonryLayoutSeed<unknown>;
}

export interface MasonryCacheAdapter {
  load(cacheKey: string, request: LayoutCacheLoadRequest): LayoutCacheLoadResult;
  save<T>(cacheKey: string, layout: MasonryLayout<T>): boolean;
  invalidate?(cacheKey: string): void;
}

export interface MasonryEngineOptions<T = unknown> {
  columns?: MasonryColumns;
  gap?: MasonryGap;
  estimateHeight?: MasonryEstimateHeight<T>;
  getItemSize?: MasonryItemSizeGetter<T>;
  getItemLayoutKey?: MasonryItemLayoutKeyGetter<T>;
  warnOnMissingSize?: boolean;
  algorithmVersion?: string;
  cache?: MasonryCacheAdapter | false | null;
  cacheKey?: string;
}

export type MasonryEngineLayoutInput<T> = MasonryLayoutInput<T> & {
  cache?: MasonryCacheAdapter | false | null;
  cacheKey?: string;
};

export interface SpatialEntry<Meta = unknown> {
  key: MasonryKey;
  index: number;
  column: number;
  top: number;
  bottom: number;
  meta: Meta;
}

export type SpatialQueryOrder = "source" | "visual" | "none";

export interface SpatialIndexOptions<Meta = unknown> {
  order?: SpatialQueryOrder;
  assertInvariant?: boolean;
  getVisualX?: (entry: SpatialEntry<Meta>) => number;
}

export interface StorageLike {
  readonly length?: number;
  key?(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LayoutCacheOptions {
  namespace?: string;
  storage?: StorageLike | null;
  ttlMs?: number;
  maxEntries?: number;
  algorithmVersion?: string;
  now?: () => number;
}

export interface CachedMasonryLayout {
  schemaVersion: 1;
  algorithmVersion: string;
  createdAt: number;
  touchedAt: number;
  signature: LayoutSignature;
  itemKeys: string[];
  itemLayoutKeys: string[];
  positions: MasonrySeedPosition[];
  columnHeights: number[];
  containerHeight: number;
}

export interface RectViewport {
  viewportTop: number;
  viewportBottom: number;
  viewportHeight: number;
  rootRect: DOMRectReadOnly | null;
  refresh: () => void;
}

export interface UseRectViewportOptions {
  disabled?: boolean;
  warnOnScaledRoot?: boolean;
}

export type MasonryStatus = "disabled" | "measuring" | "ready" | "virtualized";

export interface MasonryVisibleItem<T = unknown> extends MasonryPosition<T> {
  style: React.CSSProperties;
}

export interface UseMasonryOptions<T> extends Omit<MasonryLayoutInput<T>, "width" | "seed"> {
  width?: number;
  initialWidth?: number;
  disabled?: boolean;
  overscan?: number;
  order?: SpatialQueryOrder;
  cache?: MasonryCacheAdapter | false | null;
  cacheKey?: string;
}

export interface UseMasonryResult<T> {
  rootRef: React.RefObject<HTMLDivElement>;
  layout: MasonryLayout<T>;
  visibleItems: MasonryVisibleItem<T>[];
  viewport: RectViewport;
  status: MasonryStatus;
  refresh: () => void;
  containerStyle: React.CSSProperties;
}

export interface MasonryRenderContext<T> {
  key: MasonryKey;
  index: number;
  position: MasonryPosition<T>;
  style: React.CSSProperties;
  layout: MasonryLayout<T>;
  estimated: boolean;
}

export type MasonryItemStyle<T> =
  | React.CSSProperties
  | ((item: T, context: MasonryRenderContext<T>) => React.CSSProperties | undefined);

export interface MasonryGridProps<T> extends UseMasonryOptions<T> {
  renderItem: (item: T, context: MasonryRenderContext<T>) => React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  itemClassName?: string;
  itemStyle?: MasonryItemStyle<T>;
}
