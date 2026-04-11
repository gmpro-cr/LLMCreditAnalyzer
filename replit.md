# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### CreditGuard AI (`artifacts/creditguard`)
- React + Vite frontend at `/`
- LLM-powered Credit Memo Generator for corporate bankers
- Pages: Dashboard, Cases list, New Case form, Memo Editor (/cases/:id), Risk Review (/cases/:id/risks)
- Uses Plus Jakarta Sans + JetBrains Mono fonts
- Design: Oxford Blue sidebar, emerald accent, information-dense layout

### API Server (`artifacts/api-server`)
- Express 5 at `/api`
- Routes: `/api/cases`, `/api/cases/:id`, `/api/cases/:id/sections`, `/api/cases/:id/generate`, `/api/cases/:id/risk-flags`, `/api/dashboard/stats`, `/api/dashboard/recent-activity`, `/api/dashboard/status-breakdown`

## Database Schema

- `cases` — credit memo cases with borrower info, facility details, status, progress
- `memo_sections` — 12 CAM sections per case with AI-generated content, confidence, review state
- `risk_flags` — risk flags per case with severity and mitigation
- `activity_log` — audit trail of case activity

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
