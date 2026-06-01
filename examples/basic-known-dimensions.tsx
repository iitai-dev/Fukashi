import { MasonryGrid } from "fukashi";

interface ImageItem {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
}

export function BasicKnownDimensions({ images }: { images: ImageItem[] }) {
  return (
    <MasonryGrid
      items={images}
      getKey={(image) => image.id}
      getItemSize={(image) => ({ width: image.width, height: image.height })}
      columns={{ minWidth: 220, min: 1, max: 6 }}
      gap={12}
      overscan={800}
      renderItem={(image) => (
        <img
          src={image.src}
          alt={image.alt}
          style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    />
  );
}
