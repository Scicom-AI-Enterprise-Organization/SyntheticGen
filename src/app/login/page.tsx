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

  const target = params.callbackUrl ?? "/dashboard";
  const providers = {
    azure: !!process.env.AUTH_AZURE_AD_CLIENT_ID,
    google: !!process.env.AUTH_GOOGLE_CLIENT_ID,
    keycloak: true,
    saml: !!process.env.AUTH_SAML_ENTRY_POINT,
  };

  return (
    <LoginForm
      callbackUrl={target}
      providers={providers}
      initialError={params.error}
    />
  );
}
