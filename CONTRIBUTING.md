# Contributing to Ledgr

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Fork and clone the repo
2. Copy `.env.example` to `.env` and fill in your database credentials
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

## Reporting Issues

Open a GitHub issue with:

- Steps to reproduce
- Expected vs actual behavior
- Browser/environment details

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
