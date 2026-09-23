---
name: relyless-development
description: Implement, review, or plan changes in the RelyLess browser extension while preserving its English-first product direction, privacy boundaries, browser architecture, UI system, and contribution requirements.
---

# RelyLess Development

Use this skill for feature work, bug fixes, refactors, UI changes, provider integrations, storage migrations, connector work, documentation, or PR review in this repository.

## 1. Establish the contract

Read:

1. `docs/development/product-direction.md`
2. `docs/development/development-principles.md`
3. `docs/development/architecture.md`

Then classify the change:

- user-visible reading behavior;
- Popup/settings or injected UI;
- storage, privacy, permissions, or migration;
- model provider, routing, or Native connector;
- build, release, or documentation only.

For product-direction, permission, persistence, protocol, dependency, or multi-runtime changes, require an Issue and determine whether an ADR is needed before implementation.

## 2. Load only the relevant specialist guidance

- UI: `docs/design-system.md`
- Browser smoke coverage: `docs/verification-checklist.md`
- Contribution mechanics: `CONTRIBUTING.md`
- PR acceptance: `docs/development/pull-requests.md`
- Data handling: `PRIVACY.md` and `PRIVACY.en.md`
- Release behavior: the README source-development section and `tools/package-release.mjs`

Do not invent a second convention beside these documents.

## 3. Inspect before editing

- Check the worktree and preserve existing contributor changes.
- Find the current module, every caller, storage/message contracts, and relevant tests.
- For a bug, reproduce the observable failure first.
- For UI, inspect the real extension surface rather than judging HTML/CSS alone.

## 4. Implement the smallest complete change

- Keep English primary and help secondary.
- Keep automatic behavior inside reliable reading areas.
- Keep on-demand mode free of passive work.
- Minimize transmitted and persisted data; define cleanup and incognito behavior.
- Reuse shared settings, provider, error, storage, and design-token sources.
- Migrate all callers and delete obsolete paths; do not leave compatibility aliases without an explicit contract.
- Bound page-, user-, and model-controlled values at every runtime boundary.

## 5. Prove behavior

Always run:

```bash
npm run check
```

Add surface-specific proof:

- UI: real browser screenshot plus keyboard/focus/accessibility inspection;
- injected behavior: actual webpage and clean disable/removal;
- data: migration, cleanup, failure-safe and future-schema scenarios;
- model/connector: success and real failure categories, including fallback;
- release: package, checksum, extracted-artifact inspection.

A test is permanent only when it protects an observable contract or plausible regression.

## 6. Synchronize community artifacts

- Update user instructions for user-visible behavior.
- Update both privacy documents for data or remote-processing changes.
- Update architecture and add an ADR for long-lived decisions.
- Add a development record for high-impact implementations.
- Complete `.github/pull_request_template.md` with exact evidence.

End with a concise report: behavior changed, files changed, verification performed, and remaining risk. Never claim browser or release verification that was not actually run.
