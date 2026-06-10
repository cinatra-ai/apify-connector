// Verifies the in-package Apify MCP toolbox builder (moved from the host's
// apify-mcp-connection during the transport-registration cutover). Mirrors the
// previous host test shape: nango-unconfigured / no-connection / happy-path /
// missing-token, with the nango surface arriving through the ctx capability.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";
import { registerApifyConnector } from "../deps";
import { buildApifyMcpServerTools, APIFY_TOOLBOX_ID } from "../llm-toolbox";

const settingsRow: { value: Record<string, unknown> } = { value: {} };

function stubDeps() {
  registerApifyConnector({
    readConnectorConfigFromDatabase: <T,>(_id: string, fallback: T): T =>
      (Object.keys(settingsRow.value).length ? (settingsRow.value as T) : fallback),
    writeConnectorConfigToDatabase: () => {},
    upsertExternalMcpServer: () => {},
    deleteExternalMcpServer: () => {},
    nango: {} as never,
  });
}

const isConfigured = vi.fn();
const buildBearerAuthHeader = vi.fn();

function ctxWithNango(present = true): ExtensionHostContext {
  return {
    capabilities: {
      registerProvider: () => {},
      resolveProviders: (capability: string) =>
        present && capability === "@cinatra-ai/host:nango-connection-storage"
          ? [
              {
                packageName: "@cinatra-ai/host",
                impl: {
                  isConfigured,
                  buildBearerAuthHeader,
                  providerConfigKeys: { apify: "cinatra-apify" },
                },
              },
            ]
          : [],
    },
  } as unknown as ExtensionHostContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsRow.value = {};
  stubDeps();
});

describe("buildApifyMcpServerTools — in-package builder", () => {
  it("exports the legacy declared toolbox id", () => {
    expect(APIFY_TOOLBOX_ID).toBe("apify-connector");
  });

  it("returns [] when Nango is not configured + no connection saved (no warn)", async () => {
    isConfigured.mockReturnValue(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await buildApifyMcpServerTools(ctxWithNango(), "openai")).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns [] AND warns loudly when Nango is unconfigured but a connection was saved", async () => {
    isConfigured.mockReturnValue(false);
    settingsRow.value = { lastValidatedAt: "x", username: "u", nangoConnectionId: "cinatra-apify" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await buildApifyMcpServerTools(ctxWithNango(), "openai")).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("apify");
    warn.mockRestore();
  });

  it("returns [] when no nangoConnectionId is stored (never connected)", async () => {
    isConfigured.mockReturnValue(true);
    settingsRow.value = { lastValidatedAt: "x", username: "u" };
    expect(await buildApifyMcpServerTools(ctxWithNango(), "openai")).toEqual([]);
    expect(buildBearerAuthHeader).not.toHaveBeenCalled();
  });

  it("returns [] when the bearer header cannot be built (no token)", async () => {
    isConfigured.mockReturnValue(true);
    settingsRow.value = { nangoConnectionId: "cinatra-apify" };
    buildBearerAuthHeader.mockResolvedValue(null);
    expect(await buildApifyMcpServerTools(ctxWithNango(), "openai")).toEqual([]);
  });

  it("builds the single Apify MCP server tool with the vault bearer header", async () => {
    isConfigured.mockReturnValue(true);
    settingsRow.value = { nangoConnectionId: "cinatra-apify" };
    buildBearerAuthHeader.mockResolvedValue({ Authorization: "Bearer tok" });
    const tools = await buildApifyMcpServerTools(ctxWithNango(), "openai");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      type: "mcp",
      serverLabel: "apify-connector",
      serverUrl: "https://mcp.apify.com",
      headers: { Authorization: "Bearer tok" },
      requireApproval: "never",
    });
    expect(buildBearerAuthHeader).toHaveBeenCalledWith({
      providerConfigKey: "cinatra-apify",
      connectionId: "cinatra-apify",
      label: "apify",
    });
  });

  it("returns [] when the host nango service is absent (degrade, never throw)", async () => {
    expect(await buildApifyMcpServerTools(ctxWithNango(false), "openai")).toEqual([]);
  });
});
