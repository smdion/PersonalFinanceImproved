# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] - 2026-03-19

### Fixed

- Auto-versioning never fired — `experimental.instrumentationHook` was not enabled in Next.js config, so `instrumentation.ts` was silently ignored
- Webpack bundling failure when instrumentationHook was enabled — refactored to use self-fetch against API routes instead of direct DB imports (avoids bundling `pg` and Node.js builtins)
- Edge runtime crash (`process.on is not a function`) — added runtime guard so instrumentation only runs in Node.js server context
- Multiple auto versions created on container restart — added duplicate check to `/api/versions/daily` that skips if an auto version already exists for today
- Authentik OIDC groups not forwarded into session — OIDC provider was missing `groups` scope and profile callback, so all Authentik users were assigned viewer role regardless of group membership
- Timestamps displayed in wrong timezone — DB server timezone leaked into `timestamp` columns; forced UTC at the connection level so timestamps are consistent regardless of DB server timezone setting

### Changed

- Instrumentation startup tasks (backfills) moved to `/api/startup` route, called via self-fetch
- Auto-versioning uses self-fetch to `/api/versions/daily` instead of direct DB queries
- All `timestamp` columns in schema updated to `timestamptz` for new deployments; existing databases handled via connection-level `timezone=UTC`
- Externalized `pg` and related packages from webpack bundling via `serverComponentsExternalPackages`

## [0.1.0] - 2026-03-18

### Features

- 7 withdrawal strategies (Fixed, Forgo-Inflation, Spending Decline, Constant %, Endowment, Vanguard Dynamic, Guyton-Klinger)
- Full federal tax engine with 2025/2026 brackets, FICA, Additional Medicare Tax, LTCG graduated rates
- Social Security taxation via IRS 3-tier provisional income formula
- RMD compliance with SECURE 2.0 age thresholds and Uniform Lifetime Table
- Monte Carlo simulation with Cholesky-correlated returns, glide-path support, and percentile bands
- IRMAA cliff detection with 2-year lookback
- Mortgage calculator with amortization, extra payments, refinance chains, and what-if scenarios
- Contribution routing: waterfall, percentage, and specs-based modes with IRS limit enforcement
- Budget dashboard with income/expense tracking and category breakdowns
- Savings goals tracking
- Brokerage account management with performance metrics
- Portfolio allocation and rebalancing views
- Paycheck modeling with pre-tax/post-tax deduction breakdowns
- Scenario system for comparing financial plans side-by-side
- State versioning with snapshot/restore and JSON export/import
- Demo mode with pre-built profiles and read-only access
- ACA subsidy estimator using national average premiums

### Security

- RBAC via Authentik OIDC with 9 granular permissions and admin/viewer roles
- Local admin login with email/password (bcrypt-hashed, created during onboarding)
- Permission-gated tRPC procedures for all mutation endpoints
- First-run bootstrap grants admin to initial authenticated user
- Cookie-based demo profile isolation with schema-level separation
- Dev mode requires explicit ALLOW_DEV_MODE opt-in; defaults to viewer role

### Performance

- Pure calculator functions separated from data-fetching for testability
- Server components for auth and DB checks; client components only for interactives
- Connection pooling with dedicated connections for demo schema switching

### Database

- PostgreSQL with Drizzle ORM and strict TypeScript schema
- Automated migrations via drizzle-kit
- Schema drift detection using drizzle journal version tracking
- Change log (audit trail) for all admin mutations
- Auto-versioning with configurable retention policy

### UI/UX

- Dark/light theme via CSS custom properties
- Responsive dashboard layout with sidebar navigation
- Accessible skip-to-content link
- Config-driven design system with no magic strings
- Tooltip and card components via Radix UI primitives
- Recharts-based data visualizations

### Testing

- Vitest unit tests for financial calculators
- Property-based testing with fast-check
- Calculator validation against published research (Trinity Study, cFIREsim)

### Operations

- Multi-stage Docker build
- Database health check on dashboard load with user-friendly error state
- Structured JSON error logging for audit failures
