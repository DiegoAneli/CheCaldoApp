// SPDX-License-Identifier: AGPL-3.0-or-later
import { NextResponse } from "next/server";
import { logout } from "@/lib/auth-demo";

export async function GET() {
  await logout();
  // Dopo logout, alla radice: da lì l'utente sceglie il comune e va al
  // login corretto (/{slug}/login) — vedi §12u.
  return NextResponse.redirect(new URL("/", process.env.APP_URL ?? "http://localhost:3000"));
}
