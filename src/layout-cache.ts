import type {
  CachedMasonryLayout,
  LayoutCacheLoadRequest,
  LayoutCacheLoadResult,
  LayoutCacheMissReason,
  LayoutCacheOptions,
  LayoutCachePartialReason,
  LayoutCacheSaveResult,
  MasonryLayout,
  MasonrySeedPosition,
  StorageLike
} from "./types";

const SCHEMA_VERSION = 1;
const DEFAULT_NAMESPACE = "fukashi";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 25;
const CHECKPOINT_INTERVAL = 128;

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

function createCheckpoints(
  positions: MasonrySeedPosition[],
  columnCount: number,
  gapY: number
) {
  const checkpoints: Array<{ index: number; columnHeights: number[] }> = [];
  const columnHeights = Array.from({ length: columnCount }, () => 0);

  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];

    if (position.column >= 0 && position.column < columnCount) {
      columnHeights[position.column] = Math.max(
        columnHeights[position.column],
        position.y + position.height + gapY
      );
    }

    const count = index + 1;
    if (count % CHECKPOINT_INTERVAL === 0 || count === positions.length) {
      checkpoints.push({ index: count, columnHeights: [...columnHeights] });
    }
  }

  return checkpoints;
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

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map((item) => String(item)) : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeEntry(parsed: unknown, cacheKey: string): CachedMasonryLayout | null {
  if (!isRecord(parsed) || parsed.schemaVersion !== SCHEMA_VERSION || !isRecord(parsed.signature)) {
    return null;
  }

  const itemKeys = asStringArray(parsed.itemKeys);
  const itemLayoutKeys = asStringArray(parsed.itemLayoutKeys);

  if (!itemKeys || !itemLayoutKeys || !Array.isArray(parsed.positions) || !Array.isArray(parsed.columnHeights)) {
    return null;
  }

  const createdAt = asNumber(parsed.createdAt, Date.now());
  const updatedAt = asNumber(parsed.updatedAt, asNumber(parsed.touchedAt, createdAt));
  const expiresAt = typeof parsed.expiresAt === "number" || parsed.expiresAt === null ? parsed.expiresAt : null;
  const checkpoints = Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    algorithmVersion: String(parsed.algorithmVersion ?? parsed.signature.algorithmVersion ?? ""),
    createdAt,
    updatedAt,
    touchedAt: updatedAt,
    expiresAt,
    cacheKey: String(parsed.cacheKey ?? cacheKey),
    signature: parsed.signature as unknown as CachedMasonryLayout["signature"],
    itemKeys,
    itemLayoutKeys,
    positions: parsed.positions as MasonrySeedPosition[],
    columnHeights: parsed.columnHeights as number[],
    checkpoints: checkpoints as CachedMasonryLayout["checkpoints"],
    containerHeight: asNumber(parsed.containerHeight, 0)
  };
}

function parseJson(raw: string | null): unknown {
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as unknown;
}

function classifyPartial(
  entry: CachedMasonryLayout,
  request: LayoutCacheLoadRequest,
  validUntil: number
): LayoutCachePartialReason {
  if (validUntil === entry.itemKeys.length && request.itemKeys.length > entry.itemKeys.length) {
    return "append";
  }

  if (validUntil === request.itemKeys.length && request.itemKeys.length < entry.itemKeys.length) {
    return "remove";
  }

  if (
    entry.itemKeys[validUntil] === request.itemKeys[validUntil] &&
    entry.itemLayoutKeys[validUntil] !== request.itemLayoutKeys[validUntil]
  ) {
    return "size-change";
  }

  const cachedKey = entry.itemKeys[validUntil];
  const currentKey = request.itemKeys[validUntil];

  if (cachedKey && request.itemKeys.indexOf(cachedKey, validUntil + 1) !== -1) {
    return "insert";
  }

  if (currentKey && entry.itemKeys.indexOf(currentKey, validUntil + 1) !== -1) {
    return "remove";
  }

  return "reorder";
}

export class LayoutCache {
  private readonly namespace: string;
  private readonly storage: StorageLike | null;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly algorithmVersion?: string;
  private readonly now: () => number;
  private readonly onError?: LayoutCacheOptions["onError"];

  constructor(options: LayoutCacheOptions | string = {}) {
    const normalized = typeof options === "string" ? { namespace: options } : options;
    this.namespace = normalized.namespace ?? DEFAULT_NAMESPACE;
    this.storage = normalized.storage === undefined ? getDefaultStorage() : normalized.storage;
    this.ttlMs = normalized.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = normalized.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.algorithmVersion = normalized.algorithmVersion;
    this.now = normalized.now ?? (() => Date.now());
    this.onError = normalized.onError;
  }

  private storageKey(cacheKey: string): string {
    return this.namespace + ":" + cacheKey;
  }

  private expiresAt(now: number): number | null {
    return Number.isFinite(this.ttlMs) ? now + this.ttlMs : null;
  }

  private isExpired(entry: CachedMasonryLayout, now: number): boolean {
    return entry.expiresAt == null ? now - entry.createdAt > this.ttlMs : now > entry.expiresAt;
  }

  private report(error: unknown, operation: "load" | "save" | "remove" | "clear" | "prune", key?: string): void {
    try {
      this.onError?.(error, { operation, key });
    } catch {
      return;
    }
  }

  load(cacheKey: string, request: LayoutCacheLoadRequest): LayoutCacheLoadResult {
    if (!this.storage) {
      return { status: "miss", reason: "storage-unavailable" };
    }

    const key = this.storageKey(cacheKey);

    try {
      const raw = this.storage.getItem(key);

      if (!raw) {
        return { status: "miss", reason: "not-found" };
      }

      const parsed = parseJson(raw);

      if (!isRecord(parsed)) {
        this.storage.removeItem(key);
        return { status: "miss", reason: "corrupt" };
      }

      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        return { status: "miss", reason: "schema-version" };
      }

      const entry = normalizeEntry(parsed, cacheKey);

      if (!entry) {
        this.storage.removeItem(key);
        return { status: "miss", reason: "corrupt" };
      }

      if (this.isExpired(entry, this.now())) {
        this.storage.removeItem(key);
        return { status: "miss", reason: "expired" };
      }

      if (
        (this.algorithmVersion && entry.algorithmVersion !== this.algorithmVersion) ||
        entry.signature.algorithmVersion !== request.signature.algorithmVersion
      ) {
        return { status: "miss", reason: "algorithm-version" };
      }

      if (entry.signature.columnCount !== request.signature.columnCount) {
        return { status: "miss", reason: "columns" };
      }

      if (entry.signature.gapX !== request.signature.gapX || entry.signature.gapY !== request.signature.gapY) {
        return { status: "miss", reason: "gap" };
      }

      if (
        entry.signature.width !== request.signature.width ||
        entry.signature.columnWidth !== request.signature.columnWidth
      ) {
        return { status: "miss", reason: "width" };
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
        return { status: "miss", reason: "item-mismatch" };
      }

      const isFullHit =
        validUntil === request.itemKeys.length &&
        request.itemKeys.length === entry.itemKeys.length &&
        request.itemLayoutKeys.length === entry.itemLayoutKeys.length;
      const positions = entry.positions.slice(0, validUntil);
      const metrics = isFullHit
        ? { columnHeights: entry.columnHeights, containerHeight: entry.containerHeight }
        : deriveSeedMetrics(positions, request.signature.columnCount, request.signature.gapY);
      const seed = {
        positions,
        columnHeights: metrics.columnHeights,
        containerHeight: metrics.containerHeight,
        validUntil,
        signature: entry.signature,
        source: isFullHit ? "cache" : "cache-partial"
      } as const;

      const touched: CachedMasonryLayout = {
        ...entry,
        updatedAt: this.now(),
        touchedAt: this.now()
      };
      this.storage.setItem(key, JSON.stringify(touched));

      if (isFullHit) {
        return { status: "hit", entry: touched, seed };
      }

      return {
        status: "partial",
        entry: touched,
        validUntil,
        reason: classifyPartial(entry, request, validUntil),
        seed
      };
    } catch (error) {
      this.report(error, "load", key);
      return { status: "miss", reason: "storage-error" };
    }
  }

  save<T>(cacheKey: string, layout: MasonryLayout<T>): LayoutCacheSaveResult {
    if (!this.storage) {
      return { status: "skipped", reason: "disabled" };
    }

    if (layout.positions.length === 0) {
      return { status: "skipped", reason: "empty" };
    }

    const key = this.storageKey(cacheKey);

    try {
      const now = this.now();
      const positions = stripPositions(layout);
      const entry: CachedMasonryLayout = {
        schemaVersion: SCHEMA_VERSION,
        algorithmVersion: layout.signature.algorithmVersion,
        createdAt: now,
        updatedAt: now,
        touchedAt: now,
        expiresAt: this.expiresAt(now),
        cacheKey,
        signature: layout.signature,
        itemKeys: layout.itemKeys,
        itemLayoutKeys: layout.itemLayoutKeys,
        positions,
        columnHeights: layout.columnHeights,
        checkpoints: createCheckpoints(positions, layout.columnCount, layout.gap.y),
        containerHeight: layout.containerHeight
      };
      const serialized = JSON.stringify(entry);

      this.storage.setItem(key, serialized);
      this.prune();

      return { status: "saved", key, bytes: serialized.length };
    } catch (error) {
      this.report(error, "save", key);
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const reason = message.includes("quota") ? "quota" : "storage";
      return { status: "failed", reason };
    }
  }

  invalidate(cacheKey: string): void {
    this.remove(cacheKey);
  }

  remove(cacheKey: string): void {
    if (!this.storage) {
      return;
    }

    const key = this.storageKey(cacheKey);

    try {
      this.storage.removeItem(key);
    } catch (error) {
      this.report(error, "remove", key);
    }
  }

  clear(): void {
    if (!this.storage || typeof this.storage.length !== "number" || !this.storage.key) {
      return;
    }

    const keys: string[] = [];

    try {
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);

        if (key && key.startsWith(this.namespace + ":")) {
          keys.push(key);
        }
      }

      for (const key of keys) {
        this.storage.removeItem(key);
      }
    } catch (error) {
      this.report(error, "clear");
    }
  }

  prune(): number {
    if (!this.storage || typeof this.storage.length !== "number" || !this.storage.key) {
      return 0;
    }

    const entries: Array<{ key: string; updatedAt: number }> = [];
    let removed = 0;

    try {
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);

        if (!key || !key.startsWith(this.namespace + ":")) {
          continue;
        }

        const entry = normalizeEntry(parseJson(this.storage.getItem(key)), key.slice(this.namespace.length + 1));

        if (!entry || this.isExpired(entry, this.now())) {
          this.storage.removeItem(key);
          removed += 1;
        } else {
          entries.push({ key, updatedAt: entry.updatedAt });
        }
      }

      entries.sort((a, b) => a.updatedAt - b.updatedAt);

      while (entries.length > this.maxEntries) {
        const oldest = entries.shift();

        if (oldest) {
          this.storage.removeItem(oldest.key);
          removed += 1;
        }
      }

      return removed;
    } catch (error) {
      this.report(error, "prune");
      return removed;
    }
  }
}

export function createLayoutCache(options: LayoutCacheOptions | string = {}): LayoutCache {
  return new LayoutCache(options);
}
