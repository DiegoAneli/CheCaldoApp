/**
 * CheCaldo! — carica nel DB il seed sintetico e crea le assegnazioni del giorno.
 *
 * Pipeline:
 *   1. Legge fixtures/generated/assistiti.sintetico.csv (dall'adattatore)
 *      + fixtures/generated/segnali.sintetico.json (dal generatore).
 *   2. Inserisce persone in riservato.persona (per l'organizzazione 1
 *      = Distretto di Parma dal seed-organizzazione.sql).
 *   3. Inserisce i segnali corrispondenti in riservato.segnale.
 *   4. Crea 6 volontari demo in riservato.utente se non esistono.
 *   5. Chiama `generaGiroDelGiorno(sql, org, oggi)` di @checaldo/db —
 *      calcola classifica, aggiorna rango_giorno + punteggio_sezione +
 *      assegnazione. Stessa funzione chiamata dal pulsante "Genera il
 *      giro" della dashboard coordinatore (§12w): un solo posto dove
 *      vive la logica del giro.
 *
 * Idempotente: import via ON CONFLICT DO NOTHING sulle chiavi naturali,
 * generaGiroDelGiorno idempotente per costruzione (DELETE+INSERT in
 * transazione, protette rispettate).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
import {
  comuneDellOrganizzazione,
  fixtureIdSegnale,
  generaGiroDelGiorno,
  leggiCsv, proponiMappatura, estraiMappatura, applicaMappatura, aPersona,
  oggiRome,
} from "@checaldo/db";
import type { TipoSegnale } from "@checaldo/scoring";

/**
 * Telefono sintetico deterministico in decade 9.
 *
 * Motivo: la decade 9 non è assegnata a nessun operatore nel Piano
 * nazionale di numerazione, quindi il numero non raggiunge nessuno.
 * L'istanza dimostrativa è ad accesso libero e la vista volontario
 * espone un href `tel:` — con un numero non instradabile la chiamata
 * "cade nel vuoto" e l'interazione UI resta comunque dimostrabile.
 *
 * Deterministica su `idEsterno` via SHA-256 (stesso pattern di
 * `creatoIl(...)` in `packages/fixtures/src/generatore.ts:84`): non
 * attinge allo stream faker/`Math.random`, il canone del seed 42 resta
 * intatto e ogni riesecuzione produce lo stesso numero per la stessa
 * persona. La versione precedente usava `Math.random()` + decade 3 =
 * numeri mobile italiani reali potenzialmente raggiungibili, e
 * cambiavano a ogni carica.
 *
 * Formato: `+399XXXXXXXXX` — `+39` + `9` + 9 cifre = 13 caratteri,
 * identico per lunghezza al formato precedente (`+393XXXXXXXXX`).
 *
 * Guardia: ogni valore prodotto viene validato; se qualche futura
 * modifica producesse un numero non-decade-9, l'INSERT fallirebbe
 * rumorosamente. Nessun CHECK constraint su `riservato.persona.telefono`
 * — quello rifiuterebbe recapiti veri in una installazione operativa.
 */
function generaTelefonoDecade9(idEsterno: string): string {
  const hash = createHash("sha256").update(`telefono::${idEsterno}`).digest();
  // 9 cifre pseudo-random dal digest: leggo 4 byte come uint32 (0..2^32-1),
  // riduco modulo 1e9 per stare in [0, 999_999_999], pad a 9 cifre.
  const raw =
    hash[0]! * 2 ** 24 +
    hash[1]! * 2 ** 16 +
    hash[2]! * 2 ** 8 +
    hash[3]!;
  const noveCifre = String(raw % 1_000_000_000).padStart(9, "0");
  const numero = `+399${noveCifre}`;
  if (!/^\+399\d{9}$/.test(numero)) {
    throw new Error(
      `generaTelefonoDecade9: numero fuori dalla decade 9 non assegnata: ${numero}`,
    );
  }
  return numero;
}

const ROOT = join(__dirname, "..", "..", "..");
// Le sezioni si leggono da pubblico.sezione (fonte unica): la fixture
// packages/scoring/test/parma-sezioni.json resta al solo uso dei test di
// @checaldo/scoring, e va rigenerata quando un test lo richiede. Vedi
// CHECALDO-PROGETTO §12c ("Rimozione di una fonte di verità doppia").

// Lookup ISTAT → slug per derivare i path CSV/segnali (uguale a
// generatore.ts). Aggiungere un comune = una riga qui e nel generatore.
const SLUG_PER_ISTAT: Record<string, string> = {
  "034027": "parma",
  "037006": "bologna",
};

function argOrEnv(nome: string, envVar: string, def?: string): string | undefined {
  const idx = process.argv.indexOf(`--${nome}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return process.env[envVar] ?? def;
}

// §12zzzz — Europe/Rome via oggiRome() invece di UTC via toISOString.
const OGGI = (process.env.CHECALDO_OGGI ?? oggiRome()).slice(0, 10);
// Argomento --org ID (default: 1 = Distretto di Parma dal seed-organizzazione).
// Non è più costante: dopo il refactor multi-comune (§12q) ogni istanza può
// servire più comuni; per ogni carico va detto quale organizzazione popolare.
const ORGANIZZAZIONE_ID = Number(argOrEnv("org", "ORGANIZZAZIONE_ID", "1"));
// §12jjjjj — 12 volontari (era 6). L'idea di prodotto è "sei che
// lavorano la mattina, sei che entrano nel pomeriggio": il coord
// gestisce mattina/pomeriggio mettendo in pausa (§12jjjjj) chi non
// è di turno oggi. I nuovi 7-12 nascono ATTIVI (non in pausa): il
// primo gesto della demo diventa cliccare "in pausa", che è quello
// che serve a mostrare la funzione. Nessun INSERT su
// `riservato.pausa_volontario` dal seed.
//
// Idempotenza: `INSERT ... ON CONFLICT (email) DO NOTHING` sotto.
// Rilanciare `pnpm seed` non duplica; se i 6 originali esistevano
// già, aggiunge solo gli id 7-12 nuovi.
const N_VOLONTARI = 12;

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL non impostata.\n");
  process.exit(1);
}
const sql = postgres(url, { idle_timeout: 5 });

interface RigaSegnale {
  id: string;
  sezione_id: string;
  segnali: {
    tipo: TipoSegnale;
    origine: string;
    valido_fino: string | null;
    creato_il: string;
  }[];
}

async function main() {
  // Prima leggo il comune dell'organizzazione: da lì derivo lo slug e i
  // path CSV/segnali. Un'organizzazione = un comune (self-hosted per org
  // ma multi-org per istanza dopo §12q).
  const comuneIstat = await comuneDellOrganizzazione(sql, ORGANIZZAZIONE_ID);
  if (!comuneIstat) {
    throw new Error(`organizzazione ${ORGANIZZAZIONE_ID} senza comune_istat`);
  }
  const slug = SLUG_PER_ISTAT[comuneIstat] ?? comuneIstat;
  const CSV = join(ROOT, "fixtures", "generated", `assistiti-${slug}.sintetico.csv`);
  const SEGNALI = join(ROOT, "fixtures", "generated", `segnali-${slug}.sintetico.json`);
  process.stderr.write(`org=${ORGANIZZAZIONE_ID} comune=${comuneIstat} slug=${slug}\n`);

  const t = leggiCsv(CSV);
  const m = estraiMappatura(proponiMappatura(t.header, t.righe));
  const r = applicaMappatura(t.header, t.righe, m);
  process.stderr.write(`persone dall'adattatore: ${r.persone.length}\n`);

  const segnaliRaw = JSON.parse(readFileSync(SEGNALI, "utf8")) as RigaSegnale[];
  const segnaliPerId = new Map(segnaliRaw.map((s) => [s.id, s]));

  await sql.begin(async (tx) => {
    // Persone
    for (const pIn of r.persone) {
      const sez = segnaliPerId.get(pIn.idEsterno);
      const sezioneId = sez?.sezione_id ?? pIn.sezioneCensimento;
      if (!sezioneId) continue;
      await tx`
        INSERT INTO riservato.persona
          (organizzazione_id, id_esterno, sezione_id, anno_nascita, vive_solo,
           piano, ascensore, data_ultimo_contatto,
           segnalato_da_mmg, indirizzo, telefono, attiva)
        VALUES
          (${ORGANIZZAZIONE_ID}, ${pIn.idEsterno}, ${sezioneId},
           ${pIn.annoNascita ?? null}, ${pIn.viveSolo ?? null},
           ${pIn.piano ?? null}, ${pIn.ascensore ?? null},
           ${pIn.dataUltimoContatto ?? null},
           ${pIn.segnalatoDaMmg ?? false},
           ${pIn.indirizzo ?? null}, ${generaTelefonoDecade9(pIn.idEsterno)},
           true)
        ON CONFLICT (organizzazione_id, id_esterno) DO UPDATE SET
          data_ultimo_contatto = EXCLUDED.data_ultimo_contatto,
          telefono = EXCLUDED.telefono
      `;
      // DO UPDATE su data_ultimo_contatto: campo di anagrafe pre-
      // esistente che può cambiare al variare del canone del generatore
      // (es. DATA_BASE diversa). Un'istanza già caricata dal generatore
      // precedente ha data_ultimo_contatto=NULL per tutte le 500 righe
      // (colonna aggiunta via ALTER TABLE in §12jjj); senza DO UPDATE,
      // il campo resterebbe NULL e il fattore giorni_da_ultimo_contatto
      // continuerebbe a non applicarsi.
      //
      // DO UPDATE su telefono: ora `telefono` è funzione pura di
      // `idEsterno` (SHA-256 deterministica), quindi riscriverlo è
      // idempotente e vale sia per portare le righe legacy (decade 3
      // da `Math.random()`) in decade 9 alla prima ricarica, sia per
      // garantire che nessun `id_esterno` esistente possa mai trovarsi
      // con un telefono fuori norma.
      //
      // Non aggiorniamo anno_nascita/vive_solo: anagrafica stabile — se
      // un CSV nuovo li cambiasse, sarebbe un merge separato.
    }
    // Segnali (dopo aver risolto persona.id).
    //
    // Prima di inserire, DELETE dei segnali fixture di questa organizzazione:
    // il generatore ora produce anche `creato_il` (§12fff), e senza un reset
    // le righe già in DB manterrebbero il timestamp della prima carica,
    // ignorando le nuove date. `ON CONFLICT DO NOTHING` sotto è idempotente
    // per esistenza ma non per contenuto — il DELETE ristabilisce
    // l'invariante "lo stato dei segnali fixture è funzione dell'ultimo
    // generatore girato". Scelta di design (motivo in §12fff): NON
    // promuovere il DO NOTHING a DO UPDATE, perché farebbe cambiare le
    // date ad ogni rilancio anche a seed identico, rompendo il
    // determinismo del generatore che è il suo motivo di esistere.
    //
    // Scopato per organizzazione (`persona_id IN (...WHERE organizzazione_id
    // = X)`) e per fixture (`fixture_id IS NOT NULL`): non tocca segnali
    // di altre organizzazioni sulla stessa istanza, e non tocca segnali
    // scritti dall'app (registraContatto, che ha fixture_id NULL).
    // Le chiusure (chiuso_il) fatte dal coordinatore demo sui segnali
    // fixture si perdono al rilancio — comportamento accettabile per
    // dati sintetici, il ciclo demo lo tollera per costruzione.
    await tx`
      DELETE FROM riservato.segnale
       WHERE fixture_id IS NOT NULL
         AND persona_id IN (
               SELECT id FROM riservato.persona
                WHERE organizzazione_id = ${ORGANIZZAZIONE_ID}
             )
    `;

    // Idempotente via `fixture_id`: il generatore emette al massimo un
    // segnale per (persona, tipo), quindi la chiave
    // "s-<orgId>-<idEsterno>-<tipo>" e' unica per costruzione. La chiave
    // INCLUDE `orgId`: senza, due org sulla stessa istanza collidono
    // sull'unique index globale di `riservato.segnale (fixture_id)`
    // perche' il generatore emette `id_esterno` "Persona 0000..0499" per
    // ogni comune (bug osservato pre-2026-08-14: Bologna caricata dopo
    // Parma finiva con zero segnali, silenziosamente, per il ON CONFLICT
    // DO NOTHING sotto). La chiave la costruisce `fixtureIdSegnale`, che
    // vive in @checaldo/db (un solo posto).
    //
    // `ON CONFLICT DO NOTHING` resta come difesa di seconda linea (dopo
    // il DELETE non puo' piu' scattare, ma protegge da race o esecuzioni
    // concorrenti). Le scritture dell'app (registraContatto) hanno
    // fixture_id NULL e non partecipano al partial UNIQUE INDEX — restano
    // libere di ripetersi in tempi diversi.
    for (const [idEsterno, s] of segnaliPerId) {
      if (s.segnali.length === 0) continue;
      const rows = await tx<{ id: number }[]>`
        SELECT id FROM riservato.persona
        WHERE organizzazione_id = ${ORGANIZZAZIONE_ID} AND id_esterno = ${idEsterno}
      `;
      const persId = rows[0]?.id;
      if (!persId) continue;
      for (const sg of s.segnali) {
        const fixtureId = fixtureIdSegnale(ORGANIZZAZIONE_ID, idEsterno, sg.tipo);
        await tx`
          INSERT INTO riservato.segnale
            (persona_id, tipo, origine, valido_fino, creato_il, fixture_id)
          VALUES
            (${persId}, ${sg.tipo}, ${sg.origine}, ${sg.valido_fino},
             ${sg.creato_il}, ${fixtureId})
          ON CONFLICT (fixture_id) WHERE fixture_id IS NOT NULL DO NOTHING
        `;
      }
    }
    // Volontari demo. Email univoche per-organizzazione con suffisso `-slug`
    // per non collidere fra due organizzazioni della stessa istanza
    // (`volontario1@…` di Parma esiste già, per Bologna serve
    // `volontario1-bologna@…`). Retro-compat Parma: se ORGANIZZAZIONE_ID = 1
    // si mantiene `volontario1@…` originale.
    const suffisso = ORGANIZZAZIONE_ID === 1 ? "" : `-${slug}`;
    for (let i = 1; i <= N_VOLONTARI; i++) {
      const email = `volontario${i}${suffisso}@checaldo.local`;
      const nome = ORGANIZZAZIONE_ID === 1 ? `Volontario ${i}` : `Volontario ${i} (${slug})`;
      await tx`
        INSERT INTO riservato.utente
          (organizzazione_id, nome, email, hash_password, ruolo, attivo)
        VALUES
          (${ORGANIZZAZIONE_ID}, ${nome}, ${email}, 'DEMO', 'volontario', true)
        ON CONFLICT (email) DO NOTHING
      `;
    }
  });

  // Classifica, rango_giorno, punteggio_sezione, assegnazione: tutto
  // dentro generaGiroDelGiorno di @checaldo/db. È la stessa funzione
  // chiamata dal pulsante "Genera il giro di oggi" della dashboard
  // coordinatore (§12w) — un solo posto dove vive la logica del giro,
  // batch e UI non possono divergere.
  //
  // Include il fix del bug del 2026-08-04 (DELETE su assegnazione
  // scopata per organizzazione_id) e la regola delle protette
  // (persone già contattate oggi restano nel giro alla rigenerazione).
  const risultato = await generaGiroDelGiorno(sql, ORGANIZZAZIONE_ID, OGGI);
  process.stderr.write(
    `giro del ${OGGI} per org ${ORGANIZZAZIONE_ID}: `
    + `${risultato.totaleAssegnate} persone `
    + `(${risultato.protette} protette + ${risultato.nuoveAssegnate} nuove), `
    + `soglia=${risultato.sogliaUsata}, livello=${risultato.livelloUsato}, `
    + `vol_attivi=${risultato.volontariAttivi}, `
    + `vol_di_turno=${risultato.volontariDiTurno}\n`,
  );
  if (risultato.nonAssegnatePerCapSaturato > 0) {
    process.stderr.write(
      `[CAP] ${risultato.nonAssegnatePerCapSaturato} persone senza volontario `
      + `(soglia=${risultato.sogliaUsata} > posti=${risultato.volontariDiTurno * 6})\n`,
    );
  }

  await sql.end();
}

main().catch((e) => {
  process.stderr.write(`errore: ${e?.message ?? e}\n`);
  process.exit(1);
});
