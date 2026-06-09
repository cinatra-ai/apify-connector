# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
apify-connector/
├── src/                        # All TypeScript source
│   ├── index.ts                # Package public API & core business logic
│   ├── deps.ts                 # Host DI interfaces & globalThis registration
│   ├── apify-setup-actions.ts  # Next.js "use server" action wrappers
│   ├── apify-setup-impl.tsx    # RSC setup page implementation (server-only)
│   ├── setup-page.tsx          # Next.js page route dispatch (thin wrapper)
│   ├── components/
│   │   └── ui/                 # Primitive UI components
│   │       ├── alert.tsx
│   │       ├── button.tsx
│   │       ├── field.tsx
│   │       ├── input.tsx
│   │       ├── label.tsx
│   │       └── separator.tsx
│   ├── lib/
│   │   └── utils.ts            # Generic utility functions (cn, slugify, etc.)
│   └── __tests__/
│       └── index.test.ts       # Vitest unit tests for core logic
├── .planning/
│   └── codebase/               # GSD planning documents
├── .github/
│   └── workflows/
│       ├── ci.yml              # CI pipeline
│       └── release.yml         # Release pipeline
├── package.json                # Package manifest + Cinatra connector metadata
├── tsconfig.json               # TypeScript config
├── vitest.config.ts            # Vitest test runner config
├── .npmrc                      # npm registry config (note: do not read — may contain auth tokens)
├── LICENSE                     # Apache-2.0
└── README.md                   # Package documentation
```

## Directory Purposes

**`src/`:**
- Purpose: All TypeScript source for the connector package
- Contains: Core logic, DI wiring, server actions, RSC pages, UI components, utilities, tests
- Key files: `src/index.ts` (public API entry), `src/deps.ts` (DI contract)

**`src/components/ui/`:**
- Purpose: Primitive React UI components used by the setup page
- Contains: `alert.tsx`, `button.tsx`, `field.tsx`, `input.tsx`, `label.tsx`, `separator.tsx`
- Key files: All components are used in `src/apify-setup-impl.tsx`

**`src/lib/`:**
- Purpose: Generic utility functions shared across the connector
- Contains: `utils.ts` — `cn` (Tailwind class merging), `slugify`, `formatCurrencyMillions`, `firstName`, `quarterLabel`, `asArray`, `compareValues`, `getPageNumbers`

**`src/__tests__/`:**
- Purpose: Vitest unit tests for core connector logic
- Contains: `index.test.ts` — tests for `saveApifySettings`, `clearApifySettings`, `getApifySettings`, `getApifyStatus`

**`.github/workflows/`:**
- Purpose: CI/CD automation
- Contains: `ci.yml` (test runs), `release.yml` (package publishing)

## Key File Locations

**Entry Points:**
- `src/index.ts`: Package public API — all exports consumed by the host app
- `src/setup-page.tsx`: Next.js page component exported for the connector setup route

**Configuration:**
- `package.json`: Package identity, dependencies, and `"cinatra"` connector metadata block
- `tsconfig.json`: TypeScript compiler options
- `vitest.config.ts`: Test runner configuration

**Core Logic:**
- `src/index.ts`: `saveApifySettings`, `clearApifySettings`, `getApifySettings`, `getApifyStatus`, `validateApifyToken`
- `src/deps.ts`: `ApifyConnectorDeps` interface, `registerApifyConnector`, `getApifyDeps`

**Server Actions:**
- `src/apify-setup-actions.ts`: `saveApifyConnectionAction`, `clearApifyConnectionAction`

**UI:**
- `src/apify-setup-impl.tsx`: Full RSC setup page with form and status display
- `src/setup-page.tsx`: Thin Next.js page route dispatch

**Testing:**
- `src/__tests__/index.test.ts`: All unit tests

## Naming Conventions

**Files:**
- kebab-case for all source files: `apify-setup-actions.ts`, `apify-setup-impl.tsx`
- `setup-page.tsx` for the Next.js page component (platform convention)
- `deps.ts` for the DI registration module (connector-family convention)
- `utils.ts` for shared utilities
- `*.test.ts` for test files

**Directories:**
- lowercase kebab-case: `components/ui/`, `__tests__/`, `lib/`
- `__tests__/` for test colocation at `src/` level

**Exports:**
- Functions: camelCase (`saveApifySettings`, `getApifyDeps`, `clearApifySettings`)
- Types/interfaces: PascalCase (`ApifyConnectorDeps`, `ApifyNangoCapability`, `ApifySettings`)
- Constants: SCREAMING_SNAKE_CASE (`APIFY_MCP_REGISTRY_ID`)
- React components: PascalCase (`ApifyConnectorPageImpl`, `ApifyConnectorSetupPage`)

## Where to Add New Code

**New connector logic (save/clear/validate/status):**
- Primary code: `src/index.ts`
- Export via: `src/index.ts` public surface

**New host capability the connector needs:**
- Add method to `ApifyConnectorDeps` or `ApifyNangoCapability` in `src/deps.ts`
- Update `registerApifyConnector` call sites in the host app and in `src/__tests__/index.test.ts` mock setup

**New server action (form submission, admin operation):**
- Implementation: `src/apify-setup-actions.ts`
- Must begin with `await requireExtensionAction("@cinatra-ai/apify-connector", "manage")`

**New UI component:**
- Implementation: `src/components/ui/<component-name>.tsx`
- Use `cn` from `src/lib/utils.ts` for class merging

**New test:**
- Implementation: `src/__tests__/index.test.ts` (extend existing file) or new `src/__tests__/<topic>.test.ts`
- Use `registerApifyConnector` in `beforeEach` to inject mock deps (see existing pattern in `src/__tests__/index.test.ts`)

**New utility function:**
- Implementation: `src/lib/utils.ts`

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD planning and architecture documents
- Generated: Yes (by gsd-map-codebase)
- Committed: Yes

**`src/__tests__/`:**
- Purpose: Unit tests only — no integration or E2E tests present
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-06-09*
