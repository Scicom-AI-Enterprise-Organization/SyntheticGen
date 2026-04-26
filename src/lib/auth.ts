import NextAuth, { type DefaultSession } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import AzureAD from "next-auth/providers/microsoft-entra-id";
import Google from "next-auth/providers/google";
import Keycloak from "next-auth/providers/keycloak";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { samlProvider } from "@/lib/auth-saml";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: string[];
      permissions: string[];
    } & DefaultSession["user"];
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function loadUserAccess(userId: string) {
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  const roles = userRoles.map((ur) => ur.role.name);
  const permissions = Array.from(
    new Set(
      userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key)),
    ),
  );
  return { roles, permissions };
}

const providers = [
  Credentials({
    name: "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;

      const user = await prisma.user.findUnique({
        where: { email: parsed.data.email },
      });
      if (!user?.passwordHash) return null;

      const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
      if (!ok) return null;

      return { id: user.id, email: user.email, name: user.name, image: user.image };
    },
  }),
];

if (process.env.AUTH_AZURE_AD_CLIENT_ID) {
  providers.push(
    AzureAD({
      clientId: process.env.AUTH_AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AUTH_AZURE_AD_CLIENT_SECRET!,
      issuer: process.env.AUTH_AZURE_AD_TENANT_ID
        ? `https://login.microsoftonline.com/${process.env.AUTH_AZURE_AD_TENANT_ID}/v2.0`
        : undefined,
    }),
  );
}

if (process.env.AUTH_GOOGLE_CLIENT_ID) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET!,
    }),
  );
}

if (process.env.AUTH_KEYCLOAK_CLIENT_ID) {
  providers.push(
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_CLIENT_ID,
      clientSecret: process.env.AUTH_KEYCLOAK_CLIENT_SECRET!,
      issuer: process.env.AUTH_KEYCLOAK_ISSUER!,
    }),
  );
}

if (process.env.AUTH_SAML_ENTRY_POINT) {
  providers.push(samlProvider());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      if (token.sub) {
        const access = await loadUserAccess(token.sub);
        token.roles = access.roles;
        token.permissions = access.permissions;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.roles = (token.roles as string[]) ?? [];
        session.user.permissions = (token.permissions as string[]) ?? [];
      }
      return session;
    },
    async signIn({ user, account }) {
      // For SSO users with no prior assignment, grant the default "member" role.
      if (account?.provider !== "credentials" && user?.id) {
        const existing = await prisma.userRole.findFirst({ where: { userId: user.id } });
        if (!existing) {
          const memberRole = await prisma.role.findUnique({ where: { name: "member" } });
          if (memberRole) {
            await prisma.userRole.create({
              data: { userId: user.id, roleId: memberRole.id },
            });
          }
        }
      }
      return true;
    },
  },
});
