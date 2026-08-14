// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sezione "Fonti dei dati" della pagina /[comune]/metodo. Contenuto
 * comune (Open-Meteo, onData, ISTAT + cartina province, OSM) valido
 * per qualsiasi comune servito dall'istanza, più le fonti specifiche
 * del comune passate come prop `fontiSpecifiche`.
 *
 * Prima (§12vv correzione): l'elenco elencava sia Casette Iren
 * (Parma) sia Biblioteche/aree statistiche Bologna in entrambe le
 * pagine — visibili anche sul comune sbagliato. Ora le voci
 * specifiche vengono da `lib/comuni-metodo.tsx` (`fontiSpecifiche`
 * per slug), quindi ogni pagina elenca solo le proprie.
 */

import type { FonteSpecificaComune } from "@/lib/comuni-metodo";

interface Props {
  fontiSpecifiche?: FonteSpecificaComune[];
}

export const TITOLO_FONTI = "Fonti dei dati";

export function MetodoFonti({ fontiSpecifiche }: Props) {
  return (
    <ul className="list-disc pl-5 space-y-1">
      <li>
        <b>Temperature</b>:{" "}
        <a
          className="underline"
          href="https://open-meteo.com/"
          target="_blank"
          rel="noreferrer"
        >
          Open-Meteo
        </a>
        . I dati sono rilasciati con licenza <b>CC-BY 4.0</b>;
        l&apos;uso gratuito dell&apos;API è riservato a impieghi{" "}
        <b>non commerciali</b>, con tetto di <b>10.000 chiamate al
        giorno</b>. I termini di Open-Meteo considerano non
        commerciale l&apos;uso da parte di enti pubblici e
        organizzazioni senza scopo di lucro — chi installa in un
        contesto diverso deve verificare le condizioni.
      </li>
      <li>
        <b>Bollettino ufficiale del Ministero</b>: pubblicato per 27
        città in formato aperto da{" "}
        <a
          className="underline"
          href="https://ondata.it/"
          target="_blank"
          rel="noreferrer"
        >
          onData
        </a>
        {" "}(licenza CC-BY 4.0).
      </li>
      <li>
        <b>Basi territoriali del quartiere</b>: censimento ISTAT 2021
        (licenza CC-BY 4.0).
      </li>
      <li>
        <b>Distanze dai parchi</b> e <b>punti freschi</b> (biblioteche,
        farmacie, centri commerciali, centri sociali, chiese,
        fontanelle, casette dell&apos;acqua, parchi): OpenStreetMap
        contributors (ODbL 1.0).
      </li>
      {fontiSpecifiche?.map((f) => (
        <li key={f.titolo}>
          <b>{f.titolo}</b>: {f.descrizione}
        </li>
      ))}
    </ul>
  );
}
