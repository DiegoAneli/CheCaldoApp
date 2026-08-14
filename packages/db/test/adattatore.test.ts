/**
 * Test dell'adattatore CSV/XLSX di @checaldo/db.
 *
 * Copre 3 delle 5 verifiche del modulo MOD02:
 *   - un CSV con intestazioni volutamente sporche (stile gestionale
 *     assistenziale italiano) viene mappato correttamente;
 *   - classificaPersone del motore gira sulle persone estratte;
 *   - il rilevatore duplicati segnala coppie candidate senza fondere.
 *
 * Le due verifiche restanti (`pnpm seed × 2 identico` e `il CSV generato
 * entra dall'adattatore senza casi speciali`) richiedono l'esecuzione del
 * generatore, oggi bloccato su vie-parma.json non ancora estratto da
 * Overpass.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  rilevaSeparatore,
  leggiCsv,
  proponiMappatura,
  estraiMappatura,
  applicaMappatura,
  aPersona,
  trovaDuplicati,
  type PersonaIn,
} from "../src/index";
import {
  classificaPersone,
  valutaSezioni,
  type Allerta,
  type Sezione,
} from "@checaldo/scoring";

// ---------------------------------------------------------- helper file

function tempCsv(nome: string, contenuto: string): string {
  const dir = mkdtempSync(join(tmpdir(), "checaldo-adattatore-"));
  const path = join(dir, nome);
  writeFileSync(path, contenuto, "utf8");
  return path;
}

// ------------------------------------------- separatore, parser CSV

test("rileva separatore ; come dominante in un CSV all'italiana", () => {
  const csv = "A;B;C\n1;2;3\n4;5;6\n";
  assert.equal(rilevaSeparatore(csv), ";");
});

test("rileva separatore , come dominante", () => {
  const csv = "A,B,C\n1,2,3\n4,5,6\n";
  assert.equal(rilevaSeparatore(csv), ",");
});

test("rileva separatore tab come dominante", () => {
  const csv = "A\tB\tC\n1\t2\t3\n";
  assert.equal(rilevaSeparatore(csv), "\t");
});

// -------------------- mappatura euristica su intestazioni "sporche"

test("propone mappatura corretta su header stile gestionale italiano", () => {
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;NUCLEO_FAM;PIANO;DT_ULT_CONT;ASCENSORE;SEGNALATO_DA_MMG\n" +
    "U001;via Fantasia 12;1948;1;3;2026-06-15;N;S\n" +
    "U002;strada del Sole 8;1952;3;0;;S;N\n";
  const path = tempCsv("gestionale.csv", csv);
  try {
    const t = leggiCsv(path);
    const p = proponiMappatura(t.header, t.righe);
    assert.equal(p.proposte["COD_UT"]?.campo, "id_esterno");
    assert.equal(p.proposte["RESIDENZA"]?.campo, "indirizzo");
    assert.equal(p.proposte["ANNO_N"]?.campo, "anno_nascita");
    assert.equal(p.proposte["NUCLEO_FAM"]?.campo, "vive_solo");
    assert.equal(p.proposte["PIANO"]?.campo, "piano");
    assert.equal(p.proposte["DT_ULT_CONT"]?.campo, "data_ultimo_contatto");
    assert.equal(p.proposte["ASCENSORE"]?.campo, "ascensore");
    assert.equal(p.proposte["SEGNALATO_DA_MMG"]?.campo, "segnalato_da_mmg");
  } finally {
    rmSync(path, { force: true });
  }
});

test("propone mappatura anche su header alternative (id/indirizzo/nato)", () => {
  const csv =
    "id,indirizzo,nato_nel,solo_sn\n" +
    "A;via Roma 1;1945;S\n";
  // separatore misto per esercitare il rilevatore: sceglie ,
  const path = tempCsv("altre.csv", csv);
  try {
    const t = leggiCsv(path);
    const p = proponiMappatura(t.header, t.righe);
    assert.equal(p.proposte["id"]?.campo, "id_esterno");
    assert.equal(p.proposte["indirizzo"]?.campo, "indirizzo");
    assert.equal(p.proposte["nato_nel"]?.campo, "anno_nascita");
    assert.equal(p.proposte["solo_sn"]?.campo, "vive_solo");
  } finally {
    rmSync(path, { force: true });
  }
});

// ----------------------------------- applicazione mappatura e scarti

test("applicaMappatura estrae persone valide e scarta le non conformi", () => {
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;NUCLEO_FAM\n" +
    "U001;via Fantasia 12;1948;1\n" +
    "U002;;1952;2\n" +           // scartata: né indirizzo né sezione
    ";via Sole 3;1950;1\n" +      // scartata: id mancante
    "U004;via Vento 5;NON-ANNO;1\n"; // scartata: anno non valido, nessuna fascia
  const path = tempCsv("mix.csv", csv);
  try {
    const t = leggiCsv(path);
    const m = estraiMappatura(proponiMappatura(t.header, t.righe));
    const r = applicaMappatura(t.header, t.righe, m);
    assert.equal(r.persone.length, 1);
    assert.equal(r.persone[0]?.idEsterno, "U001");
    assert.equal(r.persone[0]?.viveSolo, true);
    assert.equal(r.righeScartate.length, 3);
  } finally {
    rmSync(path, { force: true });
  }
});

test("colonne non mappate finiscono in colonneIgnorate, non nella persona", () => {
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;NOTE_DIAGNOSTICHE;PATOLOGIE\n" +
    "U001;via Fantasia 12;1948;paziente diabetico;ipertensione\n";
  const path = tempCsv("diagnosi.csv", csv);
  try {
    const t = leggiCsv(path);
    const m = estraiMappatura(proponiMappatura(t.header, t.righe));
    const r = applicaMappatura(t.header, t.righe, m);
    assert.equal(r.persone.length, 1);
    assert.ok(r.colonneIgnorate.includes("NOTE_DIAGNOSTICHE"));
    assert.ok(r.colonneIgnorate.includes("PATOLOGIE"));
    // Vincolo 3: nulla di sanitario deve entrare nel modello.
    assert.equal((r.persone[0] as unknown as Record<string, unknown>)["NOTE_DIAGNOSTICHE"], undefined);
  } finally {
    rmSync(path, { force: true });
  }
});

// ---------------------------- integrazione con classificaPersone

test("classificaPersone gira sulle persone caricate dall'adattatore", () => {
  // Sezioni sintetiche minime, coerenti col tipo di @checaldo/scoring.
  const sezioni: (Sezione & { sez21: number })[] = [
    { id: "SEC-A", sez21: 1, popolazione: 100, famiglie: 60, abitazioni: 80,
      edificiResidenziali: 20, tipoSezione: 1, quartiere: "Centro" },
    { id: "SEC-B", sez21: 2, popolazione: 200, famiglie: 90, abitazioni: 150,
      edificiResidenziali: 30, tipoSezione: 1, quartiere: "Periferia" },
    { id: "SEC-C", sez21: 3, popolazione: 50, famiglie: 20, abitazioni: 30,
      edificiResidenziali: 10, tipoSezione: 1, quartiere: "Frazione" },
  ];
  const csv =
    "COD_UT;SEZIONE;ANNO_N;NUCLEO_FAM\n" +
    "U1;SEC-A;1946;1\n" +
    "U2;SEC-B;1952;2\n" +
    "U3;SEC-C;1938;1\n";
  const path = tempCsv("integraz.csv", csv);
  try {
    const t = leggiCsv(path);
    const m = estraiMappatura(proponiMappatura(t.header, t.righe));
    const r = applicaMappatura(t.header, t.righe, m);
    assert.equal(r.persone.length, 3);

    const personeMotore = r.persone.map((p) => aPersona(p, { sezioneId: p.sezioneCensimento }));
    const valutate = valutaSezioni(sezioni);
    const allerta: Allerta = {
      livello: 2, provenienza: "stima", data: "2026-07-30",
      orizzonteOre: 24, nottiTropicali: 3,
    };
    const classifica = classificaPersone(personeMotore, valutate, {
      allerta, soglia: 2, oggi: new Date("2026-07-30"),
    });
    assert.equal(classifica.length, 3);
    // c'è un ordine deterministico
    assert.ok(classifica.every((p, i) => p.posizione === i + 1));
    // la soglia rispetta il limite
    assert.equal(classifica.filter((p) => p.inListaOggi).length, 2);
  } finally {
    rmSync(path, { force: true });
  }
});

// ------------------------------ 0/1 come booleani vs NUCLEO_FAM

test("ASCENSORE con valori 0/1 viene interpretato come booleano puro", () => {
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;ASCENSORE\n" +
    "U1;via X 1;1948;1\n" +
    "U2;via Y 2;1950;0\n";
  const path = tempCsv("ascensore-01.csv", csv);
  try {
    const t = leggiCsv(path);
    const m = estraiMappatura(proponiMappatura(t.header, t.righe));
    const r = applicaMappatura(t.header, t.righe, m);
    assert.equal(r.persone.length, 2);
    assert.equal(r.persone[0]?.ascensore, true, "U1;1 deve essere true");
    assert.equal(r.persone[1]?.ascensore, false, "U2;0 deve essere false, non undefined");
  } finally {
    rmSync(path, { force: true });
  }
});

test("SEGNALATO_DA_MMG con valori 0/1 viene interpretato come booleano puro", () => {
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;SEGNALATO_DA_MMG\n" +
    "U1;via X 1;1948;0\n" +
    "U2;via Y 2;1950;1\n";
  const path = tempCsv("mmg-01.csv", csv);
  try {
    const t = leggiCsv(path);
    const m = estraiMappatura(proponiMappatura(t.header, t.righe));
    const r = applicaMappatura(t.header, t.righe, m);
    assert.equal(r.persone[0]?.segnalatoDaMmg, false);
    assert.equal(r.persone[1]?.segnalatoDaMmg, true);
  } finally {
    rmSync(path, { force: true });
  }
});

test("NUCLEO_FAM=1 → vive_solo=true, NUCLEO_FAM=3 → vive_solo=false", () => {
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;NUCLEO_FAM\n" +
    "U1;via X 1;1948;1\n" +
    "U2;via Y 2;1950;3\n";
  const path = tempCsv("nucleo.csv", csv);
  try {
    const t = leggiCsv(path);
    const m = estraiMappatura(proponiMappatura(t.header, t.righe));
    const r = applicaMappatura(t.header, t.righe, m);
    assert.equal(r.persone[0]?.viveSolo, true, "NUCLEO_FAM=1 → true");
    assert.equal(r.persone[1]?.viveSolo, false, "NUCLEO_FAM=3 → false");
  } finally {
    rmSync(path, { force: true });
  }
});

test("NUCLEO_FAM=0 non produce viveSolo (dato non valido)", () => {
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;NUCLEO_FAM\n" +
    "U1;via X 1;1948;0\n";
  const path = tempCsv("nucleo-zero.csv", csv);
  try {
    const t = leggiCsv(path);
    const m = estraiMappatura(proponiMappatura(t.header, t.righe));
    const r = applicaMappatura(t.header, t.righe, m);
    assert.equal(r.persone.length, 1);
    assert.equal(r.persone[0]?.viveSolo, undefined, "NUCLEO_FAM=0 non è un booleano valido");
  } finally {
    rmSync(path, { force: true });
  }
});

test("SOLO_SN con valori S/N produce vive_solo booleano (non passa per NUCLEO_FAM)", () => {
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;SOLO_SN\n" +
    "U1;via X 1;1948;S\n" +
    "U2;via Y 2;1950;N\n";
  const path = tempCsv("solo-sn.csv", csv);
  try {
    const t = leggiCsv(path);
    const m = estraiMappatura(proponiMappatura(t.header, t.righe));
    const r = applicaMappatura(t.header, t.righe, m);
    assert.equal(r.persone[0]?.viveSolo, true);
    assert.equal(r.persone[1]?.viveSolo, false);
  } finally {
    rmSync(path, { force: true });
  }
});

// ----------------------------------------- rilevatore duplicati

test("segnala stesso id_esterno come duplicato", () => {
  const a: PersonaIn = { idEsterno: "U1", indirizzo: "via X 1", annoNascita: 1948 };
  const b: PersonaIn = { idEsterno: "U1", indirizzo: "via Y 2", annoNascita: 1950 };
  const d = trovaDuplicati([a, b]);
  assert.equal(d.length, 1);
  assert.match(d[0]!.motivo, /stesso id_esterno/);
});

test("segnala stesso indirizzo e anno ±1 come possibile duplicato", () => {
  const a: PersonaIn = { idEsterno: "U1", indirizzo: "Via Roma, 12", annoNascita: 1948 };
  const b: PersonaIn = { idEsterno: "U2", indirizzo: "via roma 12", annoNascita: 1949 };
  const d = trovaDuplicati([a, b]);
  assert.equal(d.length, 1);
  assert.match(d[0]!.motivo, /stesso indirizzo/);
});

test("NON fonde: restituisce coppie candidate ma i record restano separati", () => {
  const a: PersonaIn = { idEsterno: "U1", indirizzo: "via X 1", annoNascita: 1948 };
  const b: PersonaIn = { idEsterno: "U1", indirizzo: "via X 1", annoNascita: 1948 };
  const d = trovaDuplicati([a, b]);
  assert.equal(d.length, 1);
  // a e b restano oggetti distinti, l'output è solo la coppia
  assert.notEqual(d[0]!.a, d[0]!.b);
});

// ------------------------- proprietà onesta di proponiMappatura

test("distingue fonte 'nome' da fonte 'valore' nelle proposte", () => {
  // COD_UT e RESIDENZA matchano per nome; ANNO_ANONIMO ha valori 4 cifre → valore.
  const csv =
    "COD_UT;RESIDENZA;ANNO_ANONIMO\n" +
    "U1;via X 1;1948\n" +
    "U2;via Y 2;1950\n";
  const path = tempCsv("fonti.csv", csv);
  try {
    const t = leggiCsv(path);
    const p = proponiMappatura(t.header, t.righe);
    assert.equal(p.proposte["COD_UT"]?.fonte, "nome");
    assert.equal(p.proposte["RESIDENZA"]?.fonte, "nome");
    assert.equal(p.proposte["ANNO_ANONIMO"]?.fonte, "valore",
      "una colonna il cui nome non è nel dizionario ma i valori la rivelano deve essere marcata 'valore'");
  } finally {
    rmSync(path, { force: true });
  }
});

test("segnala conflitto quando due colonne mappano lo stesso campo", () => {
  // Sia COD_UT sia ID sono candidate per id_esterno: COD_UT vince per ordine,
  // ID finisce fra le scartate e in nonMappate.
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;ID\n" +
    "U1;via X 1;1948;9001\n";
  const path = tempCsv("conflitto.csv", csv);
  try {
    const t = leggiCsv(path);
    const p = proponiMappatura(t.header, t.righe);
    assert.equal(p.proposte["COD_UT"]?.campo, "id_esterno");
    assert.equal(p.proposte["ID"], undefined, "ID non deve essere assegnato silenziosamente");
    const c = p.conflitti.find((x) => x.campo === "id_esterno");
    assert.ok(c, "il conflitto su id_esterno deve essere presente");
    assert.equal(c?.scelta, "COD_UT");
    assert.ok(c?.scartate.includes("ID"));
    assert.ok(p.nonMappate.includes("ID"));
  } finally {
    rmSync(path, { force: true });
  }
});

test("elenca in nonMappate le colonne che nessuna regola ha risolto", () => {
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;NOTE_LIBERE;PATOLOGIE_VARIE\n" +
    "U1;via X 1;1948;paziente collaborativo;ipertensione\n";
  const path = tempCsv("non-mappate.csv", csv);
  try {
    const t = leggiCsv(path);
    const p = proponiMappatura(t.header, t.righe);
    assert.ok(p.nonMappate.includes("NOTE_LIBERE"));
    assert.ok(p.nonMappate.includes("PATOLOGIE_VARIE"));
    assert.equal(p.proposte["NOTE_LIBERE"], undefined);
    assert.equal(p.proposte["PATOLOGIE_VARIE"], undefined);
    // e le altre restano mappate come sempre
    assert.equal(p.proposte["COD_UT"]?.campo, "id_esterno");
  } finally {
    rmSync(path, { force: true });
  }
});

test("SEGNALATO_DA_MMG (S/N) resta mappato a segnalato_da_mmg con fonte 'nome'", () => {
  // Regressione che avevo individuato: se togliessi la regex nome per mmg, i
  // valori S/N verrebbero mappati per valore a vive_solo. Oggi la regex nome
  // c'è, quindi 'nome' vince su 'valore' (priorità sancita nel pass 4).
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;SEGNALATO_DA_MMG\n" +
    "U1;via X 1;1948;S\n" +
    "U2;via Y 2;1950;N\n";
  const path = tempCsv("mmg-nome.csv", csv);
  try {
    const t = leggiCsv(path);
    const p = proponiMappatura(t.header, t.righe);
    assert.equal(p.proposte["SEGNALATO_DA_MMG"]?.campo, "segnalato_da_mmg");
    assert.equal(p.proposte["SEGNALATO_DA_MMG"]?.fonte, "nome");
    // vive_solo deve restare non assegnato (nessuna colonna vive_solo/solo/NUCLEO)
    const viveSoloAssegnataA = Object.entries(p.proposte)
      .find(([_, v]) => v.campo === "vive_solo")?.[0];
    assert.equal(viveSoloAssegnataA, undefined,
      "nessuna colonna doveva ereditare vive_solo per valore quando SEGNALATO_DA_MMG matcha per nome");
  } finally {
    rmSync(path, { force: true });
  }
});

test("colonna S/N senza regola nome viene assegnata per valore a vive_solo, non silenziosamente ad altro", () => {
  // Scenario simulato di degradazione: una colonna dal nome opaco (X_SN) con
  // valori S/N. Non c'è regex nome che la catturi, ma la regola valore per
  // vive_solo scatta. L'operatore vede la mappatura con fonte "valore" e
  // può intercettare l'errore. Nessuna assegnazione silenziosa a un altro campo.
  const csv =
    "COD_UT;RESIDENZA;ANNO_N;X_SN\n" +
    "U1;via X 1;1948;S\n" +
    "U2;via Y 2;1950;N\n";
  const path = tempCsv("x-sn.csv", csv);
  try {
    const t = leggiCsv(path);
    const p = proponiMappatura(t.header, t.righe);
    // vive_solo è libero (nessuna regola nome ha catturato X_SN), quindi la
    // regola valore la assegna: cosa che l'operatore intercetta grazie a fonte.
    assert.equal(p.proposte["X_SN"]?.campo, "vive_solo");
    assert.equal(p.proposte["X_SN"]?.fonte, "valore",
      "l'operatore DEVE vedere 'valore' per sospettare");
    // e non doveva finire in nonMappate né in conflitti spuri
    assert.ok(!p.nonMappate.includes("X_SN"));
  } finally {
    rmSync(path, { force: true });
  }
});
