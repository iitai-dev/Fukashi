import { describe, expect, it } from "vitest";
import { SpatialIndex } from "../src";
import type { SpatialEntry } from "../src";

function entry(index: number, column: number, top: number, bottom: number): SpatialEntry<{ x: number }> {
  return {
    key: String(index),
    index,
    column,
    top,
    bottom,
    meta: { x: column * 100 }
  };
}

describe("SpatialIndex", () => {
  it("queries overlapping entries per column", () => {
    const index = new SpatialIndex([
      entry(0, 0, 0, 100),
      entry(1, 1, 0, 300),
      entry(2, 0, 110, 200),
      entry(3, 0, 210, 280)
    ]);

    expect(index.queryRange(105, 215).map((item) => item.index)).toEqual([1, 2, 3]);
  });

  it("can return visual order", () => {
    const index = new SpatialIndex(
      [entry(2, 1, 0, 100), entry(1, 0, 0, 100)],
      { order: "visual", getVisualX: (item) => item.meta.x }
    );

    expect(index.queryRange(0, 50).map((item) => item.index)).toEqual([1, 2]);
  });

  it("can leave query order untouched", () => {
    const index = new SpatialIndex(
      [entry(2, 1, 0, 100), entry(1, 0, 0, 100)],
      { order: "none" }
    );

    expect(index.queryRange(0, 50, "none")).toHaveLength(2);
  });
});
