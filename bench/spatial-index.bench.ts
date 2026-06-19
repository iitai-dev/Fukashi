import { bench, describe } from "vitest";
import { computeMasonryLayout, createSpatialIndexFromLayout } from "../src";
import { createRanges, createStressItems } from "../test/stress/fixtures";

const items = createStressItems(50_000, 0x50a71a1);
const layout = computeMasonryLayout({
  items,
  width: 1920,
  columns: { minWidth: 220, max: 9 },
  gap: 12,
  getKey: (item) => item.id,
  getItemSize: (item) => ({ width: item.width, height: item.height })
});
const ranges = createRanges(layout.containerHeight, 1000, 0x50a71a2);

describe("SpatialIndex", () => {
  bench("build 50k index", () => {
    createSpatialIndexFromLayout(layout);
  });

  bench("1000 viewport queries over 50k layout", () => {
    const index = createSpatialIndexFromLayout(layout);

    for (const range of ranges) {
      index.queryRange(range.top, range.bottom);
    }
  });
});
