# RelyLess Repository Guidance

This file applies to the entire repository. Human contributors should start with `CONTRIBUTING.md`; coding agents must follow this file and the same canonical development documents.

## Read before changing code

1. `docs/development/product-direction.md`
2. `docs/development/development-principles.md`
3. `docs/development/architecture.md`
4. The relevant specialist document:
   - UI: `docs/design-system.md`
   - Browser behavior: `docs/verification-checklist.md`
   - Pull requests: `docs/development/pull-requests.md`
   - Data handling: `PRIVACY.md` and `PRIVACY.en.md`

Do not infer a new product direction from one implementation detail. Code and runtime output establish current behavior; development documents establish intended boundaries.

## Product invariants

- Preserve authentic English; assistance is sparse and secondary.
- Chinese explanation and translation are explicit local rescue, not the default replacement experience.
- Automatic work stays inside a reliably detected English reading area.
- On-demand mode stops passive scanning, prefetch, annotation, and recording.
- New data, permissions, model calls, persistence, and costs are explicit and minimal.
- User support states are explainable and reversible; do not introduce hidden mastery scoring or learning-game mechanics.
- Model or connector failure must not be presented as a successful answer.

## Engineering workflow

- Inspect existing patterns before editing; do not create a parallel settings, message, styling, provider, or storage convention.
- Reproduce bugs before fixing them. Prefer a behavioral regression test when it protects a plausible failure.
- Keep one concern per change. Migrate every caller and remove obsolete paths in the same change.
- Treat content scripts, extension pages, the service worker, offscreen documents, and native connectors as separate trust and lifecycle boundaries.
- Validate every cross-boundary message and bound user/page/model-controlled input.
- Never commit secrets, private page content, full URLs, diagnostic dumps, generated release archives, or local machine paths.

## Verification

Run for every code change:

```bash
npm run check
```

Then exercise the changed surface:

- Popup/options: load the unpacked extension and inspect the real page, keyboard flow, and accessibility.
- Injected UI: verify on a real light and dark webpage and confirm disabling removes extension-owned UI.
- Storage/migration: verify old state, failed migration, cleanup, and unsupported future schema.
- Providers/connectors: verify success, authentication failure, rate limit, malformed response, timeout, and fallback.
- Release: run `npm run release:package` only from a clean committed tree and inspect the extracted artifact.

Use only the relevant sections of `docs/verification-checklist.md`; report exactly what was exercised.

## Documentation synchronization

Update in the same change:

- user-visible behavior → `README.md` or the in-product guide;
- UI semantics or tokens → `docs/design-system.md`;
- permissions, persistence, remote processing, or retention → both privacy documents;
- runtime boundaries or long-lived constraints → architecture document and an ADR;
- high-impact implementation or migration → a development record.

Templates live under `docs/development/records/` and `docs/development/decisions/`.
