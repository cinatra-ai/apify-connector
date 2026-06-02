// Host DI singleton for apify.
// See packages/connector-gmail/src/deps.ts for the pattern + rationale.

/**
 * Structural shape of `@/lib/external-mcp-registry.upsertExternalMcpServer`'s
 * input. Inlined to keep apify's deps interface contract-only (no
 * runtime-or-type import from `@/lib/*`).
 */
type ExternalMcpServerUpsertInput = {
  id: string;
  label: string;
  serverUrl: string;
  nangoConnectionId: string | null;
  scope: "global" | "org" | "team" | "user";
  orgId: string | null;
  userId: string | null;
  enabled: boolean;
};

/**
 * Structural shape of the Nango connection-storage surface apify uses. Inlined
 * (NOT imported from `@cinatra-ai/nango-connector`) so the connector carries no
 * non-SDK `@cinatra-ai/*` code dependency — the host binds the concrete impls
 * (sourced from the nango-connector extension) at boot. Returns are kept
 * permissive (`unknown`) because the connector reads credential readbacks
 * through its own `extractApiKey`/structural guards.
 */
export interface ApifyNangoCapability {
  /** True when the workspace has Nango configured (credentials present). */
  isConfigured(): boolean;
  /** Ensure the provider-config (integration) row exists for this connector. */
  ensureConnectorIntegration(connectorKey: "apify"): Promise<unknown>;
  /** Upsert a connection record by (providerConfigKey, connectionId). */
  importConnection(input: {
    providerConfigKey: string;
    connectionId: string;
    credentials: { type: string; apiKey: string };
    connectorKey?: "apify";
  }): Promise<unknown>;
  /** Read back the stored credentials (optionally force a refresh). */
  getCredentials(
    providerConfigKey: string,
    connectionId: string,
    opts?: { forceRefresh?: boolean },
  ): Promise<unknown>;
  /** Persist the cinatra-side pointer row after a verified readback. */
  saveConnectionRecord(
    connectorKey: "apify",
    record: {
      connectionId: string;
      providerConfigKey: string;
      displayName?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<unknown>;
  /** Remove the cinatra-side pointer row. */
  removeConnectionRecord(connectorKey: "apify", connectionId: string): Promise<unknown>;
  /** Delete the Nango connection (scrubs stored credentials). */
  deleteConnection(providerConfigKey: string, connectionId: string): Promise<unknown>;
  /** Provider-config-key bag — only this connector's slug is exposed. */
  providerConfigKeys: { apify: string };
  /** Connection-id bag — only this connector's slug is exposed. */
  connectionIds: { apify: string };
}

export interface ApifyConnectorDeps {
  readConnectorConfigFromDatabase: <T>(connectorId: string, fallback: T) => T;
  writeConnectorConfigToDatabase: (connectorId: string, value: unknown) => void;
  upsertExternalMcpServer: (input: ExternalMcpServerUpsertInput) => void;
  deleteExternalMcpServer: (id: string) => void;
  /** Nango connection-storage surface (host-bound from the nango-connector extension). */
  nango: ApifyNangoCapability;
}

// Anchor the deps slot on `globalThis` via a namespaced+versioned Symbol so the
// boot-time registration (src/lib/register-transport-connectors.ts, one module
// instance) and the runtime callers — which live in SEPARATELY-COMPILED Next.js
// bundles that do NOT import the registrar (the /connectors page, the setup
// page, the setup actions) — resolve the SAME slot. A plain module-local binding
// would leave those bundles' instance unregistered → getApifyDeps() would throw.
// (Same cross-compilation reason as the SDK action-guard + email-connector
// registry/facade.)
const APIFY_DEPS_KEY = Symbol.for("@cinatra-ai/apify-connector:host-deps/v1");
type DepsHolder = { [k: symbol]: ApifyConnectorDeps | null | undefined };
const _holder = globalThis as unknown as DepsHolder;

export function registerApifyConnector(deps: ApifyConnectorDeps): void {
  _holder[APIFY_DEPS_KEY] = deps;
}

export function getApifyDeps(): ApifyConnectorDeps {
  const deps = _holder[APIFY_DEPS_KEY];
  if (!deps) {
    throw new Error(
      "@cinatra-ai/apify-connector: host runtime deps not registered. " +
        "Call registerApifyConnector(deps) at boot.",
    );
  }
  return deps;
}

export function _resetApifyDepsForTests(): void {
  _holder[APIFY_DEPS_KEY] = null;
}
