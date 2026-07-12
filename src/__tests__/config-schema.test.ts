// Contract fixtures for the declarative setup DSL (cinatra.configSchema).
//
// The Apify connector ships a `uiSurface:"schema-config"` declaration
// (cinatra#782) so the host renders its setup page from DATA with NO rebuild,
// retiring the bundled-react setup page. These tests prove the declared
// `cinatra.configSchema` passes the PUBLIC validation path: the SAME fail-closed
// `validateConfigSchema` the repo's `extension-kind-gate.mjs` runs in CI. They
// also pin the apify-connector#39 tab-group reorg (design spec: app-connectors
// §II — this is a SINGLE-connection connector with no additional settings
// beyond the connection itself, so it carries an implicit "Setup" base tab plus
// a reserved "Help" tab, always last, holding the read-only setup how-to that
// used to sit inline on the Setup tab as an advisory field).

import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { validateConfigSchema } from "../../extension-kind-gate.mjs";

const configSchema = (pkg as { cinatra?: { configSchema?: unknown } }).cinatra
  ?.configSchema;

type Field = Record<string, unknown>;
type Tab = { id: string; label: string; fields: Field[] };

const setupFields = (configSchema as { fields: Field[] }).fields;
const tabs = (configSchema as { tabs?: Tab[] }).tabs ?? [];
const helpTab = tabs.find((t) => t.id === "help");

const byKind = (list: Field[], k: string) => list.filter((f) => f.kind === k);
const byKey = (list: Field[], k: string) => list.find((f) => (f as { key?: string }).key === k);

describe("apify-connector cinatra.configSchema", () => {
  it('declares uiSurface:"schema-config" and requests the "ui" + "capabilities" host ports', () => {
    const cinatra = (pkg as { cinatra: Record<string, unknown> }).cinatra;
    expect(cinatra.uiSurface).toBe("schema-config");
    expect(cinatra.requestedHostPorts).toContain("ui");
    expect(cinatra.requestedHostPorts).toContain("capabilities");
  });

  it("the declared configSchema parses with ZERO validation errors", () => {
    expect(validateConfigSchema(configSchema)).toEqual([]);
  });

  it("covers every setup element the API-token connection needs on the Setup tab", () => {
    const fields = setupFields;

    expect(byKind(fields, "secret").map((f) => f.key)).toContain("apiKey");
    expect(byKind(fields, "status-probe")[0]?.actionId).toBe("connectionStatus");

    const actionIds = byKind(fields, "named-action").map((f) => f.actionId);
    expect(actionIds).toEqual(
      expect.arrayContaining(["saveConnection", "clearConnection"]),
    );
    const clear = byKind(fields, "named-action").find((f) => f.actionId === "clearConnection");
    expect(clear?.confirm).toBeTruthy();

    const banner = byKind(fields, "banner")[0];
    const variantNames = (banner.variants as Array<{ name: string }>).map((v) => v.name);
    expect(variantNames).toEqual(
      expect.arrayContaining(["saved", "cleared", "error"]),
    );
  });

  describe("tab groups (design spec: app-connectors §II — single connection, Help last)", () => {
    it("declares exactly ONE custom tab: the reserved Help tab", () => {
      // Single-connection, no additional settings block (unlike openai's
      // "Local shell") — per spec, a connector with no extra tabs and one
      // connection shows no tablist at all; the first custom tab (here, Help)
      // is what introduces one.
      expect(tabs.map((t) => t.id)).toEqual(["help"]);
      expect(helpTab?.label).toBe("Help");
    });

    it("moved the setup how-to advisory OFF the Setup tab and onto the Help tab", () => {
      expect(byKind(setupFields, "advisory")).toHaveLength(0);
      expect(byKind(helpTab!.fields, "advisory")).toHaveLength(1);
    });

    it('Help tab is READ-ONLY (no form, no Save): exactly one advisory field, no keyed/action-writing field kinds', () => {
      const helpFields = helpTab!.fields;
      expect(helpFields).toHaveLength(1);
      const advisory = helpFields[0] as {
        kind: string;
        tone?: string;
        probeActionId?: string;
        whenReady?: string;
        whenNotReady?: string;
      };
      expect(advisory.kind).toBe("advisory");
      expect(advisory.tone).toBe("info");
      // Reuses the connector's existing connection-service-readiness probe
      // (already registered as a READ-only probe in src/register.ts — no
      // requireManage gate; only the write handlers saveConnection/
      // clearConnection are manage-gated) — no new action added — and that
      // probe returns `{ ready: boolean }`, the exact shape the host's
      // advisory renderer requires (unlike connectionStatus, which THROWS on
      // not-connected for the status-probe pill).
      expect(advisory.probeActionId).toBe("connectionServiceReady");
      expect(typeof advisory.whenReady).toBe("string");
      expect(typeof advisory.whenNotReady).toBe("string");
      expect((advisory.whenReady ?? "").length).toBeGreaterThan(0);
      expect((advisory.whenNotReady ?? "").length).toBeGreaterThan(0);

      const writeCapableKinds = new Set([
        "text", "secret", "select", "boolean", "number", "free-list",
        "named-action", "status-probe", "nango-connect", "repeatable-list",
        "record-list", "dynamic-select-options",
      ]);
      for (const f of helpFields) {
        expect(writeCapableKinds.has(f.kind as string), `${JSON.stringify(f.kind)} is not read-only`).toBe(false);
      }
    });

    it("every field key stays unique across the Setup tab AND every custom tab (one flat submit namespace)", () => {
      const allKeyed = [...setupFields, ...(helpTab?.fields ?? [])]
        .map((f) => (f as { key?: string }).key)
        .filter((k): k is string => typeof k === "string");
      expect(new Set(allKeyed).size).toBe(allKeyed.length);
      // apiKey stays on the Setup tab only.
      expect(byKey(setupFields, "apiKey")?.kind).toBe("secret");
      expect(byKey(helpTab!.fields, "apiKey")).toBeUndefined();
    });
  });

  describe("tabs vocabulary — FAIL-CLOSED (mirrors the host parser's tab rules)", () => {
    const baseField = { kind: "secret", key: "apiKey", label: "API key" };
    const wrapTabs = (tabsRaw: unknown) => ({ fields: [baseField], tabs: tabsRaw });

    it("rejects a non-array tabs root", () => {
      expect(validateConfigSchema(wrapTabs({})).length).toBeGreaterThan(0);
    });

    it("rejects an unknown key on a tab (no executable/HTML carrier)", () => {
      expect(
        validateConfigSchema(
          wrapTabs([{ id: "x", label: "X", fields: [{ kind: "text", key: "k", label: "L" }], onClick: "alert(1)" }]),
        ).length,
      ).toBeGreaterThan(0);
    });

    it("rejects a duplicate tab id", () => {
      expect(
        validateConfigSchema(
          wrapTabs([
            { id: "dup", label: "One", fields: [{ kind: "text", key: "k1", label: "L" }] },
            { id: "dup", label: "Two", fields: [{ kind: "text", key: "k2", label: "L" }] },
          ]),
        ).length,
      ).toBeGreaterThan(0);
    });

    it("rejects a field key duplicated across the base fields and a tab", () => {
      expect(
        validateConfigSchema(wrapTabs([{ id: "t", label: "T", fields: [{ kind: "text", key: "apiKey", label: "Dup" }] }])).length,
      ).toBeGreaterThan(0);
    });

    it("rejects an invalid tab id, a missing label, and an empty fields array", () => {
      expect(validateConfigSchema(wrapTabs([{ id: "1bad", label: "X", fields: [{ kind: "text", key: "k", label: "L" }] }])).length).toBeGreaterThan(0);
      expect(validateConfigSchema(wrapTabs([{ id: "t", fields: [{ kind: "text", key: "k", label: "L" }] }])).length).toBeGreaterThan(0);
      expect(validateConfigSchema(wrapTabs([{ id: "t", label: "T", fields: [] }])).length).toBeGreaterThan(0);
    });
  });

  describe("validateConfigSchema stays fail-closed", () => {
    const wrap = (field: Record<string, unknown>) => ({ fields: [field] });

    it("rejects an advisory with an invalid tone", () => {
      expect(
        validateConfigSchema(wrap({ kind: "advisory", label: "Note", tone: "fuchsia" })).length,
      ).toBeGreaterThan(0);
    });

    it("rejects an UNKNOWN key on a field (no executable/HTML carrier smuggled in)", () => {
      for (const evil of ["html", "onClick", "render", "component", "script"]) {
        const errs = validateConfigSchema(
          wrap({ kind: "secret", key: "apiKey", label: "Token", [evil]: "<script>x</script>" }),
        );
        expect(errs.length, `expected ${evil} to be rejected`).toBeGreaterThan(0);
      }
    });
  });
});
