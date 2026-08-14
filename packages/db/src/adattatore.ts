/**
 * CheCaldo! — adattatore CSV/XLSX per l'anagrafe.
 *
 * Riceve un file di anagrafe di un'organizzazione, propone una mappatura
 * fra le colonne sorgente e i campi minimi del modello (nessun LLM: nomi
 * colonne + primi valori). L'operatore conferma la mappatura, l'adattatore
 * emette PersonaIn[] con i soli campi minimi e opzionali. Il resto viene
 * scartato: diagnosi, note, situazione familiare NON entrano nel modello.
 *
 * L'agente di mappatura (MOD06) si innesta SOPRA questa euristica e non al
 * suo posto — il modulo funziona anche senza modello.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import { parse as parseCsvSync } from "csv-parse/sync";
import * as XLSX from "xlsx";

// --------------------------------------------------------------------- tipi

export type CampoMinimo =
  | "id_esterno"
  | "indirizzo"
  | "sezione_censimento"
  | "anno_nascita"
  | "fascia_eta"
  | "vive_solo"
  | "piano"
  | "ascensore"
  | "data_ultimo_contatto"
  | "segnalato_da_mmg";

/**
 * Mappatura confermata dall'operatore: nome colonna sorgente → campo del modello.
 * Struttura piatta, serializzabile. Input di `applicaMappatura`.
 */
export interface Mappatura {
  [colonnaSorgente: string]: CampoMinimo;
}

/** Come una colonna è stata associata a un campo: match sul nome o sui valori. */
export type FonteMappatura = "nome" | "valore";

/**
 * Output di `proponiMappatura`: quello che l'operatore vede prima di confermare.
 * Distingue le proposte per fonte (nome ≠ valore = livello di confidenza),
 * elenca esplicitamente le colonne non mappate e i campi con più candidate.
 * Nessuna assegnazione silenziosa: chi legge questo può sempre spiegare perché
 * una colonna è finita dove è finita, o perché non ci è finita.
 */
export interface ProposteMappatura {
  /** Le proposte accettate, con la fonte di derivazione. */
  proposte: {
    [colonnaSorgente: string]: { campo: CampoMinimo; fonte: FonteMappatura };
  };
  /** Colonne che nessuna regola ha risolto: coda di conferma per l'operatore. */
  nonMappate: string[];
  /**
   * Campi per cui più di una colonna sarebbe stata candidata. `scelta`
   * indica quale è finita in `proposte`; le altre restano in `scartate`
   * e (di solito) anche in `nonMappate`.
   */
  conflitti: {
    campo: CampoMinimo;
    scelta: string;
    scartate: string[];
  }[];
}

/**
 * Persona come esce dall'adattatore, prima della geocodifica.
 * Deve avere almeno `indirizzo` o `sezione_censimento`.
 * La normalizzazione a `Persona` di @checaldo/scoring avviene dopo la
 * geocodifica: chi non risolve va in coda con `posizione_incerta = true`.
 */
export interface PersonaIn {
  idEsterno: string;
  indirizzo?: string;
  sezioneCensimento?: string;
  annoNascita?: number;
  fasciaEta?: "65-74" | "75-84" | "85+";
  viveSolo?: boolean;
  piano?: number;
  ascensore?: boolean;
  dataUltimoContatto?: string;
  segnalatoDaMmg?: boolean;
}

export interface RigaScartata {
  numero: number;
  motivo: string;
}

export interface RisultatoImport {
  persone: PersonaIn[];
  righeScartate: RigaScartata[];
  colonneIgnorate: string[];
  mappaturaUsata: Mappatura;
}

// ------------------------------------------------------ lettura CSV / XLSX

export type Separatore = "," | ";" | "\t";

/**
 * Rileva il separatore dominante nella prima riga significativa.
 * Non guarda solo la header: alcune header hanno spazi che confondono.
 * Conta le occorrenze nelle prime 5 righe e sceglie il maggioritario.
 */
export function rilevaSeparatore(testo: string): Separatore {
  const primeRighe = testo.split(/\r?\n/).filter((r) => r.trim()).slice(0, 5);
  const conteggi: Record<Separatore, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const r of primeRighe) {
    for (const c of [",", ";", "\t"] as Separatore[]) {
      conteggi[c] += (r.match(new RegExp(c === "\t" ? "\\t" : `\\${c}`, "g")) || []).length;
    }
  }
  const best = (Object.entries(conteggi) as [Separatore, number][])
    .sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

export interface Tabella {
  header: string[];
  righe: string[][];
}

export function leggiCsv(path: string, separatore?: Separatore): Tabella {
  const testo = readFileSync(path, "utf8");
  const sep = separatore ?? rilevaSeparatore(testo);
  const records: string[][] = parseCsvSync(testo, {
    delimiter: sep,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  if (records.length === 0) return { header: [], righe: [] };
  const [header, ...righe] = records;
  return { header: header ?? [], righe };
}

export function leggiXlsx(path: string): Tabella {
  const wb = XLSX.readFile(path);
  const primoFoglio = wb.SheetNames[0];
  if (!primoFoglio) return { header: [], righe: [] };
  const ws = wb.Sheets[primoFoglio];
  if (!ws) return { header: [], righe: [] };
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1, raw: false, defval: "",
  });
  if (rows.length === 0) return { header: [], righe: [] };
  const [header, ...righe] = rows;
  return {
    header: (header ?? []).map((h) => String(h ?? "").trim()),
    righe: righe.map((r) => r.map((c) => String(c ?? "").trim())),
  };
}

// ---------------------------------------------------- euristica di mappatura

const REGOLE_NOME: { campo: CampoMinimo; regex: RegExp }[] = [
  { campo: "id_esterno", regex: /^(id|cod|cod[_ ]?ut|codice[_ ]?utente|matricola|utente)$/i },
  { campo: "indirizzo", regex: /^(indirizzo|residenza|via|address|domicilio)$/i },
  { campo: "sezione_censimento", regex: /^(sezione|sez|sez21|sezione[_ ]?censimento|sez21[_ ]?id)$/i },
  { campo: "anno_nascita", regex: /^(anno[_ ]?n|anno[_ ]?nascita|nato[_ ]?nel|year)$/i },
  { campo: "fascia_eta", regex: /^(fascia|fascia[_ ]?eta|eta)$/i },
  { campo: "vive_solo", regex: /^(vive[_ ]?solo|solo|solitudine|solo[_ ]?sn|singleton|nucleo|nucleo[_ ]?fam|nucleo[_ ]?familiare|componenti)$/i },
  { campo: "piano", regex: /^(piano|floor)$/i },
  { campo: "ascensore", regex: /^(ascensore|elevator|asc)$/i },
  { campo: "data_ultimo_contatto", regex: /^(data[_ ]?ult[_ ]?cont|ultimo[_ ]?contatto|dt[_ ]?ult[_ ]?cont|last[_ ]?contact)$/i },
  { campo: "segnalato_da_mmg", regex: /^(segnalato[_ ]?(da[_ ]?)?mmg|mmg|medico|segnal[_ ]?mmg|flag[_ ]?mmg)$/i },
];

// Tolleranza aggiuntiva: NUCLEO_FAM con solo valori 1 → vive_solo
const REGOLE_VALORE: { campo: CampoMinimo; test: (valori: string[]) => boolean }[] = [
  {
    campo: "anno_nascita",
    test: (v) => v.length > 0 && v.every((x) => /^(19\d{2}|20[0-1]\d)$/.test(x.trim())),
  },
  {
    campo: "vive_solo",
    test: (v) => v.length > 0 && v.every((x) => /^([sn]|s[iì]|no|true|false|0|1)$/i.test(x.trim())),
  },
  {
    campo: "data_ultimo_contatto",
    test: (v) => v.length > 0 && v.every((x) => /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(x.trim()) || /^\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}$/.test(x.trim())),
  },
  {
    campo: "piano",
    test: (v) => v.length > 0 && v.every((x) => /^-?\d{1,2}$/.test(x.trim()) && Number(x) >= -3 && Number(x) <= 30),
  },
];

interface Candidata {
  colonna: string;
  campo: CampoMinimo;
  fonte: FonteMappatura;
}

/**
 * Propone una mappatura colonne → campi minimi.
 *
 * Algoritmo, in un giro:
 *   1. raccolgo le candidature (match nome per ogni colonna; match valore
 *      solo per le colonne senza match nome — la fonte "nome" è più
 *      affidabile e non va sostituita da un'euristica sui valori);
 *   2. assegno per ordine header, dando priorità "nome" > "valore" e
 *      rispettando l'unicità (un campo mappa una sola colonna);
 *   3. registro come conflitto ogni campo con più di una colonna candidata;
 *   4. registro come nonMappate ogni colonna non finita in `proposte`.
 *
 * Chi legge il risultato può sempre spiegare perché una colonna è finita
 * dove è finita, o perché non ci è finita. L'operatore conferma o corregge.
 */
export function proponiMappatura(header: string[], righe: string[][]): ProposteMappatura {
  // -- pass 1: candidature per nome
  const candidatePerColonna = new Map<string, Candidata[]>();
  for (const nome of header) {
    if (!nome) continue;
    const lista: Candidata[] = [];
    for (const { campo, regex } of REGOLE_NOME) {
      if (regex.test(nome.trim())) {
        lista.push({ colonna: nome, campo, fonte: "nome" });
      }
    }
    candidatePerColonna.set(nome, lista);
  }

  // -- pass 2: candidature per valore, solo dove il nome non ha detto nulla
  for (let i = 0; i < header.length; i++) {
    const nome = header[i];
    if (!nome) continue;
    const gia = candidatePerColonna.get(nome) ?? [];
    if (gia.length > 0) continue;
    const valori = righe
      .map((r) => r[i] ?? "")
      .filter((v) => v.trim() !== "")
      .slice(0, 20);
    if (valori.length === 0) continue;
    for (const { campo, test } of REGOLE_VALORE) {
      if (test(valori)) gia.push({ colonna: nome, campo, fonte: "valore" });
    }
    candidatePerColonna.set(nome, gia);
  }

  // -- pass 3: raggruppa per campo per rilevare i conflitti
  const perCampo = new Map<CampoMinimo, Candidata[]>();
  for (const cands of candidatePerColonna.values()) {
    for (const c of cands) {
      const arr = perCampo.get(c.campo) ?? [];
      arr.push(c);
      perCampo.set(c.campo, arr);
    }
  }

  // -- pass 4: assegna. Priorità "nome" > "valore", ordine header stabile.
  const proposte: ProposteMappatura["proposte"] = {};
  const usati = new Set<CampoMinimo>();

  // Prima le colonne con match nome (in ordine header)
  for (const nome of header) {
    if (!nome) continue;
    const cands = candidatePerColonna.get(nome) ?? [];
    const primoNome = cands.find((c) => c.fonte === "nome");
    if (primoNome && !usati.has(primoNome.campo)) {
      proposte[nome] = { campo: primoNome.campo, fonte: "nome" };
      usati.add(primoNome.campo);
    }
  }
  // Poi le colonne con match valore (in ordine header)
  for (const nome of header) {
    if (!nome || proposte[nome]) continue;
    const cands = candidatePerColonna.get(nome) ?? [];
    const primoValore = cands.find((c) => c.fonte === "valore");
    if (primoValore && !usati.has(primoValore.campo)) {
      proposte[nome] = { campo: primoValore.campo, fonte: "valore" };
      usati.add(primoValore.campo);
    }
  }

  // -- pass 5: conflitti e nonMappate
  const conflitti: ProposteMappatura["conflitti"] = [];
  for (const [campo, cands] of perCampo) {
    // Un vero conflitto è quando più colonne diverse puntano allo stesso campo
    const colonneDistinte = [...new Set(cands.map((c) => c.colonna))];
    if (colonneDistinte.length > 1) {
      const scelta = colonneDistinte.find((c) => proposte[c]?.campo === campo) ?? "";
      conflitti.push({
        campo,
        scelta,
        scartate: colonneDistinte.filter((c) => c !== scelta),
      });
    }
  }
  const proposteSet = new Set(Object.keys(proposte));
  const nonMappate = header.filter((h) => h && !proposteSet.has(h));

  return { proposte, nonMappate, conflitti };
}

/**
 * Estrae la mappatura piatta da una proposta, come farebbe un operatore che
 * conferma tutte le proposte senza modifiche. Utile a test e demo; in
 * produzione l'operatore modifica interattivamente.
 */
export function estraiMappatura(p: ProposteMappatura): Mappatura {
  const m: Mappatura = {};
  for (const [colonna, v] of Object.entries(p.proposte)) m[colonna] = v.campo;
  return m;
}

// ------------------------------------------------------------- coercizione

function parseBool(v: string): boolean | undefined {
  const t = v.trim().toLowerCase();
  if (t === "s" || t === "sì" || t === "si" || t === "true" || t === "1" || t === "yes" || t === "y") return true;
  if (t === "n" || t === "no" || t === "false" || t === "0") return false;
  return undefined;
}

/**
 * Interpretazione "numero di componenti del nucleo" come `vive_solo`:
 * 1 componente → true, N>1 → false, 0 → undefined (dato non valido).
 * Distinto da parseBool perché in un CSV reale ASCENSORE;0 significa
 * "senza ascensore", non "dato mancante".
 */
function parseComeSolo(v: string): boolean | undefined {
  const num = Number(v.trim());
  if (!Number.isInteger(num) || num < 1) return undefined;
  return num === 1;
}

/** Il campo sorgente esprime NUCLEO_FAM/componenti? */
function isColonnaNucleo(nomeSorgente: string | undefined): boolean {
  if (!nomeSorgente) return false;
  return /^(nucleo|nucleo[_ ]?fam|nucleo[_ ]?familiare|componenti)$/i.test(nomeSorgente.trim());
}

function parseAnno(v: string): number | undefined {
  const m = v.match(/^(19\d{2}|20[0-1]\d)$/);
  return m && m[1] ? Number(m[1]) : undefined;
}

function parseIntero(v: string): number | undefined {
  const m = v.trim().match(/^-?\d+$/);
  return m ? Number(m[0]) : undefined;
}

function parseData(v: string): string | undefined {
  const t = v.trim();
  const iso = t.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso && iso[1]) return iso[1];
  const eu = t.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
  if (eu) {
    const [_, dd, mm, aa] = eu;
    if (!dd || !mm || !aa) return undefined;
    const anno = aa.length === 2 ? (Number(aa) > 30 ? 1900 + Number(aa) : 2000 + Number(aa)) : Number(aa);
    return `${anno}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return undefined;
}

// -------------------------------------------- applicazione della mappatura

/**
 * Applica la mappatura confermata e produce PersonaIn[].
 * Righe senza `id_esterno` o senza `indirizzo`/`sezione_censimento` vengono
 * scartate con motivazione. Le colonne non mappate vengono elencate a parte.
 */
export function applicaMappatura(
  header: string[],
  righe: string[][],
  mappatura: Mappatura,
): RisultatoImport {
  const invMap = new Map<CampoMinimo, number>();
  const nomeSorgentePer = new Map<CampoMinimo, string>();
  for (const [colonna, campo] of Object.entries(mappatura)) {
    const idx = header.indexOf(colonna);
    if (idx >= 0) {
      invMap.set(campo, idx);
      nomeSorgentePer.set(campo, colonna);
    }
  }

  const persone: PersonaIn[] = [];
  const righeScartate: RigaScartata[] = [];

  const cell = (r: string[], campo: CampoMinimo): string | undefined => {
    const i = invMap.get(campo);
    if (i === undefined) return undefined;
    const v = r[i];
    return v && v.trim() !== "" ? v.trim() : undefined;
  };

  for (let i = 0; i < righe.length; i++) {
    const r = righe[i] ?? [];
    const idEsterno = cell(r, "id_esterno");
    if (!idEsterno) {
      righeScartate.push({ numero: i + 2, motivo: "id_esterno mancante" });
      continue;
    }
    const indirizzo = cell(r, "indirizzo");
    const sezione = cell(r, "sezione_censimento");
    if (!indirizzo && !sezione) {
      righeScartate.push({
        numero: i + 2,
        motivo: "né indirizzo né sezione_censimento",
      });
      continue;
    }

    const annoRaw = cell(r, "anno_nascita");
    const fasciaRaw = cell(r, "fascia_eta");
    const anno = annoRaw ? parseAnno(annoRaw) : undefined;
    const fascia = fasciaRaw && /^(65-74|75-84|85\+)$/.test(fasciaRaw)
      ? fasciaRaw as "65-74" | "75-84" | "85+"
      : undefined;
    if (anno === undefined && fascia === undefined) {
      righeScartate.push({
        numero: i + 2,
        motivo: "né anno_nascita né fascia_eta validi",
      });
      continue;
    }

    const p: PersonaIn = { idEsterno };
    if (indirizzo) p.indirizzo = indirizzo;
    if (sezione) p.sezioneCensimento = sezione;
    if (anno !== undefined) p.annoNascita = anno;
    if (fascia !== undefined) p.fasciaEta = fascia;

    const solo = cell(r, "vive_solo");
    if (solo !== undefined) {
      const b = isColonnaNucleo(nomeSorgentePer.get("vive_solo"))
        ? parseComeSolo(solo)
        : parseBool(solo);
      if (b !== undefined) p.viveSolo = b;
    }
    const piano = cell(r, "piano");
    if (piano !== undefined) {
      const n = parseIntero(piano);
      if (n !== undefined) p.piano = n;
    }
    const asc = cell(r, "ascensore");
    if (asc !== undefined) {
      const b = parseBool(asc);
      if (b !== undefined) p.ascensore = b;
    }
    const dult = cell(r, "data_ultimo_contatto");
    if (dult !== undefined) {
      const d = parseData(dult);
      if (d) p.dataUltimoContatto = d;
    }
    const mmg = cell(r, "segnalato_da_mmg");
    if (mmg !== undefined) {
      const b = parseBool(mmg);
      if (b !== undefined) p.segnalatoDaMmg = b;
    }

    persone.push(p);
  }

  const mappate = new Set(Object.keys(mappatura));
  const colonneIgnorate = header.filter((h) => h && !mappate.has(h));

  return {
    persone,
    righeScartate,
    colonneIgnorate,
    mappaturaUsata: mappatura,
  };
}

// ----------------------------------------------------------------- facade

/**
 * Import completo: legge file (CSV o XLSX), propone la mappatura, la applica.
 * Utile per test e come sequenza di riferimento. In produzione l'operatore
 * si interpone fra `proponiMappatura` e `applicaMappatura` per confermarla.
 */
export function importaFile(path: string): RisultatoImport {
  const ext = path.toLowerCase().slice(path.lastIndexOf("."));
  const t: Tabella = ext === ".xlsx" || ext === ".xls"
    ? leggiXlsx(path)
    : leggiCsv(path);
  const mappatura = estraiMappatura(proponiMappatura(t.header, t.righe));
  return applicaMappatura(t.header, t.righe, mappatura);
}
