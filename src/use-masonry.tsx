import { useCallback, useMemo, useRef } from "react";
import {
  type MasonryVisibleItem,
  type UseMasonryOptions,
  type UseMasonryResult
} from "./types";
import { MasonryEngine } from "./engine";
import { createSpatialIndexFromLayout } from "./spatial-index";
import { useContainerSize } from "./use-container-size";
import { useRectViewport } from "./use-rect-viewport";

function createVisibleStyle(x: number, y: number, width: number, height: number) {
  return {
    position: "absolute" as const,
    width,
    height,
    transform: "translate3d(" + x + "px, " + y + "px, 0)"
  };
}

export function useMasonry<T>(options: UseMasonryOptions<T>): UseMasonryResult<T> {
  const rootRef = useRef<HTMLDivElement>(null);
  const measured = useContainerSize(rootRef, {
    disabled: options.disabled,
    initialWidth: options.initialWidth
  });
  const width = typeof options.width === "number" ? options.width : measured.width;
  const viewport = useRectViewport(rootRef, {
    disabled: options.disabled
  });

  const engine = useMemo(
    () =>
      new MasonryEngine<T>({
        cache: options.cache,
        cacheKey: options.cacheKey
      }),
    [options.cache, options.cacheKey]
  );

  const layout = useMemo(
    () =>
      engine.compute({
        items: options.items,
        width,
        getKey: options.getKey,
        getItemSize: options.getItemSize,
        getItemLayoutKey: options.getItemLayoutKey,
        estimateHeight: options.estimateHeight,
        columns: options.columns,
        gap: options.gap,
        warnOnMissingSize: options.warnOnMissingSize,
        algorithmVersion: options.algorithmVersion,
        cache: options.cache,
        cacheKey: options.cacheKey
      }),
    [
      engine,
      options.algorithmVersion,
      options.cache,
      options.cacheKey,
      options.columns,
      options.estimateHeight,
      options.gap,
      options.getItemLayoutKey,
      options.getItemSize,
      options.getKey,
      options.items,
      options.warnOnMissingSize,
      width
    ]
  );

  const index = useMemo(() => createSpatialIndexFromLayout(layout), [layout]);
  const overscan = options.overscan ?? 800;
  const order = options.order ?? "source";

  const visibleItems = useMemo<MasonryVisibleItem<T>[]>(() => {
    if (options.disabled || layout.positions.length === 0) {
      return [];
    }

    const top = viewport.viewportTop - overscan;
    const bottom = viewport.viewportBottom + overscan;
    const entries = index.queryRange(top, bottom, order);

    return entries.map((entry) => ({
      ...entry.meta,
      style: createVisibleStyle(entry.meta.x, entry.meta.y, entry.meta.width, entry.meta.height)
    }));
  }, [
    index,
    layout.positions.length,
    options.disabled,
    order,
    overscan,
    viewport.viewportBottom,
    viewport.viewportTop
  ]);

  const refresh = useCallback(() => {
    measured.refresh();
    viewport.refresh();
  }, [measured, viewport]);

  const invalidateCache = useCallback(() => {
    if (!options.cache || !options.cacheKey) {
      return;
    }

    if (options.cache.invalidate) {
      options.cache.invalidate(options.cacheKey);
      return;
    }

    options.cache.remove?.(options.cacheKey);
  }, [options.cache, options.cacheKey]);

  const status = options.disabled
    ? "disabled"
    : width <= 0
      ? "measuring"
      : visibleItems.length < layout.positions.length
        ? "virtualized"
        : "ready";

  return {
    rootRef,
    layout,
    visibleItems,
    viewport,
    status,
    cache: layout.cache,
    refresh,
    invalidateCache,
    containerStyle: {
      position: "relative",
      width: "100%",
      height: layout.containerHeight
    }
  };
}
