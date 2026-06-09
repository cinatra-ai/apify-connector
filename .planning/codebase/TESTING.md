# Testing Patterns

**Analysis Date:** 2026-06-09

## Test Framework

**Runner:**
- Vitest
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`)

**Run Commands:**
```bash
npm test          # Run all tests (vitest)
```

## Test File Organization

**Location:**
- Separate `__tests__` directory co-located within `src/`: `src/__tests__/`

**Naming:**
- `<module-name>.test.ts` — mirrors the module under test: `src/__tests__/index.test.ts` tests `src/index.ts`

**Structure:**
```
src/
  __tests__/
    index.test.ts      # Tests for src/index.ts (saveApifySettings, clearApifySettings, getApifySettings)
```

## Test Structure

**Suite Organization:**
```typescript
describe("saveApifySettings", () => {
  it("happy path: validates, imports without connectorKey, readback succeeds, persists in correct order", async () => { ... });
  it("throws when Nango is unconfigured and does not hit api.apify.com", async () => { ... });
  // ...
});

describe("clearApifySettings cleanup symmetry", () => {
  it("removes the local Nango pointer, wipes connector_config, removes the external MCP row, ...", async () => { ... });
  // ...
});

describe("getApifySettings + getApifyStatus", () => {
  it("returns empty settings when nothing saved", () => { ... });
  // ...
});
```

**Patterns:**
- `beforeEach` resets all state: clears `CONFIG_STORE`, calls `vi.clearAllMocks()`, re-registers the connector with mock deps, stubs global `fetch`
- `afterEach` restores all mocks: `vi.restoreAllMocks()` + `vi.unstubAllGlobals()`
- Test descriptions are sentence-level behavioral specs, not implementation descriptions

## Mocking

**Framework:** Vitest (`vi`)

**Dependency injection mocking — the primary pattern:**
The connector uses a `registerApifyConnector(deps)` DI surface. Tests inject mock implementations directly into `registerApifyConnector` in `beforeEach` rather than mocking modules. This avoids `vi.mock()` hoisting entirely for the core business logic.

```typescript
// Module-level mock function declarations
const isNangoConfigured = vi.fn<() => boolean>();
const deleteExternalMcpServer = vi.fn();
const saveNangoConnectionRecord = vi.fn(async (_connectorKey, _record) => undefined);

beforeEach(() => {
  CONFIG_STORE = {};
  vi.clearAllMocks();
  registerApifyConnector({
    readConnectorConfigFromDatabase: <T>(key: string, fallback: T): T =>
      (CONFIG_STORE[key] as T) ?? fallback,
    writeConnectorConfigToDatabase: (key: string, value: unknown) => {
      CONFIG_STORE[key] = value;
    },
    upsertExternalMcpServer: vi.fn(),
    deleteExternalMcpServer,
    nango: {
      isConfigured: isNangoConfigured,
      // ... other nango surface mocks
    },
  });
  isNangoConfigured.mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(async () => USERS_ME_OK as Response));
});
```

**Global stubs:**
- `vi.stubGlobal("fetch", vi.fn(...))` used to intercept outgoing HTTP calls to `api.apify.com`
- Unstubbed in `afterEach` via `vi.unstubAllGlobals()`

**Per-test overrides:**
- `vi.mocked(fn).mockResolvedValueOnce(...)` for single-call overrides within a test
- `vi.mocked(fn).mockReturnValue(false)` for synchronous return overrides
- `vi.mocked(fn).mockImplementationOnce(() => { ... })` for side-effect tracking

**What is NOT mocked:**
- The actual module under test (`src/index.ts`) — imported directly
- `CONFIG_STORE` — a real in-memory `Record<string, unknown>` that acts as a database stub

**Asserting call order:**
```typescript
// Ordering test using a shared array pushed to in mock implementations
const order: string[] = [];
vi.mocked(deleteExternalMcpServer).mockImplementationOnce(() => { order.push("deleteExt"); });
vi.mocked(saveNangoConnectionRecord).mockImplementationOnce(async () => { order.push("savePointer"); });
await saveApifySettings({ apiKey: APIFY_TOKEN });
expect(order).toEqual(["deleteExt", "savePointer"]);
```

## Fixtures and Factories

**Test Data:**
```typescript
const APIFY_TOKEN = "apify_api_VALID_TOKEN_FROM_USER_INPUT_xyz123";
const USERS_ME_OK = {
  ok: true,
  status: 200,
  json: async () => ({ data: { id: "u-1", username: "test-user" } }),
};
```

**Location:**
- Defined as module-level constants at the top of the test file — no separate fixture files

## Coverage

**Requirements:** Not enforced (no coverage thresholds in `vitest.config.ts`)

**View Coverage:**
```bash
# Not configured — no coverage script in package.json
```

## Test Types

**Unit Tests:**
- All tests are unit tests covering business logic in `src/index.ts`
- Isolation achieved via DI injection rather than module mocking
- Tests cover: happy path, ordering invariants, failure modes, security properties (token not leaked in errors), edge cases (empty token, null readback, Nango unconfigured)

**Integration Tests:**
- Not present

**E2E Tests:**
- Not present

## Vitest Configuration Details

From `vitest.config.ts`:
- `environment`: `"node"` — no browser/DOM environment
- `include`: `["src/__tests__/**/*.test.ts"]`
- `exclude`: `["**/node_modules/**"]`

**Path aliases (for monorepo compatibility):**
- `server-only` → `tests/__stubs__/server-only.ts` (repo-root stub)
- `@/lib/database` → `tests/__stubs__/database.ts` (repo-root stub)
- `@/(.+)` → monorepo `src/$1`

These aliases let the connector tests run inside the monorepo workspace without the package being standalone-installable.

## Security Test Patterns

A dedicated test category verifies that error messages never leak credential values:

```typescript
it("error message never includes the input token", async () => {
  vi.mocked(getNangoCredentials).mockResolvedValueOnce({ apiKey: "WRONG" } as never);
  try {
    await saveApifySettings({ apiKey: APIFY_TOKEN });
    expect.unreachable("should have thrown");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    expect(message).not.toContain(APIFY_TOKEN);
    expect(message).not.toContain("WRONG");
  }
});
```

## Common Patterns

**Async Testing:**
```typescript
// Expect resolution
const result = await saveApifySettings({ apiKey: APIFY_TOKEN });
expect(result.nangoConnectionId).toBe("cinatra-apify");

// Expect rejection with message match
await expect(saveApifySettings({ apiKey: APIFY_TOKEN })).rejects.toThrow(/Nango credential verification failed/);

// Expect resolution to undefined (void function)
await expect(clearApifySettings()).resolves.toBeUndefined();
```

**Spy on console:**
```typescript
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
// ... run code that calls console.warn ...
expect(warn).toHaveBeenCalled();
```

---

*Testing analysis: 2026-06-09*
