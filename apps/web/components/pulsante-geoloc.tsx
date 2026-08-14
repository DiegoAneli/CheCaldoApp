"use client";

/**
 * Pulsante geolocalizzazione come progressive enhancement. Il componente
 * si monta solo se JS è attivo: senza JS il selettore <select> è il
 * fallback (vedi SelettoreQuartiere).
 *
 * Flusso: getCurrentPosition → GET /api/quartiere?lat=&lon= →
 * router.push("/?q=<slug>"). Se il punto cade fuori dai poligoni di Parma,
 * mostra il fatto ("sei fuori dal comune di Parma") — nessun fallback che
 * inventa un quartiere per il cittadino.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

type Stato =
  | { fase: "idle" }
  | { fase: "in_corso" }
  | { fase: "errore"; testo: string };

interface Props {
  /** Nome del comune, per il messaggio d'errore "sei fuori dal comune di X". */
  nomeComune: string;
  /** Slug URL del comune: la rotta è `/api/${slugComune}/quartiere`. */
  slugComune: string;
}

export function PulsanteGeoloc({ nomeComune, slugComune }: Props) {
  const router = useRouter();
  const [stato, setStato] = useState<Stato>({ fase: "idle" });
  const [pending, startTransition] = useTransition();

  const disabilitato = stato.fase === "in_corso" || pending;

  function onClick() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStato({ fase: "errore", testo: "Il browser non supporta la geolocalizzazione. Usa il menu qui sopra." });
      return;
    }
    setStato({ fase: "in_corso" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        // Se la precisione dichiarata è peggiore di 500 m, avverti e
        // interrompi: sotto quella soglia la sezione risolta sarebbe più
        // rumore che segnale (le sezioni di Parma hanno raggio ~100-300 m).
        if (accuracy > 500) {
          setStato({
            fase: "errore",
            testo: `Precisione della posizione ${Math.round(accuracy)} m — troppo bassa per risolvere il quartiere. Usa il menu qui sopra.`,
          });
          return;
        }
        try {
          const res = await fetch(`/api/${slugComune}/quartiere?lat=${lat}&lon=${lon}`, { cache: "no-store" });
          if (res.status === 404) {
            setStato({
              fase: "errore",
              testo: `La tua posizione è fuori dal comune di ${nomeComune}. Usa il menu qui sopra.`,
            });
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const dati = (await res.json()) as { slug: string };
          // Porto lat/lon anche nell'URL: la pagina server-render l'elenco
          // dei punti freschi più vicini alle coordinate esatte (MOD06
          // §"Elenco vicini"). Distanze in metri veri, link a indicazioni
          // stradali. Nessun tracking, nessun link condiviso normalmente
          // include le coordinate — restano in browser history dell'utente.
          const lat6 = lat.toFixed(6);
          const lon6 = lon.toFixed(6);
          startTransition(() => {
            router.push(`/${slugComune}?q=${dati.slug}&lat=${lat6}&lon=${lon6}`);
          });
        } catch {
          setStato({
            fase: "errore",
            testo: "Impossibile risolvere la posizione. Usa il menu qui sopra.",
          });
        }
      },
      (err) => {
        const testo = err.code === err.PERMISSION_DENIED
          ? "Hai negato la geolocalizzazione. Usa il menu qui sopra."
          : "Impossibile leggere la posizione. Usa il menu qui sopra.";
        setStato({ fase: "errore", testo });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabilitato}
        className={clsx(
          "text-[12.5px] font-display font-semibold text-slate hover:text-ink",
          disabilitato && "opacity-45 cursor-not-allowed no-underline",
        )}
      >
        {stato.fase === "in_corso" || pending
          ? "Cerco la tua posizione…"
          : "…oppure usa la mia posizione"}
      </button>
      {stato.fase === "errore" && (
        <div className="mt-2 text-[12.5px] text-emergink bg-emergbg border border-emergrule rounded-btn px-3 py-2 max-w-prose">
          {stato.testo}
        </div>
      )}
    </div>
  );
}
