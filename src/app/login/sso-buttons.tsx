"use client";

import { signIn } from "next-auth/react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/auth/provider-icons";

interface Providers {
  azure: boolean;
  google: boolean;
  keycloak: boolean;
  saml: boolean;
}

export function SsoButtons({
  providers,
  callbackUrl,
}: {
  providers: Providers;
  callbackUrl: string;
}) {
  const buttons = [
    providers.google && {
      key: "google",
      label: "Google",
      icon: <GoogleIcon className="size-4" />,
      onClick: () => signIn("google", { callbackUrl }),
    },
    providers.azure && {
      key: "azure",
      label: "Azure AD",
      icon: <KeyRound className="size-4 text-[#0078D4]" />,
      onClick: () => signIn("microsoft-entra-id", { callbackUrl }),
    },
    providers.keycloak && {
      key: "keycloak",
      label: "Keycloak",
      icon: <KeyRound className="size-4" />,
      onClick: () => signIn("keycloak", { callbackUrl }),
    },
    providers.saml && {
      key: "saml",
      label: "SAML SSO",
      icon: <ShieldCheck className="size-4" />,
      onClick: () => {
        window.location.href = "/api/auth/saml/login";
      },
    },
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
  }>;

  if (buttons.length === 0) return null;

  return (
    <div className="space-y-2">
      {buttons.map((b) => (
        <Button
          key={b.key}
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={b.onClick}
        >
          {b.icon}
          {b.label}
        </Button>
      ))}
    </div>
  );
}
