"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Check,
  Building2,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { GoogleIcon } from "@/components/auth/provider-icons";

interface LoginFormProps {
  callbackUrl: string;
  error?: string;
  providers: {
    azure: boolean;
    google: boolean;
    keycloak: boolean;
    saml: boolean;
  };
}

export function LoginForm({ callbackUrl, error, providers }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setPending(false);
    if (res?.error) {
      toast.error("Invalid email or password");
    } else if (res?.url) {
      window.location.href = res.url;
    }
  }

  function notConfigured(name: string) {
    return () =>
      toast.error(`${name} is not configured`, {
        description: `Set the ${name} env vars in .env to enable.`,
      });
  }

  const ssoButtons = [
    {
      key: "google",
      label: "Google",
      icon: <GoogleIcon className="h-4 w-4" />,
      onClick: providers.google
        ? () => signIn("google", { callbackUrl })
        : notConfigured("Google"),
      disabled: !providers.google,
    },
    {
      key: "azure",
      label: "Azure AD",
      icon: <KeyRound className="h-4 w-4 text-[#0078D4]" />,
      onClick: providers.azure
        ? () => signIn("microsoft-entra-id", { callbackUrl })
        : notConfigured("Azure AD"),
      disabled: !providers.azure,
    },
    {
      key: "keycloak",
      label: "Keycloak",
      icon: <Building2 className="h-4 w-4" />,
      onClick: providers.keycloak
        ? () => signIn("keycloak", { callbackUrl })
        : notConfigured("Keycloak"),
      disabled: !providers.keycloak,
    },
    {
      key: "saml",
      label: "SAML SSO",
      icon: <ShieldCheck className="h-4 w-4" />,
      onClick: providers.saml
        ? () => (window.location.href = "/api/auth/saml/login")
        : notConfigured("SAML"),
      disabled: !providers.saml,
    },
  ];

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      {/* Left — Hero */}
      <div className="relative hidden overflow-hidden lg:block">
        <Image
          src="/images/hero-bg-light.jpg"
          alt=""
          fill
          priority
          className="object-cover dark:hidden"
        />
        <Image
          src="/images/hero-bg.jpg"
          alt=""
          fill
          priority
          className="hidden object-cover dark:block"
        />
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative z-10 flex h-full flex-col justify-between p-10">
          <div className="text-xl font-bold tracking-tight text-white">
            Enterprise Template
          </div>
          <div>
            <h2 className="text-3xl font-bold text-white">Welcome back</h2>
            <p className="mt-3 max-w-sm text-sm text-white/80">
              Sign in to access your dashboard, manage users, and configure roles
              and permissions.
            </p>
            <div className="mt-8 flex gap-8">
              <Stat value="RBAC" label="Roles & permissions" />
              <Stat value="SSO" label="Azure · Google · Keycloak · SAML" />
              <Stat value="JWT" label="Stateless sessions" />
            </div>
          </div>
        </div>
      </div>

      {/* Right — Form */}
      <div className="flex flex-col items-center justify-center bg-background px-6 py-10 sm:px-10">
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your credentials to continue.
          </p>

          {error && (
            <div className="mt-5 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error === "OAuthAccountNotLinked"
                ? "This email is already linked to another sign-in method."
                : "Sign-in failed. Please try again."}
            </div>
          )}

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-xs font-medium text-foreground"
              >
                Email
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="text-xs font-medium text-foreground"
                >
                  Password
                </label>
                <span className="cursor-pointer text-xs text-primary hover:underline">
                  Forgot?
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <label
              className="flex cursor-pointer items-center gap-2 text-sm"
              onClick={() => setRememberMe((r) => !r)}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] transition-colors ${
                  rememberMe
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border"
                }`}
              >
                {rememberMe && <Check className="h-3 w-3" />}
              </span>
              <span className="text-muted-foreground">Remember me</span>
            </label>

            <motion.button
              whileHover={{ scale: 1.005 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {pending ? "Signing in…" : "Sign in"}
            </motion.button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              or continue with
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {ssoButtons.map((b) => (
              <motion.button
                key={b.key}
                type="button"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={b.onClick}
                title={b.disabled ? `${b.label} (not configured)` : b.label}
                className={`flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-xs font-medium transition-colors hover:bg-muted ${
                  b.disabled ? "text-muted-foreground" : "text-foreground"
                }`}
              >
                {b.icon}
                {b.label}
              </motion.button>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            By continuing, you agree to the Terms and Privacy Policy.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-left">
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="mt-0.5 text-xs text-white/60">{label}</div>
    </div>
  );
}
