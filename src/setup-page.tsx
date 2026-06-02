// Apify connector setup page dispatch route.
// Wraps the shared page implementation.

import { ApifyConnectorPageImpl } from "./apify-setup-impl";

type ConnectorSetupPageProps = {
  packageId: string;
  slug: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function ApifyConnectorSetupPage({
  searchParams,
}: ConnectorSetupPageProps) {
  return ApifyConnectorPageImpl({ searchParams: Promise.resolve(searchParams) });
}
