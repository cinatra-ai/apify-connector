// Verifies the first-party Apify external-MCP toolbox (manifest-discovered
// builder). Relocated from the host's apify-mcp-connection builder test when
// the builder moved into this extension; deps are wired the way the host boot
// does in src/lib/register-transport-connectors.ts.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { registerApifyConnector, _resetApifyDepsForTests } from "../deps";
import { createApifyExternalMcpToolbox } from "../mcp/toolbox";

const isConfigured = vi.fn();
const buildBearerAuthHeader = vi.fn();

let CONFIG_STORE: Record<string, unknown> = {};

function registerDepsStub() {
  registerApifyConnector({
    readConnectorConfigFromDatabase: <T>(key: string, fallback: T): T =>
      (CONFIG_STORE[key] as T) ?? fallback,
    writeConnectorConfigToDatabase: (key: string, value: unknown) => {
      CONFIG_STORE[key] = value;
    },
    upsertExternalMcpServer: vi.fn(),
    deleteExternalMcpServer: vi.fn(),
    nango: {
      isConfigured,
      ensureConnectorIntegration: vi.fn(),
      importConnection: vi.fn(),
      getCredentials: vi.fn(),
      saveConnectionRecord: vi.fn(),
      removeConnectionRecord: vi.fn(),
      deleteConnection: vi.fn(),
      buildBearerAuthHeader,
      providerConfigKeys: { apify: "cinatra-apify" },
      connectionIds: { apify: "cinatra-apify" },
    },
  });
}

beforeEach(() => {
  CONFIG_STORE = {};
  vi.clearAllMocks();
  registerDepsStub();
});

afterEach(() => {
  _resetApifyDepsForTests();
});

describe("createApifyExternalMcpToolbox().buildTools", () => {
  it("returns [] when Nango is not configured + no connection saved (no warn)", async () => {
    isConfigured.mockReturnValue(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await createApifyExternalMcpToolbox().buildTools("openai");

    expect(result).toEqual([]);
    // Settings are read first to decide whether a loud warn is warranted;
    // with no saved connection there's nothing to warn about.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns [] AND warns loudly when Nango is unconfigured but a connection was saved (fail-closed loud)", async () => {
    isConfigured.mockReturnValue(false);
    CONFIG_STORE["apify"] = {
      lastValidatedAt: "x",
      username: "u",
      nangoConnectionId: "cinatra-apify",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await createApifyExternalMcpToolbox().buildTools("openai");

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain("apify");
    expect(msg).not.toContain("cinatra-apify"); // label only, no connection id leak beyond the connector name
    warn.mockRestore();
  });

  it("returns [] when no nangoConnectionId is set on the connector_config row (never connected)", async () => {
    isConfigured.mockReturnValue(true);
    CONFIG_STORE["apify"] = { lastValidatedAt: "x", username: "u" };

    const result = await createApifyExternalMcpToolbox().buildTools("openai");

    expect(result).toEqual([]);
    expect(buildBearerAuthHeader).not.toHaveBeenCalled();
  });

  it("returns [] when Nango header resolution returns null (helper warns label, no token)", async () => {
    isConfigured.mockReturnValue(true);
    CONFIG_STORE["apify"] = {
      lastValidatedAt: "x",
      username: "u",
      nangoConnectionId: "cinatra-apify",
    };
    buildBearerAuthHeader.mockResolvedValueOnce(null);

    const result = await createApifyExternalMcpToolbox().buildTools("openai");

    expect(result).toEqual([]);
    expect(buildBearerAuthHeader).toHaveBeenCalledWith({
      providerConfigKey: "cinatra-apify",
      connectionId: "cinatra-apify",
      label: "apify",
    });
  });

  it("returns the MCP server tool with the resolved Authorization header when Nango resolves", async () => {
    isConfigured.mockReturnValue(true);
    CONFIG_STORE["apify"] = {
      lastValidatedAt: "x",
      username: "u",
      nangoConnectionId: "cinatra-apify",
    };
    buildBearerAuthHeader.mockResolvedValueOnce({ Authorization: "Bearer secret-token-abc" });

    const result = await createApifyExternalMcpToolbox().buildTools("openai");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "mcp",
      serverLabel: "apify-connector",
      serverUrl: "https://mcp.apify.com",
      headers: { Authorization: "Bearer secret-token-abc" },
      serverDescription: "Apify MCP — actor tools",
      allowedTools: null,
      requireApproval: "never",
    });
  });

  it("returns [] and never throws when deps are unavailable (settings read throws)", async () => {
    _resetApifyDepsForTests(); // getApifyDeps() throws inside buildTools
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await createApifyExternalMcpToolbox().buildTools("openai");

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
