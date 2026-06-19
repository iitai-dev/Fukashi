import { describe, expect, it, vi } from "vitest";
import { computeMasonryLayout, createLayoutCache, MasonryEngine } from "../src";
import { MemoryStorage } from "./memory-storage";

const items = [
  { id: "a", size: { width: 100, height: 100 } },
  { id: "b", size: { width: 100, height: 200 } },
  { id: "c", size: { width: 100, height: 100 } }
];

const input = {
  items,
  width: 210,
  columns: 2,
  gap: 10,
  getKey: (item: (typeof items)[number]) => item.id,
  getItemSize: (item: (typeof items)[number]) => item.size
};

describe("LayoutCache", () => {
  it("returns a full hit for matching signatures and keys", () => {
    const storage = new MemoryStorage();
    const cache = createLayoutCache({ namespace: "cache", storage });
    const layout = computeMasonryLayout(input);

    const saved = cache.save("gallery", layout);
    expect(saved.status).toBe("saved");

    const hit = cache.load("gallery", {
      signature: layout.signature,
      itemKeys: layout.itemKeys,
      itemLayoutKeys: layout.itemLayoutKeys
    });

    expect(hit.status).toBe("hit");
    if (hit.status !== "hit") throw new Error("expected cache hit");
    expect(hit.seed.validUntil).toBe(items.length);
    expect(hit.entry?.checkpoints.length).toBeGreaterThan(0);
  });

  it("returns append partial hits for shared prefixes", () => {
    const storage = new MemoryStorage();
    const cache = createLayoutCache({ namespace: "cache", storage });
    const layout = computeMasonryLayout(input);
    const nextItems = [...items, { id: "d", size: { width: 100, height: 50 } }];
    const next = computeMasonryLayout({ ...input, items: nextItems });

    cache.save("gallery", layout);

    const hit = cache.load("gallery", {
      signature: next.signature,
      itemKeys: next.itemKeys,
      itemLayoutKeys: next.itemLayoutKeys
    });

    expect(hit.status).toBe("partial");
    if (hit.status !== "partial") throw new Error("expected partial cache hit");
    expect(hit.reason).toBe("append");
    expect(hit.seed.validUntil).toBe(items.length);
  });

  it("classifies size-change partial hits", () => {
    const storage = new MemoryStorage();
    const cache = createLayoutCache({ namespace: "cache", storage });
    const layout = computeMasonryLayout(input);
    const changed = computeMasonryLayout({
      ...input,
      items: [
        items[0],
        { id: "b", size: { width: 100, height: 300 } },
        items[2]
      ]
    });

    cache.save("gallery", layout);

    const hit = cache.load("gallery", {
      signature: changed.signature,
      itemKeys: changed.itemKeys,
      itemLayoutKeys: changed.itemLayoutKeys
    });

    expect(hit.status).toBe("partial");
    if (hit.status !== "partial") throw new Error("expected partial cache hit");
    expect(hit.reason).toBe("size-change");
    expect(hit.validUntil).toBe(1);
  });

  it("fails closed and reports storage errors", () => {
    const onError = vi.fn();
    const cache = createLayoutCache({
      namespace: "bad",
      onError,
      storage: {
        getItem: () => {
          throw new Error("nope");
        },
        setItem: () => {
          throw new Error("nope");
        },
        removeItem: () => undefined
      }
    });
    const layout = computeMasonryLayout(input);

    expect(cache.save("gallery", layout)).toEqual({ status: "failed", reason: "storage" });
    expect(
      cache.load("gallery", {
        signature: layout.signature,
        itemKeys: layout.itemKeys,
        itemLayoutKeys: layout.itemLayoutKeys
      }).status
    ).toBe("miss");
    expect(onError).toHaveBeenCalled();
  });

  it("invalidates cached layouts", () => {
    const storage = new MemoryStorage();
    const cache = createLayoutCache({ namespace: "cache", storage });
    const layout = computeMasonryLayout(input);

    cache.save("gallery", layout);
    cache.invalidate("gallery");

    const hit = cache.load("gallery", {
      signature: layout.signature,
      itemKeys: layout.itemKeys,
      itemLayoutKeys: layout.itemLayoutKeys
    });

    expect(hit).toEqual({ status: "miss", reason: "not-found" });
  });

  it("lets MasonryEngine expose partial cache status", () => {
    const storage = new MemoryStorage();
    const cache = createLayoutCache({ namespace: "engine", storage });
    const engine = new MasonryEngine<(typeof items)[number]>({ cache, cacheKey: "gallery" });

    engine.compute(input);

    const next = engine.compute({
      ...input,
      items: [...items, { id: "d", size: { width: 100, height: 50 } }]
    });

    expect(next.source).toBe("cache-partial");
    expect(next.cache.status).toBe("partial");
    expect(next.cache.reason).toBe("append");
    expect(next.cache.saveStatus).toBe("saved");
    expect(next.positions).toHaveLength(4);
  });
});