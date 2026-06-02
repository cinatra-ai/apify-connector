import "server-only";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Main, PageHeader, PageContent } from "@cinatra-ai/sdk-ui/marketplace";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Field, FieldLabel } from "./components/ui/field";
import { Alert, AlertDescription } from "./components/ui/alert";
import { getApifyStatus, getApifyNangoReady } from "@cinatra-ai/apify-connector";
import { saveApifyConnectionAction, clearApifyConnectionAction } from "./apify-setup-actions";

export const metadata: Metadata = { title: "Apify MCP | Cinatra" };

async function saveAction(formData: FormData) {
  "use server";
  await saveApifyConnectionAction(formData);
  redirect("/connectors/apify?saved=1");
}

async function clearAction() {
  "use server";
  await clearApifyConnectionAction();
  redirect("/connectors/apify?disconnected=1");
}

type SearchParams = Record<string, string | string[] | undefined>;

function pickParam(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export async function ApifyConnectorPageImpl(props: {
  searchParams?: Promise<SearchParams>;
}) {
  const nangoReady = getApifyNangoReady();
  const status = getApifyStatus();
  const isConnected = status.status === "connected";
  const resolvedSearchParams = (await props.searchParams) ?? {};
  const saved = pickParam(resolvedSearchParams.saved);
  const disconnected = pickParam(resolvedSearchParams.disconnected);

  // Fail closed loudly when Nango is unconfigured. The save
  // path throws server-side; render an explanatory banner so users don't
  // mistake a disabled connector for a bug.
  if (!nangoReady) {
    return (
      <Main className="min-h-screen">
        <PageHeader title="Apify MCP" description="Connect your Apify account to enable the Apify MCP server for all agents." />
        <PageContent className="flex flex-col gap-6 pb-8">
          <Alert variant="warning" className="rounded-control">
            <AlertDescription>
              Nango is not configured — the Apify connector is disabled. Configure it at <a className="underline" href="/configuration/llm/nango">/configuration/llm/nango</a> first.
            </AlertDescription>
          </Alert>
        </PageContent>
      </Main>
    );
  }

  return (
    <Main className="min-h-screen">
      <PageHeader title="Apify MCP" description="Connect your Apify account to enable the Apify MCP server for all agents." />
      <PageContent className="flex flex-col gap-6 pb-8">
        {saved ? (
          <Alert variant="success" className="rounded-control">
            <AlertDescription>Apify API token saved and MCP server registered.</AlertDescription>
          </Alert>
        ) : null}
        {disconnected ? (
          <Alert variant="warning" className="rounded-control">
            <AlertDescription>Apify connection removed.</AlertDescription>
          </Alert>
        ) : null}

        <section className="soft-panel rounded-panel p-5">
          <form action={saveAction} className="grid gap-4">
            <Field>
              <FieldLabel>API token</FieldLabel>
              <Input
                name="apiKey"
                type="password"
                autoComplete="off"
                placeholder="apify_api_..."
                required={!isConnected}
              />
              {isConnected ? (
                <span className="text-xs text-muted-foreground">
                  Leave blank to keep the current token. Enter a new token to replace it.
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Get your token at console.apify.com → Administration → API &amp; Integrations.
                </span>
              )}
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button type="submit">Save &amp; register MCP</Button>
              {isConnected ? (
                <Button variant="outline" formAction={clearAction}>
                  Disconnect
                </Button>
              ) : null}
            </div>
          </form>
        </section>
      </PageContent>
    </Main>
  );
}
