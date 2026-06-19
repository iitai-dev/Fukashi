import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const url = pathToFileURL(resolve("test/browser/.tmp/index.html")).toString();

async function visibleItemStats(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("[data-fukashi-item]"));
    const viewportHeight = window.innerHeight;
    const visible = items.filter((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom >= 0 && rect.top <= viewportHeight;
    });

    return {
      rendered: items.length,
      visible: visible.length,
      height: Number.parseFloat((document.querySelector("[data-fukashi]") as HTMLElement).style.height),
      status: (document.querySelector("[data-fukashi]") as HTMLElement).dataset.fukashiStatus
    };
  });
}

test("virtualized grid remains bounded and nonblank while scrolling 10k items", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  await page.waitForSelector("[data-fukashi-item]");

  const first = await visibleItemStats(page);
  expect(first.status).toBe("virtualized");
  expect(first.height).toBe(459_458);
  expect(first.rendered).toBeLessThan(90);
  expect(first.visible).toBeGreaterThan(0);

  for (const y of [first.height * 0.25, first.height * 0.5, first.height * 0.75, first.height - 1200]) {
    await page.evaluate((nextY) => window.scrollTo(0, nextY), y);
    await page.waitForTimeout(50);
    const stats = await visibleItemStats(page);
    expect(stats.rendered).toBeLessThan(110);
    expect(stats.visible).toBeGreaterThan(0);
  }
});
