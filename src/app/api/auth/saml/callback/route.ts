import { NextRequest, NextResponse } from "next/server";
import { getSamlClient } from "@/lib/auth-saml";
import { signIn } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const samlResponse = formData.get("SAMLResponse");
  if (typeof samlResponse !== "string") {
    return NextResponse.json({ error: "Missing SAMLResponse" }, { status: 400 });
  }

  const saml = getSamlClient();
  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (!profile) {
    return NextResponse.json({ error: "Invalid SAML assertion" }, { status: 401 });
  }

  await signIn("saml", {
    profile: JSON.stringify({
      email: profile.email ?? profile.nameID,
      name: profile.cn ?? profile.displayName ?? profile.givenName,
      nameID: profile.nameID,
    }),
    redirectTo: "/dashboard",
  });

  return NextResponse.redirect(new URL("/dashboard", req.url));
}
