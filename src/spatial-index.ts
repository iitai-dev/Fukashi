import type {
  MasonryLayout,
  MasonryPosition,
  SpatialEntry,
  SpatialIndexOptions,
  SpatialQueryOrder
} from "./types";

let warnedAboutInvariant = false;

function binarySearchFirstBottom<Meta>(entries: SpatialEntry<Meta>[], top: number): number {
  let low = 0;
  let high = entries.length - 1;
  let answer = entries.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (entries[mid].bottom >= top) {
      answer = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return answer;
}

function warnInvariant(message: string): void {
  if (warnedAboutInvariant) {
    return;
  }

  warnedAboutInvariant = true;

  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("[fukashi] " + message);
  }
}

export class SpatialIndex<Meta = unknown> {
  private entries: SpatialEntry<Meta>[] = [];
  private columns = new Map<number, SpatialEntry<Meta>[]>();
  private order: SpatialQueryOrder = "source";
  private getVisualX?: (entry: SpatialEntry<Meta>) => number;

  constructor(entries: readonly SpatialEntry<Meta>[] = [], options: SpatialIndexOptions<Meta> = {}) {
    this.replace(entries, options);
  }

  replace(entries: readonly SpatialEntry<Meta>[], options: SpatialIndexOptions<Meta> = {}): void {
    this.entries = [...entries];
    this.columns = new Map();
    this.order = options.order ?? "source";
    this.getVisualX = options.getVisualX;

    for (const entry of this.entries) {
      const column = this.columns.get(entry.column) ?? [];
      column.push(entry);
      this.columns.set(entry.column, column);
    }

    for (const columnEntries of this.columns.values()) {
      columnEntries.sort((a, b) => a.top - b.top || a.index - b.index);

      if (options.assertInvariant) {
        for (let index = 1; index < columnEntries.length; index += 1) {
          const previous = columnEntries[index - 1];
          const current = columnEntries[index];

          if (current.top < previous.top || current.bottom < previous.bottom) {
            warnInvariant("SpatialIndex expected non-overlapping entries sorted by column.");
            break;
          }
        }
      }
    }
  }

  queryRange(rangeTop: number, rangeBottom: number, order: SpatialQueryOrder = this.order): SpatialEntry<Meta>[] {
    if (this.entries.length === 0 || rangeBottom < rangeTop) {
      return [];
    }

    const result: SpatialEntry<Meta>[] = [];

    for (const columnEntries of this.columns.values()) {
      const startIndex = binarySearchFirstBottom(columnEntries, rangeTop);

      for (let index = startIndex; index < columnEntries.length; index += 1) {
        const entry = columnEntries[index];

        if (entry.top > rangeBottom) {
          break;
        }

        if (entry.bottom >= rangeTop) {
          result.push(entry);
        }
      }
    }

    if (order === "source") {
      result.sort((a, b) => a.index - b.index);
    } else if (order === "visual") {
      result.sort((a, b) => {
        const visualX = this.getVisualX ?? ((entry: SpatialEntry<Meta>) => entry.column);
        return a.top - b.top || visualX(a) - visualX(b) || a.index - b.index;
      });
    }

    return result;
  }

  get length(): number {
    return this.entries.length;
  }
}

export function createSpatialIndexFromLayout<T>(
  layout: MasonryLayout<T>,
  options: SpatialIndexOptions<MasonryPosition<T>> = {}
): SpatialIndex<MasonryPosition<T>> {
  const entries = layout.positions.map((position) => ({
    key: position.key,
    index: position.index,
    column: position.column,
    top: position.y,
    bottom: position.bottom,
    meta: position
  }));

  return new SpatialIndex(entries, {
    getVisualX: (entry) => entry.meta.x,
    ...options
  });
}
