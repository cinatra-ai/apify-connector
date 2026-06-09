# Coding Conventions

**Analysis Date:** 2026-06-09

## Naming Patterns

**Files:**
- kebab-case for multi-word source files: `apify-setup-actions.ts`, `apify-setup-impl.tsx`
- Single-word files: `deps.ts`, `index.ts`
- UI components: kebab-case under `src/components/ui/`: `button.tsx`, `alert.tsx`, `field.tsx`
- Test files: `src/__tests__/index.test.ts`

**Functions:**
- camelCase for all functions: `saveApifySettings`, `clearApifySettings`, `getApifySettings`, `getApifyStatus`, `validateApifyToken`
- Internal helpers prefixed with no modifier — private by convention (not exported): `readSettings`, `writeSettings`, `extractApiKey`, `apifyNango`
- Test-only resets prefixed with underscore: `_resetApifyDepsForTests` (exported from `src/deps.ts`)
- React components: PascalCase: `Button`, `ApifyConnectorPageImpl`

**Variables:**
- camelCase for local variables and function parameters
- UPPER_SNAKE_CASE for module-level constants: `APIFY_MCP_REGISTRY_ID`, `APIFY_DEPS_KEY`
- camelCase for mutable module-level stores: `CONFIG_STORE` in tests (UPPER_SNAKE_CASE used for emphasis in test context)

**Types/Interfaces:**
- PascalCase for all: `ApifySettings`, `ApifyConnectorDeps`, `ApifyNangoCapability`, `ExternalMcpServerUpsertInput`
- Interfaces preferred over `type` for injectable dependency surfaces (`ApifyNangoCapability`, `ApifyConnectorDeps`)
- `type` used for simple data shapes: `ApifySettings`, `SearchParams`

**Exports:**
- Named exports only — no default exports anywhere in the codebase
- Re-exports consolidated at `src/index.ts`

## Code Style

**Formatting:**
- Not detected (no `.prettierrc` or `biome.json` present; `.npmrc` exists but only for registry config)
- TypeScript strict mode enabled; `noImplicitAny: false` is the one relaxation (`tsconfig.json`)

**Linting:**
- Not detected (no `.eslintrc` or `eslint.config.*`)

**TypeScript Settings (from `tsconfig.json`):**
- `target`: ES2023
- `module`: ESNext, `moduleResolution`: bundler
- `strict: true`, `noImplicitAny: false`
- `verbatimModuleSyntax: true` — all type-only imports must use `import type`
- `isolatedModules: true`
- JSX: `react-jsx`

## Import Organization

**Order:**
1. Node built-ins or `"server-only"` sentinel at the top when applicable
2. External packages (Next.js, React, third-party)
3. Internal `@cinatra-ai/sdk-*` peer imports
4. Relative imports from within the package (`./`, `../../`)

**Path Aliases:**
- No `@/` alias within this package itself — relative paths used for internal imports
- `@/` alias is used in `vitest.config.ts` to stub monorepo paths during tests (pointing at monorepo `src/`)

**Type imports:**
- `import type` required for type-only imports due to `verbatimModuleSyntax: true`
  - Example: `import type { HostRequiredPackageDefinition } from "@cinatra-ai/sdk-extensions"` in `src/index.ts`

## Error Handling

**Patterns:**
- Throw `Error` with descriptive, user-facing messages — never raw strings
- Security-conscious: error messages intentionally exclude input tokens/credentials to prevent leaks
  - Example in `src/index.ts`: `validateApifyToken` throws `"Apify API token validation failed (HTTP ${response.status})."` — no upstream body echoed
  - Readback mismatch throws a generic `"Nango credential verification failed: ..."` — no token in message
- Fail-closed: Nango check (`isNangoConfigured()`) happens before any external API call; empty/whitespace tokens validated before any Nango call
- Best-effort pattern for non-critical cleanup: `clearApifySettings` wraps `deleteNangoConnection` in try/catch and calls `console.warn` on failure rather than propagating
- Ordering enforced: destructive operations (delete external MCP row) happen before state-updating operations (write config), so failure leaves no mixed state

**Comment convention for security decisions:**
- Multi-line comments above security-sensitive operations explain WHY (e.g., "No-op when absent, throws only on a real DB error" near `deleteExternalMcpServer` calls)

## Dependency Injection Pattern

**Host DI via `globalThis` Symbol:**
- Deps are registered once at boot via `registerApifyConnector(deps)` in `src/deps.ts`
- Stored on `globalThis` using a namespaced versioned Symbol: `Symbol.for("@cinatra-ai/apify-connector:host-deps/v1")`
- Resolved lazily in callers via `getApifyDeps()` — throws a descriptive error if not registered
- Pattern rationale: Next.js produces separately-compiled bundles; a module-local binding would leave sibling bundles unregistered
- Test reset: `_resetApifyDepsForTests()` sets the slot to `null`

**Structural typing for injected interfaces:**
- `ApifyNangoCapability` is inlined in `src/deps.ts` (not imported from `@cinatra-ai/nango-connector`) so the connector carries no non-SDK `@cinatra-ai/*` code dependency
- Return types of capability methods are kept permissive (`Promise<unknown>`) — callers use structural guards (`extractApiKey`) to read values

## UI Components

**Pattern:** shadcn/ui-style — `class-variance-authority` (CVA) for variant management, `cn()` utility from `src/lib/utils.ts` for class merging, Radix UI primitives via `radix-ui` package.

**Component structure:**
- Named function (not arrow function) for component body: `function Button({ ... }) { ... }`
- Spread `...props` onto the underlying element
- `data-slot` attribute on root element for CSS targeting: `data-slot="button"`
- `asChild` pattern via `Slot.Root` from `radix-ui`

## Logging

**Framework:** `console.warn` only (no logging library)

**Pattern:**
- Warn on non-fatal cleanup failures with a prefixed tag: `[connector-apify] deleteNangoConnection failed (ignored): ...`
- No `console.log` or `console.error` in production paths — errors are thrown, not logged

## Comments

**When to Comment:**
- JSDoc-style `/** ... */` for exported functions and interfaces that have non-obvious contracts
- Inline `//` comments for security/ordering decisions that future readers must not optimize away
- File-level block comments explain cross-bundle architecture decisions (`src/deps.ts`)

**JSDoc usage:**
- Applied to exported constants and functions with non-obvious semantics
- Documents migration context, not just current behavior (e.g., `APIFY_MCP_REGISTRY_ID` explaining legacy row)

## Module Design

**Barrel pattern:**
- `src/index.ts` is the public barrel — re-exports everything consumers need including DI surface from `src/deps.ts`
- `"server-only"` sentinel imported at top of `src/index.ts` and `src/apify-setup-impl.tsx` to prevent client-bundle leakage

**Next.js server actions:**
- Marked with `"use server"` directive at file top (`src/apify-setup-actions.ts`) or inline on async functions (`src/apify-setup-impl.tsx`)
- Always gated with `requireExtensionAction(...)` authz check before any mutation

---

*Convention analysis: 2026-06-09*
