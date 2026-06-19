# CWS Tracker

A Chrome extension (Manifest V3) for App Store Optimization (ASO) and
competitive intelligence on the Chrome Web Store. It tracks keyword rankings,
monitors competitor listings, detects translation manipulation, and offers
AI-powered listing optimization.

## License

**Source-available, not open source.**

CWS Tracker is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

- ✅ **Free** for any noncommercial purpose — personal projects, study,
  research, evaluation, and use by nonprofit/educational/government
  organizations.
- ❌ **Commercial use requires a paid license.** Using CWS Tracker in or for a
  business, or to generate revenue, is not covered by the free license.
- 🚫 You may **not** sell, host, or redistribute it as a commercial product or
  service.

The source is public so you can read it, audit it, self-host it, and contribute
fixes — but it does **not** grant the freedoms of an OSI-approved open source
license.

### Commercial licensing

Want to use CWS Tracker commercially? A separate commercial license is
available. Contact **benmakartni@gmail.com**.

## Contributing

Contributions are welcome under the Developer Certificate of Origin (DCO). See
[CONTRIBUTING.md](./CONTRIBUTING.md) for how to sign off your commits.

## Development

See [`CLAUDE.md`](./CLAUDE.md) for architecture, conventions, and the full
command reference. Quick start:

```bash
npm install
npm run dev        # Vite dev server with CRXJS HMR
npm run build:only # Production build to dist/
npm test           # Run the test suite
npm run typecheck  # Type-check (vue-tsc)
```

Load the unpacked extension: `npm run build:only` → `chrome://extensions` →
enable Developer mode → **Load unpacked** → select `dist/`.
