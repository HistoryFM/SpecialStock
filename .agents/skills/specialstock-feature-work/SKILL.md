---
name: specialstock-feature-work
description: Plan and implement feature iterations or new product behavior in the SpecialStock repository with its domain boundaries, audit requirements, local persistence, and mocked validation workflow. Use for feature work spanning UI, APIs, services, providers, scheduling, or storage; do not use for a copy-only edit or a simple factual question.
---

# SpecialStock Feature Work

Build the smallest coherent feature while preserving the product's evidence, audit, security, and isolation contracts.

## Establish current context

1. Inspect `git status` before editing. Treat every pre-existing change as user-owned until proven otherwise.
2. Read the current `README.md` sections for Current product behavior, Architecture, Project map, Development constraints, and the domain being changed. Do not use the historical build prompts as requirements.
3. Read [references/architecture-map.md](references/architecture-map.md), then inspect the existing implementation and tests along the affected vertical slice. Current code and tests resolve details that the summary does not.
4. If the work changes Next.js behavior, read the relevant guide under `node_modules/next/dist/docs/` before writing code. This repository's installed Next.js version is authoritative.

## Frame the feature

Before substantial edits, make the following explicit in a short working update:

- the user problem and observable outcome;
- the smallest end-to-end scope that is still usable;
- the UI, route, domain, provider, persistence, and test surfaces affected;
- the product invariants and failure modes most at risk;
- how the result will be verified without paid provider calls.

Make reasonable assumptions when they do not change product scope. Ask only when a missing choice would materially change behavior, data, cost, or architecture.

## Implement through the existing slice

- Extend an existing domain path before inventing a parallel service, repository, scheduler, or provider abstraction.
- Keep protected route handlers responsible for authentication, strict input validation, domain invocation, and sanitized private responses. Put business behavior in the relevant `src/*` module.
- Keep external providers server-only and mockable. Never expose credentials, raw provider error bodies, private prompt text, uploaded data, model responses, or chart bytes through logs or telemetry.
- Preserve idempotency and exclusion rules when work can be retried, scheduled, run concurrently, or submitted from multiple tabs. Define partial-success behavior rather than treating a multi-item batch as all-or-nothing unless the product contract requires atomicity.
- Preserve audit provenance when changing chart capture or AI behavior: exact stored bytes and hashes, prompt revision and rendered-prompt hash, inference settings, attempts, usage/cost, validated output, and locked fields must continue to agree.
- Keep intraday scans, Swing Trade, and Backtesting isolated. Reuse infrastructure only when doing so cannot leak data, side effects, model policies, or indicator rules across domains.
- For schema changes, update `src/db/schema.ts`, create the next checked-in Drizzle migration through the repository workflow, and add a migration or compatibility regression test. Inspect any pending migration first and never fold unrelated work into it.
- Update `README.md` when the feature changes behavior, configuration, architecture, storage, commands, operating requirements, or a documented limitation.
- Ask before adding a production dependency or making a real Chart-Img, OpenRouter, Alpaca, or other paid/external validation call.

## Verify proportionally

1. Run the nearest unit or route tests while iterating.
2. Run `pnpm validate` after implementation changes.
3. Run `pnpm test:e2e` when a user-visible workflow, browser scheduler, route contract, or cross-layer integration changes.
4. Use only mocked providers unless the user separately authorizes a tightly bounded live check.
5. Review the final diff for unrelated edits, secret/private paths, accidental client exposure, and documentation drift.

Finish with the implemented behavior, checks that passed, and any real remaining uncertainty, especially Windows-only or provider-specific uncertainty.
