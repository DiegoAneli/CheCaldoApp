// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CheCaldo! — motore di punteggio.
 *
 * Somma pesata su ranghi percentili, non prodotto di valori normalizzati:
 * il prodotto collassa verso zero e amplifica il rumore del fattore più piccolo.
 *
 * Il punteggio è un percentile sul comune, non una misura fisica. Va detto
 * nell'interfaccia.
 */

import {
  Allerta, Azione, FattoreSpiegabile, Pesi, PESI_DEFAULT, Persona,
  PersonaValutata, Sezione, SezioneValutata, TIPI_FRESCHI, TipoSegnale,
  TIPO_RESIDENZIALE, isSezioneFittizia,
} from "./types";

export * from "./types";

/**
 * Rango percentile di v nell'insieme ordinato xs.
 * Restituisce 0.5 quando l'insieme non discrimina, così un fattore piatto
 * non sposta la classifica invece di rompere il calcolo.
 */
export function rangoPercentile(v: number, xs: number[]): number {
  if (xs.length < 2) return 0.5;
  const min = xs[0];
  const max = xs[xs.length - 1];
  if (min === max) return 0.5;
  let sotto = 0;
  let pari = 0;
  for (const x of xs) {
    if (x < v) sotto++;
    else if (x === v) pari++;
  }
  return (sotto + pari / 2) / xs.length;
}

/** Fattori realmente presenti nei dati, per rinormalizzare i pesi. */
function fattoriPresenti(sezioni: Sezione[]) {
  return {
    isolamento: sezioni.some((s) => s.famiglie > 0),
    densitaCostruita: sezioni.some((s) => s.edificiResidenziali > 0),
    lontananzaDalFresco: sezioni.some((s) => s.metriDaPuntoFresco != null),
    esposizioneTermica: sezioni.some((s) => s.deltaTermico != null),
  };
}

/**
 * Valuta le sezioni residenziali abitate di un comune.
 *
 * Esclude le sezioni fittizie: contengono persone senza dimora collocate da
 * ISTAT in un'area disabitata, di norma un parco urbano. Se restassero,
 * avrebbero il punteggio termico più basso possibile pur ospitando
 * persone tra le più esposte. È un limite da dichiarare, non da nascondere.
 */
export function valutaSezioni(
  sezioni: Sezione[],
  pesi: Pesi = PESI_DEFAULT,
): SezioneValutata[] {
  const abitate = sezioni.filter(
    (s) =>
      !isSezioneFittizia(s.id.split("-").pop() ?? s.id) &&
      s.tipoSezione === TIPO_RESIDENZIALE &&
      s.popolazione > 0 &&
      s.famiglie > 0,
  );
  if (abitate.length === 0) return [];

  const presenti = fattoriPresenti(abitate);
  const sommaPesi =
    (presenti.isolamento ? pesi.isolamento : 0) +
    (presenti.densitaCostruita ? pesi.densitaCostruita : 0) +
    (presenti.lontananzaDalFresco ? pesi.lontananzaDalFresco : 0) +
    (presenti.esposizioneTermica ? pesi.esposizioneTermica : 0);
  if (sommaPesi === 0) return [];

  const asc = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const isoXs = asc(abitate.map((s) => s.popolazione / s.famiglie));
  const denXs = asc(
    abitate.filter((s) => s.edificiResidenziali > 0)
      .map((s) => s.abitazioni / s.edificiResidenziali),
  );
  const fresXs = asc(
    abitate.filter((s) => s.metriDaPuntoFresco != null)
      .map((s) => s.metriDaPuntoFresco!),
  );
  const termXs = asc(
    abitate.filter((s) => s.deltaTermico != null).map((s) => s.deltaTermico!),
  );

  return abitate.map((s) => {
    const dimFam = s.popolazione / s.famiglie;
    const abiEdi = s.edificiResidenziali > 0
      ? s.abitazioni / s.edificiResidenziali
      : 0;

    // Famiglie piccole significano più persone sole: il rango si inverte.
    const rIso = 1 - rangoPercentile(dimFam, isoXs);
    const rDen = s.edificiResidenziali > 0
      ? rangoPercentile(abiEdi, denXs)
      : 0.5;
    const rFres = s.metriDaPuntoFresco != null
      ? rangoPercentile(s.metriDaPuntoFresco, fresXs)
      : 0.5;
    const rTerm = s.deltaTermico != null
      ? rangoPercentile(s.deltaTermico, termXs)
      : undefined;

    let acc = 0;
    const disponibili: string[] = [];
    if (presenti.isolamento) {
      acc += pesi.isolamento * rIso;
      disponibili.push("isolamento");
    }
    if (presenti.densitaCostruita) {
      acc += pesi.densitaCostruita * rDen;
      disponibili.push("densitaCostruita");
    }
    if (presenti.lontananzaDalFresco) {
      acc += pesi.lontananzaDalFresco * rFres;
      disponibili.push("lontananzaDalFresco");
    }
    if (presenti.esposizioneTermica && rTerm != null) {
      acc += pesi.esposizioneTermica * rTerm;
      disponibili.push("esposizioneTermica");
    }

    return {
      ...s,
      dimensioneFamiglia: dimFam,
      abitazioniPerEdificio: abiEdi,
      rango: {
        isolamento: rIso,
        densitaCostruita: rDen,
        lontananzaDalFresco: rFres,
        esposizioneTermica: rTerm,
      },
      punteggio: acc / sommaPesi,
      fattoriDisponibili: disponibili,
    };
  });
}

/** Sezioni che offrono raffrescamento, per il calcolo delle distanze. */
export function sezioniFresche(sezioni: Sezione[]): Sezione[] {
  return sezioni.filter((s) => TIPI_FRESCHI.has(s.tipoSezione));
}

function fasciaDa(p: Persona): "65-74" | "75-84" | "85+" | undefined {
  if (p.fasciaEta) return p.fasciaEta;
  if (p.annoNascita == null) return undefined;
  const eta = new Date().getUTCFullYear() - p.annoNascita;
  if (eta >= 85) return "85+";
  if (eta >= 75) return "75-84";
  if (eta >= 65) return "65-74";
  return undefined;
}

const MOLT_ETA: Record<string, number> = {
  "65-74": 1.0,
  "75-84": 1.30,
  "85+": 1.62,
};

const MOLT_SEGNALE: Record<string, number> = {
  nessuna_climatizzazione: 1.25,
  ventilatore_rotto: 1.18,
  rete_familiare_assente: 1.20,
  difficolta_mobilita: 1.15,
  nessun_contatto_riferito: 1.22,
  sintomi_riferiti: 1.45,
};

/**
 * Durata di validità di un segnale scritto dall'applicazione, in giorni.
 * Usata da `registraContatto` in packages/db per popolare `valido_fino`
 * alla scrittura di un nuovo segnale dal form volontario. `null` =
 * strutturale: nasce con `valido_fino = NULL` e resta valido finché
 * qualcuno non lo chiude esplicitamente (§12cccc).
 *
 * I tre valori numerici stanno **dentro** le finestre già usate dal
 * generatore fixture (`packages/fixtures/src/generatore.ts:168-175`):
 *   - `sintomi_riferiti` fixture 1-5 giorni → qui 3
 *   - `ventilatore_rotto` fixture 3-21 giorni → qui 14
 *   - `nessun_contatto_riferito` fixture 7-30 giorni → qui 21
 *
 * Sono una **convenzione operativa**, non un dato clinico e non
 * risultato di un ottimo aritmetico: scelti perché cadono
 * comodamente dentro le finestre fixture, così un segnale app-side
 * appena scritto non ha una scadenza fuori scala rispetto a un
 * segnale sintetico dello stesso tipo caricato nel canone. Se un
 * domani arriva un requisito clinico serio, questi numeri vanno
 * rimpiazzati da criteri documentati e i test in
 * `packages/scoring/test/durata-segnale.test.ts` andranno aggiornati.
 *
 * Il vincolo test "finestre allineate fixture ↔ scrittura" fa cadere
 * il test se una delle due sorgenti cambia senza l'altra.
 */
export const DURATA_SEGNALE_GIORNI: Record<TipoSegnale, number | null> = {
  sintomi_riferiti: 3,
  ventilatore_rotto: 14,
  nessun_contatto_riferito: 21,
  nessuna_climatizzazione: null,
  rete_familiare_assente: null,
  difficolta_mobilita: null,
};

function giorniDa(iso: string | undefined, oggi: Date): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.floor((oggi.getTime() - t) / 86_400_000));
}

function segnaliValidi(p: Persona, oggi: Date) {
  // Semantica DB-autoritativa (decisione registrata in CHECALDO-PROGETTO.md §6.7,
  // opzione A): valido_fino DATE significa "valido per l'intero calendar day".
  // Confronto lessicografico su stringhe ISO YYYY-MM-DD, allineato al predicato
  // SQL `valido_fino >= CURRENT_DATE`.
  const oggiIso = oggi.toISOString().slice(0, 10);
  return (p.segnali ?? []).filter(
    (s) => !s.validoFino || s.validoFino >= oggiIso,
  );
}

/**
 * Escalation. Chi non risponde non esce dalla lista: sale, e l'azione
 * richiesta cambia. Il volontario non decide l'intervento — decide che
 * serve qualcuno che decida.
 */
export function azionePer(p: Persona, oggi: Date): Azione {
  if (segnaliValidi(p, oggi).some((s) => s.tipo === "sintomi_riferiti")) {
    return "valutazione_coordinatore";
  }
  const t = p.tentativiFalliti ?? 0;
  if (t === 0) return "prima_chiamata";
  if (t === 1) return "seconda_chiamata";
  if (t === 2) return "contatto_familiare";
  return "visita_domiciliare";
}

/**
 * Capienza del giorno. Il livello di allerta non cambia l'ordine — è
 * costante su tutta la città — ma decide se il sistema si accende e fin
 * dove si scende nella lista. La decisione finale resta del coordinatore.
 */
export function capienzaSuggerita(
  allerta: Allerta,
  volontari: number,
  chiamatePerVolontario = 6,
): number {
  const base = Math.max(0, volontari) * chiamatePerVolontario;
  const q = { 0: 0.30, 1: 0.55, 2: 0.85, 3: 1.0 }[allerta.livello];
  const bonusNotti = Math.min(0.15, Math.max(0, allerta.nottiTropicali - 2) * 0.05);
  return Math.round(base * Math.min(1, q + bonusNotti));
}

export interface OpzioniClassifica {
  allerta: Allerta;
  soglia: number;
  oggi?: Date;
  /** Posizioni del giorno precedente, per il confronto nella motivazione. */
  posizioniIeri?: Map<string, number>;
}

/**
 * Classifica le persone di un'organizzazione.
 *
 * Restituisce anche i fattori che hanno prodotto ogni punteggio: sono l'unico
 * input dell'agente redattore, che non può usare numeri che non sono qui.
 */
export function classificaPersone(
  persone: Persona[],
  sezioni: SezioneValutata[],
  opz: OpzioniClassifica,
): PersonaValutata[] {
  const oggi = opz.oggi ?? new Date();
  const perId = new Map(sezioni.map((s) => [s.id, s]));

  const valutate = persone.map((p) => {
    const sez = perId.get(p.sezioneId);
    const base = sez?.punteggio ?? 0.5;
    const fattori: FattoreSpiegabile[] = [];

    fattori.push({
      chiave: "punteggio_sezione",
      valore: Number(base.toFixed(3)),
      contributo: base,
      fonte: "istat",
    });
    if (sez) {
      fattori.push({
        chiave: "persone_per_famiglia",
        valore: Number(sez.dimensioneFamiglia.toFixed(2)),
        contributo: sez.rango.isolamento,
        fonte: "istat",
      });
      // Esposto se la sezione ha edifici residenziali (denominatore > 0);
      // in caso contrario abitazioniPerEdificio = 0 e non discrimina.
      if (sez.edificiResidenziali > 0) {
        fattori.push({
          chiave: "abitazioni_per_edificio",
          valore: Number(sez.abitazioniPerEdificio.toFixed(2)),
          contributo: sez.rango.densitaCostruita,
          fonte: "istat",
        });
      }
      if (sez.metriDaPuntoFresco != null) {
        fattori.push({
          chiave: "metri_da_punto_fresco",
          valore: Math.round(sez.metriDaPuntoFresco),
          unita: "metri",
          contributo: sez.rango.lontananzaDalFresco,
          fonte: "istat",
        });
      }
      if (sez.rango.esposizioneTermica != null && sez.deltaTermico != null) {
        fattori.push({
          chiave: "delta_termico",
          valore: Number(sez.deltaTermico.toFixed(1)),
          unita: "°C",
          contributo: sez.rango.esposizioneTermica,
          fonte: "satellite",
        });
      }
    }

    let punteggio = base;

    const fascia = fasciaDa(p);
    if (fascia) {
      const m = MOLT_ETA[fascia];
      if (m !== undefined) {
        punteggio *= m;
        fattori.push({ chiave: "fascia_eta", valore: fascia, contributo: m, fonte: "organizzazione" });
      }
    }

    if (p.viveSolo) {
      punteggio *= 1.42;
      fattori.push({ chiave: "vive_solo", valore: true, contributo: 1.42, fonte: "organizzazione" });
    }

    const gg = giorniDa(p.dataUltimoContatto, oggi);
    if (gg != null) {
      // Calibrazione: 0.75 + min(gg,30)/120, range [0.75, 1.00]. Verso
      // invertito rispetto alla prima calibrazione di §12jjj
      // (1 + min(gg,30)/75, range [1.00, 1.40]).
      //
      // Perché il verso invertito (§12jjj revisione): con il verso
      // originale, NULL e "contatto oggi" ricevevano entrambi
      // moltiplicatore 1.00 — il dato mancante veniva trattato come
      // "vista oggi", il default sbagliato. La classifica era dominata
      // dalle 342/500 persone con anagrafe completa (moltiplicatore
      // fino a 1.40), le 158 NULL scendevano in blocco per assenza di
      // informazione, non per bisogno inferiore.
      //
      // Col verso invertito: modifichiamo il punteggio solo dove c'è
      // dato certo (contatto recente). NULL e contatto ≥ 30 giorni fa
      // stanno entrambi a 1.00 — nessuna penalità per l'ignoranza,
      // nessun premio per l'ignoranza. L'unico gruppo spostato è
      // quello di cui sappiamo con certezza che è stato visto da poco.
      // A gg=0 il moltiplicatore è 0.75 — un quarto in meno di
      // punteggio: la certezza recente rilassa la priorità, non la
      // azzera.
      //
      // Ricalibrato in una sessione dove il codice non era mai stato
      // eseguito in produzione (personePerClassifica non popolava il
      // campo) — tarare un ramo dormiente, non modificare il motore
      // in esercizio (vincolo 1).
      const m = 0.75 + Math.min(gg, 30) / 120;
      punteggio *= m;
      fattori.push({
        chiave: "giorni_da_ultimo_contatto",
        valore: gg,
        unita: "giorni",
        contributo: m,
        fonte: "organizzazione",
      });
    }

    const t = p.tentativiFalliti ?? 0;
    if (t > 0) {
      const m = 1 + t * 0.20;
      punteggio *= m;
      fattori.push({
        chiave: "tentativi_falliti",
        valore: t,
        contributo: m,
        fonte: "organizzazione",
      });
    }

    for (const s of segnaliValidi(p, oggi)) {
      const m = MOLT_SEGNALE[s.tipo] ?? 1;
      if (m !== 1) {
        punteggio *= m;
        fattori.push({ chiave: s.tipo, valore: s.origine, contributo: m, fonte: "segnale" });
      }
    }

    // La posizione incerta non sale in cima senza verifica umana.
    if (p.posizioneIncerta) punteggio *= 0.85;

    return { p, sez, punteggio, fattori };
  });

  valutate.sort((a, b) =>
    b.punteggio - a.punteggio || a.p.idEsterno.localeCompare(b.p.idEsterno)
  );

  return valutate.map((v, i) => ({
    idEsterno: v.p.idEsterno,
    sezioneId: v.p.sezioneId,
    quartiere: v.sez?.quartiere,
    punteggio: v.punteggio,
    posizione: i + 1,
    posizioneIeri: opz.posizioniIeri?.get(v.p.idEsterno),
    fattori: v.fattori,
    inListaOggi: i < opz.soglia,
    azione: azionePer(v.p, oggi),
  }));
}
