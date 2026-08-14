/**
 * Caricamento dei punti freschi di Parma in `pubblico.punto_fresco`.
 *
 * Legge 7 JSON grezzi Overpass da `data/osm/` (biblioteche, farmacie,
 * centri commerciali, centri sociali, chiese, fontanelle, parchi), estrae
 * (lat, lon, nome, indirizzo, orari, wheelchair), fa dedup sulle coordinate
 * a 5 decimali (~1 m; utile per fontanelle mappate con più tag), assegna
 * la sezione ISTAT via ST_Contains e scarta i punti fuori dal comune 034027.
 *
 * La bbox Overpass (44.72,10.22,44.87,10.45) è più larga del confine di
 * Parma per essere robusti a piccole imprecisioni: dentro cadono anche
 * elementi di Collecchio/Sorbolo/Colorno. ST_Contains sulle 1.667 sezioni
 * del comune li filtra via.
 *
 * Idempotente via UNIQUE (fonte, osm_id) WHERE osm_id IS NOT NULL:
 * ripetere lo script non duplica.
 *
 * Le casette dell'acqua Iren (fonte comune.parma.it, dato più affidabile
 * di OSM: impianti gestiti) si caricano con `--iren` una volta risolte le
 * coordinate: sono cinque, si aggiungono a mano con lat/lon note al
 * chiamante.
 *
 * Uso:
 *   docker compose run --rm node pnpm --filter @checaldo/fixtures carica-punti-freschi
 *   docker compose run --rm node pnpm --filter @checaldo/fixtures carica-punti-freschi -- --iren
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const ROOT = join(__dirname, "..", "..", "..");
const OSM_DIR = join(ROOT, "data", "osm");
const COMUNE_ISTAT = "034027";

type TipoPunto =
  | "biblioteca" | "farmacia" | "centro_commerciale" | "centro_sociale"
  | "chiesa" | "fontanella" | "parco" | "casetta_iren";

interface FileMap {
  file: string;
  tipo: TipoPunto;
}

const FILES: FileMap[] = [
  { file: "biblioteche.json",         tipo: "biblioteca" },
  { file: "farmacie.json",            tipo: "farmacia" },
  { file: "centri-commerciali.json",  tipo: "centro_commerciale" },
  { file: "centri-sociali.json",      tipo: "centro_sociale" },
  { file: "chiese.json",              tipo: "chiesa" },
  { file: "fontanelle.json",          tipo: "fontanella" },
  { file: "parchi.json",              tipo: "parco" },
];

/**
 * Priorità dentro la categoria (1 = alto). L'agente riceve i punti
 * ordinati e non deve decidere la gerarchia da solo. Categoria e
 * fascia_oraria sono derivate dal tipo dallo schema (GENERATED STORED),
 * qui basta la priorità intracategoria — vedi commento nella colonna
 * `priorita` in schema.sql per la motivazione dei livelli.
 */
const PRIORITA: Record<TipoPunto, number> = {
  biblioteca:         1,
  centro_commerciale: 1,
  centro_sociale:     2,
  farmacia:           1,
  parco:              1,
  casetta_iren:       1,
  fontanella:         2,
  chiesa:             1,
};

/**
 * Un punto pronto per l'INSERT. `nome` nullable perché le fontanelle
 * quasi mai hanno un tag `name`. `accessibile` limitato ai 4 valori OSM
 * standard; altri valori vengono normalizzati a NULL.
 */
interface PuntoIn {
  osmId: string;             // "node/1234" | "way/5678" | "relation/9012"
  tipo: TipoPunto;
  nome: string | null;
  lat: number;
  lon: number;
  indirizzo: string | null;
  orari: string | null;
  accessibile: "yes" | "no" | "limited" | "designated" | null;
}

interface OverpassEl {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassJson {
  elements: OverpassEl[];
}

function normalizzaAccessibile(v: string | undefined): PuntoIn["accessibile"] {
  if (v === "yes" || v === "no" || v === "limited" || v === "designated") return v;
  return null;
}

/** Concatena `addr:street` + `addr:housenumber` se presenti. */
function componiIndirizzo(tags: Record<string, string>): string | null {
  const via = tags["addr:street"];
  const num = tags["addr:housenumber"];
  if (via && num) return `${via} ${num}`;
  if (via) return via;
  return null;
}

/**
 * Estrae PuntoIn da un elemento Overpass. Filtra elementi senza coordinate
 * (way/relation senza `center` — non dovrebbe succedere con `out ... center`).
 */
function estrai(el: OverpassEl, tipo: TipoPunto): PuntoIn | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;
  const tags = el.tags ?? {};
  return {
    osmId: `${el.type}/${el.id}`,
    tipo,
    nome: tags.name ?? null,
    lat,
    lon,
    indirizzo: componiIndirizzo(tags),
    orari: tags.opening_hours ?? null,
    accessibile: normalizzaAccessibile(tags.wheelchair),
  };
}

/**
 * Dedup su coordinate a 5 decimali (~1 m). Un punto d'acqua mappato sia
 * come `amenity=drinking_water` sia come `man_made=water_tap` sullo
 * stesso nodo Overpass lo consegna già una volta sola (dedup per OSM ID);
 * il caso residuo è due nodi distinti nello stesso posto. Tiene il primo,
 * scarta i successivi.
 */
function dedupCoordinate(punti: PuntoIn[]): PuntoIn[] {
  const visto = new Set<string>();
  const out: PuntoIn[] = [];
  for (const p of punti) {
    const k = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    if (visto.has(k)) continue;
    visto.add(k);
    out.push(p);
  }
  return out;
}

interface Riepilogo {
  tipo: TipoPunto;
  lettiJson: number;
  dopoDedup: number;
  senzaCoordinate: number;
}

function leggiFile(f: FileMap): { punti: PuntoIn[]; riepilogo: Riepilogo } {
  const path = join(OSM_DIR, f.file);
  if (!existsSync(path)) {
    throw new Error(`file OSM mancante: ${path}`);
  }
  const data = JSON.parse(readFileSync(path, "utf8")) as OverpassJson;
  const grezzi = data.elements ?? [];
  let senzaCoords = 0;
  const estratti: PuntoIn[] = [];
  for (const el of grezzi) {
    const p = estrai(el, f.tipo);
    if (!p) { senzaCoords++; continue; }
    estratti.push(p);
  }
  const dopo = dedupCoordinate(estratti);
  return {
    punti: dopo,
    riepilogo: {
      tipo: f.tipo,
      lettiJson: grezzi.length,
      dopoDedup: dopo.length,
      senzaCoordinate: senzaCoords,
    },
  };
}

// --------------------------------------------- 5 casette Iren

interface CasettaIren {
  nome: string;
  indirizzo: string;
  lat: number | null;
  lon: number | null;
}

/**
 * Casette dell'acqua Iren a Parma. Fonte: comune.parma.it, erogazione
 * gratuita. Coordinate ottenute in due passi:
 *   - Bizzozero, Daolio: centroide della way OSM del parco omonimo
 *     (trovati in `data/osm/parchi.json`, way 33760477 e 35977633).
 *   - Musica: nessun POI "Parco della Musica" mappato; usato il segmento
 *     di via Barilla di Nominatim, coerente con la descrizione utente
 *     "ingresso via Barilla" (Auditorium Paganini a 230 m di distanza,
 *     dentro il complesso).
 *   - Osacca: nessun POI casetta mappato; usato il punto più a nord di
 *     Viale Osacca su Nominatim (le due risposte differiscono di 5 m),
 *     coerente con "adiacenze viale Piacenza" ma non a incrocio (~200 m
 *     dall'intersezione più vicina).
 *   - Corcagnano: centroide di Piazza Indipendenza (Nominatim
 *     type=square, class=place — mappata come piazza).
 * L'incertezza è al più ~100–200 m, accettabile per un consiglio
 * "casetta d'acqua in via/parco X": l'agente cita il luogo per nome, la
 * distanza esatta al metro non serve.
 */
const CASETTE_IREN: CasettaIren[] = [
  {
    nome: "Casetta dell'acqua parco Bizzozero",
    indirizzo: "Parco Bizzozero (vicino Sala Civica)",
    lat: 44.7877393, lon: 10.3314775,
  },
  {
    nome: "Casetta dell'acqua parco Daolio",
    indirizzo: "Parco Augusto Daolio (lato via Cremonese, Fognano)",
    lat: 44.8178562, lon: 10.2833822,
  },
  {
    nome: "Casetta dell'acqua parco della Musica",
    indirizzo: "Parco della Musica (ingresso via Barilla)",
    lat: 44.8023079, lon: 10.3406760,
  },
  {
    nome: "Casetta dell'acqua viale Osacca",
    indirizzo: "Viale Osacca (adiacenze viale Piacenza)",
    lat: 44.8071929, lon: 10.3105349,
  },
  {
    nome: "Casetta dell'acqua piazza Indipendenza (Corcagnano)",
    indirizzo: "Piazza Indipendenza, Corcagnano",
    lat: 44.7210876, lon: 10.3045635,
  },
];

async function caricaCasetteIren(sql: postgres.Sql): Promise<void> {
  const mancanti = CASETTE_IREN.filter((c) => c.lat === null || c.lon === null);
  if (mancanti.length > 0) {
    process.stderr.write(
      `\n[iren] ${mancanti.length} casette senza coordinate: ` +
      mancanti.map((c) => c.nome).join("; ") +
      `\n[iren] risolvile prima di rilanciare con --iren.\n`,
    );
    process.exit(2);
  }
  for (const c of CASETTE_IREN) {
    const row = await sql<Array<{ id: number; quartiere: string | null }>>`
      WITH inserted AS (
        INSERT INTO pubblico.punto_fresco
          (fonte, osm_id, tipo, priorita, nome, geom,
           indirizzo, orari, accessibile, sezione_id, quartiere)
        SELECT
          'iren', NULL, 'casetta_iren', ${PRIORITA.casetta_iren}, ${c.nome},
          ST_SetSRID(ST_MakePoint(${c.lon!}, ${c.lat!}), 4326),
          ${c.indirizzo}, NULL, NULL, s.id, s.quartiere
        FROM pubblico.sezione s
        WHERE s.comune_istat = ${COMUNE_ISTAT}
          AND NOT s.fittizia
          AND ST_Contains(s.geom, ST_SetSRID(ST_MakePoint(${c.lon!}, ${c.lat!}), 4326))
        LIMIT 1
        RETURNING id, quartiere
      )
      SELECT * FROM inserted
    `;
    if (row.length === 0) {
      process.stderr.write(
        `[iren] "${c.nome}" a ${c.lat},${c.lon} non ricade in nessuna sezione del comune 034027: verifica coordinate.\n`,
      );
      continue;
    }
    process.stderr.write(
      `[iren] "${c.nome}" → sezione ${row[0]!.id}, quartiere ${row[0]!.quartiere ?? "n.d."}\n`,
    );
  }
}

// --------------------------------------------- main

async function caricaOsm(sql: postgres.Sql): Promise<void> {
  const riepiloghi: Riepilogo[] = [];
  let tuttiPunti: PuntoIn[] = [];
  for (const f of FILES) {
    const { punti, riepilogo } = leggiFile(f);
    riepiloghi.push(riepilogo);
    tuttiPunti = tuttiPunti.concat(punti);
  }

  process.stderr.write("\n--- Lettura JSON ---\n");
  for (const r of riepiloghi) {
    process.stderr.write(
      `  ${r.tipo.padEnd(20)} letti ${String(r.lettiJson).padStart(4)}, ` +
      `dopo dedup ${String(r.dopoDedup).padStart(4)}` +
      (r.senzaCoordinate > 0 ? `, ${r.senzaCoordinate} senza coordinate scartati` : "") +
      `\n`,
    );
  }
  process.stderr.write(`  ${"TOTALE".padEnd(20)} = ${tuttiPunti.length}\n`);

  // Carico in un colpo solo: INSERT ... SELECT dalla sezione, così i
  // punti fuori-comune non entrano proprio. Il partial UNIQUE
  // (fonte, osm_id) WHERE osm_id IS NOT NULL gestisce idempotenza:
  // ripetere lo script è no-op.
  let dentro = 0;
  let fuori = 0;
  await sql.begin(async (tx) => {
    for (const p of tuttiPunti) {
      const inserito = await tx<Array<{ id: number }>>`
        INSERT INTO pubblico.punto_fresco
          (fonte, osm_id, tipo, priorita, nome, geom,
           indirizzo, orari, accessibile, sezione_id, quartiere)
        SELECT
          'osm', ${p.osmId}, ${p.tipo}, ${PRIORITA[p.tipo]}, ${p.nome},
          ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326),
          ${p.indirizzo}, ${p.orari}, ${p.accessibile}, s.id, s.quartiere
        FROM pubblico.sezione s
        WHERE s.comune_istat = ${COMUNE_ISTAT}
          AND NOT s.fittizia
          AND ST_Contains(s.geom, ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326))
        LIMIT 1
        ON CONFLICT (fonte, osm_id) WHERE osm_id IS NOT NULL DO NOTHING
        RETURNING id
      `;
      if (inserito.length > 0) dentro++;
      else {
        // O il punto ricade fuori comune, o è già in tabella (idempotenza).
        // Distinguiamo interrogando l'unique.
        const [gia] = await tx<Array<{ id: number }>>`
          SELECT id FROM pubblico.punto_fresco
          WHERE fonte = 'osm' AND osm_id = ${p.osmId}
        `;
        if (!gia) fuori++;
      }
    }
  });

  process.stderr.write(
    `\n--- ST_Contains su ${COMUNE_ISTAT} ---\n` +
    `  dentro comune (inseriti o già presenti): ${dentro}\n` +
    `  fuori comune (scartati):                 ${fuori}\n`,
  );

  // Statistiche finali per tipo (dopo eventuali giri precedenti).
  const perTipo = await sql<Array<{ tipo: TipoPunto; n: number }>>`
    SELECT tipo, count(*)::int AS n
      FROM pubblico.punto_fresco
     GROUP BY tipo
     ORDER BY tipo
  `;
  process.stderr.write("\n--- Righe in DB per tipo (dopo carico) ---\n");
  for (const r of perTipo) {
    process.stderr.write(`  ${r.tipo.padEnd(20)} ${r.n}\n`);
  }

  // Righe per quartiere raggruppate per categoria (asse "cosa fa il posto").
  const perCat = await sql<Array<{
    quartiere: string;
    categoria: "rifugio"|"sosta_fresca"|"ombra_aperta"|"acqua"|"ripiego";
    priorita: number;
    n: number;
  }>>`
    SELECT quartiere, categoria, priorita, count(*)::int AS n
      FROM pubblico.punto_fresco
     WHERE quartiere IS NOT NULL
     GROUP BY quartiere, categoria, priorita
     ORDER BY quartiere, categoria, priorita
  `;
  // Nested map: quartiere → categoria → priorita → count
  const perQuartCat = new Map<string, Map<string, Map<number, number>>>();
  for (const r of perCat) {
    if (!perQuartCat.has(r.quartiere)) perQuartCat.set(r.quartiere, new Map());
    const catMap = perQuartCat.get(r.quartiere)!;
    if (!catMap.has(r.categoria)) catMap.set(r.categoria, new Map());
    catMap.get(r.categoria)!.set(r.priorita, r.n);
  }
  const tuttiQuart = await sql<Array<{ nome: string }>>`
    SELECT DISTINCT quartiere AS nome
      FROM pubblico.sezione
     WHERE comune_istat = ${COMUNE_ISTAT}
       AND NOT fittizia
       AND tipo_sezione = 1
       AND popolazione > 0
       AND quartiere IS NOT NULL
     ORDER BY quartiere
  `;

  // Colonne = (categoria, aggregato). Per rifugio distinguo priorita 1 e 2:
  // il "livello 1" della domanda utente = biblioteca+CC (priorita 1) e
  // centro sociale (priorita 2), tutti dentro categoria rifugio. Le altre
  // categorie hanno priorita omogenea, aggreghi tutto.
  process.stderr.write(
    "\n--- Punti freschi per quartiere, raggruppati per uso ---\n" +
    "                    rif1  rif2  sost  ombr  acqu  ripi  TOT\n" +
    "                    " +
    "biblioteca+CC / centro sociale / farmacia / parco / casette+font / chiesa\n\n",
  );
  const senzaRifugioPri1: string[] = [];
  const zeroAssoluto: string[] = [];
  for (const q of tuttiQuart) {
    const cat = perQuartCat.get(q.nome) ?? new Map<string, Map<number, number>>();
    const rif1 = cat.get("rifugio")?.get(1) ?? 0;
    const rif2 = cat.get("rifugio")?.get(2) ?? 0;
    const sost = [...(cat.get("sosta_fresca")?.values() ?? [])].reduce((a,b)=>a+b, 0);
    const ombr = [...(cat.get("ombra_aperta")?.values() ?? [])].reduce((a,b)=>a+b, 0);
    const acqu = [...(cat.get("acqua")?.values() ?? [])].reduce((a,b)=>a+b, 0);
    const ripi = [...(cat.get("ripiego")?.values() ?? [])].reduce((a,b)=>a+b, 0);
    const tot = rif1+rif2+sost+ombr+acqu+ripi;
    process.stderr.write(
      `  ${q.nome.padEnd(20)}` +
      [rif1,rif2,sost,ombr,acqu,ripi].map(n=>String(n).padStart(5)+" ").join("") +
      ` ${tot}\n`
    );
    if (rif1 === 0) senzaRifugioPri1.push(q.nome);
    if (tot === 0) zeroAssoluto.push(q.nome);
  }

  if (senzaRifugioPri1.length > 0) {
    process.stderr.write(
      `\n[!] ${senzaRifugioPri1.length} quartieri senza rifugio priorita 1` +
      ` (biblioteca o centro commerciale): ${senzaRifugioPri1.join(", ")}\n` +
      `    L'agente non ha un vero "posto dove stare ore" da proporre —` +
      ` deve dichiarare che nel quartiere non c'è, non ripiegare in silenzio` +
      ` su centro sociale o chiesa senza dirlo.\n`,
    );
  } else {
    process.stderr.write("\n[ok] tutti i quartieri hanno almeno un rifugio priorita 1.\n");
  }
  if (zeroAssoluto.length > 0) {
    process.stderr.write(
      `\n[!] ${zeroAssoluto.length} quartieri con ZERO punti freschi di qualunque tipo: ${zeroAssoluto.join(", ")}\n` +
      `    L'agente non potrà proporre luoghi in quei quartieri — dirà solo cosa fare.\n`,
    );
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("DATABASE_URL non impostata.\n");
    process.exit(1);
  }
  const soloIren = process.argv.includes("--iren");
  const sql = postgres(url, { idle_timeout: 5 });
  try {
    if (soloIren) {
      await caricaCasetteIren(sql);
    } else {
      await caricaOsm(sql);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
