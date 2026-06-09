# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Apify REST API:**
- Service: Apify — scraping, crawling, and data extraction actor catalogue exposed as MCP tools
- Endpoint used: `https://api.apify.com/v2/users/me` (GET) — token validation during save flow
- Auth: Bearer token (`Authorization: Bearer <apiKey>`) sent only during validation; credential at rest stored in Nango vault
- Implementation: `src/index.ts` — `validateApifyToken()`

**Apify MCP Server:**
- The connector registers Apify's MCP server URL with the Cinatra host's external-MCP registry so every LLM call in the workspace gains Apify actor tools
- Legacy registry row (plaintext token) identified by `APIFY_MCP_REGISTRY_ID = "apify-connector"` — actively migrated away and deleted on save/clear
- Current path: Nango-backed connection replaces the plaintext MCP URL row; host's `src/lib/apify-mcp-connection.ts` builds the MCP connection (referenced in comments, not in this package)

## Data Storage

**Databases:**
- Connector config stored via host-injected `readConnectorConfigFromDatabase` / `writeConnectorConfigToDatabase` callbacks (key: `"apify"`)
- Schema: `ApifySettings` — `{ lastValidatedAt?: string; username?: string; nangoConnectionId?: string }`
- No direct database client or ORM in this package; all DB access is abstracted through the `ApifyConnectorDeps` DI interface registered at boot (`src/deps.ts`)

**File Storage:**
- Not applicable

**Caching:**
- Next.js path revalidation via `revalidatePath("/connectors/cinatra-ai/apify-connector/setup")` called after save and clear actions (`src/apify-setup-actions.ts`)

## Authentication & Identity

**Auth Provider — Nango (credential vault):**
- Nango manages the Apify API key at rest; this connector never stores the raw token in the database
- Integration flow: `ensureConnectorIntegration("apify")` → `importConnection()` → `getCredentials(forceRefresh: true)` readback verification → `saveConnectionRecord()`
- Provider config key: `"cinatra-apify"`; connection ID: `"cinatra-apify"`
- Nango capability surface is injected at host boot via `ApifyNangoCapability` interface (`src/deps.ts`) — no direct import of `@cinatra-ai/nango-connector` to keep the connector portable
- Configured-check: `nango.isConfigured()` — save flow aborts before any Apify API call if Nango is unconfigured

**Action Authorization:**
- Setup form actions (`src/apify-setup-actions.ts`) gate on `requireExtensionAction("@cinatra-ai/apify-connector", "manage")` from `@cinatra-ai/sdk-extensions` — only workspace admins can save or clear credentials

## Monitoring & Observability

**Error Tracking:**
- Not detected (no Sentry or similar SDK imported)

**Logs:**
- `console.warn` used in `clearApifySettings()` for best-effort Nango `deleteConnection` failures: `[connector-apify] deleteNangoConnection failed (ignored): ...` (`src/index.ts`)

## CI/CD & Deployment

**Hosting:**
- Deployed as part of the Cinatra host Next.js application; this package is installed as a workspace dependency
- Cinatra connector manifest (`package.json` `"cinatra"` key) declares `kind: connector`, `displayName: Apify` for registry discovery

**CI Pipeline:**
- `.github/workflows/` directory present; workflow files not read (contents not examined)

## Environment Configuration

**Required env vars:**
- None directly in this package — all secrets (Nango credentials, Apify API tokens) are injected through the host DI surface at boot
- Nango configuration must be present at the host level before this connector can save credentials (checked via `nango.isConfigured()`)

**Secrets location:**
- Apify API keys stored in Nango vault (external credential manager), retrieved per-request via `nango.getCredentials()`
- `.npmrc` file present (existence only — contents not read)

## Webhooks & Callbacks

**Incoming:**
- Not applicable — no webhook endpoints defined in this package

**Outgoing:**
- Not applicable — connector calls Apify REST API synchronously during token validation only; ongoing MCP tool invocations are handled by the host's MCP connection layer

---

*Integration audit: 2026-06-09*
