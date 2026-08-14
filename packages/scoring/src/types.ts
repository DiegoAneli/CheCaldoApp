// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CheCaldo! — tipi del motore di punteggio.
 *
 * Vincolo di progetto: questo package è deterministico e non importa nulla
 * da @checaldo/agents. Nessuna chiamata a modelli linguistici, mai.
 */

/** Provenienza del livello di allerta. Deve restare visibile fino all'interfaccia. */
export type ProvenienzaLivello = "bollettino" | "stima";

export interface Allerta {
  /** 0-3, secondo la scala del Ministero della Salute. */
  livello: 0 | 1 | 2 | 3;
  provenienza: ProvenienzaLivello;
  /** Data a cui il livello si riferisce, non quella di estrazione. */
  data: string;
  /** Orizzonte del bollettino usato: 24, 48 o 72 ore. */
  orizzonteOre: 24 | 48 | 72;
  /** Notti consecutive con minima sopra i 20 °C. */
  nottiTropicali: number;
  /** Link al bollettino di origine, quando esiste. */
  fonteUrl?: string;
}

/**
 * Indicatori di una sezione di censimento, tutti da dati aperti.
 * Nessun campo di questa interfaccia riguarda una persona.
 */
export interface Sezione {
  /** SEZ21_ID: codice nazionale della sezione. */
  id: string;
  /** COM_ASC1: area sub-comunale, dove disponibile. */
  quartiere?: string;
  /** POP21 */
  popolazione: number;
  /** FAM21 */
  famiglie: number;
  /** ABI21 */
  abitazioni: number;
  /** EDI21 */
  edificiResidenziali: number;
  /** COD_TIPO_S */
  tipoSezione: number;
  /** Metri dalla sezione verde o d'acqua più vicina. */
  metriDaPuntoFresco?: number;
  /**
   * Delta termico sulla media comunale, in gradi. Da strato satellitare
   * esterno. Assente finché non è collegato: il motore deve funzionare senza.
   */
  deltaTermico?: number;
}

/** Sezione con i suoi ranghi percentili calcolati sul comune. */
export interface SezioneValutata extends Sezione {
  /** POP21 / FAM21. Vicino a 1 significa molte persone sole. */
  dimensioneFamiglia: number;
  /** ABI21 / EDI21. Alto significa edifici densi. */
  abitazioniPerEdificio: number;
  rango: {
    isolamento: number;
    densitaCostruita: number;
    lontananzaDalFresco: number;
    esposizioneTermica?: number;
  };
  /** 0-1. È un percentile sul comune, non una misura fisica. */
  punteggio: number;
  fattoriDisponibili: string[];
}

/**
 * Persona in carico a un'organizzazione. Vive solo nell'istanza
 * dell'organizzazione: non transita mai altrove.
 */
export interface Persona {
  /** Chiave dell'organizzazione. Il sistema non genera identità. */
  idEsterno: string;
  sezioneId: string;
  annoNascita?: number;
  fasciaEta?: "65-74" | "75-84" | "85+";
  viveSolo?: boolean;
  piano?: number;
  ascensore?: boolean;
  dataUltimoContatto?: string;
  tentativiFalliti?: number;
  segnalatoDaMmg?: boolean;
  /** Segnali strutturati estratti dall'agente di triage. Mai testo libero. */
  segnali?: SegnaleAttivo[];
  /** True quando la geocodifica non ha risolto al civico. */
  posizioneIncerta?: boolean;
}

/**
 * Elenco chiuso dei tipi di segnale. Fonte autoritativa a runtime: il
 * validatore output dell'agente di triage (MOD06) importa questo array e
 * costruisce la whitelist con `new Set(TIPI_SEGNALE)`. Un tipo aggiunto qui
 * si propaga sia al tipo TS (via `typeof`) sia al filtro runtime. Un tipo
 * rimosso rompe i test negativi che lo citano — è la difesa contro la
 * divergenza silente fra motore e agenti.
 */
export const TIPI_SEGNALE = [
  "nessuna_climatizzazione",
  "ventilatore_rotto",
  "rete_familiare_assente",
  "difficolta_mobilita",
  "nessun_contatto_riferito",
  "sintomi_riferiti",
] as const;

export type TipoSegnale = typeof TIPI_SEGNALE[number];

export interface SegnaleAttivo {
  tipo: TipoSegnale;
  /** Scadenza del segnale, se temporaneo. */
  validoFino?: string;
  origine: "volontario" | "cittadino" | "mmg" | "coordinatore";
  /**
   * Data di creazione del segnale (ISO). Il motore non lo usa —
   * `giorniDa()` opera su `dataUltimoContatto` della persona, non
   * sull'età del segnale. Serve alla scheda persona (§12vvv) per
   * mostrare "dal 5 agosto" sotto la condizione. Opzionale così le
   * query che non lo caricano restano compatibili.
   */
  creatoIl?: string;
}

export interface PersonaValutata {
  idEsterno: string;
  sezioneId: string;
  quartiere?: string;
  punteggio: number;
  posizione: number;
  /** Posizione del giorno precedente, per il confronto nella motivazione. */
  posizioneIeri?: number;
  /**
   * Fattori che hanno prodotto il punteggio. È l'unico input che l'agente
   * redattore riceve: non può usare numeri che non sono qui.
   */
  fattori: FattoreSpiegabile[];
  /** True se rientra nella soglia operativa del giorno. */
  inListaOggi: boolean;
  /** Escalation: quale azione il volontario deve compiere. */
  azione: Azione;
}

export interface FattoreSpiegabile {
  chiave: string;
  valore: number | string | boolean;
  unita?: string;
  contributo: number;
  /** Da dove viene il dato. Serve al README e alla trasparenza. */
  fonte: "istat" | "organizzazione" | "segnale" | "allerta" | "satellite";
}

export type Azione =
  | "prima_chiamata"
  | "seconda_chiamata"
  | "contatto_familiare"
  | "visita_domiciliare"
  | "valutazione_coordinatore";

export interface Pesi {
  isolamento: number;
  densitaCostruita: number;
  lontananzaDalFresco: number;
  esposizioneTermica: number;
}

/** I pesi sono un giudizio, non un dato: non esiste verità con cui tararli. */
export const PESI_DEFAULT: Pesi = {
  isolamento: 0.40,
  densitaCostruita: 0.30,
  lontananzaDalFresco: 0.15,
  esposizioneTermica: 0.15,
};

/** Sezioni fittizie ISTAT: contengono persone reali in geometrie false. */
export function isSezioneFittizia(sez21: number | string): boolean {
  const n = Number(sez21);
  if (!Number.isFinite(n)) return false;
  return (n >= 8888881 && n <= 8888889) || n === 999999 || n === 9999998 || n === 9999999;
}

/** COD_TIPO_S delle sezioni che offrono raffrescamento. */
export const TIPI_FRESCHI = new Set([5, 22, 23]);
/** COD_TIPO_S residenziale. */
export const TIPO_RESIDENZIALE = 1;
