// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import type { TipoSegnale } from "@checaldo/scoring";

// ------------------------------------------------------ modello domande

interface Opzione {
  label: string;
  value: string;
  /** Se selezionata scrive un record in riservato.segnale con questo tipo. */
  segnale?: TipoSegnale;
  /**
   * Se selezionata contribuisce a `nota_libera` come frase. Usato per
   * risposte "non ha bevuto/mangiato" che restano nota, non segnale
   * strutturato (decisione CHECALDO-PROGETTO.md §6.9/MOD03).
   */
  nota?: string;
  /** True se selezionandola l'esito "Sta bene" va disabilitato (sintomi). */
  bloccaStaBene?: true;
}

interface Domanda {
  id: string;
  testo: string;
  /**
   * Tipi di segnale che questa domanda **possiede** (§12xxx): il
   * dominio di condizioni che la risposta di oggi governa. Quando il
   * volontario risponde, ogni tipo in `possiede` viene chiuso, tranne
   * quello che l'opzione selezionata apre (`segnale`). Se `possiede`
   * è vuoto, la domanda non tocca nessun segnale (es. bevuto/mangiato).
   *
   * Regola equivalente: la risposta di oggi è verità aggiornata sul
   * dominio della domanda; le condizioni non affermate oggi si
   * intendono smentite.
   */
  possiede: TipoSegnale[];
  opzioni: Opzione[];
}

const DOMANDE: Domanda[] = [
  {
    id: "bevuto",
    testo: "Ha bevuto oggi?",
    possiede: [],
    opzioni: [
      { label: "Sì", value: "si" },
      { label: "No", value: "no", nota: "Non ha bevuto oggi." },
      { label: "Non lo sa", value: "non_lo_sa" },
    ],
  },
  {
    id: "climatizzazione",
    testo: "Ha il condizionatore o un ventilatore? Funziona?",
    possiede: ["nessuna_climatizzazione", "ventilatore_rotto"],
    opzioni: [
      { label: "Sì, ok", value: "ok" },
      { label: "Non funziona", value: "rotto", segnale: "ventilatore_rotto" },
      { label: "Non ce l'ha", value: "assente", segnale: "nessuna_climatizzazione" },
    ],
  },
  {
    id: "mangiato",
    // Riformulato "È riuscito a mangiare?" → "Ha mangiato oggi?":
    // il participio "riuscito" concorda al maschile e non funziona
    // per una persona femminile. La forma "Ha mangiato?" è coerente
    // col "lei" formale delle altre quattro domande e non ha genere.
    testo: "Ha mangiato oggi?",
    possiede: [],
    opzioni: [
      { label: "Sì", value: "si" },
      { label: "No", value: "no", nota: "Non ha mangiato." },
      { label: "Non lo sa", value: "non_lo_sa" },
    ],
  },
  {
    id: "aiuto",
    testo: "Ha qualcuno che può aiutarla?",
    possiede: ["rete_familiare_assente"],
    opzioni: [
      { label: "Sì, in famiglia", value: "familia" },
      { label: "Un vicino", value: "vicino" },
      { label: "Nessuno", value: "nessuno", segnale: "rete_familiare_assente" },
    ],
  },
  {
    id: "sintomi",
    testo: "Ha sintomi? Febbre, confusione, capogiri.",
    possiede: ["sintomi_riferiti"],
    opzioni: [
      { label: "No, sta bene", value: "no" },
      { label: "Sì, uno o più", value: "si", segnale: "sintomi_riferiti", bloccaStaBene: true },
    ],
  },
];

// ------------------------------------------------------ props e stato

export type Esito = "sta_bene" | "ha_bisogno" | "non_risponde";

export interface RegistraArgs {
  esito: Esito;
  notaLibera: string;
  segnaliNuovi: { tipo: TipoSegnale; origine: "volontario" }[];
  /**
   * Tipi che la risposta di oggi smentisce (§12xxx). Calcolato al
   * submit come union dei `possiede` delle domande risposte, meno il
   * tipo eventualmente aperto dall'opzione selezionata.
   */
  segnaliDaChiudere: TipoSegnale[];
}

interface Props {
  personaId: number;
  /**
   * Server action che chiude il contatto. Ritorna un risultato
   * discriminato: `ok=true` per il success path (il client naviga a
   * /volontario), `ok=false` con `motivo` user-facing quando la regola
   * applicativa lato server rifiuta la combinazione (oggi: sintomi
   * riferiti + esito «sta bene»). Gli errori infrastrutturali (DB
   * giù, autorizzazione violata) risalgono come `throw` e vanno nel
   * catch del client.
   */
  registra: (args: RegistraArgs) => Promise<{ ok: true } | { ok: false; motivo: string }>;
  /**
   * Tipi di segnale aperti e validi oggi sulla persona (§12ffff).
   * Usato per riformulare le domande del form come *verifica* quando
   * la condizione risulta già registrata — così il volontario non
   * chiede da zero cose che il blocco "Situazione già nota" ha
   * appena elencato. Le OPZIONI di risposta restano identiche (numero,
   * testo, `segnale` associato): cambia solo il testo della `legend`.
   *
   * La domanda NON viene nascosta: rispondere è l'unico percorso
   * applicativo per chiudere quei segnali via `segnaliDaChiudere`
   * di `registraContatto` (regola §12xxx). Nasconderla renderebbe la
   * condizione inchiudibile dal giro.
   */
  tipiApertiOggi?: readonly TipoSegnale[];
}

/**
 * Testo della `legend` di una domanda: riformulato come verifica se
 * uno dei tipi che la domanda `possiede` risulta aperto oggi sulla
 * persona (§12ffff). Se nessuno dei tipi è aperto, torna il testo
 * originale — la domanda si presenta "da zero".
 *
 * Precedenza clima: se entrambi `nessuna_climatizzazione` e
 * `ventilatore_rotto` sono aperti (situazione fixture, canone corrente
 * ranghi 6 e 7), vince `nessuna_climatizzazione` — stessa precedenza
 * dichiarata in §12dddd per `statoCondizionatore` della classifica.
 */
function testoDomanda(d: Domanda, tipiAperti: ReadonlySet<TipoSegnale>): string {
  if (d.id === "climatizzazione") {
    if (tipiAperti.has("nessuna_climatizzazione")) {
      return "Risulta senza condizionatore né ventilatore. È ancora così?";
    }
    if (tipiAperti.has("ventilatore_rotto")) {
      return "Risulta che il ventilatore non funzioni. È ancora così?";
    }
  }
  if (d.id === "aiuto" && tipiAperti.has("rete_familiare_assente")) {
    return "Risulta che non abbia nessuno che possa aiutarla. È ancora così?";
  }
  if (d.id === "sintomi" && tipiAperti.has("sintomi_riferiti")) {
    return "Aveva riferito sintomi. Come sta oggi?";
  }
  return d.testo;
}

// ------------------------------------------------------ componente

export function SchedaPersonaForm({ personaId, registra, tipiApertiOggi }: Props) {
  const router = useRouter();
  const [risposte, setRisposte] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);
  const tipiAperti = new Set(tipiApertiOggi ?? []);

  const opzioneScelta = (d: Domanda) =>
    d.opzioni.find((o) => o.value === risposte[d.id]);

  const staBeneBloccato = DOMANDE.some((d) => {
    const o = opzioneScelta(d);
    return o?.bloccaStaBene === true;
  });

  const hoRispostaData = Object.keys(risposte).length > 0;

  function seleziona(d: Domanda, o: Opzione) {
    // Non deselezionabile: cambiabile sì, azzerabile no (decisione MOD03).
    if (risposte[d.id] === o.value) return;
    setRisposte((r) => ({ ...r, [d.id]: o.value }));
    setErrore(null);
  }

  const [confermaUscita, setConfermaUscita] = useState(false);
  const linkBackRef = useRef<HTMLAnchorElement>(null);
  const esciBtnRef = useRef<HTMLButtonElement>(null);
  const restaBtnRef = useRef<HTMLButtonElement>(null);

  // Focus di default sul bottone "Resta" (azione sicura); Esc equivale
  // a "Resta" e riporta il focus sul link che ha aperto il modale, per
  // rispettare il ciclo trigger→modale→trigger richiesto dai lettori
  // di schermo. Il gesto "indietro" del browser non è intercettato
  // (decisione: resta scoperto).
  useEffect(() => {
    if (!confermaUscita) return;
    restaBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfermaUscita(false);
        linkBackRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confermaUscita]);

  function backProtetto(e: React.MouseEvent) {
    if (!hoRispostaData) return;
    e.preventDefault();
    setConfermaUscita(true);
  }

  function chiudiEResta() {
    setConfermaUscita(false);
    linkBackRef.current?.focus();
  }

  function esciSenzaSalvare() {
    setConfermaUscita(false);
    router.push("/volontario");
  }

  function invia(esito: Esito) {
    if (esito === "sta_bene" && staBeneBloccato) {
      setErrore("Sintomi riferiti: «Sta bene» non applicabile. Scegli «Ha bisogno» o «Non risponde».");
      return;
    }
    if (esito === "non_risponde" && hoRispostaData) {
      setErrore("«Non risponde» significa che la persona non ha risposto. Se hai raccolto risposte, scegli «Sta bene» o «Ha bisogno».");
      return;
    }
    const segnaliNuovi: { tipo: TipoSegnale; origine: "volontario" }[] = [];
    const segnaliDaChiudere: TipoSegnale[] = [];
    const noteFr: string[] = [];
    for (const d of DOMANDE) {
      const o = opzioneScelta(d);
      if (!o) continue;
      if (o.segnale) segnaliNuovi.push({ tipo: o.segnale, origine: "volontario" });
      if (o.nota) noteFr.push(o.nota);
      // §12xxx: la domanda governa il proprio dominio. Chiudo tutti i
      // tipi che possiede tranne quello che l'opzione apre (`o.segnale`).
      // Silenzio non chiude: le domande senza risposta (skippate sopra
      // dal `continue`) non contribuiscono a segnaliDaChiudere.
      for (const t of d.possiede) {
        if (t !== o.segnale) segnaliDaChiudere.push(t);
      }
    }
    const notaLibera = noteFr.join(" ");
    startTransition(async () => {
      try {
        const res = await registra({ esito, notaLibera, segnaliNuovi, segnaliDaChiudere });
        if (!res.ok) {
          setErrore(res.motivo);
          return;
        }
        router.push("/volontario");
      } catch (e) {
        setErrore("Salvataggio fallito: riprova. " + ((e as Error).message ?? ""));
      }
    });
  }

  return (
    <div>
      <Link
        ref={linkBackRef}
        href="/volontario"
        onClick={backProtetto}
        className="inline-block bg-ink text-white px-4 py-2 rounded-btn font-display font-semibold text-[13px] no-underline mt-4 mx-4"
      >
        ← Il giro di oggi
      </Link>

      <section className="mt-5">
        <div className="px-4 pb-3 text-[11px] font-display font-semibold tracking-label uppercase text-muted">
          Come sta oggi
        </div>
        {DOMANDE.map((d) => {
          const testo = testoDomanda(d, tipiAperti);
          return (
          <fieldset
            key={d.id}
            className="px-4 py-4 border-t border-rule"
            aria-describedby={`${d.id}-testo`}
          >
            <legend id={`${d.id}-testo`} className="text-[15px] mb-3 leading-snug">
              {testo}
            </legend>
            {/* Griglia 2×N: 3 opzioni → prime due affiancate, terza
                full-width via `col-span-2` sull'ultima; 2 opzioni →
                una per colonna. L'ordine delle opzioni resta quello di
                DOMANDE (nessun riordino: le domande vanno lette al
                telefono nell'ordine originale). Padding verticale
                `py-3` per un'area toccabile abbondante col telefono
                in mano. */}
            <div role="radiogroup" aria-label={testo} className="grid grid-cols-2 gap-2">
              {d.opzioni.map((o, i) => {
                const selezionata = risposte[d.id] === o.value;
                const spanFull = d.opzioni.length === 3 && i === 2;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={selezionata}
                    onClick={() => seleziona(d, o)}
                    className={clsx(
                      "px-3 py-3 border rounded-btn font-body text-sm transition-colors",
                      spanFull && "col-span-2",
                      selezionata
                        ? "bg-ink text-white border-ink"
                        : "bg-card text-ink border-rule hover:border-slate",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {d.id === "sintomi" && opzioneScelta(d)?.bloccaStaBene && (
              <p className="mt-2 text-[12.5px] bg-emergbg text-emergink border border-emergrule rounded-btn px-3 py-2">
                Sintomi riferiti — questa scheda va al coordinatore. Chiudi
                con "Ha bisogno" e continua il giro.
              </p>
            )}
          </fieldset>
          );
        })}
      </section>

      <section className="mt-1 border-t border-rule">
        <div className="px-4 py-3 text-[11px] font-display font-semibold tracking-label uppercase text-muted">
          Esito
        </div>
        {errore && (
          <p className="mx-4 mb-3 text-[12.5px] bg-emergbg text-emergink border border-emergrule rounded-btn px-3 py-2">
            {errore}
          </p>
        )}
        <div className="px-4 pb-4 grid grid-cols-3 gap-2">
          <BottoneEsito
            label="Sta bene"
            disabled={staBeneBloccato || pending}
            onClick={() => invia("sta_bene")}
            titoloDisabled={staBeneBloccato ? "Non applicabile con sintomi riferiti" : undefined}
          />
          <BottoneEsito
            label="Ha bisogno"
            disabled={pending}
            onClick={() => invia("ha_bisogno")}
          />
          <BottoneEsito
            label="Non risponde"
            disabled={hoRispostaData || pending}
            onClick={() => invia("non_risponde")}
            titoloDisabled={hoRispostaData ? "Non applicabile: hai raccolto risposte, quindi la persona ha risposto" : undefined}
          />
        </div>
      </section>

      {/* Rimossa in §12bbbb la didascalia sul registro accessi: la seconda
          metà ("chi è assistito può sapere chi ha visto i suoi dati")
          prometteva una consultazione da parte dell'assistito che non
          esiste — nessuna schermata, comando o procedura in questa
          versione. Il registro `riservato.accesso_scheda` **resta attivo**
          e continua a essere scritto da `scriviAccessoScheda` a ogni
          apertura della scheda: serve a un'eventuale ispezione o
          richiesta formale. Non ripristinare la frase senza aver prima
          implementato la consultazione. */}

      {confermaUscita && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titolo-conferma-uscita"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setConfermaUscita(false);
              linkBackRef.current?.focus();
            }
          }}
        >
          <div className="bg-card border border-rule rounded-card max-w-md w-full p-5 shadow-lg">
            <h3
              id="titolo-conferma-uscita"
              className="font-display font-semibold text-[15px] text-ink mb-3"
            >
              Uscire senza registrare l&apos;esito?
            </h3>
            <p className="text-[13px] text-slate leading-normal mb-4">
              Quello che hai risposto va perso. Per salvarlo, scegli un
              esito in fondo alla scheda.
            </p>
            <div className="flex justify-end gap-2">
              {/* Focus trap manuale: solo due elementi focusable qui dentro,
                  quindi Shift+Tab dal primo torna sull'ultimo e Tab
                  dall'ultimo torna sul primo. Necessario perché
                  aria-modal="true" dichiara al lettore di schermo che
                  fuori dal dialogo non c'è nulla da raggiungere. */}
              <button
                ref={esciBtnRef}
                type="button"
                onClick={esciSenzaSalvare}
                onKeyDown={(e) => {
                  if (e.key === "Tab" && e.shiftKey) {
                    e.preventDefault();
                    restaBtnRef.current?.focus();
                  }
                }}
                className="px-3 py-2 rounded-btn font-display font-semibold text-[12.5px] border border-rule bg-card text-ink hover:bg-foot"
              >
                Esci senza salvare
              </button>
              <button
                ref={restaBtnRef}
                type="button"
                onClick={chiudiEResta}
                onKeyDown={(e) => {
                  if (e.key === "Tab" && !e.shiftKey) {
                    e.preventDefault();
                    esciBtnRef.current?.focus();
                  }
                }}
                className="px-3 py-2 rounded-btn font-display font-semibold text-[12.5px] bg-ink text-white hover:bg-ink/85"
              >
                Resta sulla scheda
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BottoneEsito({
  label, disabled, onClick, titoloDisabled,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  titoloDisabled?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? titoloDisabled : undefined}
      className={clsx(
        "px-3 py-3 border rounded-btn font-display font-semibold text-[13px]",
        disabled
          ? "bg-paper text-muted border-rule cursor-not-allowed"
          : "bg-ink text-white border-ink hover:opacity-90",
      )}
    >
      {label}
    </button>
  );
}
