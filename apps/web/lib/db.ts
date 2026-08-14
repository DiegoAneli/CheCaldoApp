/**
 * Client Postgres singleton per la vista volontario.
 * postgres.js: nessun ORM, template tag per parametri sicuri.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL non impostata: serve per apps/web");

// In dev con HMR i moduli si ricompilano — riusa il pool tramite globalThis
// per evitare esplosione di connessioni.
declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

export const sql =
  globalThis.__sql ??
  postgres(url, {
    // idle_timeout basso in dev, non voglio pool grossi.
    idle_timeout: 20,
    max: 10,
    // Serializza le date come stringhe ISO (coerente con lo schema DATE).
    transform: { undefined: null },
  });

if (process.env.NODE_ENV !== "production") globalThis.__sql = sql;
