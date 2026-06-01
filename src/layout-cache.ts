import type {
  CachedMasonryLayout,
  LayoutCacheLoadRequest,
  LayoutCacheLoadResult,
  LayoutCacheOptions,
  MasonryLayout,
  MasonrySeedPosition,
  StorageLike
} from "./types";

const SCHEMA_VERSION = 1;
const DEFAULT_NAMESPACE = "fukashi";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 25;

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }

  return null;
}

function stripPositions<T>(layout: MasonryLayout<T>): MasonrySeedPosition[] {
  return layout.positions.map((position) => ({
    key: position.key,
    index: position.index,
    column: position.column,
    x: position.x,
    y: position.y,
    width: position.width,
    height: position.height,
    bottom: position.bottom,
    estimated: position.estimated,
    layoutKey: position.layoutKey
  }));
}

function deriveSeedMetrics(
  positions: MasonrySeedPosition[],
  columnCount: number,
  gapY: number
): { columnHeights: number[]; containerHeight: number } {
  const columnHeights = Array.from({ length: columnCount }, () => 0);

  for (const position of positions) {
    if (position.column >= 0 && position.column < columnCount) {
      columnHeights[position.column] = Math.max(
        columnHeights[position.column],
        position.y + position.height + gapY
      );
    }
  }

  const containerHeight = positions.length > 0 ? Math.max(0, Math.max(...columnHeights, 0) - gapY) : 0;
  return { columnHeights, containerHeight };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseEntry(raw: string | null): CachedMasonryLayout | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed) || parsed.schemaVersion !== SCHEMA_VERSION) {
      return null;
    }

    return parsed as unknown as CachedMasonryLayout;
  } catch {
    return null;
  }
}

export class LayoutCache {
  private readonly namespace: string;
  private readonly storage: StorageLike | null;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly algorithmVersion?: string;
  private readonly now: () => number;

  constructor(options: LayoutCacheOptions | string = {}) {
    const normalized = typeof options === "string" ? { namespace: options } : options;
    this.namespace = normalized.namespace ?? DEFAULT_NAMESPACE;
    this.storage = normalized.storage === undefined ? getDefaultStorage() : normalized.storage;
    this.ttlMs = normalized.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = normalized.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.algorithmVersion = normalized.algorithmVersion;
    this.now = normalized.now ?? (() => Date.now());
  }

  private storageKey(cacheKey: string): string {
    return this.namespace + ":" + cacheKey;
  }

  load(cacheKey: string, request: LayoutCacheLoadRequest): LayoutCacheLoadResult {
    if (!this.storage) {
      return { status: "miss", reason: "storage-unavailable" };
    }

    try {
      const key = this.storageKey(cacheKey);
      const entry = parseEntry(this.storage.getItem(key));

      if (!entry) {
        return { status: "miss", reason: "not-found" };
      }

      if (this.now() - entry.createdAt > this.ttlMs) {
        this.storage.removeItem(key);
        return { status: "miss", reason: "expired" };
      }

      if (this.algorithmVersion && entry.algorithmVersion !== this.algorithmVersion) {
        return { status: "miss", reason: "algorithm-version" };
      }

      const signature = request.signature;
      const cached = entry.signature;

      if (
        cached.algorithmVersion !== signature.algorithmVersion ||
        cached.width !== signature.width ||
        cached.columnCount !== signature.columnCount ||
        cached.columnWidth !== signature.columnWidth ||
        cached.gapX !== signature.gapX ||
        cached.gapY !== signature.gapY
      ) {
        return { status: "miss", reason: "layout-params" };
      }

      const limit = Math.min(
        request.itemKeys.length,
        entry.itemKeys.length,
        entry.itemLayoutKeys.length,
        entry.positions.length
      );
      let validUntil = 0;

      for (let index = 0; index < limit; index += 1) {
        if (
          entry.itemKeys[index] !== request.itemKeys[index] ||
          entry.itemLayoutKeys[index] !== request.itemLayoutKeys[index]
        ) {
          break;
        }

        validUntil += 1;
      }

      if (validUntil === 0) {
        return { status: "miss", reason: "keys" };
      }

      const isFullHit =
        validUntil === request.itemKeys.length &&
        request.itemKeys.length === entry.itemKeys.length &&
        request.itemLayoutKeys.length === entry.itemLayoutKeys.length;
      const positions = entry.positions.slice(0, validUntil);
      const metrics = isFullHit
        ? { columnHeights: entry.columnHeights, containerHeight: entry.containerHeight }
        : deriveSeedMetrics(positions, signature.columnCount, signature.gapY);
      const seed = {
        positions,
        columnHeights: metrics.columnHeights,
        containerHeight: metrics.containerHeight,
        validUntil,
        signature: entry.signature,
        source: isFullHit ? "cache" : "cache-partial"
      } as const;

      entry.touchedAt = this.now();
      this.storage.setItem(key, JSON.stringify(entry));

      return {
        status: isFullHit ? "hit" : "partial",
        validUntil,
        seed
      };
    } catch {
      return { status: "miss", reason: "storage-error" };
    }
  }

  save<T>(cacheKey: string, layout: MasonryLayout<T>): boolean {
    if (!this.storage) {
      return false;
    }

    try {
      const now = this.now();
      const entry: CachedMasonryLayout = {
        schemaVersion: SCHEMA_VERSION,
        algorithmVersion: layout.signature.algorithmVersion,
        createdAt: now,
        touchedAt: now,
        signature: layout.signature,
        itemKeys: layout.itemKeys,
        itemLayoutKeys: layout.itemLayoutKeys,
        positions: stripPositions(layout),
        columnHeights: layout.columnHeights,
        containerHeight: layout.containerHeight
      };

      this.storage.setItem(this.storageKey(cacheKey), JSON.stringify(entry));
      this.prune();
      return true;
    } catch {
      return false;
    }
  }

  invalidate(cacheKey: string): void {
    if (!this.storage) {
      return;
    }

    try {
      this.storage.removeItem(this.storageKey(cacheKey));
    } catch {
      return;
    }
  }

  clear(): void {
    if (!this.storage || typeof this.storage.length !== "number" || !this.storage.key) {
      return;
    }

    const keys: string[] = [];

    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);

      if (key && key.startsWith(this.namespace + ":")) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      this.storage.removeItem(key);
    }
  }

  prune(): void {
    if (!this.storage || typeof this.storage.length !== "number" || !this.storage.key) {
      return;
    }

    const entries: Array<{ key: string; touchedAt: number }> = [];

    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);

      if (!key || !key.startsWith(this.namespace + ":")) {
        continue;
      }

      const entry = parseEntry(this.storage.getItem(key));

      if (!entry || this.now() - entry.createdAt > this.ttlMs) {
        this.storage.removeItem(key);
      } else {
        entries.push({ key, touchedAt: entry.touchedAt });
      }
    }

    entries.sort((a, b) => a.touchedAt - b.touchedAt);

    while (entries.length > this.maxEntries) {
      const oldest = entries.shift();

      if (oldest) {
        this.storage.removeItem(oldest.key);
      }
    }
  }
}

export function createLayoutCache(options: LayoutCacheOptions | string = {}): LayoutCache {
  return new LayoutCache(options);
}

