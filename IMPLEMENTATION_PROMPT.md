# Archived implementation kickoff prompt

> **ARCHIVED — DO NOT USE.** This prompt targets the original architecture and model catalog. `README.md`, `AGENTS.md`, and `WINDOWS_CODEX_SETUP.md` describe the current implementation and handoff workflow.

Use the following prompt in a new Codex task opened in this workspace:

> We are starting implementation of SpecialStock. Read `/Users/dhrumilparekh/SpecialStock/PROJECT_PLAN.md` completely and treat it as the approved product and architecture source of truth. Also inspect the repository and follow its AGENTS.md instructions.
>
> Before editing, summarize the proposed first implementation slice, affected areas, risks, and validation. The repository is expected to be empty or nearly empty. Recommend the concrete production dependencies needed for the approved Next.js/TypeScript stack, but ask for my approval before installing them, as required by AGENTS.md.
>
> After dependency approval, implement the project incrementally. Start with Phase 1 from the plan: application scaffold, environment validation, protected single-user authentication, database schema/migrations, protected application shell, five-symbol settings, and the OpenRouter model picker with `openai/gpt-5.6-luna` as the default. Keep provider and model abstractions clean for later Alpaca/Schwab and model comparison work. Add relevant tests and run validation before handing off.
>
> Do not add options mechanics, execution features, thinkScript integration, or autonomous trading. Do not expose API secrets to the browser. Make reasonable assumptions within the approved plan and document material deviations instead of silently changing scope.
