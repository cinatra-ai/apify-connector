"use server";
import { revalidatePath } from "next/cache";
import { saveApifySettings, clearApifySettings } from "./index";
import { requireExtensionAction } from "@cinatra-ai/sdk-extensions";

export async function saveApifyConnectionAction(formData: FormData) {
  // Admin authz gate mirrors the Drupal sibling
  // (extensions/cinatra-ai/drupal-mcp-connector/src/settings-page.tsx). This path
  // must stay gated because any authenticated user could otherwise overwrite the
  // workspace Apify credential or disconnect the connector.
  await requireExtensionAction("@cinatra-ai/apify-connector", "manage");
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!apiKey) throw new Error("Enter an Apify API token.");
  await saveApifySettings({ apiKey });
  revalidatePath("/connectors/cinatra-ai/apify-connector/setup");
}

export async function clearApifyConnectionAction() {
  await requireExtensionAction("@cinatra-ai/apify-connector", "manage");
  await clearApifySettings();
  revalidatePath("/connectors/cinatra-ai/apify-connector/setup");
}
