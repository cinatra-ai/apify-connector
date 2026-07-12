# Apify

Connect your Apify account to make its full actor catalogue available as tools across every Cinatra agent. Once connected, any agent can run scrapers, crawlers, and data extractors on demand — no per-agent wiring needed. You supply an Apify API token; the connector stores it securely via Nango and injects the Apify MCP server into every LLM call automatically.

To get started, navigate to **Connectors → Apify** in the Cinatra settings UI, paste your API token (find it at `console.apify.com → Administration → API & Integrations`), and click **Save & register MCP**. Nango must be configured first (`/configuration/llm/nango`); the setup page's **Help** tab shows a clear warning if it is not. To revoke access, click **Disconnect** — this removes the stored credential and deregisters the MCP server.

If the MCP server stops responding, check that your Apify API token is still valid and re-save the connection. If the Help tab shows "Configure the connection service first", configure Nango before reconnecting.

## Works with

- [Apify](https://apify.com) — web scraping and automation platform; the connector registers its MCP server (`https://mcp.apify.com`)
- [Nango](https://www.nango.dev) — credential vault that stores and refreshes the Apify API token; must be configured before the connector is active

## Capabilities

- Make Apify's actor catalogue available as tools across the workspace
- Let agents run scrapers, crawlers, and data extractors on demand
- Authenticate securely via Nango — the API token is stored in the credential vault, never in plaintext
- Inject the Apify MCP server automatically into every LLM call when connected
- Validate the API token against `api.apify.com/v2/users/me` before saving; reject invalid tokens before any credential is stored
- Disconnect cleanly — removes the stored credential and deregisters the MCP server workspace-wide
