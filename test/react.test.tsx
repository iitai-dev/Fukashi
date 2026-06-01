// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MasonryGrid } from "../src";

describe("MasonryGrid", () => {
  it("renders an SSR-safe shell", () => {
    const html = renderToString(
      <MasonryGrid
        items={[{ id: "a", width: 100, height: 100 }]}
        width={200}
        columns={1}
        getKey={(item) => item.id}
        getItemSize={(item) => ({ width: item.width, height: item.height })}
        renderItem={(item) => <span>{item.id}</span>}
      />
    );

    expect(html).toContain("data-fukashi");
  });
});

