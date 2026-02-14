# CLAUDE.md Examples

Concrete templates for root and component-level CLAUDE.md files.

## Root CLAUDE.md Template

```markdown
# MyApp

SaaS platform for inventory management. Next.js frontend, NestJS API, PostgreSQL database, Nginx reverse proxy.

## Architecture

- `frontend/` - Next.js 14 (App Router), deployed to Vercel
- `backend/` - NestJS API, deployed to AWS ECS
- `nginx/` - Reverse proxy, handles SSL termination
- `shared/` - TypeScript types and utilities shared across packages
- `infra/` - Terraform configs for AWS resources

## Conventions

- Branch naming: `feat/`, `fix/`, `chore/` prefixes
- Commits: conventional commits format
- All code in TypeScript strict mode
- Environment variables: `.env.local` for local dev, never committed

## Local Development

pnpm install
docker-compose up -d  # PostgreSQL + Redis
pnpm dev              # Starts frontend and backend concurrently
```

## Backend CLAUDE.md Template

```markdown
# Backend - NestJS API

NestJS 10 with TypeORM, PostgreSQL 15, Redis for caching.

## Structure

- `src/modules/` - Feature modules (one dir per domain entity)
- `src/common/` - Shared decorators, guards, pipes, interceptors
- `src/config/` - Configuration module with validation
- `src/database/` - Migrations, seeds, TypeORM config

## Patterns

- Every module follows: controller -> service -> repository
- DTOs use class-validator decorators for validation
- All endpoints require AuthGuard unless marked @Public()
- Pagination uses cursor-based approach (not offset)
- Errors throw NestJS built-in exceptions (NotFoundException, etc.)

## Commands

npm run start:dev         # Dev server with hot reload
npm run migration:gen     # Generate migration from entity changes
npm run migration:run     # Run pending migrations
npm run test              # Unit tests
npm run test:e2e          # E2E tests (requires running DB)

## Database

- Migrations are auto-generated from entity changes, always review before running
- Column naming: snake_case in DB, camelCase in entities (TypeORM handles mapping)
- Soft deletes on all user-facing entities (deletedAt column)
```

## Frontend CLAUDE.md Template

```markdown
# Frontend - Next.js

Next.js 14, App Router, Tailwind CSS, Zustand for state, React Query for server state.

## Structure

- `app/` - Routes and layouts (App Router)
- `components/` - Reusable UI components
- `components/ui/` - Base primitives (Button, Input, Modal)
- `lib/` - Utilities, API client, hooks
- `stores/` - Zustand stores

## Patterns

- Server Components by default, add "use client" only when needed
- API calls go through `lib/api-client.ts` (wraps fetch with auth)
- Forms use react-hook-form + zod validation
- All UI components accept className prop for style overrides
- Loading states use Suspense boundaries, not conditional rendering

## Commands

pnpm dev          # Dev server on port 3000
pnpm build        # Production build
pnpm lint         # ESLint
pnpm test         # Vitest unit tests
```

## Infrastructure CLAUDE.md Template

```markdown
# Nginx - Reverse Proxy

Handles SSL termination, routing, and rate limiting.

## Config Files

- `nginx.conf` - Main config
- `conf.d/upstream.conf` - Backend upstream definitions
- `conf.d/ssl.conf` - SSL/TLS settings
- `sites-enabled/` - Per-domain server blocks

## Key Patterns

- All HTTP traffic redirects to HTTPS
- API routes proxy to backend: `/api/` -> `backend:3001`
- Static assets served directly with 1-year cache headers
- Rate limiting: 100 req/min per IP on API routes

## Commands

nginx -t                    # Test config before reload
docker-compose restart nginx  # Apply changes
```