import { computeMasonryLayout } from "fukashi";

const items = [
  { id: "one", size: { width: 800, height: 600 } },
  { id: "two", size: { width: 600, height: 900 } },
  { id: "three", size: { width: 1200, height: 800 } }
];

const layout = computeMasonryLayout({
  items,
  width: 960,
  columns: { minWidth: 240, max: 4 },
  gap: { x: 12, y: 12 },
  getKey: (item) => item.id,
  getItemSize: (item) => item.size
});

console.log(layout.positions);
