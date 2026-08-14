/**
 * Test §12cccc: `DURATA_SEGNALE_GIORNI` in packages/scoring/src/index.ts
 * deve restare **allineata** alle finestre usate dal generatore fixture
 * in `packages/fixtures/src/generatore.ts:PROB_SEGNALI`. Se una delle
 * due sorgenti cambia senza l'altra, la card della dashboard mostrerebbe
 * scaduti-a-tre-mesi accanto a validi-di-due-giorni, o simili
 * incoerenze; questo test cade prima che qualcuno se ne accorga
 * lookando la UI.
 *
 * Le finestre del generatore fixture sono duplicate qui come constanti:
 * il generatore vive in un modulo con `faker` che tira in dipendenze
 * pesanti, e importarlo nel test di scoring gonfia il pacchetto. La
 * duplicazione è **volutamente esplicita** e il test controlla che
 * `DURATA_SEGNALE_GIORNI[tipo]` cada dentro la finestra `[min, max]`
 * dichiarata qui.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DURATA_SEGNALE_GIORNI } from "../src/index";
import type { TipoSegnale } from "../src/types";

// Finestre dichiarate dal generatore in packages/fixtures/src/generatore.ts.
// Se il generatore cambia queste, aggiornare anche `FINESTRE_FIXTURE`.
// `null` = strutturale, sia nel generatore che nella scrittura app-side.
const FINESTRE_FIXTURE: Record<TipoSegnale, { min: number; max: number } | null> = {
  sintomi_riferiti:         { min: 1,  max: 5  },
  ventilatore_rotto:        { min: 3,  max: 21 },
  nessun_contatto_riferito: { min: 7,  max: 30 },
  nessuna_climatizzazione:  null,
  rete_familiare_assente:   null,
  difficolta_mobilita:      null,
};

test("§12cccc — DURATA_SEGNALE_GIORNI copre esattamente i sei tipi", () => {
  const chiaviDurata = new Set(Object.keys(DURATA_SEGNALE_GIORNI));
  const chiaviFinestre = new Set(Object.keys(FINESTRE_FIXTURE));
  assert.deepEqual(
    chiaviDurata, chiaviFinestre,
    "DURATA_SEGNALE_GIORNI e FINESTRE_FIXTURE devono coprire lo stesso set di tipi",
  );
});

test("§12cccc — tipi strutturali null in entrambi", () => {
  for (const tipo of Object.keys(FINESTRE_FIXTURE) as TipoSegnale[]) {
    const finestra = FINESTRE_FIXTURE[tipo];
    if (finestra === null) {
      assert.equal(
        DURATA_SEGNALE_GIORNI[tipo], null,
        `${tipo} strutturale in generatore fixture ma non in DURATA_SEGNALE_GIORNI: ` +
        `${DURATA_SEGNALE_GIORNI[tipo]}. Le due sorgenti sono divergenti — un ` +
        `tipo che il generatore emette con valido_fino=NULL scritto dal form ` +
        `avrebbe invece una scadenza (o viceversa).`,
      );
    }
  }
});

test("§12cccc — tipi con scadenza cadono dentro la finestra fixture", () => {
  for (const tipo of Object.keys(FINESTRE_FIXTURE) as TipoSegnale[]) {
    const finestra = FINESTRE_FIXTURE[tipo];
    if (finestra !== null) {
      const durata = DURATA_SEGNALE_GIORNI[tipo];
      assert.notEqual(
        durata, null,
        `${tipo} ha finestra fixture ${JSON.stringify(finestra)} ma ` +
        `DURATA_SEGNALE_GIORNI la dichiara null (strutturale). Divergenza: ` +
        `il generatore lo fa scadere, il form no.`,
      );
      assert.ok(
        durata! >= finestra.min && durata! <= finestra.max,
        `${tipo}: DURATA_SEGNALE_GIORNI = ${durata} giorni, fuori dalla ` +
        `finestra fixture [${finestra.min}, ${finestra.max}]. Rischio ` +
        `sulla card dashboard: scritture app-side con scadenza incoerente ` +
        `col canone di fixture (mediana o media della finestra è la ` +
        `convenzione dichiarata in §12cccc).`,
      );
    }
  }
});
