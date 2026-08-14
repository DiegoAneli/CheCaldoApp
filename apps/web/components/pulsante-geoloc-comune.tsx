"use client";

/**
 * Pulsante geolocalizzazione della radice: risolve il **comune** che
 * contiene la posizione utente e naviga a /{slug}. Distinto da
 * PulsanteGeoloc (che risolve il quartiere DENTRO un comune noto e
 * naviga a /{slug}?q=...).
 *
 * Progressive enhancement: se JS è spento, resta il selettore statico
 * dei due comuni. Se il punto cade fuori dai comuni serviti (§12t
 * lookup `COMUNI`), messaggio esplicito senza ripiegare a un comune
 * di default.
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

export function PulsanteGeolocComune() {
  const router = useRouter();
  const [stato, setStato] = useState<Stato>({ fase: "idle" });
  const [pending, startTransition] = useTransition();

  const disabilitato = stato.fase === "in_corso" || pending;

  function onClick() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStato({ fase: "errore", testo: "Il browser non supporta la geolocalizzazione. Scegli il comune dalla lista qui sopra." });
      return;
    }
    setStato({ fase: "in_corso" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        if (accuracy > 5000) {
          setStato({
            fase: "errore",
            testo: `Precisione della posizione ${Math.round(accuracy)} m — troppo bassa. Scegli il comune dalla lista qui sopra.`,
          });
          return;
        }
        try {
          const res = await fetch(`/api/geoloc-comune?lat=${lat}&lon=${lon}`, { cache: "no-store" });
          if (res.status === 404) {
            setStato({
              fase: "errore",
              testo: "La tua posizione è fuori dai comuni serviti da questa istanza. Scegli manualmente dalla lista qui sopra.",
            });
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const dati = (await res.json()) as { slug: string };
          // Coordinate anche nell'URL: /{slug}?lat=&lon= così la pagina
          // pubblica del comune mostra subito l'elenco vicini.
          const lat6 = lat.toFixed(6);
          const lon6 = lon.toFixed(6);
          startTransition(() => {
            router.push(`/${dati.slug}?lat=${lat6}&lon=${lon6}`);
          });
        } catch {
          setStato({ fase: "errore", testo: "Impossibile risolvere la posizione. Scegli il comune dalla lista qui sopra." });
        }
      },
      (err) => {
        const testo = err.code === err.PERMISSION_DENIED
          ? "Hai negato la geolocalizzazione. Scegli il comune dalla lista qui sopra."
          : "Impossibile leggere la posizione. Scegli il comune dalla lista qui sopra.";
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
          "text-[13px] font-display font-semibold  text-slate hover:text-ink",
          disabilitato && "opacity-45 cursor-not-allowed no-underline",
        )}
      >
        {stato.fase === "in_corso" || pending
          ? "Cerco il tuo comune…"
          : "…oppure usa la mia posizione per trovare il comune"}
      </button>
      {stato.fase === "errore" && (
        <div className="mt-2 text-[12.5px] text-emergink bg-emergbg border border-emergrule rounded-btn px-3 py-2 max-w-prose">
          {stato.testo}
        </div>
      )}
    </div>
  );
}
