import { connection } from "next/server";
import { isNewUserRegistrationEnabled } from "@/lib/instanceSettings";
import { enabledOAuthProviders } from "@/lib/oauthProviders";

export async function loadLoginView() {
  await connection();
  const [accountCreationEnabled, providers] = await Promise.all([isNewUserRegistrationEnabled(), enabledOAuthProviders()]);
  return { providers, accountCreationEnabled };
}
