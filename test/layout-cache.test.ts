import { describe, expect, it } from "vitest";
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

    expect(cache.save("gallery", layout)).toBe(true);

    const hit = cache.load("gallery", {
      signature: layout.signature,
      itemKeys: layout.itemKeys,
      itemLayoutKeys: layout.itemLayoutKeys
    });

    expect(hit.status).toBe("hit");
    expect(hit.seed?.validUntil).toBe(items.length);
  });

  it("returns a partial hit for shared prefixes", () => {
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
    expect(hit.seed?.validUntil).toBe(items.length);
  });

  it("fails closed when storage throws", () => {
    const cache = createLayoutCache({
      namespace: "bad",
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

    expect(cache.save("gallery", layout)).toBe(false);
    expect(
      cache.load("gallery", {
        signature: layout.signature,
        itemKeys: layout.itemKeys,
        itemLayoutKeys: layout.itemLayoutKeys
      }).status
    ).toBe("miss");
  });

  it("lets MasonryEngine reuse a partial cache prefix", () => {
    const storage = new MemoryStorage();
    const cache = createLayoutCache({ namespace: "engine", storage });
    const engine = new MasonryEngine<(typeof items)[number]>({ cache, cacheKey: "gallery" });

    engine.compute(input);

    const next = engine.compute({
      ...input,
      items: [...items, { id: "d", size: { width: 100, height: 50 } }]
    });

    expect(next.source).toBe("cache-partial");
    expect(next.positions).toHaveLength(4);
  });
});

