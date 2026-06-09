# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- TypeScript (strict mode, ES2023 target) - all source files under `src/`

**Secondary:**
- TSX (React JSX) - UI components and setup pages under `src/components/ui/` and `src/apify-setup-impl.tsx`, `src/setup-page.tsx`

## Runtime

**Environment:**
- Node.js (ESNext modules, `"type": "module"`)
- Server-only constraint enforced via `import "server-only"` in `src/index.ts` — connector logic is Next.js server-side only

**Package Manager:**
- npm (`.npmrc` present with `auto-install-peers=false`)
- Lockfile: Not detected in repository root (may be managed by parent monorepo)

## Frameworks

**Core:**
- Next.js (implicit — uses `next/cache` `revalidatePath` in `src/apify-setup-actions.ts`, `"use server"` directive, server-only import)
- React 19 (peer dependency `react: ^19.2.3`, `react-dom: ^19.2.3`)

**Testing:**
- Vitest — configured in `vitest.config.ts`; test files under `src/__tests__/`

**Build/Dev:**
- TypeScript compiler (`tsc`) — `tsconfig.json` targets `dist/` output with declarations and source maps
- Module resolution: `bundler` mode (Next.js compatible)

## Key Dependencies

**Critical:**
- `@cinatra-ai/sdk-extensions` (peer, optional) — provides `requireExtensionAction` auth guard and `HostRequiredPackageDefinition` type; host binds implementation at boot
- `@cinatra-ai/sdk-ui` (peer, optional) — UI primitives from Cinatra's design system

**Infrastructure:**
- `class-variance-authority ^0.7.1` - variant-based component styling (`src/components/ui/`)
- `clsx ^2.1.1` - conditional className utility (`src/lib/utils.ts`)
- `radix-ui ^1.4.3` - headless UI primitives for components
- `tailwind-merge ^3.5.0` - Tailwind class merging utility

## Configuration

**Environment:**
- No `.env` files in this package; environment/secrets injected at host level via the `ApifyConnectorDeps` DI interface (registered at boot via `registerApifyConnector(deps)`)
- Apify API token is stored through Nango (credential vault) — never held in process environment variables directly

**Build:**
- `tsconfig.json` — standalone config (does not extend monorepo root); `outDir: dist`, `rootDir: src`, declarations + source maps enabled
- `vitest.config.ts` — test environment `node`; resolves `server-only` and `@/lib/database` via stubs from parent repo's `tests/__stubs__/`

## Platform Requirements

**Development:**
- Node.js with ESM support
- Parent monorepo present for test stub resolution (vitest aliases reference `../../..` relative paths)

**Production:**
- Deployed as part of the Cinatra host application (Next.js App Router)
- Cinatra connector manifest in `package.json` under `"cinatra"` key: `apiVersion: cinatra.ai/v1`, `kind: connector`, `displayName: Apify`

---

*Stack analysis: 2026-06-09*
