# Contributing to OrdinalMind

Thanks for your interest in contributing to OrdinalMind.

OrdinalMind is a factual memory engine for Bitcoin Ordinals. The product resolves inscription numbers, inscription IDs, and Taproot addresses into verifiable timelines built from public data. Community wiki context and optional client-side narrative synthesis are additive layers on top of that factual core.

This document covers how to contribute safely, how to work with the repository, and what standards changes should meet before they are merged.

## Before You Start

Please review these repository documents first:

- [README.md](./README.md) for the project overview and architecture entrypoints.
- [AGENTS.md](./AGENTS.md) for the product thesis and implementation constraints.
- [SECURITY.md](./SECURITY.md) for vulnerability reporting.

## Product Principles

Every contribution should reinforce the core promise of OrdinalMind:

> Factual first, public data only, optional Discord-based community consensus, and no server-side custody of user secrets.

In practice, this means:

- The raw Chronicle timeline is the product.
- LLM output is optional and must never block the factual experience.
- User LLM keys must stay client-side.
- The Worker must only use public, cacheable data.
- Events must be traceable to real public sources.
- Uncertainty should be surfaced, not hidden.

## Ways to Contribute

You can contribute by:

- Fixing bugs or regressions.
- Improving factual resolution, timeline quality, or source attribution.
- Improving the UI around provenance, uncertainty, and graceful fallbacks.
- Improving docs, tests, or developer tooling.
- Proposing safe improvements to the MCP or wiki contribution surfaces.

Please avoid drive-by architectural rewrites. Prefer small, reviewable changes that preserve the existing product direction.

## Development Setup

1. Fork the repository if you are contributing from outside the main project.
2. Clone the repository.
3. Install dependencies:

```bash
npm install
```

4. Apply local database migrations if your work needs the wiki database:

```bash
npm run db:migrate:local
```

5. Start the local development server:

```bash
npm run dev
```

## Branching and Pull Requests

`main` is the protected production branch.

Please use this workflow:

1. Create a branch from `main`.
2. Make focused commits.
3. Open a pull request back into `main`.
4. Wait for required checks to pass before merging.

Example:

```bash
git checkout main
git pull origin main
git checkout -b feature/your-change
```

Commit messages should be small and semantic when possible:

```bash
feat: improve chronicle provenance rendering
fix: preserve partial results when rarity lookup fails
docs: clarify byok contribution rules
```

Avoid vague commit messages such as `update`, `fix stuff`, or `misc changes`.

## Required Checks

At the time of writing, `main` is protected and requires:

- Pull requests before merge.
- Up-to-date branches before merge.
- Conversation resolution before merge.
- Passing Cloudflare Workers build checks.

If repository automation changes, contributors should still assume that all relevant validation must pass before merge.

## Coding Expectations

Please keep changes aligned with the current architecture:

- Prefer explicit TypeScript types.
- Prefer pure functions for normalization, timeline merging, and event construction.
- Keep Worker routing/orchestration separate from UI rendering.
- Keep BYOK adapters isolated from server logic.
- Avoid new dependencies unless they clearly reduce complexity.

Please do not:

- Add server-side handling of user LLM API keys.
- Introduce hidden data sources or fabricated metadata.
- Make the factual timeline depend on Discord auth or LLM availability.
- Replace existing structure with a broad rewrite unless explicitly requested.

## Data Integrity and Agent Surfaces

Changes touching resolution, timeline assembly, scraping, caching, wiki consolidation, MCP, or SEO/agent-readiness should be especially careful about:

- deterministic output for the same upstream data
- explicit timestamps
- source preservation
- careful deduplication
- partial-result behavior when one source fails
- avoiding aggressive scraping behavior

For public machine-readable surfaces such as `llms.txt`, `robots.txt`, `sitemap.xml`, and `/mcp`, prefer explicit, stable contracts over clever or implicit behavior.

## Testing

Before opening a PR, run the most relevant validation you can for your change.

Common commands:

```bash
npm run typecheck
npm run test
npm run build
```

For targeted work, run the smallest relevant test slice in addition to broader validation.

Examples:

```bash
npm run test -- tests/worker/seoRoutes.test.ts
npm run test -- tests/worker/chronicleSmoke.test.ts
```

If you cannot run a validation step, mention that clearly in the PR description.

## Pull Request Guidance

A good pull request should explain:

- what changed
- why it changed
- how it was validated
- any known risks or follow-ups

If your change affects user-visible behavior, public APIs, MCP behavior, or agent-readable surfaces, include a short note about expected before/after behavior.

## Issues and Discussion

If you are planning a large feature, product-direction change, or architectural shift, open an issue or discussion first so we can align before implementation.

For smaller fixes, it is usually fine to open a PR directly.

## Security

Please do not open public issues for security vulnerabilities. Follow the process in [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the same license as the repository.
