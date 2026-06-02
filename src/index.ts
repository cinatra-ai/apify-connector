import "server-only";
import type { HostRequiredPackageDefinition } from "@cinatra-ai/sdk-extensions";
import { getApifyDeps } from "./deps";

/**
 * Nango connection-storage surface — host-bound via the connector's `deps`
 * (sourced from the nango-connector extension at boot). Resolved lazily so the
 * separately-compiled setup/page bundles share the same globalThis deps slot.
 */
function apifyNango() {
  return getApifyDeps().nango;
}

/** True when the workspace has Nango configured — used by the setup page. */
export function getApifyNangoReady(): boolean {
  return apifyNango().isConfigured();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApifySettings = {
  lastValidatedAt?: string;
  username?: string;
  /** Present after the Nango-vault migration. Absent on un-migrated workspaces. */
  nangoConnectionId?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Legacy `external_mcp_servers.id` used to register Apify's MCP URL with the
 * global external-MCP registry. The connector now uses its own first-party
 * builder (`src/lib/apify-mcp-connection.ts`), so the row is removed during
 * save and migration. The constant survives because the migration script and
 * `clearApifySettings` still need it for the deletion call.
 */
export const APIFY_MCP_REGISTRY_ID = "apify-connector";

export const apifyConnectionPackage: HostRequiredPackageDefinition = {
  packageId: "@cinatra-ai/connector-apify",
  name: "Apify MCP",
  slug: "connector-apify",
  description: "Apify MCP server registration — adds Apify actor tools to every LLM call.",
  settingsHref: "/connectors/apify",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readSettings(): ApifySettings {
  return getApifyDeps().readConnectorConfigFromDatabase<ApifySettings>("apify", {});
}

function writeSettings(value: ApifySettings) {
  getApifyDeps().writeConnectorConfigToDatabase("apify", value);
}

function extractApiKey(credentials: unknown): string | null {
  if (credentials && typeof credentials === "object" && "apiKey" in credentials) {
    const candidate = (credentials as { apiKey: unknown }).apiKey;
    return typeof candidate === "string" ? candidate : null;
  }
  if (typeof credentials === "string") return credentials;
  return null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function getApifySettings() {
  return readSettings();
}

export function getApifyStatus() {
  const settings = readSettings();
  if (settings.lastValidatedAt && settings.nangoConnectionId) {
    return {
      status: "connected" as const,
      detail: settings.username
        ? `Connected as ${settings.username}. Apify MCP server registered.`
        : "Apify MCP server registered and active.",
    };
  }
  return {
    status: "not_connected" as const,
    detail: "Add an Apify API token to enable Apify actor tools in every LLM call.",
  };
}

export async function validateApifyToken(apiKey: string): Promise<{ id: string; username: string }> {
  const response = await fetch("https://api.apify.com/v2/users/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    // Do not echo Apify's upstream error body. It can contain the submitted
    // token if the API reflects the bad credential. Keep the message generic
    // and status-only.
    throw new Error(`Apify API token validation failed (HTTP ${response.status}).`);
  }
  const payload = (await response.json()) as { data?: { id?: string; username?: string } };
  if (!payload?.data?.id) {
    throw new Error("Apify API returned an unexpected response shape.");
  }
  return { id: payload.data.id, username: payload.data.username ?? "" };
}

/**
 * Save flow:
 *
 *   1. Trim / shape-validate input.
 *   2. Throw if `isNangoConfigured() === false` before validating against
 *      Apify, to avoid burning an external API call on a save that's going to
 *      throw.
 *   3. Validate the token against Apify (`/v2/users/me`).
 *   4. ensureNangoConnectorIntegration("apify").
 *   5. importNangoConnection WITHOUT `connectorKey` so the local Nango pointer
 *      is not written before readback.
 *   6. getNangoCredentials with `forceRefresh: true` and assert that the
 *      returned `apiKey` matches the input. Generic error on mismatch, with no
 *      token in the message.
 *   7. Persist `connector_config["apify"]` with `nangoConnectionId` set.
 *   8. saveNangoConnectionRecord separately after readback succeeds.
 *   9. Defensive cleanup of any legacy `external_mcp_servers` row.
 */
export async function saveApifySettings(input: { apiKey: string }): Promise<ApifySettings> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error("Enter an Apify API token to continue.");
  }
  const nango = apifyNango();
  if (!nango.isConfigured()) {
    throw new Error(
      "Nango is not configured. Configure it at /configuration/llm/nango before saving Apify credentials.",
    );
  }

  const identity = await validateApifyToken(apiKey);

  const providerConfigKey = nango.providerConfigKeys.apify;
  const connectionId = nango.connectionIds.apify;

  await nango.ensureConnectorIntegration("apify");

  await nango.importConnection({
    // Omit connectorKey here to defer saveConnectionRecord until after
    // readback succeeds.
    providerConfigKey,
    connectionId,
    credentials: { type: "API_KEY", apiKey },
  });

  const readback = await nango.getCredentials(providerConfigKey, connectionId, { forceRefresh: true });
  const readbackKey = extractApiKey(readback);
  if (readbackKey !== apiKey) {
    // Generic message — no plaintext / token leak.
    throw new Error(
      "Nango credential verification failed: the readback value did not match the saved credential.",
    );
  }

  // Delete the legacy plaintext `?token=` external_mcp_servers row before the
  // Nango-backed config becomes visible. Doing it after writeSettings can leave
  // a mixed state on delete failure: first-party Apify active while the
  // plaintext row is still injectable. Use an unconditional direct DELETE; a
  // cache-gated existence check can miss a real plaintext row. The delete is
  // `DELETE WHERE id=$1`: no-op when absent, throws only on a real DB error, so
  // save fails loudly rather than reporting success with plaintext still at
  // rest.
  getApifyDeps().deleteExternalMcpServer(APIFY_MCP_REGISTRY_ID);

  writeSettings({
    lastValidatedAt: new Date().toISOString(),
    username: identity.username,
    nangoConnectionId: connectionId,
  });

  await nango.saveConnectionRecord("apify", {
    connectionId,
    providerConfigKey,
    displayName: identity.username || undefined,
    metadata: {},
  });

  return readSettings();
}

export async function clearApifySettings(): Promise<void> {
  const nango = apifyNango();
  const settings = readSettings();
  const connectionId = settings.nangoConnectionId ?? nango.connectionIds.apify;
  // External MCP row cleanup first. Disconnect must fully remove the plaintext
  // `?token=` row before the local pointer/config are wiped, so delete failure
  // cannot leave the plaintext row alive while the rest of disconnect appears
  // to have succeeded. Use an unconditional direct DELETE: idempotent no-op
  // when absent, throws only on a real DB error, and avoids a cache-gated
  // existence check.
  getApifyDeps().deleteExternalMcpServer(APIFY_MCP_REGISTRY_ID);
  // Local pointer + cinatra row cleanup.
  await nango.removeConnectionRecord("apify", connectionId);
  writeSettings({});
  // Nango delete is best-effort — Nango may be unreachable, the connection
  // may already be gone, or the workspace may have been pre-migration.
  if (nango.isConfigured()) {
    try {
      await nango.deleteConnection(nango.providerConfigKeys.apify, connectionId);
    } catch (err) {
      console.warn(
        `[connector-apify] deleteNangoConnection failed (ignored): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// Host DI surface (boot wiring lives in src/lib/register-transport-connectors.ts).
export { registerApifyConnector, getApifyDeps, _resetApifyDepsForTests } from "./deps";
export type { ApifyConnectorDeps } from "./deps";
