"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updatePassword } from "./actions";

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const formData = new FormData(e.currentTarget);
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    if (hasPassword && !String(formData.get("currentPassword") ?? "")) {
      setError("Current password is required");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    start(async () => {
      const res = await updatePassword(formData);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(hasPassword ? "Password updated." : "Password set.");
        formRef.current?.reset();
      }
    });
  }

  return (
    <form ref={formRef} className="space-y-4" onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            {hasPassword
              ? "Change your password. You'll stay signed in on this device."
              : "Set a password to enable email + password sign-in alongside SSO."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasPassword && (
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="newPassword">
              {hasPassword ? "New password" : "Password"}
            </Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
            />
          </div>
          {error && (
            <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="text-xs text-green-600" role="status">
              {success}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : hasPassword ? "Change password" : "Set password"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
