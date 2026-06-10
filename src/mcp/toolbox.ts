import "server-only";

// First-party Apify external-MCP toolbox.
//
// Discovered through the generated extension manifest: the package declares
// `cinatra.providesExternalMcpToolbox: true` and the manifest generator records
// this module's factory as a slug-keyed loader entry, so the host's LLM
// toolbox-injection path resolves it WITHOUT importing this package by name.
//
// Apify leaves `external_mcp_servers` entirely; this builder is the only
// injection path for the Apify MCP server. The Bearer token comes from the
// Nango vault under the cinatra-apify integration (provider: "apify"). The MCP
// server URL stays clean (`https://mcp.apify.com`); the token rides in the
// `Authorization` header.

import type {
  ExtensionExternalMcpTool,
  ExtensionExternalMcpToolbox,
} from "@cinatra-ai/sdk-extensions";
import { getApifyDeps } from "../deps";
import { getApifySettings } from "../index";

const APIFY_MCP_URL = "https://mcp.apify.com";
const APIFY_MCP_LABEL = "apify-connector";

export function createApifyExternalMcpToolbox(): ExtensionExternalMcpToolbox {
  return {
    async buildTools(_provider: string): Promise<ExtensionExternalMcpTool[]> {
      try {
        const settings = getApifySettings();
        const { nango } = getApifyDeps();
        if (!nango.isConfigured()) {
          // Fail closed loudly, matching the Drupal toolbox. Only warn when
          // there's actually a connection that would otherwise have been
          // injected.
          if (settings.nangoConnectionId) {
            console.warn(
              "[connector-apify] Nango not configured — Apify MCP server disabled (connector: apify)",
            );
          }
          return [];
        }
        if (!settings.nangoConnectionId) {
          // No stored connection to inject.
          return [];
        }
        const headers = await nango.buildBearerAuthHeader({
          providerConfigKey: nango.providerConfigKeys.apify,
          connectionId: settings.nangoConnectionId,
          label: "apify",
        });
        if (!headers) {
          // Helper already warned about the connection label (no token).
          return [];
        }
        return [
          {
            type: "mcp",
            serverLabel: APIFY_MCP_LABEL,
            serverUrl: APIFY_MCP_URL,
            headers,
            serverDescription: "Apify MCP — actor tools",
            allowedTools: null,
            requireApproval: "never",
          },
        ];
      } catch (err) {
        console.warn(
          `[connector-apify] external-MCP toolbox build failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      }
    },
  };
}
