import { bench, describe } from "vitest";
import { MasonryEngine, createLayoutCache } from "../src";
import { MemoryStorage } from "../test/memory-storage";
import { createStressItems } from "../test/stress/fixtures";

const items = createStressItems(20_000, 0xcac4e);
const input = {
  items,
  width: 1440,
  columns: { minWidth: 220, max: 7 },
  gap: { x: 11, y: 17 },
  getKey: (item: (typeof items)[number]) => item.id,
  getItemSize: (item: (typeof items)[number]) => ({ width: item.width, height: item.height })
};

describe("LayoutCache", () => {
  bench("exact cache hit for 20k layout", () => {
    const cache = createLayoutCache({ namespace: "bench", storage: new MemoryStorage() });
    const engine = new MasonryEngine<(typeof items)[number]>({ cache, cacheKey: "gallery" });
    engine.compute(input);
    engine.compute(input);
  });
});
