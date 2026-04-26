import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  if (session?.user) redirect(params.callbackUrl ?? "/dashboard");

  const enabledProviders = {
    azure: !!process.env.AUTH_AZURE_AD_CLIENT_ID,
    google: !!process.env.AUTH_GOOGLE_CLIENT_ID,
    keycloak: !!process.env.AUTH_KEYCLOAK_CLIENT_ID,
    saml: !!process.env.AUTH_SAML_ENTRY_POINT,
  };

  return (
    <LoginForm
      callbackUrl={params.callbackUrl ?? "/dashboard"}
      error={params.error}
      providers={enabledProviders}
    />
  );
}
