# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**`src/lib/utils.ts` contains unrelated utility functions:**
- Issue: The connector's `src/lib/utils.ts` contains generic helpers (`slugify`, `formatCurrencyMillions`, `firstName`, `quarterLabel`, `asArray`, `compareValues`, `getPageNumbers`) that have nothing to do with the Apify connector. These appear to have been copied from a monorepo shared utility file and left in the connector repo. Only `cn` (clsx + tailwind-merge) is actually used by the connector's UI components.
- Files: `src/lib/utils.ts`
- Impact: Dead code inflates the package payload, creates confusion about what the connector provides, and may cause drift with the monorepo's canonical versions of those utilities.
- Fix approach: Remove all functions except `cn` from `src/lib/utils.ts`. Verify no connector source imports the orphaned functions before deleting.

**`noImplicitAny: false` contradicts `strict: true`:**
- Issue: `tsconfig.json` sets `"strict": true` but explicitly overrides `"noImplicitAny": false`. This allows implicit `any` throughout the codebase while maintaining an appearance of strict typing.
- Files: `tsconfig.json`
- Impact: Type-safety holes — particularly in `deps.ts` where return types are `unknown` and structural guards depend on runtime checks rather than compiler enforcement.
- Fix approach: Remove the `noImplicitAny: false` override (let `strict: true` enforce it) and fix any resulting compile errors.

**`vitest.config.ts` depends on a repo-root stub path outside this repo:**
- Issue: `vitest.config.ts` resolves `server-only` and `@/lib/database` stubs via `path.join(__dirname, "../../..")` — three directories above the repo root. This assumes the connector is checked out at a fixed depth within the monorepo. In standalone use (git clone of this extracted repo), the stubs are missing and `vitest` will fail.
- Files: `vitest.config.ts`
- Impact: Tests cannot run in isolation outside the monorepo. CI explicitly skips tests for source-mirror repos (`first_party=1`), so the breakage is only visible locally or in direct forks.
- Fix approach: Ship local stubs in `src/__tests__/__stubs__/` and update aliases to point to them, removing the monorepo path dependency.

**`upsertExternalMcpServer` dep is declared but never called:**
- Issue: `ApifyConnectorDeps` interface (and mock setup in tests) includes `upsertExternalMcpServer`, but no code in `src/index.ts` or anywhere else actually calls it. The connector migrated to a first-party Nango-backed builder and the legacy upsert was dropped, but the dep interface was not cleaned up.
- Files: `src/deps.ts`, `src/__tests__/index.test.ts`
- Impact: Misleads implementors of `registerApifyConnector` into providing an unused method; tests mock it unnecessarily.
- Fix approach: Remove `upsertExternalMcpServer` from `ApifyConnectorDeps` and from all mocks/registrations.

## Known Bugs

**`saveAction` in `apify-setup-impl.tsx` calls `saveApifyConnectionAction` which re-validates the token even when the user leaves the API key field blank to keep the current token:**
- Symptoms: The UI shows "Leave blank to keep the current token" but `saveApifyConnectionAction` always calls `saveApifySettings({ apiKey })` with the trimmed form value. If blank, `saveApifySettings` throws "Enter an Apify API token." — so the UI hint is misleading; blanking the field does not actually preserve the existing token.
- Files: `src/apify-setup-impl.tsx`, `src/apify-setup-actions.ts`
- Trigger: Connect Apify, then re-visit the setup page and submit with the API key field empty.
- Workaround: Always re-enter the token when saving changes.

## Security Considerations

**`clearApifySettings` deletes the external MCP row before removing the Nango pointer, but `writeSettings({})` (which clears `nangoConnectionId`) runs AFTER the external MCP delete and BEFORE `saveConnectionRecord` removal:**
- Risk: The current ordering in `clearApifySettings` is: (1) `deleteExternalMcpServer`, (2) `removeConnectionRecord`, (3) `writeSettings({})`, (4) best-effort `deleteConnection`. If `removeConnectionRecord` throws, `writeSettings({})` is never called, leaving the config row with a stale `nangoConnectionId`. Subsequent `getApifyStatus()` would report "connected" even though the pointer was removed from Nango's side.
- Files: `src/index.ts` (`clearApifySettings`)
- Current mitigation: The best-effort Nango delete is wrapped in try/catch, but `removeConnectionRecord` is not.
- Recommendations: Wrap `removeConnectionRecord` in a try/catch or reorder so `writeSettings({})` runs before the async Nango calls, ensuring the local config is cleared even if remote cleanup fails.

**Apify API upstream error body is not echoed (good), but the `validateApifyToken` error message includes the raw HTTP status code:**
- Risk: HTTP status code alone is low-risk but minor — `HTTP 401` vs `HTTP 403` could hint at whether a token exists vs. has wrong permissions. Already well-mitigated by the comment in code.
- Files: `src/index.ts` (`validateApifyToken`)
- Current mitigation: Comment explicitly documents the decision to suppress upstream body.
- Recommendations: Current mitigation is adequate.

**`requireExtensionAction` gate in server actions:**
- Risk: Admin authz is correctly enforced in `saveApifyConnectionAction` and `clearApifyConnectionAction` via `requireExtensionAction("@cinatra-ai/apify-connector", "manage")`. However, `ApifyConnectorSetupPage` itself in `src/setup-page.tsx` does not perform an authz check before rendering — it exposes the current connection status and username to any authenticated user who can reach the route.
- Files: `src/setup-page.tsx`, `src/apify-setup-impl.tsx`
- Current mitigation: Save/clear mutations are gated. Read-only status exposure may be intentional.
- Recommendations: Confirm whether read access to connection status (including `username`) should also be gated at the page-render level.

## Performance Bottlenecks

**`getCredentials` with `forceRefresh: true` on every save:**
- Problem: `saveApifySettings` forces a Nango credential refresh (`forceRefresh: true`) after every import. For API key credentials that don't expire, this round-trip adds latency with no security benefit beyond the initial readback verification.
- Files: `src/index.ts` (`saveApifySettings`)
- Cause: Defensive design to confirm Nango stored the credential correctly. Reasonable for security but adds a network round-trip on every save.
- Improvement path: The check is correct behavior for a security-sensitive flow; accept the latency or add a timeout/deadline.

## Fragile Areas

**`globalThis` symbol-keyed DI slot:**
- Files: `src/deps.ts`
- Why fragile: The deps singleton uses `Symbol.for("@cinatra-ai/apify-connector:host-deps/v1")` anchored on `globalThis`. If the version string in the symbol key is ever changed (e.g., during a major refactor), old and new bundles will use different slots — `getApifyDeps()` will throw at runtime with no compile-time warning. The `v1` suffix must be kept in sync across all bundles consuming this package.
- Safe modification: Never change the symbol string without a coordinated multi-bundle deploy. Add the symbol key as a named export constant if external consumers need to reference it.
- Test coverage: Tests call `registerApifyConnector` + `_resetApifyDepsForTests` correctly, but there is no test that simulates the cross-bundle scenario (two `Symbol.for(...)` calls returning the same symbol).

**`apify-setup-impl.tsx` inline server actions:**
- Files: `src/apify-setup-impl.tsx`
- Why fragile: `saveAction` and `clearAction` are defined as inline `"use server"` closures inside the React component. Next.js serializes these as bound server references. If the component is refactored to a client component or the file is moved, the `"use server"` directive must be re-placed or the action delegation to `apify-setup-actions.ts` re-wired. The double-layer (impl calls action which calls core) adds indirection that obscures error propagation.
- Safe modification: Keep `saveAction`/`clearAction` as top-level functions in `apify-setup-actions.ts` rather than closures defined inside the component.
- Test coverage: No tests for the React component or server actions — only the core `saveApifySettings`/`clearApifySettings` functions are tested.

## Scaling Limits

**Not applicable** — this is a single-workspace credential connector with no throughput or concurrency requirements. The Nango backend handles credential storage scaling.

## Dependencies at Risk

**`radix-ui` version pinned to `^1.4.3` (monolithic package):**
- Risk: `radix-ui` is the new monolithic distribution. Individual `@radix-ui/*` primitives are the established, stable alternative. The monolithic package is newer and may have fewer community resources and slower patch cycles.
- Impact: If a UI primitive bug appears, fixes may lag behind `@radix-ui/*` equivalents.
- Migration plan: Swap `radix-ui` for the specific `@radix-ui/react-*` packages actually used by the components in `src/components/ui/`.

**`react: "^19.2.3"` as a peer dep — version is very specific:**
- Risk: Pinning `^19.2.3` as a peer dep means hosts on `19.0.x` or `19.1.x` get a peer dep warning. React 19 is still maturing; minor version bumps may introduce breaking changes.
- Impact: Minor — host apps on slightly older React 19 builds get install warnings.
- Migration plan: Loosen to `^19.0.0` unless a specific 19.2.x API is actually required.

**No lockfile committed:**
- Risk: `package.json` has no committed lockfile (`pnpm-lock.yaml` or `package-lock.json` is absent). CI uses `--no-frozen-lockfile`. Dependency versions are not pinned at install time.
- Impact: Builds are not reproducible across time; a patch-level bump in any dependency can break the connector silently.
- Migration plan: Commit a `pnpm-lock.yaml` and switch CI to `--frozen-lockfile`.

## Missing Critical Features

**No UI component tests:**
- Problem: `src/components/ui/` contains `button.tsx`, `input.tsx`, `field.tsx`, `label.tsx`, `alert.tsx`, `separator.tsx`. None have tests. The setup page implementation (`src/apify-setup-impl.tsx`) also has no tests.
- Blocks: Regressions in form behavior, error state rendering, and Nango-unconfigured banner go undetected until manual QA.

**No integration/E2E test for the full save flow:**
- Problem: Tests mock the entire Nango surface and the Apify API. There is no integration test that exercises a real Nango sandbox or Apify sandbox credential.
- Blocks: Regressions in Nango API shape (e.g., `importConnection` signature changes) would not be caught in CI.

## Test Coverage Gaps

**React component layer entirely untested:**
- What's not tested: `src/setup-page.tsx`, `src/apify-setup-impl.tsx`, all of `src/components/ui/`
- Files: `src/setup-page.tsx`, `src/apify-setup-impl.tsx`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/field.tsx`, `src/components/ui/alert.tsx`
- Risk: Rendering regressions, broken form submissions, incorrect conditional display (e.g., "connected" vs. "not connected" state) go undetected.
- Priority: Medium

**Server action authz not tested:**
- What's not tested: `requireExtensionAction` gate in `saveApifyConnectionAction` and `clearApifyConnectionAction`
- Files: `src/apify-setup-actions.ts`
- Risk: An accidental removal of the `requireExtensionAction` call would not be caught by any test.
- Priority: High

**`extractApiKey` with string credential type not tested:**
- What's not tested: The branch `if (typeof credentials === "string") return credentials` in `extractApiKey`
- Files: `src/index.ts`
- Risk: If Nango returns a bare string credential, the fallback branch could return the wrong value silently.
- Priority: Low

---

*Concerns audit: 2026-06-09*
