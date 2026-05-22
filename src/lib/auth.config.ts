import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config. Used by middleware — must not import Prisma,
 * bcrypt, or any Node-only module. The full provider list and adapter live
 * in `auth.ts`.
 */

// Cookie names default to `authjs.session-token` (etc.), which on localhost
// is scoped to the host without port discrimination — running two instances
// on different ports (e.g. 3000 + 3001) will clobber each other's session
// because the browser sends the same cookie to both. Set
// AUTH_COOKIE_PREFIX="port3001" (or similar) on each instance to give them
// separate cookie namespaces and stop them fighting.
const COOKIE_PREFIX = process.env.AUTH_COOKIE_PREFIX
  ? `${process.env.AUTH_COOKIE_PREFIX}.authjs`
  : "authjs";

export const authConfig = {
  pages: { signIn: "/login" },
  providers: [],
  session: { strategy: "jwt" },
  cookies: {
    sessionToken: {
      name: `${COOKIE_PREFIX}.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        // Only force HTTPS when explicitly running over it — local dev on
        // http://localhost would otherwise refuse to set the cookie.
        secure: process.env.AUTH_URL?.startsWith("https://") ?? false,
      },
    },
    callbackUrl: {
      name: `${COOKIE_PREFIX}.callback-url`,
      options: {
        sameSite: "lax",
        path: "/",
        secure: process.env.AUTH_URL?.startsWith("https://") ?? false,
      },
    },
    csrfToken: {
      name: `${COOKIE_PREFIX}.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.AUTH_URL?.startsWith("https://") ?? false,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
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
  },
} satisfies NextAuthConfig;
