import { NextResponse } from "next/server";
import { getSamlClient } from "@/lib/auth-saml";

export async function GET() {
  const saml = getSamlClient();
  const url = await saml.getAuthorizeUrlAsync("", undefined, {});
  return NextResponse.redirect(url);
}
