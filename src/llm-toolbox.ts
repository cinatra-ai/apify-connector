import "server-only";

// First-party Apify MCP toolbox builder — IN-PACKAGE (transport-registration cutover).
//
// Moved from the host's `src/lib/apify-mcp-connection.ts`: Apify is managed
// outside the host's `external_mcp_servers` registry, so its MCP server tools
// are built here and surfaced to the LLM injection paths through the
// `llm-toolbox` capability this connector registers in ./register.ts. The
// Bearer token comes from the Nango vault via the host's
// `@cinatra-ai/host:nango-connection-storage` service (resolved through the
// `ctx.capabilities` port — no host import). The MCP server URL stays clean
// (`https://mcp.apify.com`); the token rides in the `Authorization` header.
//
// The returned tool objects mirror the host LLM layer's `LlmMcpServerTool`
// shape STRUCTURALLY (this package must stay SDK-only, so it does not import
// the llm package); the host validates the shape at the injection boundary.

import type {
  ExtensionHostContext,
  HostNangoConnectionStorageService,
} from "@cinatra-ai/sdk-extensions";
import { getApifySettings } from "./index";

const APIFY_MCP_URL = "https://mcp.apify.com";
const APIFY_MCP_LABEL = "apify-connector";

/** The declared toolbox id agents pin (the legacy `apify-connector` id). */
export const APIFY_TOOLBOX_ID = "apify-connector";

type McpServerToolLike = {
  type: "mcp";
  serverLabel: string;
  serverUrl: string;
  headers?: Record<string, string>;
  serverDescription?: string;
  allowedTools?: string[] | null;
  requireApproval?: "never" | "always" | "read-only";
};

function nangoService(ctx: ExtensionHostContext): HostNangoConnectionStorageService | null {
  const provider = ctx.capabilities.resolveProviders(
    "@cinatra-ai/host:nango-connection-storage",
  )[0];
  return (provider?.impl as HostNangoConnectionStorageService | undefined) ?? null;
}

export async function buildApifyMcpServerTools(
  ctx: ExtensionHostContext,
  _provider: string,
): Promise<McpServerToolLike[]> {
  try {
    const settings = getApifySettings();
    const nango = nangoService(ctx);
    if (!nango || !nango.isConfigured()) {
      // Fail closed loudly, matching the Drupal builder. Only warn when there's
      // actually a connection that would otherwise have been injected.
      if (settings.nangoConnectionId) {
        console.warn(
          "[apify-llm-toolbox] Nango not configured — Apify MCP server disabled (connector: apify)",
        );
      }
      return [];
    }
    if (!settings.nangoConnectionId) {
      // No stored connection to inject.
      return [];
    }
    const headers = (await nango.buildBearerAuthHeader({
      providerConfigKey: nango.providerConfigKeys.apify,
      connectionId: settings.nangoConnectionId,
      label: "apify",
    })) as Record<string, string> | null;
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
      `[apify-llm-toolbox] buildApifyMcpServerTools failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
