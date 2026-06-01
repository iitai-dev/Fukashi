import { useCallback, useState, type RefObject } from "react";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

interface ContainerSizeOptions {
  disabled?: boolean;
  initialWidth?: number;
}

interface ContainerSize {
  width: number;
  refresh: () => void;
}

function canUseDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function useContainerSize(
  ref: RefObject<HTMLElement>,
  options: ContainerSizeOptions = {}
): ContainerSize {
  const [width, setWidth] = useState(options.initialWidth ?? 0);

  const measure = useCallback(() => {
    if (!canUseDom() || !ref.current) {
      return;
    }

    const rect = ref.current.getBoundingClientRect();
    const nextWidth = rect.width || ref.current.offsetWidth || 0;
    setWidth((current) => (Math.abs(current - nextWidth) > 0.5 ? nextWidth : current));
  }, [ref]);

  useIsomorphicLayoutEffect(() => {
    if (options.disabled || !canUseDom() || !ref.current) {
      return;
    }

    let firstFrame = 0;
    let secondFrame = 0;
    let observer: ResizeObserver | null = null;

    const schedule = () => {
      if (firstFrame) {
        window.cancelAnimationFrame(firstFrame);
      }

      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(measure);
      });
    };

    schedule();

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(schedule);
      observer.observe(ref.current);
    } else {
      window.addEventListener("resize", schedule);
    }

    return () => {
      if (firstFrame) {
        window.cancelAnimationFrame(firstFrame);
      }

      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }

      observer?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [measure, options.disabled, ref]);

  return { width, refresh: measure };
}
