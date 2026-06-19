import type { MasonryLayout, MasonryPosition } from "../../src";

export interface StressItem {
  id: string;
  width: number;
  height: number;
  tone: number;
}

export interface Range {
  top: number;
  bottom: number;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStressItems(count: number, seed = 0x51f15a): StressItem[] {
  const random = mulberry32(seed);
  const items: StressItem[] = [];

  for (let index = 0; index < count; index += 1) {
    const family = index % 9;
    const width = 240 + Math.floor(random() * 1680);
    const baseHeight = 180 + Math.floor(random() * 1560);
    const tallEvery = index % 97 === 0 ? 2.35 : 1;
    const wideEvery = index % 131 === 0 ? 0.42 : 1;
    const height = Math.max(80, Math.floor(baseHeight * tallEvery * wideEvery));

    items.push({
      id: "stress-" + index.toString(36).padStart(5, "0"),
      width,
      height,
      tone: family
    });
  }

  return items;
}

export function createRanges(maxBottom: number, count: number, seed = 0x71105): Range[] {
  const random = mulberry32(seed);
  const ranges: Range[] = [];

  for (let index = 0; index < count; index += 1) {
    const top = Math.floor(random() * Math.max(1, maxBottom - 1400));
    const viewport = 360 + Math.floor(random() * 1840);
    ranges.push({ top, bottom: top + viewport });
  }

  return ranges;
}

export function fnv1a(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function layoutChecksum(layout: MasonryLayout<StressItem>): string {
  return fnv1a(
    layout.positions
      .map((position) =>
        [
          position.key,
          position.index,
          position.column,
          rounded(position.x),
          rounded(position.y),
          rounded(position.width),
          rounded(position.height)
        ].join(":")
      )
      .join("|")
  );
}

export function positionChecksum(positions: readonly MasonryPosition<StressItem>[]): string {
  return fnv1a(
    positions
      .map((position) => [position.key, position.index, rounded(position.y), rounded(position.height)].join(":"))
      .join("|")
  );
}

export function assertLayoutInvariants(layout: MasonryLayout<StressItem>): void {
  const expectedColumnHeights = Array.from({ length: layout.columnCount }, () => 0);

  for (const position of layout.positions) {
    if (position.column < 0 || position.column >= layout.columnCount) {
      throw new Error("position " + position.index + " has invalid column " + position.column);
    }

    const expectedX = position.column * (layout.columnWidth + layout.gap.x);
    if (Math.abs(position.x - expectedX) > 0.0001) {
      throw new Error("position " + position.index + " x mismatch");
    }

    if (Math.abs(position.y - expectedColumnHeights[position.column]) > 0.0001) {
      throw new Error("position " + position.index + " overlaps or leaves an unexpected gap");
    }

    const minHeight = Math.min(...expectedColumnHeights);
    if (Math.abs(position.y - minHeight) > 0.0001) {
      throw new Error("position " + position.index + " was not placed in a shortest column");
    }

    if (position.width <= 0 || position.height <= 0) {
      throw new Error("position " + position.index + " has non-positive size");
    }

    expectedColumnHeights[position.column] = position.y + position.height + layout.gap.y;
  }

  for (let column = 0; column < layout.columnCount; column += 1) {
    if (Math.abs(expectedColumnHeights[column] - layout.columnHeights[column]) > 0.0001) {
      throw new Error("column " + column + " height mismatch");
    }
  }
}

export function bruteForceRange<T extends { y: number; bottom: number }>(
  positions: readonly T[],
  top: number,
  bottom: number
): T[] {
  return positions.filter((position) => position.bottom >= top && position.y <= bottom);
}
