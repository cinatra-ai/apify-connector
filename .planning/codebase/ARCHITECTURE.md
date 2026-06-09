<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Host App                          │
│  (provides: DB, Nango surface, auth, revalidatePath)        │
└────────────┬────────────────────────────────────────────────┘
             │ registerApifyConnector(deps) at boot
             ▼
┌─────────────────────────────────────────────────────────────┐
│              Connector Core  `src/index.ts`                  │
│  saveApifySettings / clearApifySettings / getApifyStatus    │
│  validateApifyToken → api.apify.com                         │
└────────┬──────────────────────────┬─────────────────────────┘
         │                          │
         ▼                          ▼
┌─────────────────┐    ┌────────────────────────────────────┐
│  Server Actions  │    │   Setup Page (RSC)                 │
│  `src/apify-    │    │   `src/setup-page.tsx`             │
│  setup-actions. │    │   `src/apify-setup-impl.tsx`       │
│  ts`            │    │                                    │
└─────────────────┘    └────────────────────────────────────┘
         │                          │
         ▼                          ▼
┌─────────────────────────────────────────────────────────────┐
│             UI Components  `src/components/ui/`             │
│  Button, Input, Field, Alert, Separator, Label              │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│              Host DI Slot  `src/deps.ts`                    │
│  globalThis[Symbol.for("@cinatra-ai/apify-connector:...")] │
│  ApifyConnectorDeps (DB read/write, Nango, MCP registry)   │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Core Logic | save/clear/read Apify settings, validate API token, orchestrate Nango | `src/index.ts` |
| Host DI | globalThis-anchored dep injection slot; `registerApifyConnector` / `getApifyDeps` | `src/deps.ts` |
| Server Actions | Next.js "use server" wrappers with authz gate, form-data parsing, revalidatePath | `src/apify-setup-actions.ts` |
| Setup Page Dispatch | Thin Next.js page route that delegates to the shared impl | `src/setup-page.tsx` |
| Setup Page Impl | RSC: renders Nango-not-ready banner or API-key form; reads status | `src/apify-setup-impl.tsx` |
| UI Components | Primitive React components (Button, Input, Field, Alert, etc.) | `src/components/ui/` |
| Utilities | Generic helpers: cn, slugify, formatCurrencyMillions, pagination | `src/lib/utils.ts` |

## Pattern Overview

**Overall:** Dependency-Injection via a namespaced globalThis Symbol

**Key Characteristics:**
- The connector package carries zero runtime dependency on any `@cinatra-ai/*` host package except the SDK peer deps; all host capabilities (DB, Nango, MCP registry) are injected at boot via `registerApifyConnector(deps)`.
- The DI slot is anchored on `globalThis` with `Symbol.for("@cinatra-ai/apify-connector:host-deps/v1")` so separately compiled Next.js bundles (page, actions, core) all resolve the same slot without a shared module instance.
- The connector manifest (`package.json` `"cinatra"` key) declares `kind: "connector"` — consumed by the Cinatra platform to register and surface the connector.

## Layers

**Host Binding Layer:**
- Purpose: Boot-time wiring of host capabilities into the connector
- Location: `src/deps.ts`
- Contains: `ApifyConnectorDeps` interface, `ApifyNangoCapability` interface, `registerApifyConnector`, `getApifyDeps`, `_resetApifyDepsForTests`
- Depends on: Nothing (structural-only types, no imports from `@cinatra-ai/*`)
- Used by: `src/index.ts`, `src/__tests__/index.test.ts`

**Core Logic Layer:**
- Purpose: Business logic — token validation, Nango orchestration, settings CRUD, status
- Location: `src/index.ts`
- Contains: `saveApifySettings`, `clearApifySettings`, `getApifySettings`, `getApifyStatus`, `validateApifyToken`, `getApifyNangoReady`
- Depends on: `src/deps.ts` (via `getApifyDeps()`), `https://api.apify.com/v2/users/me`
- Used by: `src/apify-setup-actions.ts`, `src/apify-setup-impl.tsx`

**Server Actions Layer:**
- Purpose: Next.js "use server" boundary — authz gate, form-data unwrapping, cache invalidation
- Location: `src/apify-setup-actions.ts`
- Contains: `saveApifyConnectionAction`, `clearApifyConnectionAction`
- Depends on: `src/index.ts`, `@cinatra-ai/sdk-extensions` (`requireExtensionAction`)
- Used by: `src/apify-setup-impl.tsx`

**UI/Presentation Layer:**
- Purpose: React Server Component setup page and primitive UI components
- Location: `src/setup-page.tsx`, `src/apify-setup-impl.tsx`, `src/components/ui/`
- Contains: RSC page, form UI, alert banners
- Depends on: `src/index.ts`, `src/apify-setup-actions.ts`, `@cinatra-ai/sdk-ui/marketplace`, `src/components/ui/`
- Used by: Host app Next.js router

## Data Flow

### Save API Token (Happy Path)

1. User submits form in `src/apify-setup-impl.tsx` → `saveAction` (inline server action)
2. `saveAction` calls `saveApifyConnectionAction(formData)` in `src/apify-setup-actions.ts`
3. `requireExtensionAction` authz check (`@cinatra-ai/sdk-extensions`)
4. `saveApifySettings({ apiKey })` called in `src/index.ts`
5. `getApifyDeps().nango.isConfigured()` — fail-closed gate before any external call
6. `validateApifyToken(apiKey)` — `fetch("https://api.apify.com/v2/users/me")` with Bearer token
7. `nango.ensureConnectorIntegration("apify")`
8. `nango.importConnection(...)` — stores credential in Nango without `connectorKey`
9. `nango.getCredentials(..., { forceRefresh: true })` — readback verification
10. `getApifyDeps().deleteExternalMcpServer(APIFY_MCP_REGISTRY_ID)` — legacy cleanup
11. `writeSettings({ lastValidatedAt, username, nangoConnectionId })` — persist to host DB
12. `nango.saveConnectionRecord(...)` — persist Cinatra pointer row
13. `revalidatePath(...)` — invalidate Next.js cache
14. Browser redirected to `/connectors/apify?saved=1`

### Disconnect Flow

1. User clicks "Disconnect" → `clearAction` (inline server action)
2. `clearApifyConnectionAction()` → authz check
3. `clearApifySettings()` in `src/index.ts`:
   - `deleteExternalMcpServer(APIFY_MCP_REGISTRY_ID)` (unconditional, throws on real DB error)
   - `nango.removeConnectionRecord("apify", connectionId)`
   - `writeSettings({})` — wipe local config
   - `nango.deleteConnection(...)` — best-effort, swallows errors with `console.warn`
4. Redirect to `/connectors/apify?disconnected=1`

**State Management:**
- Settings persisted in host DB via `readConnectorConfigFromDatabase` / `writeConnectorConfigToDatabase` under the key `"apify"`
- Nango credential storage is external (Nango service), referenced by `connectionId`
- No client-side state; all state is server-only (`import "server-only"` guards in `src/index.ts` and `src/apify-setup-impl.tsx`)

## Key Abstractions

**`ApifyConnectorDeps`:**
- Purpose: Structural interface the host must satisfy to wire the connector
- Examples: `src/deps.ts`
- Pattern: Pure structural typing — no runtime imports from host. Host binds concrete impls at boot via `registerApifyConnector(deps)`.

**`ApifyNangoCapability`:**
- Purpose: Minimal Nango surface the connector needs; inlined in `src/deps.ts` to avoid a `@cinatra-ai/nango-connector` code dependency
- Examples: `src/deps.ts`
- Pattern: Structural interface with permissive `unknown` returns for credential readbacks

**`ApifySettings`:**
- Purpose: Shape of the persisted connector config record
- Examples: `src/index.ts` (exported type)
- Pattern: Plain object with optional fields — `lastValidatedAt`, `username`, `nangoConnectionId`

## Entry Points

**Package Public API:**
- Location: `src/index.ts`
- Triggers: Imported by the host app at boot and by Next.js pages/actions at request time
- Responsibilities: Exports all connector logic, types, constants, and re-exports DI registration helpers from `src/deps.ts`

**Next.js Setup Page:**
- Location: `src/setup-page.tsx`
- Triggers: Next.js router navigates to `/connectors/cinatra-ai/apify-connector/setup`
- Responsibilities: Thin dispatch to `ApifyConnectorPageImpl` in `src/apify-setup-impl.tsx`

**Server Actions:**
- Location: `src/apify-setup-actions.ts`
- Triggers: React form actions from `src/apify-setup-impl.tsx`
- Responsibilities: Authz, form-data unwrapping, delegation to core logic, cache revalidation

## Architectural Constraints

- **Server-only:** `src/index.ts` and `src/apify-setup-impl.tsx` are guarded with `import "server-only"` — must never be included in client bundles
- **Global state:** One module-level singleton at `globalThis[Symbol.for("@cinatra-ai/apify-connector:host-deps/v1")]` defined in `src/deps.ts`. All other state is read from the host DB on each request.
- **No host code imports at module level:** The connector carries no runtime dep on any `@cinatra-ai/*` non-SDK package. Host capabilities are injected structurally.
- **Circular imports:** None detected.
- **ESM-only:** `package.json` sets `"type": "module"` — no CommonJS.

## Anti-Patterns

### Importing host internals directly

**What happens:** If connector code imports from `@cinatra-ai/nango-connector` or `@/lib/*` directly instead of using the injected `getApifyDeps().nango` surface.
**Why it's wrong:** Creates a compile-time dependency on host packages, breaking the connector's portability and testability. The `ApifyNangoCapability` interface exists precisely to avoid this.
**Do this instead:** Access Nango exclusively via `getApifyDeps().nango` as shown in `src/index.ts`.

### Calling `getApifyDeps()` before `registerApifyConnector`

**What happens:** Calling any exported function from `src/index.ts` before the host calls `registerApifyConnector(deps)` at boot.
**Why it's wrong:** `getApifyDeps()` throws `"host runtime deps not registered"` — all downstream calls fail.
**Do this instead:** Register deps at host boot in `register-transport-connectors.ts` (host-side) before any connector function is invoked.

## Error Handling

**Strategy:** Fail-closed with explicit, generic error messages that never leak credential values.

**Patterns:**
- Empty/whitespace token rejected before any external call (`src/index.ts` `saveApifySettings`)
- Nango configured check happens before the Apify API call to avoid burning an external request
- Apify HTTP errors produce generic status-only messages (no upstream response body echoed — it may contain the token)
- Nango readback mismatch produces a generic message; neither input nor stored value appears in the message
- Nango `deleteConnection` on disconnect is best-effort: errors are caught and logged with `console.warn`, not rethrown
- Legacy `deleteExternalMcpServer` call is NOT best-effort — a DB error on delete throws to prevent a mixed state where plaintext credentials remain alongside the Nango-backed config

## Cross-Cutting Concerns

**Logging:** `console.warn` for non-fatal Nango disconnect errors only (`src/index.ts` `clearApifySettings`). No structured logging framework.
**Validation:** Input validation is inline in `saveApifySettings` and the server action wrapper. Token format is not regex-validated — only emptiness and Apify API acceptance are checked.
**Authentication:** Authz gate via `requireExtensionAction("@cinatra-ai/apify-connector", "manage")` in `src/apify-setup-actions.ts` — must be admin to save/clear credentials.

---

*Architecture analysis: 2026-06-09*
