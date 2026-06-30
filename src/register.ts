// The apify connector's `register(ctx)` server entry.
//
// Transport-registration cutover: the host no longer statically imports `registerApifyConnector` — this
// entry binds the connector's host deps AT ACTIVATION by adapting the
// per-concern host services published in the capability registry
// (`@cinatra-ai/host:connector-config`, `@cinatra-ai/host:external-mcp-registry`)
// plus the connector-authored `nango-system` surface (the legacy
// `@cinatra-ai/host:nango-connection-storage` adapter id is retired —
// cinatra#151 Stage 3). Every adapter field resolves the host service LAZILY
// at call time, so activation order against the host's boot imports never
// matters.
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
  NangoSystemSurface,
} from "@cinatra-ai/sdk-extensions";
import {
  registerApifyConnector,
  getApifyDeps,
  type ApifyConnectorDeps,
} from "./deps";
import { APIFY_TOOLBOX_ID, buildApifyMcpServerTools } from "./llm-toolbox";
import { getApifyStatus, saveApifySettings, clearApifySettings } from "./index";

const PACKAGE_NAME = "@cinatra-ai/apify-connector";

/** The host-published action-guard service (value, NOT the SDK
 *  `requireExtensionAction` import — a runtime serverEntry graph rejects SDK
 *  value imports). Mirrors openai/anthropic/gemini-connector. */
type HostActionGuard = {
  require: (packageId: string, mode: "read" | "manage") => Promise<void>;
};

function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = ctx.capabilities.resolveProviders(capability)[0];
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-host-connector-services) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

export function register(ctx: ExtensionHostContext): void {
  const config = () =>
    hostService<HostConnectorConfigService>(ctx, "@cinatra-ai/host:connector-config");
  const externalMcp = () =>
    hostService<HostExternalMcpRegistryService>(ctx, "@cinatra-ai/host:external-mcp-registry");
  // The connector-authored nango-system surface (registered by the nango
  // gateway's own register(ctx) — a systemExtension, required at boot).
  const nango = (): NangoSystemSurface => {
    const provider = ctx.capabilities.resolveProviders("nango-system")[0];
    const surface = provider?.impl as NangoSystemSurface | undefined;
    if (!surface || typeof surface.isNangoConfigured !== "function") {
      throw new Error(
        `${PACKAGE_NAME}: the "nango-system" capability surface is not registered — ` +
          `resolve at call time (post-activation), never at module eval.`,
      );
    }
    return surface;
  };

  const deps: ApifyConnectorDeps = {
    readConnectorConfigFromDatabase: (connectorId, fallback) =>
      config().read(connectorId, fallback),
    writeConnectorConfigToDatabase: (connectorId, value) =>
      config().write(connectorId, value),
    upsertExternalMcpServer: (input) =>
      externalMcp().upsertServer(input as unknown as Record<string, unknown>),
    deleteExternalMcpServer: (id) => externalMcp().deleteServer(id),
    // Members delegate to the nango-system surface at CALL time (key maps are
    // getters for the same reason). Inputs are cast at this boundary where the
    // surface owns the wider shape (NangoConnectorKey union / record shape) —
    // this connector only ever passes valid values.
    nango: {
      isConfigured: () => nango().isNangoConfigured(),
      ensureConnectorIntegration: (connectorKey) =>
        nango().ensureNangoConnectorIntegration(connectorKey),
      importConnection: (input) =>
        nango().importNangoConnection(input as Parameters<NangoSystemSurface["importNangoConnection"]>[0]),
      getCredentials: (providerConfigKey, connectionId, opts) =>
        nango().getNangoCredentials(providerConfigKey, connectionId, opts),
      saveConnectionRecord: (connectorKey, record) =>
        nango().saveNangoConnectionRecord(
          connectorKey,
          record as Parameters<NangoSystemSurface["saveNangoConnectionRecord"]>[1],
        ),
      removeConnectionRecord: (connectorKey, connectionId) =>
        nango().removeNangoConnectionRecord(connectorKey, connectionId),
      deleteConnection: (providerConfigKey, connectionId) =>
        nango().deleteNangoConnection(providerConfigKey, connectionId),
      // Bearer-header builder for the manifest-discovered external-MCP toolbox
      // (src/mcp/toolbox.ts): once the host cutover removes the legacy boot
      // wiring, this entry is the only binder of ApifyConnectorDeps, so the
      // deps surface added with the toolbox module must be bound here too.
      buildBearerAuthHeader: async (input) =>
        (await nango().buildBearerAuthHeaderFromNango(input)) as {
          Authorization: string;
        } | null,
      // Vendor identity is OPEN at the SDK (#12): the surface's key maps are
      // `Record<string, string>` (no SDK-frozen union), so this connector
      // projects ITS OWN key out of the open map at the boundary.
      get providerConfigKeys() {
        return { apify: nango().providerConfigKeys.apify };
      },
      get connectionIds() {
        return { apify: nango().connectionIds.apify };
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

  // ---- schema-config named actions (cinatra#782) ----
  //
  // The declarative setup surface (cinatra.configSchema) renders WITHOUT
  // shipping React. Its probe + named-action fields reference these
  // host-registered actions BY ID; the host dispatches them through
  // `/api/extensions/{installId}/actions/{actionId}`, authorizing the actor at
  // the "use" tier. Saving/clearing the Apify token is a MANAGE-tier mutation
  // (the prior saveApifyConnectionAction gated "manage"), so the WRITE handlers
  // re-assert the manage gate via the host action-guard service. Requires the
  // "ui" host port.

  // Resolve the host action-guard service LAZILY at action-call time as a VALUE
  // through the capability registry (NEVER an SDK value import — a runtime
  // serverEntry graph rejects those). A missing guard FAILS CLOSED.
  const requireManage = async (): Promise<void> => {
    const provider = ctx.capabilities.resolveProviders(
      "@cinatra-ai/host:extension-action-guard",
    )[0];
    const guard = provider?.impl as HostActionGuard | undefined;
    if (!guard || typeof guard.require !== "function") {
      throw new Error(
        `${PACKAGE_NAME}: host action-guard service is not registered — refusing the ungated action.`,
      );
    }
    await guard.require(PACKAGE_NAME, "manage");
  };

  // READ/PROBE: connection (Nango) service readiness — drives the advisory copy.
  ctx.ui.registerAction({
    id: "connectionServiceReady",
    handler: async (): Promise<{ ready: boolean }> => ({
      ready: getApifyDeps().nango.isConfigured(),
    }),
  });

  // PROBE: connection status. THROWS when not connected so the status-probe pill
  // renders "error"; a connected status returns its detail.
  ctx.ui.registerAction({
    id: "connectionStatus",
    handler: async (): Promise<{ detail: string }> => {
      const status = getApifyStatus();
      if (status.status !== "connected") {
        throw new Error(status.detail);
      }
      return { detail: status.detail };
    },
  });

  // WRITE (manage-gated): validate + persist the API token (synced to Nango).
  // saveApifySettings validates the token against Apify and throws on a blank
  // token — surfaced as the error banner.
  ctx.ui.registerAction({
    id: "saveConnection",
    handler: async (input: unknown): Promise<{ banner: string }> => {
      await requireManage();
      const fields =
        input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const apiKey = typeof fields.apiKey === "string" ? fields.apiKey.trim() : "";
      if (!apiKey) {
        throw new Error("Enter an Apify API token.");
      }
      await saveApifySettings({ apiKey });
      return { banner: "saved" };
    },
  });

  // WRITE (manage-gated): clear the stored connection (scrubs the Nango
  // credential, the cinatra-side pointer rows, and the legacy external-MCP row).
  ctx.ui.registerAction({
    id: "clearConnection",
    handler: async (): Promise<{ banner: string }> => {
      await requireManage();
      await clearApifySettings();
      return { banner: "cleared" };
    },
  });
}
