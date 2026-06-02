// Verifies saveApifySettings and clearApifySettings behavior:
// readback ordering, fail-closed behavior when Nango is unconfigured,
// cleanup symmetry, and checking Nango before any Apify API call.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Host deps are now INJECTED (registerApifyConnector), not imported from
// `@/lib/*`. The connector_config store + the defensive-cleanup deleteExternalMcpServer
// are mock impls registered in beforeEach; assertions read CONFIG_STORE / the
// `deleteExternalMcpServer` mock directly.
// ---------------------------------------------------------------------------

let CONFIG_STORE: Record<string, unknown> = {};
const deleteExternalMcpServer = vi.fn();

// ---------------------------------------------------------------------------
// The Nango connection-storage surface is now INJECTED via the connector's
// `deps` (registerApifyConnector), NOT imported from @cinatra-ai/nango-connector
// (the connector carries no nango-connector code dep). These module-level mocks
// are bound into the deps slot in beforeEach; the `vi.mocked(...)` assertions
// below read them directly. Names match the original surface so the assertions
// are unchanged.
// ---------------------------------------------------------------------------

const isNangoConfigured = vi.fn<() => boolean>();
const ensureNangoConnectorIntegration = vi.fn(async (_connectorKey: string): Promise<unknown> => null);
const importNangoConnection = vi.fn(
  async (_input: {
    connectorKey?: string;
    providerConfigKey: string;
    connectionId: string;
    credentials: { type: string; apiKey: string };
  }): Promise<unknown> => null,
);
const getNangoCredentials = vi.fn(
  async (
    _providerConfigKey: string,
    _connectionId: string,
    _opts?: { forceRefresh?: boolean },
  ): Promise<unknown> => null,
);
const saveNangoConnectionRecord = vi.fn(
  async (_connectorKey: string, _record: unknown): Promise<unknown> => undefined,
);
const removeNangoConnectionRecord = vi.fn(
  async (_connectorKey: string, _connectionId: string): Promise<unknown> => undefined,
);
const deleteNangoConnection = vi.fn(
  async (_providerConfigKey: string, _connectionId: string): Promise<unknown> => undefined,
);

import {
  saveApifySettings,
  clearApifySettings,
  getApifySettings,
  APIFY_MCP_REGISTRY_ID,
  registerApifyConnector,
} from "../index";

const APIFY_TOKEN = "apify_api_VALID_TOKEN_FROM_USER_INPUT_xyz123";
const USERS_ME_OK = {
  ok: true,
  status: 200,
  json: async () => ({ data: { id: "u-1", username: "test-user" } }),
};

beforeEach(() => {
  CONFIG_STORE = {};
  vi.clearAllMocks();
  // Wire the injected host deps (boot does this in register-transport-connectors).
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
      ensureConnectorIntegration: ensureNangoConnectorIntegration,
      importConnection: importNangoConnection,
      getCredentials: getNangoCredentials,
      saveConnectionRecord: saveNangoConnectionRecord,
      removeConnectionRecord: removeNangoConnectionRecord,
      deleteConnection: deleteNangoConnection,
      providerConfigKeys: { apify: "cinatra-apify" },
      connectionIds: { apify: "cinatra-apify" },
    },
  });
  isNangoConfigured.mockReturnValue(true);
  // Default: validateApifyToken hits api.apify.com, so mock global fetch.
  vi.stubGlobal("fetch", vi.fn(async () => USERS_ME_OK as Response));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saveApifySettings", () => {
  it("happy path: validates, imports without connectorKey, readback succeeds, persists in correct order", async () => {
    vi.mocked(getNangoCredentials).mockResolvedValueOnce({ apiKey: APIFY_TOKEN } as never);

    const result = await saveApifySettings({ apiKey: APIFY_TOKEN });

    // Nango check happened before any external token validation.
    expect(vi.mocked(isNangoConfigured)).toHaveBeenCalled();
    // Apify token validated.
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      "https://api.apify.com/v2/users/me",
      expect.objectContaining({ method: "GET" }),
    );
    // ensureNangoConnectorIntegration called for the apify key.
    expect(vi.mocked(ensureNangoConnectorIntegration)).toHaveBeenCalledWith("apify");
    // importNangoConnection called without connectorKey.
    expect(vi.mocked(importNangoConnection)).toHaveBeenCalledTimes(1);
    const importArgs = vi.mocked(importNangoConnection).mock.calls[0][0];
    expect(importArgs.connectorKey).toBeUndefined();
    expect(importArgs.providerConfigKey).toBe("cinatra-apify");
    expect(importArgs.connectionId).toBe("cinatra-apify");
    expect(importArgs.credentials).toEqual({ type: "API_KEY", apiKey: APIFY_TOKEN });
    // Readback forceRefresh assertion.
    expect(vi.mocked(getNangoCredentials)).toHaveBeenCalledWith(
      "cinatra-apify",
      "cinatra-apify",
      { forceRefresh: true },
    );
    // saveNangoConnectionRecord called after readback succeeded.
    expect(vi.mocked(saveNangoConnectionRecord)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveNangoConnectionRecord)).toHaveBeenCalledWith(
      "apify",
      expect.objectContaining({ connectionId: "cinatra-apify", providerConfigKey: "cinatra-apify" }),
    );
    // Cinatra DB row populated.
    expect(result.nangoConnectionId).toBe("cinatra-apify");
    expect(result.username).toBe("test-user");
    expect(result.lastValidatedAt).toBeDefined();
    // The legacy external_mcp_servers row is deleted unconditionally with a
    // direct delete and no cache-gated check on every save.
    expect(vi.mocked(deleteExternalMcpServer)).toHaveBeenCalledWith(APIFY_MCP_REGISTRY_ID);
  });

  it("external MCP row delete runs before the Nango-backed config becomes visible", async () => {
    vi.mocked(getNangoCredentials).mockResolvedValueOnce({ apiKey: APIFY_TOKEN } as never);
    const order: string[] = [];
    vi.mocked(deleteExternalMcpServer).mockImplementationOnce(() => {
      order.push("deleteExt");
    });
    vi.mocked(saveNangoConnectionRecord).mockImplementationOnce(async () => {
      order.push("savePointer");
    });

    await saveApifySettings({ apiKey: APIFY_TOKEN });

    // Delete must precede the pointer write, which is the last step that
    // makes the Nango-backed config visible.
    expect(order).toEqual(["deleteExt", "savePointer"]);
    // And the cinatra config row only carries nangoConnectionId after the
    // delete already ran.
    expect((CONFIG_STORE.apify as { nangoConnectionId?: string }).nangoConnectionId).toBe("cinatra-apify");
  });

  it("external MCP row delete failure makes save throw before writing the Nango-backed config", async () => {
    vi.mocked(getNangoCredentials).mockResolvedValueOnce({ apiKey: APIFY_TOKEN } as never);
    vi.mocked(deleteExternalMcpServer).mockImplementationOnce(() => {
      throw new Error("DB delete failed");
    });

    await expect(saveApifySettings({ apiKey: APIFY_TOKEN })).rejects.toThrow(/DB delete failed/);
    // Config must not have been made Nango-visible.
    expect(CONFIG_STORE.apify).toBeUndefined();
    expect(vi.mocked(saveNangoConnectionRecord)).not.toHaveBeenCalled();
  });

  it("throws when Nango is unconfigured and does not hit api.apify.com", async () => {
    vi.mocked(isNangoConfigured).mockReturnValue(false);

    await expect(saveApifySettings({ apiKey: APIFY_TOKEN })).rejects.toThrow(
      /Nango is not configured/,
    );

    // No Apify API call burned.
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(vi.mocked(importNangoConnection)).not.toHaveBeenCalled();
  });

  it("readback mismatch throws a generic error and does not persist anything", async () => {
    vi.mocked(getNangoCredentials).mockResolvedValueOnce({ apiKey: "DIFFERENT_VALUE" } as never);

    await expect(saveApifySettings({ apiKey: APIFY_TOKEN })).rejects.toThrow(
      /Nango credential verification failed/,
    );

    // saveNangoConnectionRecord was not called before or instead of readback.
    expect(vi.mocked(saveNangoConnectionRecord)).not.toHaveBeenCalled();
    // Cinatra row was not written.
    expect(CONFIG_STORE.apify).toBeUndefined();
  });

  it("readback returns null treated as mismatch: generic error, no persist", async () => {
    vi.mocked(getNangoCredentials).mockResolvedValueOnce(null);

    await expect(saveApifySettings({ apiKey: APIFY_TOKEN })).rejects.toThrow(
      /Nango credential verification failed/,
    );

    expect(vi.mocked(saveNangoConnectionRecord)).not.toHaveBeenCalled();
    expect(CONFIG_STORE.apify).toBeUndefined();
  });

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

  it("rejects empty / whitespace token before any Nango call", async () => {
    await expect(saveApifySettings({ apiKey: "   " })).rejects.toThrow(
      /Enter an Apify API token/,
    );
    expect(vi.mocked(isNangoConfigured)).not.toHaveBeenCalled();
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

describe("clearApifySettings cleanup symmetry", () => {
  it("removes the local Nango pointer, wipes connector_config, removes the external MCP row, and best-effort deletes the Nango connection", async () => {
    // Pre-state: a saved row.
    CONFIG_STORE.apify = {
      lastValidatedAt: "2026-05-16T00:00:00Z",
      username: "test-user",
      nangoConnectionId: "cinatra-apify",
    };

    await clearApifySettings();

    expect(vi.mocked(removeNangoConnectionRecord)).toHaveBeenCalledWith("apify", "cinatra-apify");
    expect(CONFIG_STORE.apify).toEqual({});
    expect(vi.mocked(deleteExternalMcpServer)).toHaveBeenCalledWith(APIFY_MCP_REGISTRY_ID);
    expect(vi.mocked(deleteNangoConnection)).toHaveBeenCalledWith("cinatra-apify", "cinatra-apify");
  });

  it("survives a Nango deleteConnection error by swallowing and warning", async () => {
    CONFIG_STORE.apify = { nangoConnectionId: "cinatra-apify" };
    vi.mocked(deleteNangoConnection).mockRejectedValueOnce(new Error("network down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(clearApifySettings()).resolves.toBeUndefined();

    expect(CONFIG_STORE.apify).toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it("skips Nango delete when isNangoConfigured() is false and still cleans cinatra rows", async () => {
    CONFIG_STORE.apify = { nangoConnectionId: "cinatra-apify" };
    vi.mocked(isNangoConfigured).mockReturnValue(false);

    await clearApifySettings();

    expect(vi.mocked(deleteNangoConnection)).not.toHaveBeenCalled();
    expect(CONFIG_STORE.apify).toEqual({});
  });
});

describe("getApifySettings + getApifyStatus", () => {
  it("returns empty settings when nothing saved", () => {
    expect(getApifySettings()).toEqual({});
  });

  it("Nango-backed row roundtrip", () => {
    CONFIG_STORE.apify = {
      lastValidatedAt: "2026-05-16T00:00:00Z",
      username: "u",
      nangoConnectionId: "cinatra-apify",
    };
    expect(getApifySettings().nangoConnectionId).toBe("cinatra-apify");
  });
});
