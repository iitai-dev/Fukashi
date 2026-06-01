# React Guide

## `MasonryGrid`

`MasonryGrid` is the easiest way to render a virtualized masonry surface.

```tsx
<MasonryGrid
  items={images}
  getKey={(image) => image.id}
  getItemSize={(image) => ({ width: image.width, height: image.height })}
  columns={{ minWidth: 220, min: 1, max: 6 }}
  gap={12}
  overscan={800}
  renderItem={(image) => <img src={image.src} alt={image.alt} />}
/>
```

The component renders an unstyled relative container and absolutely positioned item wrappers. Style the content inside `renderItem`, or pass `className`, `itemClassName`, `style`, and `itemStyle`.

## `useMasonry`

Use the hook when you want to own the outer markup.

```tsx
const masonry = useMasonry({
  items,
  getKey: (item) => item.id,
  getItemSize: (item) => item.size,
  columns: { minWidth: 240 },
  gap: { x: 12, y: 12 }
});
```

Attach `masonry.rootRef` to the root element and render `masonry.visibleItems`. Each visible item includes a ready-to-apply absolute positioning style.

## Viewport Tracking

Fukashi tracks the root element with `getBoundingClientRect()` against the same document viewport. Avoid putting the masonry root inside a scaled transform if you need exact virtualization math.