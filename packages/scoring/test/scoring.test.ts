// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Test del motore di punteggio.
 *
 * Fixture: le 1.667 sezioni reali del comune di Parma (PRO_COM 34027) dalle
 * basi territoriali ISTAT 2021. Nessun dato personale: solo conteggi
 * aggregati e codici di sezione, licenza CC-BY 4.0.
 *
 * Le persone sono generate con seed fisso.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Allerta, Persona, Sezione, azionePer, capienzaSuggerita,
  classificaPersone, rangoPercentile, valutaSezioni,
} from "../src/index";

const sezioni: (Sezione & { sez21: number })[] = JSON.parse(
  readFileSync(join(__dirname, "parma-sezioni.json"), "utf8"),
);

const allerta: Allerta = {
  livello: 2, provenienza: "stima", data: "2026-07-30",
  orizzonteOre: 24, nottiTropicali: 4,
};

// ---------------------------------------------------------------- ranghi

test("rangoPercentile ordina e gestisce gli estremi", () => {
  const xs = [1, 2, 3, 4, 5];
  assert.ok(rangoPercentile(1, xs) < rangoPercentile(5, xs));
  assert.ok(rangoPercentile(3, xs) > 0.4 && rangoPercentile(3, xs) < 0.6);
});

test("un fattore piatto non sposta la classifica invece di rompersi", () => {
  assert.equal(rangoPercentile(7, [7, 7, 7, 7]), 0.5);
  assert.equal(rangoPercentile(1, [1]), 0.5);
});

// ------------------------------------------------------- sezioni: filtri

test("esclude le sezioni fittizie e le non residenziali", () => {
  const v = valutaSezioni(sezioni);
  assert.equal(v.length, 1039, "attese 1039 sezioni residenziali abitate");
  assert.ok(
    !v.some((s) => Number(s.id.slice(-7)) >= 8888881),
    "nessuna sezione fittizia deve entrare nel punteggio",
  );
  assert.ok(v.every((s) => s.tipoSezione === 1 && s.popolazione > 0));
});

test("il punteggio resta nell'intervallo 0-1", () => {
  const v = valutaSezioni(sezioni);
  assert.ok(v.every((s) => s.punteggio >= 0 && s.punteggio <= 1));
});

test("dichiara quali fattori erano disponibili", () => {
  const v = valutaSezioni(sezioni);
  // Dopo MOD01 la fixture porta metriDaPuntoFresco dal DB: tre fattori
  // presenti. deltaTermico arriverà con lo strato satellitare in MOD futuro.
  assert.deepEqual(
    v[0].fattoriDisponibili,
    ["isolamento", "densitaCostruita", "lontananzaDalFresco"],
  );
});

// ------------------------------------------- sezioni: coerenza col reale

test("riproduce il gradiente centro-periferia di Parma", () => {
  const v = valutaSezioni(sezioni);
  const perQ = new Map<string, number[]>();
  for (const s of v) {
    if (!s.quartiere) continue;
    (perQ.get(s.quartiere) ?? perQ.set(s.quartiere, []).get(s.quartiere)!).push(s.punteggio);
  }
  const mediane = [...perQ.entries()].map(([q, xs]) => {
    const a = xs.sort((x, y) => x - y);
    return { q, m: a[Math.floor(a.length / 2)] };
  }).sort((a, b) => b.m - a.m);

  const primi = mediane.slice(0, 3).map((x) => x.q);
  const ultimi = mediane.slice(-3).map((x) => x.q);

  // Il centro storico ha famiglie piccole ed edilizia densa: deve stare in alto.
  assert.ok(
    primi.includes("Oltretorrente") || primi.includes("Parma Centro"),
    `atteso il centro tra i primi tre, ottenuto ${primi.join(", ")}`,
  );
  // Le zone rurali hanno famiglie grandi e case singole: devono stare in basso.
  assert.ok(
    ultimi.includes("Vigatto") || ultimi.includes("Golese"),
    `attese le zone rurali tra gli ultimi tre, ottenuto ${ultimi.join(", ")}`,
  );
});

test("l'isolamento è invertito: famiglie piccole valgono di più", () => {
  const v = valutaSezioni(sezioni);
  const ordinate = [...v].sort((a, b) => a.dimensioneFamiglia - b.dimensioneFamiglia);
  const piccole = ordinate.slice(0, 80);
  const grandi = ordinate.slice(-80);
  const media = (xs: typeof v) =>
    xs.reduce((a, s) => a + s.rango.isolamento, 0) / xs.length;
  assert.ok(media(piccole) > media(grandi));
});

// ----------------------------------------------------- capienza e soglia

test("il livello di allerta muove la capienza, non l'ordine", () => {
  const v = valutaSezioni(sezioni);
  const persone = generaPersone(v.map((s) => s.id), 300);

  const basso = classificaPersone(persone, v, {
    allerta: { ...allerta, livello: 1 }, soglia: 20, oggi: new Date("2026-07-30"),
  });
  const alto = classificaPersone(persone, v, {
    allerta: { ...allerta, livello: 3 }, soglia: 120, oggi: new Date("2026-07-30"),
  });

  assert.deepEqual(
    basso.map((p) => p.idEsterno),
    alto.map((p) => p.idEsterno),
    "l'ordine non deve dipendere dal livello",
  );
  assert.equal(basso.filter((p) => p.inListaOggi).length, 20);
  assert.equal(alto.filter((p) => p.inListaOggi).length, 120);
});

test("capienza crescente col livello, zero volontari zero chiamate", () => {
  const c = (l: 0 | 1 | 2 | 3) =>
    capienzaSuggerita({ ...allerta, livello: l, nottiTropicali: 0 }, 14);
  assert.ok(c(0) < c(1) && c(1) < c(2) && c(2) < c(3));
  assert.equal(capienzaSuggerita(allerta, 0), 0);
});

test("le notti tropicali consecutive alzano la capienza, entro un tetto", () => {
  const senza = capienzaSuggerita({ ...allerta, livello: 2, nottiTropicali: 0 }, 20);
  const con = capienzaSuggerita({ ...allerta, livello: 2, nottiTropicali: 6 }, 20);
  assert.ok(con > senza);
  assert.ok(con <= 20 * 6);
});

// ------------------------------------------------------------- spiegabilità

test("ogni persona porta i fattori che hanno prodotto il punteggio", () => {
  const v = valutaSezioni(sezioni);
  const p: Persona = {
    idEsterno: "X-1", sezioneId: v[0].id, fasciaEta: "85+",
    viveSolo: true, dataUltimoContatto: "2026-07-22",
    segnali: [{ tipo: "nessuna_climatizzazione", origine: "volontario" }],
  };
  const [r] = classificaPersone([p], v, {
    allerta, soglia: 1, oggi: new Date("2026-07-30"),
  });
  const chiavi = r.fattori.map((f) => f.chiave);
  assert.ok(chiavi.includes("punteggio_sezione"));
  assert.ok(chiavi.includes("fascia_eta"));
  assert.ok(chiavi.includes("vive_solo"));
  assert.ok(chiavi.includes("giorni_da_ultimo_contatto"));
  assert.ok(chiavi.includes("nessuna_climatizzazione"));
  // Nessun fattore satellitare: lo strato non è collegato.
  assert.ok(!chiavi.includes("delta_termico"));
  assert.ok(r.fattori.every((f) => f.fonte !== undefined));
});

test("un segnale scaduto non pesa più", () => {
  const v = valutaSezioni(sezioni);
  const base: Persona = { idEsterno: "A", sezioneId: v[0].id, fasciaEta: "75-84" };
  const conScaduto: Persona = {
    ...base, idEsterno: "B",
    segnali: [{ tipo: "ventilatore_rotto", origine: "cittadino", validoFino: "2026-07-01" }],
  };
  const oggi = new Date("2026-07-30");
  const [a] = classificaPersone([base], v, { allerta, soglia: 1, oggi });
  const [b] = classificaPersone([conScaduto], v, { allerta, soglia: 1, oggi });
  assert.equal(a.punteggio, b.punteggio);
});

// -------------------------------------------------------------- escalation

test("chi non risponde sale di azione, non esce dalla lista", () => {
  const oggi = new Date("2026-07-30");
  const s = (t: number): Persona => ({ idEsterno: "P", sezioneId: "x", tentativiFalliti: t });
  assert.equal(azionePer(s(0), oggi), "prima_chiamata");
  assert.equal(azionePer(s(1), oggi), "seconda_chiamata");
  assert.equal(azionePer(s(2), oggi), "contatto_familiare");
  assert.equal(azionePer(s(4), oggi), "visita_domiciliare");
});

test("i sintomi riferiti passano sempre al coordinatore", () => {
  const p: Persona = {
    idEsterno: "P", sezioneId: "x", tentativiFalliti: 0,
    segnali: [{ tipo: "sintomi_riferiti", origine: "volontario" }],
  };
  assert.equal(azionePer(p, new Date("2026-07-30")), "valutazione_coordinatore");
});

test("i tentativi falliti fanno risalire in classifica", () => {
  const v = valutaSezioni(sezioni);
  const a: Persona = { idEsterno: "A", sezioneId: v[500].id, fasciaEta: "75-84" };
  const b: Persona = { ...a, idEsterno: "B", tentativiFalliti: 3 };
  const r = classificaPersone([a, b], v, {
    allerta, soglia: 2, oggi: new Date("2026-07-30"),
  });
  assert.equal(r[0].idEsterno, "B");
});

// ------------------------------------------------------------ determinismo

test("stesso input, stesso output", () => {
  const v = valutaSezioni(sezioni);
  const persone = generaPersone(v.map((s) => s.id), 400);
  const opz = { allerta, soglia: 50, oggi: new Date("2026-07-30") };
  const a = classificaPersone(persone, v, opz).map((p) => p.idEsterno);
  const b = classificaPersone([...persone].reverse(), v, opz).map((p) => p.idEsterno);
  assert.deepEqual(a, b, "l'ordine non deve dipendere dall'ordine di ingresso");
});

test("la posizione incerta non sale in cima senza verifica", () => {
  const v = valutaSezioni(sezioni);
  const alta = v.reduce((m, s) => (s.punteggio > m.punteggio ? s : m));
  const certa: Persona = { idEsterno: "A", sezioneId: alta.id, fasciaEta: "85+", viveSolo: true };
  const incerta: Persona = { ...certa, idEsterno: "B", posizioneIncerta: true };
  const r = classificaPersone([certa, incerta], v, {
    allerta, soglia: 2, oggi: new Date("2026-07-30"),
  });
  assert.equal(r[0].idEsterno, "A");
});

// ------------------------------------------------------------------ helper

function generaPersone(sezioniIds: string[], n: number): Persona[] {
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const fasce = ["65-74", "75-84", "85+"] as const;
  return Array.from({ length: n }, (_, i) => ({
    idEsterno: `Persona ${String(i).padStart(4, "0")}`,
    sezioneId: sezioniIds[Math.floor(rnd() * sezioniIds.length)],
    fasciaEta: fasce[Math.floor(rnd() * 3)],
    viveSolo: rnd() < 0.45,
    tentativiFalliti: rnd() < 0.12 ? 1 : 0,
  }));
}
