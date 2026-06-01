import { describe, expect, it, vi } from "vitest";
import { MasonryEngine, computeMasonryLayout } from "../src";
import { MemoryStorage } from "./memory-storage";
import { createLayoutCache } from "../src";

interface Item {
  id: string;
  width?: number;
  height?: number;
}

const items: Item[] = [
  { id: "a", width: 100, height: 100 },
  { id: "b", width: 100, height: 200 },
  { id: "c", width: 100, height: 50 },
  { id: "d", width: 100, height: 100 }
];

const getKey = (item: Item) => item.id;
const getItemSize = (item: Item) =>
  item.width && item.height ? { width: item.width, height: item.height } : null;

describe("computeMasonryLayout", () => {
  it("computes deterministic shortest-column positions", () => {
    const layout = computeMasonryLayout({
      items,
      width: 210,
      columns: 2,
      gap: 10,
      getKey,
      getItemSize
    });

    expect(layout.columnCount).toBe(2);
    expect(layout.columnWidth).toBe(100);
    expect(layout.positions.map((position) => position.column)).toEqual([0, 1, 0, 0]);
    expect(layout.positions.map((position) => position.y)).toEqual([0, 0, 110, 170]);
    expect(layout.containerHeight).toBe(270);
  });

  it("returns an empty layout for unmeasured widths", () => {
    const layout = computeMasonryLayout({
      items,
      width: 0,
      columns: 2,
      getKey,
      getItemSize
    });

    expect(layout.positions).toEqual([]);
    expect(layout.containerHeight).toBe(0);
    expect(layout.source).toBe("empty");
  });

  it("supports responsive min-width columns", () => {
    const layout = computeMasonryLayout({
      items,
      width: 500,
      columns: { minWidth: 160, min: 1, max: 4 },
      gap: { x: 10, y: 20 },
      getKey,
      getItemSize
    });

    expect(layout.columnCount).toBe(3);
    expect(layout.gap).toEqual({ x: 10, y: 20 });
  });

  it("uses estimated heights for missing dimensions and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const layout = computeMasonryLayout({
      items: [{ id: "a" }, { id: "b" }],
      width: 200,
      columns: 2,
      getKey,
      getItemSize,
      estimateHeight: 80
    });

    expect(layout.positions.map((position) => position.height)).toEqual([80, 80]);
    expect(layout.estimatedCount).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("uses a compatible seed as a prefix", () => {
    const first = computeMasonryLayout({
      items: items.slice(0, 3),
      width: 210,
      columns: 2,
      gap: 10,
      getKey,
      getItemSize
    });

    const next = computeMasonryLayout({
      items,
      width: 210,
      columns: 2,
      gap: 10,
      getKey,
      getItemSize,
      seed: {
        positions: first.positions,
        columnHeights: first.columnHeights,
        containerHeight: first.containerHeight,
        validUntil: first.positions.length,
        signature: first.signature
      }
    });

    expect(next.source).toBe("cache-partial");
    expect(next.positions.slice(0, 3).map((position) => position.y)).toEqual([0, 0, 110]);
    expect(next.positions[3].y).toBe(170);
  });
});

describe("MasonryEngine", () => {
  it("loads and saves through LayoutCache", () => {
    const storage = new MemoryStorage();
    const cache = createLayoutCache({ namespace: "test", storage });
    const engine = new MasonryEngine<Item>({ cache, cacheKey: "gallery" });
    const input = {
      items,
      width: 210,
      columns: 2,
      gap: 10,
      getKey,
      getItemSize
    };

    const first = engine.compute(input);
    const second = engine.compute(input);

    expect(first.source).toBe("computed");
    expect(second.source).toBe("cache");
    expect(second.positions.map((position) => position.y)).toEqual(first.positions.map((position) => position.y));
  });
});
