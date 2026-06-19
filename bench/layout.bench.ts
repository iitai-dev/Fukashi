import { bench, describe } from "vitest";
import { computeMasonryLayout } from "../src";
import { createStressItems } from "../test/stress/fixtures";

const items10k = createStressItems(10_000, 0xbeef);
const items50k = createStressItems(50_000, 0xbeef50);

describe("computeMasonryLayout", () => {
  bench("10k known-size items", () => {
    computeMasonryLayout({
      items: items10k,
      width: 1440,
      columns: { minWidth: 220, max: 7 },
      gap: { x: 11, y: 17 },
      getKey: (item) => item.id,
      getItemSize: (item) => ({ width: item.width, height: item.height })
    });
  });

  bench("50k known-size items", () => {
    computeMasonryLayout({
      items: items50k,
      width: 1920,
      columns: { minWidth: 220, max: 9 },
      gap: { x: 12, y: 12 },
      getKey: (item) => item.id,
      getItemSize: (item) => ({ width: item.width, height: item.height })
    });
  });
});
