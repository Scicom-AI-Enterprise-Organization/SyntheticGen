import Credentials from "next-auth/providers/credentials";
import { SAML } from "@node-saml/node-saml";
import { prisma } from "@/lib/db";

/**
 * SAML provider implemented as an Auth.js Credentials provider that consumes
 * the IdP POST response. The /api/auth/saml/* routes handle the SP redirect
 * and ACS callback, then forward the validated assertion here.
 *
 * For multi-tenant SAML, prefer BoxyHQ Jackson and use it as a generic OIDC
 * provider instead.
 */
export function getSamlClient() {
  return new SAML({
    entryPoint: process.env.AUTH_SAML_ENTRY_POINT!,
    issuer: process.env.AUTH_SAML_ISSUER ?? "enterprise-template",
    callbackUrl: `${process.env.AUTH_URL}/api/auth/saml/callback`,
    idpCert: process.env.AUTH_SAML_IDP_CERT!,
    wantAssertionsSigned: true,
    signatureAlgorithm: "sha256",
  });
}

export function samlProvider() {
  return Credentials({
    id: "saml",
    name: "SAML SSO",
    credentials: {
      profile: { label: "profile", type: "text" },
    },
    async authorize(raw) {
      if (!raw?.profile || typeof raw.profile !== "string") return null;
      let profile: { email?: string; name?: string; nameID?: string };
      try {
        profile = JSON.parse(raw.profile);
      } catch {
        return null;
      }
      const email = profile.email ?? profile.nameID;
      if (!email) return null;

      const user = await prisma.user.upsert({
        where: { email },
        update: { name: profile.name ?? undefined },
        create: { email, name: profile.name ?? null },
      });
      return { id: user.id, email: user.email, name: user.name };
    },
  });
}
