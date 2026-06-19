# Fukashi Public Docs

These docs cover the supported public API and usage patterns for Fukashi.

- [API reference](API.md)
- [React guide](REACT.md)
- [Stress testing](STRESS_TESTING.md)

## Package Shape

Fukashi is split into two layers:

- A deterministic layout engine for headless use.
- A React adapter for measuring a container, tracking the viewport, and rendering visible items.

The package avoids app-specific UI and state. Bring your own item renderer, image component, loading strategy, and styling.
