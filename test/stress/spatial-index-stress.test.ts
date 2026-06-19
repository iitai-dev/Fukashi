import { describe, expect, it } from "vitest";
import { computeMasonryLayout, createSpatialIndexFromLayout } from "../../src";
import {
  bruteForceRange,
  createRanges,
  createStressItems,
  fnv1a
} from "./fixtures";

describe("spatial index stress", () => {
  it("matches brute-force range queries for seeded ranges", () => {
    const items = createStressItems(15_000, 0x5150);
    const layout = computeMasonryLayout({
      items,
      width: 1280,
      columns: { minWidth: 200, max: 6 },
      gap: { x: 12, y: 12 },
      getKey: (item) => item.id,
      getItemSize: (item) => ({ width: item.width, height: item.height })
    });
    const index = createSpatialIndexFromLayout(layout);
    const ranges = createRanges(layout.containerHeight, 300, 0x5151);
    const hashParts: string[] = [];

    for (const range of ranges) {
      const indexed = index.queryRange(range.top, range.bottom).map((entry) => entry.index);
      const brute = bruteForceRange(layout.positions, range.top, range.bottom).map((position) => position.index);
      expect(indexed).toEqual(brute);
      hashParts.push(indexed.join(","));
    }

    expect(fnv1a(hashParts.join("|"))).toBe("6e15cad3");
  });
});
