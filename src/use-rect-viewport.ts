import { useCallback, useRef, useState, type RefObject } from "react";
import type { RectViewport, UseRectViewportOptions } from "./types";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

function canUseDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function initialViewport(): Omit<RectViewport, "refresh"> {
  return {
    viewportTop: 0,
    viewportBottom: 0,
    viewportHeight: 0,
    rootRect: null
  };
}

export function useRectViewport(
  rootRef: RefObject<HTMLElement>,
  options: UseRectViewportOptions = {}
): RectViewport {
  const [viewport, setViewport] = useState(initialViewport);
  const frameRef = useRef(0);
  const warnedAboutScaleRef = useRef(false);

  const measure = useCallback(() => {
    if (!canUseDom() || !rootRef.current) {
      return;
    }

    const root = rootRef.current;
    const rect = root.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportTop = Math.max(0, -rect.top);
    const viewportBottom = Math.max(0, viewportHeight - rect.top);

    if (options.warnOnScaledRoot !== false && !warnedAboutScaleRef.current && root.offsetHeight > 0) {
      const scale = rect.height / root.offsetHeight;

      if (Number.isFinite(scale) && Math.abs(scale - 1) > 0.02) {
        warnedAboutScaleRef.current = true;

        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("[fukashi] The masonry root appears to be inside a scaled transform. Viewport math assumes same-document, unscaled layout coordinates.");
        }
      }
    }

    setViewport((current) => {
      const changed =
        Math.abs(current.viewportTop - viewportTop) > 0.5 ||
        Math.abs(current.viewportBottom - viewportBottom) > 0.5 ||
        Math.abs(current.viewportHeight - viewportHeight) > 0.5 ||
        current.rootRect !== rect;

      return changed
        ? {
            viewportTop,
            viewportBottom,
            viewportHeight,
            rootRect: rect
          }
        : current;
    });
  }, [options.warnOnScaledRoot, rootRef]);

  const schedule = useCallback(() => {
    if (!canUseDom()) {
      return;
    }

    if (frameRef.current) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      measure();
    });
  }, [measure]);

  useIsomorphicLayoutEffect(() => {
    if (options.disabled || !canUseDom()) {
      return;
    }

    measure();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);

    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);

      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [measure, options.disabled, schedule]);

  return {
    ...viewport,
    refresh: measure
  };
}
