import { createLayoutCache, createMasonryEngine } from "fukashi";

interface CacheItem {
  id: string;
  size: { width: number; height: number };
}

const cache = createLayoutCache({ namespace: "example-gallery" });
const engine = createMasonryEngine<CacheItem>({
  cache,
  cacheKey: "gallery:latest"
});

const layout = engine.compute({
  items: [
    { id: "a", size: { width: 100, height: 100 } },
    { id: "b", size: { width: 100, height: 160 } }
  ],
  width: 640,
  columns: { minWidth: 180 },
  gap: 12,
  getKey: (item) => item.id,
  getItemSize: (item) => item.size
});

console.log(layout.source);
