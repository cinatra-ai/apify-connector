// The apify connector's `register(ctx)` server entry.
//
// Transport-registration cutover: the host no longer statically imports `registerApifyConnector` — this
// entry binds the connector's host deps AT ACTIVATION by adapting the
// per-concern host services published in the capability registry
// (`@cinatra-ai/host:connector-config`, `@cinatra-ai/host:external-mcp-registry`,
// `@cinatra-ai/host:nango-connection-storage`). Every adapter field resolves
// the host service LAZILY at call time, so activation order against the host's
// boot imports never matters.
//
// It also registers the `llm-toolbox` capability provider serving the
// `apify-connector` declared toolbox id — the registration-driven replacement
// for the host's hardcoded Apify branch in the LLM declared-id resolution
// (the builder lives in ./llm-toolbox, in-package).
//
// SDK imports here are TYPE-ONLY (host-peer value-import gate): the host
// services arrive as DATA through `ctx.capabilities`.

import type {
  ExtensionHostContext,
  HostConnectorConfigService,
  HostExternalMcpRegistryService,
  HostNangoConnectionStorageService,
} from "@cinatra-ai/sdk-extensions";
import { registerApifyConnector, type ApifyConnectorDeps } from "./deps";
import { APIFY_TOOLBOX_ID, buildApifyMcpServerTools } from "./llm-toolbox";

const PACKAGE_NAME = "@cinatra-ai/apify-connector";

function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = ctx.capabilities.resolveProviders(capability)[0];
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-transport-connectors) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

export function register(ctx: ExtensionHostContext): void {
  const config = () =>
    hostService<HostConnectorConfigService>(ctx, "@cinatra-ai/host:connector-config");
  const externalMcp = () =>
    hostService<HostExternalMcpRegistryService>(ctx, "@cinatra-ai/host:external-mcp-registry");
  const nango = () =>
    hostService<HostNangoConnectionStorageService>(
      ctx,
      "@cinatra-ai/host:nango-connection-storage",
    );

  const deps: ApifyConnectorDeps = {
    readConnectorConfigFromDatabase: (connectorId, fallback) =>
      config().read(connectorId, fallback),
    writeConnectorConfigToDatabase: (connectorId, value) =>
      config().write(connectorId, value),
    upsertExternalMcpServer: (input) =>
      externalMcp().upsertServer(input as unknown as Record<string, unknown>),
    deleteExternalMcpServer: (id) => externalMcp().deleteServer(id),
    nango: {
      isConfigured: () => nango().isConfigured(),
      ensureConnectorIntegration: (connectorKey) =>
        nango().ensureConnectorIntegration(connectorKey),
      importConnection: (input) => nango().importConnection(input),
      getCredentials: (providerConfigKey, connectionId, opts) =>
        nango().getCredentials(providerConfigKey, connectionId, opts),
      saveConnectionRecord: (connectorKey, record) =>
        nango().saveConnectionRecord(connectorKey, record),
      removeConnectionRecord: (connectorKey, connectionId) =>
        nango().removeConnectionRecord(connectorKey, connectionId),
      deleteConnection: (providerConfigKey, connectionId) =>
        nango().deleteConnection(providerConfigKey, connectionId),
      get providerConfigKeys() {
        return nango().providerConfigKeys as ApifyConnectorDeps["nango"]["providerConfigKeys"];
      },
      get connectionIds() {
        return nango().connectionIds as ApifyConnectorDeps["nango"]["connectionIds"];
      },
    },
  };

  registerApifyConnector(deps);

  // Registration-driven LLM toolbox: serves the legacy `apify-connector`
  // declared toolbox id (agents pin it in their toolboxes) without any host
  // branch. The builder reads this connector's own settings + the host nango
  // bearer-header service.
  ctx.capabilities.registerProvider("llm-toolbox", {
    packageName: PACKAGE_NAME,
    impl: {
      toolboxId: APIFY_TOOLBOX_ID,
      build: (provider: string) => buildApifyMcpServerTools(ctx, provider),
    },
  });
}
