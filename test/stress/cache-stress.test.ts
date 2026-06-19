import { describe, expect, it } from "vitest";
import { MasonryEngine, createLayoutCache, computeMasonryLayout } from "../../src";
import { MemoryStorage } from "../memory-storage";
import {
  createStressItems,
  layoutChecksum
} from "./fixtures";

const baseInput = {
  width: 1440,
  columns: { minWidth: 220, max: 7 },
  gap: { x: 11, y: 17 },
  getKey: (item: ReturnType<typeof createStressItems>[number]) => item.id,
  getItemSize: (item: ReturnType<typeof createStressItems>[number]) => ({
    width: item.width,
    height: item.height
  })
};

describe("cache stress", () => {
  it("produces the same layout for cold compute, exact cache hit, and append partial hit", () => {
    const storage = new MemoryStorage();
    const cache = createLayoutCache({ namespace: "stress", storage, maxEntries: 10 });
    const engine = new MasonryEngine<ReturnType<typeof createStressItems>[number]>({
      cache,
      cacheKey: "gallery"
    });
    const items = createStressItems(12_000, 0xca7e);
    const appended = [...items, ...createStressItems(500, 0xca7f).map((item) => ({ ...item, id: "append-" + item.id }))];

    const cold = engine.compute({ ...baseInput, items });
    const exact = engine.compute({ ...baseInput, items });
    const partial = engine.compute({ ...baseInput, items: appended });
    const coldAppended = computeMasonryLayout({ ...baseInput, items: appended });

    expect(cold.cache.status).toBe("miss");
    expect(exact.cache.status).toBe("hit");
    expect(partial.cache.status).toBe("partial");
    expect(partial.cache.reason).toBe("append");
    expect(partial.cache.validUntil).toBe(items.length);
    expect(layoutChecksum(exact)).toBe(layoutChecksum(cold));
    expect(layoutChecksum(partial)).toBe(layoutChecksum(coldAppended));
    expect(layoutChecksum(partial)).toBe("d445174f");
  });

  it("recomputes deterministic suffixes for size changes and reorder prefixes", () => {
    const storage = new MemoryStorage();
    const cache = createLayoutCache({ namespace: "stress", storage, maxEntries: 10 });
    const engine = new MasonryEngine<ReturnType<typeof createStressItems>[number]>({
      cache,
      cacheKey: "gallery"
    });
    const items = createStressItems(8000, 0xc0ffee);
    const changed = items.map((item, index) =>
      index === 400 ? { ...item, height: item.height + 333 } : item
    );
    const reordered = [items[0], items[2], items[1], ...items.slice(3)];

    engine.compute({ ...baseInput, items });

    const sizeChange = engine.compute({ ...baseInput, items: changed });
    const coldSizeChange = computeMasonryLayout({ ...baseInput, items: changed });
    expect(sizeChange.cache.status).toBe("partial");
    expect(sizeChange.cache.reason).toBe("size-change");
    expect(sizeChange.cache.validUntil).toBe(400);
    expect(layoutChecksum(sizeChange)).toBe(layoutChecksum(coldSizeChange));

    const reorder = engine.compute({ ...baseInput, items: reordered });
    const coldReorder = computeMasonryLayout({ ...baseInput, items: reordered });
    expect(reorder.cache.status).toBe("partial");
    expect(reorder.cache.reason).toBe("reorder");
    expect(reorder.cache.validUntil).toBe(1);
    expect(layoutChecksum(reorder)).toBe(layoutChecksum(coldReorder));
    expect(layoutChecksum(reorder)).toBe("a9f91a73");
  });
});
