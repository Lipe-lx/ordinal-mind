# OrdinalMind — CSS Architecture

> Current state of style refactoring after modularizing the former `src/app/index.css`.

---

## Status

- The former ~5.4k line monolith has been disassembled.
- `src/app/index.css` is now just a global entrypoint with `@import`s.
- Styles have been distributed across `src/app/styles/` by base, components, layout, pages, features, and widgets.
- UI has been manually validated, and build/typecheck continue to pass.

---

## Current Structure

```text
src/app/
├── index.css                        ← global entrypoint, imports only
└── styles/
    ├── base/
    │   ├── tokens.css
    │   ├── reset.css
    │   ├── glass.css
    │   └── fade-in.css
    │
    ├── components/
    │   ├── badges.css
    │   ├── buttons.css
    │   ├── inputs.css
    │   ├── modal.css
    │   ├── skeleton.css
    │   ├── identity.css            ← new: tier styles and identity badges
    │   └── tooltip.css
    │
    ├── layout/
    │   ├── layout.css
    │   └── error-boundary.css
    │
    ├── pages/
    │   ├── home.css
    │   └── address.css
    │
    ├── features/
    │   ├── chronicle/
    │   │   ├── shell.css
    │   │   ├── sidebar.css
    │   │   ├── timeline.css
    │   │   ├── card.css
    │   │   ├── navigation.css
    │   │   ├── tabs.css
    │   │   └── genealogy.css
    │   ├── narrative/
    │   │   ├── content.css
    │   │   ├── chat.css
    │   │   └── history.css
    │   ├── scan/
    │   │   └── scan-progress.css
    │   └── wiki/
    │       ├── wiki.css
    │       └── review-inbox.css    ← new: contribution moderation UI
    │
    ├── widgets/
    │   ├── meta.css
    │   ├── provenance.css
    │   ├── collection-context.css  ← safe alias for provenance.css
    │   ├── ownership.css
    │   ├── sources.css
    │   └── rarity.css
    │
    └── legacy-responsive.css       ← mixed responsive block kept separate for safety
```

---

## Entry Point

The `src/app/index.css` should remain without its own rules, functioning only as an aggregator for the global cascade:

```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap');

@import "./styles/components/tooltip.css";

@import "./styles/base/tokens.css";
@import "./styles/base/reset.css";
@import "./styles/base/glass.css";

@import "./styles/layout/layout.css";

@import "./styles/components/buttons.css";
@import "./styles/components/inputs.css";

@import "./styles/pages/home.css";

@import "./styles/features/chronicle/shell.css";
@import "./styles/features/chronicle/sidebar.css";
@import "./styles/features/chronicle/timeline.css";
@import "./styles/features/chronicle/card.css";

@import "./styles/components/badges.css";
@import "./styles/widgets/rarity.css";

@import "./styles/components/modal.css";
@import "./styles/components/skeleton.css";
@import "./styles/components/identity.css";

@import "./styles/layout/error-boundary.css";
@import "./styles/pages/address.css";

@import "./styles/base/fade-in.css";
@import "./styles/features/scan/scan-progress.css";

@import "./styles/widgets/meta.css";
@import "./styles/widgets/collection-context.css";
@import "./styles/widgets/ownership.css";
@import "./styles/widgets/sources.css";

@import "./styles/features/narrative/content.css";
@import "./styles/features/narrative/chat.css";
@import "./styles/features/narrative/history.css";
@import "./styles/features/wiki/wiki.css";
@import "./styles/features/wiki/review-inbox.css";

@import "./styles/legacy-responsive.css";

@import "./styles/features/chronicle/navigation.css";
@import "./styles/features/chronicle/tabs.css";
@import "./styles/features/chronicle/genealogy.css";
```

Important rule:

- Preserve the import order, as it was aligned with the original monolith cascade to avoid visual regression.

---

## Tokens and Contracts

Global tokens live in `base/tokens.css`.

Critical normalized custom properties:

- `--danger`
- `--color-market`
- `--border-subtle`
- `--text-dim`
- `--glass-border`

Maintenance rules:

- New global tokens go into `base/tokens.css`.
- Do not reintroduce duplicate tokens in feature/widget files.
- If a selector depends on a new token, the token must exist before changing the import order.

---

## Decisions Made During Migration

- We kept the `src/app/styles/` tree as already started instead of renaming everything to an idealized blueprint.
- There were no changes to JSX or `className`; this was a CSS-only pass.
- `collection-context.css` was kept as an explicit alias to avoid unnecessary churn, while `provenance.css` remains the source of truth.
- The mixed responsive block was kept in `legacy-responsive.css` to preserve behavior without forcing a risky split.
- Repeated scrollbars have not yet been consolidated into a shared utility, by design.

---

## Safe Next Steps

1. Consolidate repeated scrollbars into a shared utility.
2. Evaluate extracting recurring global animations into a dedicated file, if it can be done without altering the cascade.
3. Reduce transition aliases/files like `collection-context.css` once there is no more risk of regression.
4. Optionally split `legacy-responsive.css` by domain after validating each block in isolation.

---

## Expected Validation

Whenever touching this architecture, run:

- `npm run typecheck`
- `npm run build`

And manually validate in the UI:

- Home and address selection
- Chronicle shell
- Timeline and badges
- Meta/provenance/ownership/sources/rarity widgets
- Narrative render/chat/history
- Fullscreen preview and navigation overlay
- Tabs/layout modes
- Genealogy tree/explorer

Note:

- The build may display the known chunk > 500 kB warning.
- In sandboxed environments, Wrangler may emit noise when trying to write logs outside the workspace, without invalidating the build.
