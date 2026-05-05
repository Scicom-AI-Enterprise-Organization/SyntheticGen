"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { registerViaInvite } from "./actions";

interface Props {
  token: string;
  inviteEmail: string | null;
  inviterLabel: string;
  roleName: string | null;
}

export function RegisterForm({ token, inviteEmail, inviterLabel, roleName }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(inviteEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await registerViaInvite({ token, email, name, password });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/dashboard",
      });
      if (signInRes?.error) {
        toast.error("Account created but sign-in failed. Try signing in manually.");
        return;
      }
      window.location.href = signInRes?.url ?? "/dashboard";
    });
  }

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      {/* Left — Hero */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-950 lg:block">
        <div className="absolute inset-0 bg-black/20" />
        <div className="relative z-10 flex h-full flex-col justify-between p-10">
          <div className="text-xl font-bold tracking-tight text-white">SyntheticGen</div>
          <div>
            <h2 className="text-3xl font-bold text-white">You&apos;re invited</h2>
            <p className="mt-3 max-w-sm text-sm text-white/80">
              Set up your account to start building localized synthetic datasets with
              per-locale formality enforcement and OpenAI-compatible providers.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-6 text-sm">
              <Stat label="Invited by">{inviterLabel}</Stat>
              {roleName ? (
                <Stat label="Role on accept"><code>{roleName}</code></Stat>
              ) : (
                <Stat label="Default role"><code>member</code></Stat>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex flex-col items-center justify-center bg-background px-6 py-10 sm:px-10">
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {inviteEmail
              ? "Set a name and password to finish registering."
              : "Enter your details to accept the invitation."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <Field label="Name" htmlFor="name" icon={<User className="h-4 w-4 text-muted-foreground" />}>
              <input
                id="name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
              />
            </Field>

            <Field label="Email" htmlFor="email" icon={<Mail className="h-4 w-4 text-muted-foreground" />}>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                disabled={!!inviteEmail}
                className="flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
              />
            </Field>
            {inviteEmail && (
              <p className="-mt-2 text-[11px] text-muted-foreground">
                This invite is bound to {inviteEmail}.
              </p>
            )}

            <Field label="Password" htmlFor="password" icon={<Lock className="h-4 w-4 text-muted-foreground" />}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </Field>

            <motion.button
              whileHover={{ scale: 1.005 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {pending ? "Creating account…" : "Create account & accept invite"}
            </motion.button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}
              className="text-primary hover:underline"
            >
              Sign in
            </Link>{" "}
            and the invite will attach automatically.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  icon,
  children,
}: {
  label: string;
  htmlFor: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        {icon}
        {children}
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-left">
      <div className="text-xs font-medium uppercase tracking-wider text-white/60">{label}</div>
      <div className="mt-1 text-sm text-white">{children}</div>
    </div>
  );
}
