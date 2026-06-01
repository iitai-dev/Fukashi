import type { CSSProperties } from "react";
import type { MasonryGridProps, MasonryRenderContext } from "./types";
import { useMasonry } from "./use-masonry";

function resolveItemStyle<T>(
  itemStyle: MasonryGridProps<T>["itemStyle"],
  item: T,
  context: MasonryRenderContext<T>
): CSSProperties | undefined {
  if (!itemStyle) {
    return undefined;
  }

  return typeof itemStyle === "function" ? itemStyle(item, context) : itemStyle;
}

export function MasonryGrid<T>(props: MasonryGridProps<T>) {
  const {
    className,
    itemClassName,
    itemStyle,
    renderItem,
    style,
    ...options
  } = props;
  const masonry = useMasonry(options);

  return (
    <div
      ref={masonry.rootRef}
      className={className}
      style={{ ...masonry.containerStyle, ...style }}
      data-fukashi=""
      data-fukashi-status={masonry.status}
    >
      {masonry.visibleItems.map((visible) => {
        const context: MasonryRenderContext<T> = {
          key: visible.key,
          index: visible.index,
          position: visible,
          style: visible.style,
          layout: masonry.layout,
          estimated: visible.estimated
        };
        const extraStyle = resolveItemStyle(itemStyle, visible.item, context);

        return (
          <div
            key={visible.key}
            className={itemClassName}
            style={{ ...visible.style, ...extraStyle }}
            data-fukashi-item=""
          >
            {renderItem(visible.item, context)}
          </div>
        );
      })}
    </div>
  );
}

export const Masonry = MasonryGrid;
