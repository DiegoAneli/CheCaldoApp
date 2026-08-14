/**
 * CheCaldo! — generatore anagrafe sintetica per la demo.
 *
 * Produce:
 *   fixtures/generated/assistiti-{slug}.sintetico.csv
 *   fixtures/generated/segnali-{slug}.sintetico.json
 *
 * Vincoli:
 *   - vincolo 3: nessun dato reale. Nomi tipo "Persona 0142", si vede a occhio.
 *   - determinismo: FAKER_SEED e DATA_BASE da env. Due corse identiche vanno
 *     lanciate con le stesse variabili (vedi .env.example).
 *   - proporzionalità: numerosità per sezione proporzionale alla popolazione
 *     reale (sezioni vuote sono realistiche, nessun floor).
 *
 * Parametri (CLI o env):
 *   --comune-istat <codice>  default: COMUNE_ISTAT da env, oppure 034027 (Parma).
 *
 * Il generatore legge le sezioni direttamente da `pubblico.sezione`
 * (invece che dalla fixture `parma-sezioni.json` che era l'unica fonte
 * pre-2026-08-03). Le vie vengono da `packages/fixtures/data/vie-{slug}.json`
 * — vedi `scripts/estrai-vie.ts` per come si generano.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { faker } from "@faker-js/faker/locale/it";

// -------------------------------------------------------- configurazione

const TARGET = 500;
const SEED = Number(process.env.FAKER_SEED ?? "42");
const DATA_BASE = (process.env.DATA_BASE ?? isoOggi()).slice(0, 10);

// Lookup ISTAT → slug: usato per derivare i path (vie e output). Sotto i
// 3-4 comuni una tabella `pubblico.comune` sarebbe overkill; qui basta
// una mappa hardcoded. Aggiungere un comune = una riga, o passare
// `--slug` esplicito per casi ad-hoc.
const SLUG_PER_ISTAT: Record<string, string> = {
  "034027": "parma",
  "037006": "bologna",
};

function isoOggi(): string {
  return new Date().toISOString().slice(0, 10);
}

function addGiorni(baseIso: string, giorni: number): string {
  const d = new Date(baseIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + giorni);
  return d.toISOString().slice(0, 10);
}

/**
 * Timestamp ISO in Zulu per `creato_il` di un segnale, distribuito
 * uniformemente nell'intervallo [oggi - 14 giorni, oggi]. Consumato dal
 * campo `creato_il timestamptz` di `riservato.segnale` (schema.sql:160).
 *
 * Uniforme e non pesata sui feriali: durante un'ondata di calore i giri
 * si fanno tutti i giorni, e una stagionalità settimanale sarebbe un
 * attributo inventato (§12fff, vincolo esplicito dell'utente).
 *
 * Include l'ora del giorno perché altrimenti due segnali della stessa
 * data avrebbero timestamp identico e l'`ORDER BY creato_il DESC` che
 * alimenta la lista sintomi in dashboard ricadrebbe su un ordinamento
 * indeterminato fra pari (§12eee).
 *
 * **RNG indipendente dallo stream faker (§12ggg)**: la data è funzione
 * pura di `(idEsterno, tipo)` via SHA-256, indipendente dall'ordine di
 * generazione. Motivo: la versione precedente (§12fff) usava `intero()`
 * = 4 chiamate faker per segnale, che spostavano lo stream RNG condiviso
 * — persone e ranghi con lo stesso `FAKER_SEED=42` uscivano diversi da
 * prima, rompendo tutti gli esempi già scritti nei documenti (~15
 * riferimenti specifici a "Persona 0193", "Persona 0018", ranghi, ecc.).
 * Il determinismo del seed esiste per poter scrivere "Persona 0193 passa
 * dal rango 8 al 115" e ritrovarlo in demo; un'evoluzione del generatore
 * non deve romperlo in silenzio. Con l'hash, aggiungere `creato_il` è
 * cambio additivo: le persone e i segnali generati dallo stream faker
 * restano bit-per-bit identici al canone precedente.
 */
function creatoIl(idEsterno: string, tipo: string): string {
  const chiave = `${idEsterno}::${tipo}`;
  const hash = createHash("sha256").update(chiave).digest();
  // Legge 6 byte come intero unsigned (48 bit): amplio abbastanza per
  // essere praticamente uniforme mod 14*86400, evita overflow di Number.
  const raw =
    hash[0]! * 2 ** 40 +
    hash[1]! * 2 ** 32 +
    hash[2]! * 2 ** 24 +
    hash[3]! * 2 ** 16 +
    hash[4]! * 2 ** 8 +
    hash[5]!;
  const secondiInFinestra = 14 * 24 * 3600;
  const offsetSecondi = raw % secondiInFinestra;
  // Base = DATA_BASE 00:00:00 UTC menu 14 giorni, poi somma offset.
  const base = new Date(DATA_BASE + "T00:00:00Z");
  base.setUTCDate(base.getUTCDate() - 14);
  base.setUTCSeconds(base.getUTCSeconds() + offsetSecondi);
  return base.toISOString();
}

function argOrEnv(nome: string, envVar: string, def?: string): string | undefined {
  const idx = process.argv.indexOf(`--${nome}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return process.env[envVar] ?? def;
}

// --------------------------------------------------------------- input

interface SezioneIn {
  id: string;
  sez21: number;
  quartiere: string | null;
  popolazione: number;
  famiglie: number;
  tipoSezione: number;
}

interface VieFile { vie: string[] }

const ROOT = join(__dirname, "..", "..", "..");
const OUT_DIR = join(ROOT, "fixtures", "generated");

async function leggiSezioniDaDB(sql: postgres.Sql, comuneIstat: string): Promise<SezioneIn[]> {
  const rows = await sql<Array<{
    id: string; sez21: number; quartiere: string | null;
    popolazione: number; famiglie: number; tipoSezione: number;
  }>>`
    SELECT id, sez21, quartiere,
           popolazione, famiglie,
           tipo_sezione AS "tipoSezione"
      FROM pubblico.sezione
     WHERE comune_istat = ${comuneIstat}
       AND NOT fittizia
       AND tipo_sezione = 1
       AND popolazione > 0
     ORDER BY id
  `;
  if (rows.length === 0) {
    throw new Error(
      `pubblico.sezione vuota per comune ${comuneIstat}. ` +
        `Caricare prima gli attributi: istat.py ... --sql, ` +
        `e le geometrie via ogr2ogr.`,
    );
  }
  return rows;
}

function leggiVie(pathVie: string): string[] {
  if (!existsSync(pathVie)) {
    throw new Error(
      `File ${pathVie} mancante. Rigenerare con:\n` +
        `  docker compose run --rm node pnpm --filter @checaldo/fixtures estrai-vie -- --slug <slug>\n`,
    );
  }
  const data = JSON.parse(readFileSync(pathVie, "utf8")) as VieFile;
  if (!data.vie || data.vie.length < 100) {
    throw new Error(`${pathVie} contiene solo ${data.vie?.length ?? 0} vie: sospetta estrazione errata.`);
  }
  return data.vie;
}

// ----------------------------------------------- probabilità e distribuzione

const PROB_SEGNALI: Record<string, { p: number; scad: () => string | null }> = {
  nessuna_climatizzazione: { p: 0.35, scad: () => null },
  ventilatore_rotto:       { p: 0.05, scad: () => addGiorni(DATA_BASE, intero(3, 21)) },
  rete_familiare_assente:  { p: 0.20, scad: () => null },
  difficolta_mobilita:     { p: 0.30, scad: () => null },
  nessun_contatto_riferito:{ p: 0.10, scad: () => addGiorni(DATA_BASE, intero(7, 30)) },
  sintomi_riferiti:        { p: 0.03, scad: () => addGiorni(DATA_BASE, intero(1, 5))  },
};

// 'cittadino' rimosso dopo §12k: nessun canale del sistema può produrre
// segnali di origine cittadina (form/coda triage rimossi 2026-08-02). Il
// 20% originario ridistribuito su volontario e mmg in proporzione al peso
// esistente (50:15 → +15.38 e +4.62 rispettivamente); coordinatore invariato.
// Il valore 'cittadino' resta nell'enum di schema.sql per un canale pubblico
// non ancora esistente — vedi CHECALDO-PROGETTO §12v.
const ORIGINI: [string, number][] = [
  ["volontario", 0.6538], ["mmg", 0.1962], ["coordinatore", 0.15],
];

function intero(min: number, max: number): number {
  return faker.number.int({ min, max });
}

function scegliOrigine(): string {
  const r = faker.number.float({ min: 0, max: 1 });
  let acc = 0;
  for (const [o, p] of ORIGINI) {
    acc += p;
    if (r <= acc) return o;
  }
  return "volontario";
}

function estraiSezioni(sezioni: SezioneIn[], n: number): number[] {
  const pesi = sezioni.map((s) => s.popolazione);
  const totale = pesi.reduce((a, b) => a + b, 0);
  const soglie: number[] = [];
  let acc = 0;
  for (const p of pesi) {
    acc += p / totale;
    soglie.push(acc);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = faker.number.float({ min: 0, max: 1 });
    let lo = 0, hi = soglie.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const soglia = soglie[mid];
      if (soglia !== undefined && r <= soglia) hi = mid;
      else lo = mid + 1;
    }
    out.push(lo);
  }
  return out;
}

// ------------------------------------------------------ generazione persone

interface Persona {
  cod_ut: string;
  residenza: string;
  anno_n: number;
  nucleo_fam: number;
  piano: number | null;
  dt_ult_cont: string | null;
  ascensore: "S" | "N";
  segnalato_da_mmg: "S" | "N";
  sezione_id: string;
  segnali: { tipo: string; origine: string; valido_fino: string | null; creato_il: string }[];
}

function generaPersone(sezioni: SezioneIn[], vie: string[]): Persona[] {
  const annoBase = Number(DATA_BASE.slice(0, 4));
  const scelte = estraiSezioni(sezioni, TARGET);
  return scelte.map((idx, i) => {
    const sez = sezioni[idx];
    if (!sez) throw new Error(`sezione idx ${idx} fuori range`);
    const codUt = `Persona ${String(i).padStart(4, "0")}`;

    const dimFam = sez.popolazione / Math.max(1, sez.famiglie);
    const pSolo = Math.max(0.15, Math.min(0.60, 1.5 - (dimFam - 1.5) * 0.35));
    const solo = faker.number.float({ min: 0, max: 1 }) < pSolo;

    const eta = faker.helpers.weightedArrayElement([
      { weight: 3, value: intero(75, 79) },
      { weight: 4, value: intero(80, 85) },
      { weight: 2, value: intero(86, 90) },
      { weight: 1, value: intero(91, 95) },
    ]);

    const via = faker.helpers.arrayElement(vie);
    const civico = intero(1, 180);
    const piano = faker.helpers.weightedArrayElement([
      { weight: 2, value: 0 as number | null },
      { weight: 3, value: 1 },
      { weight: 4, value: 2 },
      { weight: 3, value: 3 },
      { weight: 2, value: 4 },
      { weight: 1, value: 5 },
      { weight: 1, value: null },
    ]);
    const pAsc = piano === null ? 0.5 : piano >= 3 ? 0.7 : 0.25;
    const asc: "S" | "N" = faker.number.float({ min: 0, max: 1 }) < pAsc ? "S" : "N";

    const dtUlt = faker.number.float({ min: 0, max: 1 }) < 0.30
      ? null
      : addGiorni(DATA_BASE, -intero(0, 90));

    const mmg: "S" | "N" = faker.number.float({ min: 0, max: 1 }) < 0.10 ? "S" : "N";

    const segnali: Persona["segnali"] = [];
    for (const [tipo, { p, scad }] of Object.entries(PROB_SEGNALI)) {
      if (faker.number.float({ min: 0, max: 1 }) < p) {
        segnali.push({
          tipo,
          origine: scegliOrigine(),
          valido_fino: scad(),
          // creato_il è deterministico via hash(codUt::tipo), NON attinge
          // allo stream faker — non sposta l'RNG condiviso, il canone del
          // seed 42 resta identico a prima. Vedi §12ggg.
          creato_il: creatoIl(codUt, tipo),
        });
      }
    }

    return {
      cod_ut: codUt,
      residenza: `${via} ${civico}`,
      anno_n: annoBase - eta,
      nucleo_fam: solo ? 1 : intero(2, 4),
      piano,
      dt_ult_cont: dtUlt,
      ascensore: asc,
      segnalato_da_mmg: mmg,
      sezione_id: sez.id,
      segnali,
    };
  });
}

// ---------------------------------------------------------- serializzazione

const SEP = ";";
function riga(vals: (string | number | null)[]): string {
  return vals.map((v) => v === null || v === undefined ? "" : String(v)).join(SEP);
}

function scriviAssistiti(persone: Persona[], outPath: string): void {
  const header = ["COD_UT", "RESIDENZA", "ANNO_N", "NUCLEO_FAM", "PIANO", "DT_ULT_CONT", "ASCENSORE", "SEGNALATO_DA_MMG"];
  const righe = [riga(header)];
  for (const p of persone) {
    righe.push(riga([p.cod_ut, p.residenza, p.anno_n, p.nucleo_fam, p.piano, p.dt_ult_cont, p.ascensore, p.segnalato_da_mmg]));
  }
  writeFileSync(outPath, righe.join("\n") + "\n", "utf8");
}

// ------------------------------------------------------------------ main

async function main() {
  const comuneIstat = argOrEnv("comune-istat", "COMUNE_ISTAT", "034027")!;
  const slug = SLUG_PER_ISTAT[comuneIstat] ?? comuneIstat;

  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("DATABASE_URL non impostata.\n"); process.exit(1); }
  const sql = postgres(url, { idle_timeout: 5 });

  faker.seed(SEED);
  try {
    const sezioni = await leggiSezioniDaDB(sql, comuneIstat);
    const pathVie = join(ROOT, "packages", "fixtures", "data", `vie-${slug}.json`);
    const vie = leggiVie(pathVie);

    mkdirSync(OUT_DIR, { recursive: true });
    const outAssistiti = join(OUT_DIR, `assistiti-${slug}.sintetico.csv`);
    const outSegnali = join(OUT_DIR, `segnali-${slug}.sintetico.json`);

    const persone = generaPersone(sezioni, vie);
    scriviAssistiti(persone, outAssistiti);
    writeFileSync(
      outSegnali,
      JSON.stringify(
        persone.map((p) => ({ id: p.cod_ut, sezione_id: p.sezione_id, segnali: p.segnali })),
        null, 2,
      ) + "\n",
      "utf8",
    );

    process.stderr.write(
      `\ncomune=${comuneIstat} (${slug}): ${sezioni.length} sezioni residenziali abitate\n` +
      `generati ${persone.length} assistiti in ${outAssistiti}\n` +
      `mappa sezioni: ${new Set(persone.map((p) => p.sezione_id)).size} distinte su ${sezioni.length}\n` +
      `segnali totali: ${persone.reduce((n, p) => n + p.segnali.length, 0)}\n`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  process.stderr.write(`errore: ${e?.message ?? e}\n`);
  process.exit(1);
});
