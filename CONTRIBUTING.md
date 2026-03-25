# Contributing to Ledgr

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Fork and clone the repo
2. Copy `.env.example` to `.env` and set `NEXTAUTH_SECRET` and `CRON_SECRET` (database defaults to SQLite — no config needed)
3. Install dependencies: `pnpm install`
4. Run migrations: `pnpm db:migrate`
5. Start dev server: `pnpm dev`

## Making Changes

1. Create a branch from `main`: `git checkout -b feature/your-feature`
2. Make your changes
3. Ensure all checks pass:
   ```bash
   pnpm test        # Run all tests
   pnpm lint        # Check code style
   pnpm build       # Verify production build
   ```
4. Submit a pull request

## Code Style

- TypeScript strict mode is enabled
- Format with Prettier (`pnpm format`)
- Lint with ESLint (`pnpm lint`)
- Component files use kebab-case (`my-component.tsx`)
- Database columns use snake_case, TypeScript properties use camelCase

## Data-Driven Design

Ledgr follows a data-driven architecture. When adding new features:

- Define data shapes as the source of truth
- Write generic renderers that read fields and render what's present
- Use config/lookup tables instead of if-statements for category-specific behavior
- Display rules live in data presence, not in call-site decisions

## Pure Business Logic Boundary

**All business logic must live in `src/lib/pure/` — never inside database transactions, API handlers, or router procedures.**

This is a hard architectural rule. `better-sqlite3` cannot use async transactions, and even with async-capable databases, coupling logic to I/O makes it untestable. The pattern:

1. **Pure functions** (`src/lib/pure/`): Compute values, validate rules, resolve limits, transform data. No imports from `@/lib/db`, `drizzle-orm`, or any I/O module. Import helpers only from specific submodules (e.g. `@/server/helpers/transforms`), never from barrel re-exports that pull in DB code.
2. **Routers/handlers** (`src/server/routers/`): Fetch data, call pure functions, persist results. Thin wrappers only — if you're writing an `if` statement or a `for` loop that computes a value, it belongs in a pure function.
3. **Tests** (`tests/pure/`): Every pure function gets a unit test. These tests must run without any database, network, or environment setup.

### How to tell if logic is in the wrong place

- **In a `.transaction()` callback?** Extract it.
- **In a `protectedProcedure` handler and doing math/validation/aggregation?** Extract it.
- **Needs `import * as schema` or `import { eq } from "drizzle-orm"` to work?** It's not pure — separate the query from the computation.
- **Can't test it without mocking the database?** Extract the computation into `src/lib/pure/`.

### Import discipline for pure modules

Pure modules in `src/lib/pure/` must never import from barrel re-exports that transitively pull in database code. Use direct submodule imports:

```typescript
// WRONG — barrel pulls in DB schema via transitive re-exports
import { toNumber } from "@/server/helpers";

// RIGHT — direct import from the pure submodule
import { toNumber } from "@/server/helpers/transforms";
```

### Existing pure modules

| Module                  | Domain                 | Key exports                                                                                     |
| ----------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `pure/performance.ts`   | Year-end finalization  | `resolveCategoryValues`, `filterAccountsForNextYear`, `assembleNetWorthValues`, `computeReturn` |
| `pure/contributions.ts` | IRS limits             | `resolveIrsLimit`, `computeSiblingTotal`, `isEligibleForPriorYear`                              |
| `pure/portfolio.ts`     | Snapshot carry-forward | `buildPrevInactiveKeys`, `resolveAccountActiveStatus`, `computeSnapshotEndingBalances`          |
| `pure/tax.ts`           | Household tax          | `computeHouseholdTax`, `combinedPreTaxDeductions`                                               |
| `pure/historical.ts`    | Temporal resolution    | `resolveSalaryForYear`, `buildSalaryByYear`, `resolveCarryForwardAssetValue`                    |
| `pure/projection.ts`    | MC blending            | `interpolateAllocations`, `blendDeterministicRates`, `blendedPortfolioStats`                    |
| `pure/profiles.ts`      | Deletion guards        | `canDeleteBudgetProfile`, `canDeleteContribProfile`, `findActiveJob`, `resolveLinkedProfile`    |

## Reporting Issues

Open a GitHub issue with:

- Steps to reproduce
- Expected vs actual behavior
- Browser/environment details

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
