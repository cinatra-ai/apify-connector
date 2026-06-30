// register(ctx) registers the schema-config named actions via `ctx.ui` so the
// declarative setup surface (cinatra.configSchema) can probe readiness/status
// and save/clear the Apify connection WITHOUT shipping React (cinatra#782).
// The host dispatches these by id through
// `/api/extensions/{installId}/actions/{actionId}`, authorizing the actor at
// the "use" tier host-side. Because a credential write is a MANAGE-tier
// mutation, the WRITE handlers (saveConnection/clearConnection) re-assert the
// manage gate via the host action-guard service — so a missing/denying guard
// FAILS CLOSED (the action throws; nothing executes ungated).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveApifySettings: vi.fn(async () => ({})),
  clearApifySettings: vi.fn(async () => {}),
  getApifyStatus: vi.fn(() => ({ status: "not_connected", detail: "Add a token." })),
}));

vi.mock("../index", () => ({
  saveApifySettings: mocks.saveApifySettings,
  clearApifySettings: mocks.clearApifySettings,
  getApifyStatus: mocks.getApifyStatus,
}));

vi.mock("../llm-toolbox", () => ({
  APIFY_TOOLBOX_ID: "apify-connector",
  buildApifyMcpServerTools: vi.fn(() => []),
}));

import { register } from "../register";
import { _resetApifyDepsForTests } from "../deps";

type RegisteredProvider = { packageName: string; impl: unknown };
type UiAction = { id: string; handler: (input: unknown) => Promise<unknown> };

// A minimal nango-system capability surface. register(ctx) binds the deps slot
// (whose nango members resolve this capability LAZILY at call time), so the
// connectionServiceReady probe reaches isNangoConfigured() through activation.
const NANGO_SYSTEM = {
  isNangoConfigured: () => true,
  providerConfigKeys: { apify: "cinatra-apify" },
  connectionIds: { apify: "cinatra-apify" },
};

function makeCtx(services: Record<string, unknown>) {
  const uiActions: UiAction[] = [];
  return {
    ctx: {
      capabilities: {
        registerProvider: () => {},
        resolveProviders: (capability: string): RegisteredProvider[] => {
          const svc = services[capability];
          return svc ? [{ packageName: "host", impl: svc }] : [];
        },
      },
      ui: {
        registerSetupSurface: () => {},
        registerSettingsSurface: () => {},
        registerAction: (action: UiAction) => {
          uiActions.push(action);
        },
      },
    } as unknown as Parameters<typeof register>[0],
    uiActions,
  };
}

function actionById(uiActions: UiAction[], id: string): UiAction {
  const a = uiActions.find((x) => x.id === id);
  if (!a) throw new Error(`action ${id} not registered`);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetApifyDepsForTests();
});

afterEach(() => {
  _resetApifyDepsForTests();
});

describe("apify-connector register(ctx) — schema-config named actions", () => {
  it("registers the probe + write actions used by the configSchema", () => {
    const { ctx, uiActions } = makeCtx({});
    register(ctx);
    expect(uiActions.map((a) => a.id).sort()).toEqual(
      ["clearConnection", "connectionServiceReady", "connectionStatus", "saveConnection"].sort(),
    );
  });

  it("connectionServiceReady reports the nango readiness as data", async () => {
    const { ctx, uiActions } = makeCtx({ "nango-system": NANGO_SYSTEM });
    register(ctx);
    await expect(actionById(uiActions, "connectionServiceReady").handler({})).resolves.toEqual({
      ready: true,
    });
  });

  it("connectionStatus THROWS when not connected (so the probe pill shows error)", async () => {
    mocks.getApifyStatus.mockReturnValueOnce({ status: "not_connected", detail: "Add a token." });
    const { ctx, uiActions } = makeCtx({});
    register(ctx);
    await expect(actionById(uiActions, "connectionStatus").handler({})).rejects.toThrow(/Add a token/);
  });

  it("connectionStatus returns the detail when connected", async () => {
    mocks.getApifyStatus.mockReturnValueOnce({ status: "connected", detail: "Apify MCP server registered." });
    const { ctx, uiActions } = makeCtx({});
    register(ctx);
    await expect(actionById(uiActions, "connectionStatus").handler({})).resolves.toEqual({
      detail: "Apify MCP server registered.",
    });
  });

  it("saveConnection FAILS CLOSED when the action-guard service is missing (no write runs)", async () => {
    const { ctx, uiActions } = makeCtx({});
    register(ctx);
    await expect(
      actionById(uiActions, "saveConnection").handler({ apiKey: "apify_api_xyz" }),
    ).rejects.toThrow(/action-guard service is not registered/);
    expect(mocks.saveApifySettings).not.toHaveBeenCalled();
  });

  it("saveConnection rejects a blank token after the manage gate (no write runs)", async () => {
    const { ctx, uiActions } = makeCtx({
      "@cinatra-ai/host:extension-action-guard": { require: vi.fn(async () => {}) },
    });
    register(ctx);
    await expect(actionById(uiActions, "saveConnection").handler({ apiKey: "   " })).rejects.toThrow(
      /Enter an Apify API token/,
    );
    expect(mocks.saveApifySettings).not.toHaveBeenCalled();
  });

  it("saveConnection validates + persists the token after the manage gate passes", async () => {
    const require = vi.fn(async () => {});
    const { ctx, uiActions } = makeCtx({
      "@cinatra-ai/host:extension-action-guard": { require },
    });
    register(ctx);
    const r = await actionById(uiActions, "saveConnection").handler({ apiKey: "  apify_api_xyz  " });
    expect(require).toHaveBeenCalledWith("@cinatra-ai/apify-connector", "manage");
    expect(mocks.saveApifySettings).toHaveBeenCalledWith({ apiKey: "apify_api_xyz" });
    expect(r).toEqual({ banner: "saved" });
  });

  it("clearConnection clears after the manage gate, and FAILS CLOSED without the guard", async () => {
    const noGuard = makeCtx({});
    register(noGuard.ctx);
    await expect(actionById(noGuard.uiActions, "clearConnection").handler({})).rejects.toThrow(
      /action-guard service is not registered/,
    );
    expect(mocks.clearApifySettings).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const require = vi.fn(async () => {});
    const withGuard = makeCtx({ "@cinatra-ai/host:extension-action-guard": { require } });
    register(withGuard.ctx);
    const r = await actionById(withGuard.uiActions, "clearConnection").handler({});
    expect(require).toHaveBeenCalledWith("@cinatra-ai/apify-connector", "manage");
    expect(mocks.clearApifySettings).toHaveBeenCalledOnce();
    expect(r).toEqual({ banner: "cleared" });
  });
});
