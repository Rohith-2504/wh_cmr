// ============================================================
// GET /auth/callback
//
// Supabase PKCE callback handler. Supabase's magic-link and
// inviteUserByEmail flows redirect here with a `code` query param
// (PKCE) or a `token_hash` + `type` combo (older OTP flow).
//
// After exchanging the code for a session we forward the user
// to wherever `next` points (default: /dashboard). The `next`
// param is validated to be a relative path so we never open-
// redirect to an external domain.
// ============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as
    | "magiclink"
    | "invite"
    | "recovery"
    | "email"
    | null;

  // `next` is a relative path (starts with /) — we strip anything
  // that looks like an absolute URL to prevent open-redirect.
  const rawNext = searchParams.get("next") ?? "";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/dashboard";

  const supabase = await createClient();

  if (code) {
    // PKCE flow — exchange auth code for session.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchangeCodeForSession error:", error);
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent("Authentication failed. Please try again.")}`,
      );
    }
  } else if (tokenHash && type) {
    // OTP / magic-link flow.
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      console.error("[auth/callback] verifyOtp error:", error);
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent("Authentication failed. Please try again.")}`,
      );
    }
  } else {
    // No code or token_hash — probably a stale/malformed link.
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Invalid or expired link. Please request a new one.")}`,
    );
  }

  // Success — forward to the intended destination.
  return NextResponse.redirect(`${origin}${next}`);
}
