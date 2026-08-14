"use client";

/**
 * Elenco dei punti freschi più vicini. Due modalità (§12aa punto 3):
 *
 *   - `coordinate`: la vecchia modalità (MOD06 chiusura b). L'utente
 *     ha dato il consenso alla geolocalizzazione (`PulsanteGeoloc`),
 *     il PulsanteGeoloc ha portato `?lat=&lon=` nell'URL, il server
 *     ha fatto la query PostGIS ordinata per distanza dalle coordinate
 *     esatte. Header: "Vicino a te", distanza reale in linea d'aria.
 *
 *   - `quartiere`: nuova modalità dal selettore. L'utente ha scelto un
 *     quartiere dal menu (`?q=slug`), il server ha fatto la query
 *     ordinata per distanza dal **centroide del quartiere** (sezioni
 *     residenziali abitate). Header: "Vicini al centro di {nome}",
 *     con disclaimer esplicito perché "340 metri dal centro del
 *     quartiere" ≠ "340 metri dai tuoi piedi". Il link "indicazioni"
 *     apre OSRM col DESTINATION del punto ma senza origine — l'utente
 *     dovrà digitarla lui, o dare il consenso alla geolocalizzazione
 *     dal pulsante sopra.
 *
 * Refactored a client component in §12aa perché filtra localmente
 * secondo `filtri` (categoria acqua/farmacie/parchi/chiuso/chiese):
 * i punti arrivano dal server come lista completa top-20, il client
 * mostra i primi `nMax` (default 8) dopo aver applicato il filtro
 * corrente. Se il filtro non lascia nulla, elenco vuoto senza errore.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { PuntoFrescoConCoord } from "@checaldo/db";
import {
  tipiVisibili,
  type Categoria,
} from "@/components/filtri-categoria";
import { IntestazioneQuartiere } from "@/components/intestazione-quartiere";

const TIPO_LABEL: Record<string, string> = {
  biblioteca: "Biblioteca",
  farmacia: "Farmacia",
  centro_commerciale: "Centro commerciale",
  centro_sociale: "Centro sociale",
  chiesa: "Chiesa",
  fontanella: "Fontanella",
  parco: "Parco",
  casetta_iren: "Casetta dell'acqua Iren",
};

/**
 * Link a OSRM pedone (fossgis_osrm_foot su OpenStreetMap). Origine
 * opzionale: senza origine l'URL apre solo il destination selezionato,
 * l'utente compilerà la partenza dal box di ricerca di OSM.
 */
function linkOsmDirections(
  toLat: number,
  toLon: number,
  fromLat?: number,
  fromLon?: number,
): string {
  const to = `${toLat.toFixed(6)}%2C${toLon.toFixed(6)}`;
  if (fromLat !== undefined && fromLon !== undefined) {
    const from = `${fromLat.toFixed(6)}%2C${fromLon.toFixed(6)}`;
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${from}%3B${to}`;
  }
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=%3B${to}`;
}

/**
 * Formatta la nota "orari" per un punto. Ritorna stringa vuota quando
 * non c'è nulla di sicuro da dire (regola: mai "sempre disponibile"
 * sull'acqua — coerente con il prompt del consulente).
 */
function formattaOrari(p: PuntoFrescoConCoord): string {
  const raw = (p.orari ?? "").trim();
  if (raw.length > 0) return raw;
  if (p.categoria === "acqua") return "";
  if (p.tipo === "chiesa") return "verifica gli orari, molte chiudono nel primo pomeriggio";
  return "verifica gli orari";
}

interface Props {
  punti: PuntoFrescoConCoord[];
  filtri: Set<Categoria>;
  nMax?: number;
  /**
   * Discrimina header e distanza: `coordinate` = distanza reale dai piedi
   * dell'utente; `quartiere` = distanza dal centroide del quartiere.
   */
  modo: "coordinate" | "quartiere";
  /** Coordinate utente (per link OSRM origine→destinazione). Solo modo=coordinate. */
  lat?: number;
  lon?: number;
  /** Nome umano del quartiere per l'intestazione. Solo modo=quartiere. */
  nomeQuartiere?: string;
}

export function ElencoPuntiVicini({
  punti, filtri, nMax = 8, modo, lat, lon, nomeQuartiere,
}: Props) {
  const attivi = tipiVisibili(filtri);
  const filtrati = attivi === null
    ? punti
    : punti.filter((p) => attivi.includes(p.tipo));
  const mostrati = filtrati.slice(0, nMax);

  if (punti.length === 0) return null;

  const modoQuartiere = modo === "quartiere";
  const nMaxUsati = mostrati.length;

  return (
    <div className="border border-gray-400 rounded-card bg-card">
      {/* Intestazione condivisa con `ProfiloQuartiere`: due card diverse
          identificano lo stesso quartiere, la tipografia va allineata in
          un solo punto. Presente solo in modo "quartiere" (in modo
          "coordinate" non c'è un quartiere di riferimento). */}
      {modoQuartiere && nomeQuartiere && (
        <IntestazioneQuartiere sopratitolo="Il quartiere" nome={nomeQuartiere} />
      )}
      <div className="p-5">
      <div className="text-[11px] uppercase tracking-chip font-display font-semibold text-muted mb-1">
        {modoQuartiere ? "Vicini al centro del quartiere" : "Vicino a te"}
      </div>
      <div className="text-[12px] text-muted mb-3 leading-normal">
        {modoQuartiere ? (
          <>
            {/* Il rimando al pulsante lo nomina invece di localizzarlo
                in pagina: "sopra la mappa" diventava falso al primo
                riordino dei blocchi (blocco spostato sopra la mappa). */}
            Punti freschi più vicini al <b>centro del quartiere</b>
            {nomeQuartiere ? <> {nomeQuartiere}</> : null}, in linea
            d&apos;aria. Le distanze partono dal centro del quartiere,
            non dal punto in cui si trova chi legge. Per l&apos;elenco
            dalla propria posizione, usa il pulsante
            {" "}&laquo;Usa la mia posizione&raquo;.
          </>
        ) : (
          <>
            Punti freschi più vicini alle tue coordinate esatte
            {lat !== undefined && lon !== undefined && (
              <> ({lat.toFixed(4)}, {lon.toFixed(4)})</>
            )}
            , in linea d&apos;aria.
          </>
        )}
      </div>

      {attivi !== null && (
        <div className="text-[12px] text-slate mb-3 leading-normal">
          {mostrati.length === 0
            ? "Nessun punto nelle categorie selezionate. Rimuovi qualche filtro dalla mappa."
            : (
              <>
                Filtro attivo: {mostrati.length}{" "}
                {mostrati.length === 1 ? "punto mostrato" : "punti mostrati"}
                {filtrati.length > mostrati.length && (
                  <> di {filtrati.length} nella selezione</>
                )}
                {" · "}
                <span className="text-muted">
                  {attivi.length}{" "}
                  {attivi.length === 1 ? "categoria" : "categorie"}
                </span>
              </>
            )}
        </div>
      )}

      {nMaxUsati > 0 && (
        <ul className="space-y-2.5 list-none">
          {mostrati.map((p) => {
            const nome = (p.nome ?? "").trim();
            const tipoIt = TIPO_LABEL[p.tipo] ?? p.tipo;
            const titolo = nome.length > 0 ? nome : tipoIt;
            const orari = formattaOrari(p);
            const indirizzo = (p.indirizzo ?? "").trim();
            const url = linkOsmDirections(p.lat, p.lon, lat, lon);
            return (
              <li key={p.id} className="flex items-baseline gap-3">
                <span className="font-mono text-[12px] text-slate shrink-0 w-16 tabular-nums">
                  {p.distanzaMetri} m
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] text-ink">
                    <span className="font-semibold">{titolo}</span>
                    {nome.length > 0 && (
                      <span className="text-slate text-[13px]"> — {tipoIt}</span>
                    )}
                    {p.accessibile === "yes" && (
                      <span className="ml-1.5 text-[11px] text-emerald-700">accessibile in carrozzina</span>
                    )}
                  </div>
                  {(indirizzo.length > 0 || orari.length > 0) && (
                    <div className="text-[12px] text-muted leading-normal">
                      {indirizzo.length > 0 && orari.length > 0 && (
                        <>
                          <span>{indirizzo}</span>
                          <span> · </span>
                          <span>{orari}</span>
                        </>
                      )}
                      {indirizzo.length > 0 && orari.length === 0 && (
                        <span>{indirizzo}</span>
                      )}
                      {indirizzo.length === 0 && orari.length > 0 && (
                        <span>{orari}</span>
                      )}
                    </div>
                  )}
                </div>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] font-semibold text-slate hover:text-ink underline shrink-0"
                >
                  indicazioni
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <div className="text-[11px] text-muted mt-3 leading-normal">
        {modoQuartiere ? (
          <>
            Le distanze sono in linea d&apos;aria dal centro del
            quartiere calcolato sulle sezioni residenziali abitate. Le
            indicazioni stradali si aprono su OpenStreetMap in una
            nuova scheda (dovrai indicare tu il punto di partenza).
          </>
        ) : (
          <>
            Le distanze sono in linea d&apos;aria dal punto che il
            browser ha letto (precisione dipende dal dispositivo). Le
            indicazioni stradali si aprono su OpenStreetMap in una
            nuova scheda.
          </>
        )}
      </div>
      </div>
    </div>
  );
}
