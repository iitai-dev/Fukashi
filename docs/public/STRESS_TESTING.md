# Stress Testing Fukashi

Fukashi's stress tests are deterministic. They use seeded fixtures, independent invariants, and brute-force comparisons where practical. The goal is to avoid benchmark theater: a test should fail because behavior regressed, not because a machine had a slow moment.

## What the Library Tests

Run the standard gate:

```sh
npm run verify
```

Run the browser stress gate when browsers are installed:

```sh
npx playwright install chromium
npm run test:browser
```

Run benchmarks manually:

```sh
npm run bench
```

Benchmarks are useful for trends, but they are not used as hard pass/fail gates because wall-clock timing is noisy across laptops and CI runners.

## Deterministic Stress Layers

Fukashi verifies:

- 10,000 item layout determinism.
- Shortest-column placement invariants.
- Missing-dimension estimate determinism.
- SpatialIndex results against brute-force range filtering.
- Exact cache hits against cold layout checksums.
- Append, reorder, and size-change partial cache hits against cold recomputation.
- Real browser virtualization keeps rendered DOM bounded while the viewport remains nonblank.
- npm package structure via `publint`.
- Type entrypoint health via Are The Types Wrong.
- Published package contents via `npm pack --dry-run`.

## Testing Fukashi In Your App

Use three checks in consumer apps:

1. **Bounded DOM count**

   Render your largest realistic collection and assert the number of mounted item wrappers stays far below the dataset size.

   ```ts
   const rendered = document.querySelectorAll("[data-fukashi-item]").length;
   expect(rendered).toBeLessThan(150);
   ```

2. **Nonblank viewport while scrolling**

   Scroll to deterministic positions and assert at least one rendered item intersects the viewport.

   ```ts
   const visible = [...document.querySelectorAll("[data-fukashi-item]")].filter((node) => {
     const rect = node.getBoundingClientRect();
     return rect.bottom >= 0 && rect.top <= window.innerHeight;
   });

   expect(visible.length).toBeGreaterThan(0);
   ```

3. **Cache correctness**

   Compare a cached layout against a cold layout for the same item list. Do not assert only that the cache says `"hit"`; assert that the resulting positions match your deterministic checksum or known fixture.

## Avoid Biased Tests

- Do not assert only implementation internals.
- Do not rely on random data without a seed.
- Do not use wall-clock performance as a CI pass/fail gate.
- Do not compare cached output only to itself.
- Do compare optimized paths to a simpler independent path, such as brute-force visibility filtering or a cold layout recompute.
- Do lock deterministic checksums for representative fixtures.

## CI Recommendation

Use `npm run verify` on every pull request. Run browser stress in CI with Playwright browsers installed, or at minimum before releases.

```yaml
- run: npm ci
- run: npm run verify
- run: npx playwright install --with-deps chromium
- run: npm run test:browser
```
