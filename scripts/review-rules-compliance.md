# RULES.md Compliance Audit — Structured Prompt

**When:** Every release.
**How:** Feed this file to Claude as a prompt: `cat scripts/review-rules-compliance.md`

---

Audit the codebase at /workspace/dev/personalfinance against its rules document
at .scratch/docs/RULES.md.

For EACH section of RULES.md, scan the codebase and check compliance:

1. **Data-Driven Architecture** — Find any if/switch on account category, budget category,
   or tax treatment that should be a config lookup. Check that all account behavior flows
   from ACCOUNT_TYPE_CONFIG.

2. **Engine Modularity** — Verify the orchestrator (engine/index.ts) contains no business
   logic. Check that module interfaces haven't grown hidden coupling.

3. **The Holistic Rule** — Find any page/calculator that duplicates a query or computation
   that exists elsewhere. Check that budget mode, salary, and contribution state are shared.

4. **Data Model Principles** — Check for computed values being stored in DB. Check for
   hardcoded user data. Verify naming conventions (snake_case DB, camelCase code).

5. **Coding Conventions** — Check tRPC verb prefixes, type suffixes, abbreviation usage,
   state layer compliance (server/form/UI), import boundaries.

6. **Settings Belong on Their Pages** — Find any settings that migrated to a centralized
   settings page instead of living on their domain page.

For each violation, report: Rule Section | Violation | File:Line | Fix
