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
   pnpm test        # Unit + integration tests
   pnpm lint        # ESLint + Prettier
   pnpm build       # Production build
   pnpm docs:verify # Doc counts and generated docs are current
   ```
4. Submit a pull request

## Code Style

- TypeScript strict mode is enabled
- Format with Prettier (`pnpm format`)
- Lint with ESLint (`pnpm lint`)
- Component files use kebab-case (`my-component.tsx`)
- Database columns use snake_case, TypeScript properties use camelCase

## Before you write code

Read the relevant parts of [`docs/RULES.md`](docs/RULES.md) (the rules), [`docs/DESIGN.md`](docs/DESIGN.md) (how things are built) and [`docs/TESTING.md`](docs/TESTING.md). The ones that matter most:

- **Config declares, code executes.** Account-type behavior comes from `ACCOUNT_TYPE_CONFIG` (`src/lib/config/account-types.ts`) through its helpers — never `if (category === "401k")` or a hardcoded list of categories.
- **Business logic lives in `src/lib/pure/`** (or `src/lib/calculators/` for calculators) — never inside a DB transaction, router procedure or API handler. Routers fetch, call pure functions, and persist. Every pure function gets a unit test in `tests/pure/` with no database.
- **One computation per figure.** Before writing a formula, label map or display rule, look for the existing one and reuse it.
- **Format through the helpers** (`formatCurrency`, `formatPercent`, …) so privacy mode can hide amounts.

### Import discipline for pure modules

Pure modules must not import barrel files that pull in database code — import the submodule directly:

```typescript
// WRONG — the barrel pulls in DB schema
import { toNumber } from "@/server/helpers";

// RIGHT — the pure submodule
import { toNumber } from "@/server/helpers/transforms";
```

See `ls src/lib/pure/` for the existing modules — check there before adding one.

## Sending tax figures

The yearly tax figures (IRS limits, withholding tables, capital-gains and IRMAA brackets, poverty lines) live in `tax-data/us-federal/`, one file a year, and every install picks them up. You don't need the app running to change them:

```sh
pnpm install
pnpm tax-data:new-year 2027   # a new year: every figure blank, to fill in
pnpm tax-data:check           # the same checks CI runs, in seconds
```

Cite the published document for every figure and link it in the year's `sources`; use only published figures, never estimates. Format, conventions and the list of keys: [`tax-data/README.md`](tax-data/README.md).

## Reporting Issues

Open a GitHub issue with:

- Steps to reproduce
- Expected vs actual behavior
- Browser/environment details

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
