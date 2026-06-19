import React from "react";
import { createRoot } from "react-dom/client";
import { MasonryGrid } from "../../src";
import { createStressItems } from "../stress/fixtures";

const items = createStressItems(10_000, 0xb00a);

function BrowserStressApp() {
  return (
    <MasonryGrid
      items={items}
      width={960}
      columns={{ minWidth: 180, min: 2, max: 5 }}
      gap={{ x: 8, y: 8 }}
      overscan={700}
      getKey={(item) => item.id}
      getItemSize={(item) => ({ width: item.width, height: item.height })}
      renderItem={(item) => (
        <div className="tile" data-item-id={item.id} style={{ width: "100%", height: "100%" }}>
          <span aria-hidden="true" />
        </div>
      )}
    />
  );
}

createRoot(document.getElementById("root")!).render(<BrowserStressApp />);
