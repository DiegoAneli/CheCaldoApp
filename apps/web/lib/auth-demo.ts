/**
 * Auth stub per la demo: un cookie con l'id del volontario scelto in /login.
 * NON è un sistema di autenticazione — è un selettore utente per il video.
 * Nessuna verifica di credenziali, nessun hash: la produzione userà OIDC
 * (hook opzionale in .env.example).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { cookies } from "next/headers";

const COOKIE_VOL = "checaldo_volontario_id";
const COOKIE_COO = "checaldo_coordinatore_id";

// Cookie separati per ruolo: un utente demo può alternare i due ruoli in
// finestre distinte senza far collidere le sessioni. In produzione OIDC
// gestisce lo scope tramite claim, non due cookie diversi.

export async function volontarioIdCorrente(): Promise<number | null> {
  return leggiIdCookie(COOKIE_VOL);
}

export async function impostaVolontario(id: number): Promise<void> {
  await scriviIdCookie(COOKIE_VOL, id);
}

export async function coordinatoreIdCorrente(): Promise<number | null> {
  return leggiIdCookie(COOKIE_COO);
}

export async function impostaCoordinatore(id: number): Promise<void> {
  await scriviIdCookie(COOKIE_COO, id);
}

export async function logout(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_VOL);
  c.delete(COOKIE_COO);
}

async function leggiIdCookie(nome: string): Promise<number | null> {
  const c = await cookies();
  const raw = c.get(nome)?.value;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function scriviIdCookie(nome: string, id: number): Promise<void> {
  const c = await cookies();
  c.set(nome, String(id), {
    httpOnly: true,
    sameSite: "lax",
    // demo: nessun secure, gira su http
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
