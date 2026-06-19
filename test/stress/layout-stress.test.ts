import { describe, expect, it } from "vitest";
import { computeMasonryLayout } from "../../src";
import {
  assertLayoutInvariants,
  createStressItems,
  layoutChecksum,
  positionChecksum
} from "./fixtures";

describe("layout stress", () => {
  it("lays out 10k known-size items deterministically", () => {
    const items = createStressItems(10_000, 0x10000);
    const layout = computeMasonryLayout({
      items,
      width: 1440,
      columns: { minWidth: 220, min: 2, max: 7 },
      gap: { x: 11, y: 17 },
      getKey: (item) => item.id,
      getItemSize: (item) => ({ width: item.width, height: item.height })
    });
    const second = computeMasonryLayout({
      items,
      width: 1440,
      columns: { minWidth: 220, min: 2, max: 7 },
      gap: { x: 11, y: 17 },
      getKey: (item) => item.id,
      getItemSize: (item) => ({ width: item.width, height: item.height })
    });

    assertLayoutInvariants(layout);
    expect(layout.positions).toHaveLength(10_000);
    expect(layout.columnCount).toBe(6);
    expect(layoutChecksum(layout)).toBe(layoutChecksum(second));
    expect(positionChecksum(layout.positions.slice(0, 25))).toBe("9b8462f8");
    expect(layoutChecksum(layout)).toBe("f09ac1ec");
  });

  it("keeps deterministic estimates for missing dimensions", () => {
    const items = createStressItems(2500, 0x2500).map((item, index) =>
      index % 5 === 0 ? { ...item, width: 0, height: 0 } : item
    );
    const layout = computeMasonryLayout({
      items,
      width: 960,
      columns: 4,
      gap: 8,
      getKey: (item) => item.id,
      getItemSize: (item) => (item.width > 0 ? { width: item.width, height: item.height } : null),
      estimateHeight: (_item, index, columnWidth) => columnWidth * (0.75 + (index % 7) * 0.05),
      warnOnMissingSize: false
    });

    assertLayoutInvariants(layout);
    expect(layout.estimatedCount).toBe(500);
    expect(layoutChecksum(layout)).toBe("0b001c89");
  });
});
