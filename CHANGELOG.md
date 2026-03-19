# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] - 2026-03-19

### Fixed

- Automatic daily snapshots were not being created
- Container restarts no longer create duplicate snapshots for the same day
- Authentik users now receive the correct role based on their group membership
- Timestamps now display in the correct timezone regardless of database server settings
- Dark mode: fixed visible dark boxes on the Historical page and other card backgrounds

## [0.1.0] - 2026-03-18

### Features

- 7 withdrawal strategies (Fixed, Forgo-Inflation, Spending Decline, Constant %, Endowment, Vanguard Dynamic, Guyton-Klinger)
- Federal tax engine with 2025/2026 brackets, FICA, Additional Medicare Tax, and LTCG graduated rates
- Social Security taxation using the IRS provisional income formula
- Required Minimum Distribution tracking with SECURE 2.0 age thresholds
- Monte Carlo retirement simulations with correlated returns and percentile bands
- IRMAA cliff detection with 2-year lookback
- Mortgage calculator with amortization, extra payments, refinance chains, and what-if scenarios
- Contribution routing with waterfall, percentage, and spec-based modes (IRS limits enforced)
- Budget dashboard with income/expense tracking and category breakdowns
- Savings goals tracking
- Brokerage account management with performance metrics
- Portfolio allocation and rebalancing views
- Paycheck modeling with pre-tax/post-tax deduction breakdowns
- Side-by-side scenario comparison
- State versioning with snapshot/restore and JSON export/import
- Demo mode with pre-built profiles and read-only access
- ACA subsidy estimator

### Security

- Role-based access via Authentik OIDC with granular permissions
- Local admin login with email/password
- First-run bootstrap grants admin to the initial user
- Isolated demo profiles with read-only access
- Dev mode requires explicit opt-in

### UI/UX

- Dark and light themes
- Responsive dashboard with sidebar navigation
- Recharts-based data visualizations

### Operations

- PostgreSQL with Drizzle ORM and automated migrations
- Audit trail for all admin changes
- Auto-versioning with configurable retention
- Multi-stage Docker build
- Database health check with user-friendly error state
