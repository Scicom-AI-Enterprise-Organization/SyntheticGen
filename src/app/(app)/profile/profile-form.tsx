"use client";

import { useState, useTransition } from "react";
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
import { updateProfile } from "./actions";

export function ProfileForm({
  initialName,
  email,
}: {
  initialName: string;
  email: string;
}) {
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (name.length > 100) {
      setError("Name must be at most 100 characters");
      return;
    }
    const formData = new FormData(e.currentTarget);
    start(async () => {
      const res = await updateProfile(formData);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess("Profile updated.");
        setSavedName(name);
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Your email is set by your sign-in method and can&apos;t be changed here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
            <Button type="submit" disabled={pending || name === savedName}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
