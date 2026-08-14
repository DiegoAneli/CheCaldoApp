/**
 * CheCaldo! — generatore di contatti storici sintetici (§12rrrr).
 *
 * Popola `riservato.contatto` per le date passate con contatti
 * distribuiti come una giornata di lavoro reale: alcune persone
 * assegnate NON vengono contattate, chi risponde per lo più sta bene,
 * chi non risponde a volte viene ritentato lo stesso giorno.
 *
 * Motivo (§12rrrr): pre-generatore, il canone aveva 0-2 contatti al
 * giorno. `giorni_da_ultimo_contatto` (peso [0,75; 1,00] nel motore)
 * non ha mai la variabilità sufficiente per abbassare persone
 * contattate di recente rispetto a chi non si sente da settimane. Un
 * agente "riepilogo della giornata" (MOD04, prossimo blocco) su un
 * canone senza contatti storici non ha nulla da raccontare.
 *
 * DETERMINISMO. Semi RNG derivato da (FAKER_SEED, data ISO,
 * personaId). Stesso seed = stesse righe generate, ordine identico.
 *
 * IDEMPOTENZA. `fixture_id = 'c-<data>-<persId>-<seq>'` con partial
 * UNIQUE INDEX su `contatto (fixture_id) WHERE fixture_id IS NOT
 * NULL` (schema.sql + migrazione one-shot). ON CONFLICT DO NOTHING:
 * rilanciare non moltiplica.
 *
 * ATTENZIONE al confronto con `registraContatto`. Quella scrive con
 * `data = now()`, `fixture_id = NULL` (default). Il wrapper invariante
 * di §12nnnn filtra ora `fixture_id IS NULL` — così i contatti fixture
 * non contano come residuo.
 *
 * DISTRIBUZIONE (confermata da Diego):
 *   Primo tentativo (65% di prob per persona in lista):
 *     70% sta_bene · 22% non_risponde · 8% ha_bisogno
 *   Ritentativo (40% dei non_risponde primari):
 *     40% sta_bene · 45% non_risponde · 15% ha_bisogno
 *
 * VOLONTARIO. Quello a cui la persona era assegnata in quel giorno
 * (JOIN su `riservato.assegnazione.volontario_id`). Chi ha la persona
 * la contatta — coerente col motore.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import postgres from "postgres";
import { createHash } from "node:crypto";

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL non impostata.\n");
  process.exit(1);
}

const SEED = process.env.FAKER_SEED ?? "42";

function argOrEnv(nome: string, def?: string): string | undefined {
  const idx = process.argv.indexOf(`--${nome}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return def;
}

const ORG_ID = Number(argOrEnv("org", "1"));
const DA = argOrEnv("da"); // ISO YYYY-MM-DD, inclusivo
const A = argOrEnv("a");   // ISO YYYY-MM-DD, inclusivo
// Date da escludere di default (§12rrrr): oggi (giornata in corso, i
// contatti reali del coordinatore devono restare gli unici) e 07-30
// (fossile pre-§12kkkk senza rango_giorno). Override via --escludi CSV.
const ESCLUDI = new Set(
  (argOrEnv("escludi") ??
    `${new Date().toISOString().slice(0, 10)},2026-07-30`
  ).split(",").map((s) => s.trim()),
);

// ------------------------------------------------------ RNG deterministico

/** SHA-256[:8] a intero — 32 bit di entropia. */
function seedInt(chiave: string): number {
  const h = createHash("sha256").update(chiave).digest();
  // 4 bytes little-endian, unsigned
  return (h[0]! | (h[1]! << 8) | (h[2]! << 16) | (h[3]! << 24)) >>> 0;
}

/** LCG deterministico. Costanti da Numerical Recipes. */
function creaRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/** RNG per una coppia (data, personaId): ogni riga ha il suo stream. */
function rngPer(data: string, personaId: number): () => number {
  return creaRng(seedInt(`${SEED}::${data}::${personaId}`));
}

// ------------------------------------------------------ distribuzione

type Esito = "sta_bene" | "ha_bisogno" | "non_risponde";

const P_TENTATA = 0.65;

function esitoPrimo(rnd: number): Esito {
  if (rnd < 0.70) return "sta_bene";
  if (rnd < 0.92) return "non_risponde";
  return "ha_bisogno";
}

const P_RITENTATIVO = 0.40;

function esitoRitentativo(rnd: number): Esito {
  if (rnd < 0.40) return "sta_bene";
  if (rnd < 0.85) return "non_risponde";
  return "ha_bisogno";
}

/**
 * Genera un timestamp ISO nel giorno `data` fra 08:00 e 18:00 UTC. Un
 * offset di `offsetMinuti` sposta il ritentativo dopo il primo (10-30
 * minuti tipicamente). Deterministico via `rng`.
 */
function timestampInGiorno(
  data: string, rng: () => number, offsetMinuti = 0,
): string {
  const oraInizio = 8;
  const oraFine = 18;
  const minutoTotale = Math.floor(rng() * (oraFine - oraInizio) * 60);
  const totale = minutoTotale + offsetMinuti;
  const h = oraInizio + Math.floor(totale / 60);
  const m = totale % 60;
  const s = Math.floor(rng() * 60);
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${data}T${hh}:${mm}:${ss}Z`;
}

// ------------------------------------------------------ pipeline

interface Assegnazione {
  personaId: number;
  volontarioId: number | null;
}

interface Contatto {
  fixtureId: string;
  personaId: number;
  volontarioId: number | null;
  data: string;
  esito: Esito;
}

function generaContattiPerGiorno(
  data: string, assegnazioni: Assegnazione[],
): Contatto[] {
  // Ordina per personaId per garantire ordine deterministico anche se
  // il SELECT non è ordinato lato DB.
  const assOrd = [...assegnazioni].sort((a, b) => a.personaId - b.personaId);
  const out: Contatto[] = [];
  for (const a of assOrd) {
    const rng = rngPer(data, a.personaId);
    // r1: tentata? — consuma sempre un draw così la sequenza è stabile
    // se poi cambio la soglia.
    const r1 = rng();
    if (r1 >= P_TENTATA) continue; // non tentata oggi
    // r2: esito primo tentativo
    const r2 = rng();
    const es1 = esitoPrimo(r2);
    const ts1 = timestampInGiorno(data, rng);
    out.push({
      fixtureId: `c-${data}-${a.personaId}-1`,
      personaId: a.personaId,
      volontarioId: a.volontarioId,
      data: ts1,
      esito: es1,
    });
    if (es1 !== "non_risponde") continue;
    // r3: ritentativo? (solo dopo non_risponde primario)
    const r3 = rng();
    if (r3 >= P_RITENTATIVO) continue;
    // r4: esito ritentativo, offset 15 minuti (deterministico)
    const r4 = rng();
    const es2 = esitoRitentativo(r4);
    const ts2 = timestampInGiorno(data, rng, 15);
    out.push({
      fixtureId: `c-${data}-${a.personaId}-2`,
      personaId: a.personaId,
      volontarioId: a.volontarioId,
      data: ts2,
      esito: es2,
    });
  }
  return out;
}

// ------------------------------------------------------ main

async function main() {
  const sql = postgres(url!, { idle_timeout: 5 });
  try {
    // Trova le date da lavorare. Se --da/--a assenti: tutte le date
    // con assegnazioni per l'org, escluse quelle in ESCLUDI.
    const dateSql = DA && A
      ? await sql<Array<{ d: string }>>`
          SELECT DISTINCT to_char(a.data, 'YYYY-MM-DD') AS d
            FROM riservato.assegnazione a
            JOIN riservato.utente u ON u.id = a.volontario_id
           WHERE u.organizzazione_id = ${ORG_ID}
             AND a.data BETWEEN ${DA}::date AND ${A}::date
           ORDER BY d ASC
        `
      : await sql<Array<{ d: string }>>`
          SELECT DISTINCT to_char(a.data, 'YYYY-MM-DD') AS d
            FROM riservato.assegnazione a
            JOIN riservato.utente u ON u.id = a.volontario_id
           WHERE u.organizzazione_id = ${ORG_ID}
           ORDER BY d ASC
        `;
    const date = dateSql.map((r) => r.d).filter((d) => !ESCLUDI.has(d));
    process.stderr.write(
      `org=${ORG_ID} seed=${SEED} date=${date.length} ` +
      `escluse=[${[...ESCLUDI].join(",")}]\n`,
    );

    let totali = 0;
    let staBene = 0, hbisogno = 0, nonRisponde = 0;
    for (const d of date) {
      const ass = await sql<Array<{ personaId: number; volontarioId: number | null }>>`
        SELECT a.persona_id AS "personaId", a.volontario_id AS "volontarioId"
          FROM riservato.assegnazione a
          JOIN riservato.utente u ON u.id = a.volontario_id
         WHERE u.organizzazione_id = ${ORG_ID} AND a.data = ${d}::date
      `;
      const contatti = generaContattiPerGiorno(d, ass);
      // Bulk insert dentro transazione. `ON CONFLICT DO NOTHING` sul
      // partial UNIQUE (`fixture_id` WHERE NOT NULL) rende idempotente.
      let inseriti = 0;
      await sql.begin(async (tx) => {
        for (const c of contatti) {
          const res = await tx`
            INSERT INTO riservato.contatto
              (persona_id, volontario_id, data, esito, fixture_id)
            VALUES
              (${c.personaId}, ${c.volontarioId}, ${c.data}::timestamptz,
               ${c.esito}, ${c.fixtureId})
            ON CONFLICT (fixture_id) WHERE fixture_id IS NOT NULL DO NOTHING
            RETURNING id
          `;
          if (res.length > 0) inseriti++;
        }
      });
      // Riepilogo per giorno
      const b = contatti.filter((c) => c.esito === "sta_bene").length;
      const h = contatti.filter((c) => c.esito === "ha_bisogno").length;
      const n = contatti.filter((c) => c.esito === "non_risponde").length;
      staBene += b; hbisogno += h; nonRisponde += n; totali += contatti.length;
      process.stderr.write(
        `  ${d}: assegnati=${ass.length}, generati=${contatti.length} ` +
        `(sta_bene=${b}, ha_bisogno=${h}, non_risponde=${n}), inseriti=${inseriti}\n`,
      );
    }
    process.stderr.write(
      `\ntotale generati: ${totali} (sta_bene=${staBene}, ha_bisogno=${hbisogno}, ` +
      `non_risponde=${nonRisponde}) su ${date.length} date\n`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  process.stderr.write(`errore: ${(e as Error).message}\n`);
  process.exit(1);
});
