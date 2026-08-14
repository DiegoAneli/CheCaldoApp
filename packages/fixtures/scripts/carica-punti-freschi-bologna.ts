/**
 * Caricamento dei punti freschi di Bologna in `pubblico.punto_fresco`.
 *
 * Diverso da `carica-punti-freschi.ts` (Parma) per due cose:
 *
 * 1. **Path OSM in `data/osm-bologna/`** invece che `data/osm/`. Stessi
 *    otto file per categoria (biblioteche, farmacie, CC, centri sociali,
 *    chiese, fontanelle, parchi, garden). Bologna ha ~2.5× i dati di
 *    Parma OSM (~1.700 elementi grezzi vs ~380). `garden.json` escluso
 *    come a Parma (troppi elementi anonimi: 686 con 27 nomi = spartitraffico
 *    e aiuole).
 *
 * 2. **Biblioteche comunali** da `data/bologna-opendata/biblioteche-comunali-di-bologna.geojson`
 *    entrano come `fonte = 'comune'` invece di `'osm'`, con il campo
 *    `aria_condi` valorizzato dal dataset del Comune (`sì` → true, `no`
 *    → false). 18 biblioteche, 14 con AC, 4 senza. Le biblioteche
 *    comunali con AC entrano a **priorità 1** (rifugio primario certo);
 *    quelle senza AC a **priorità 3** (declassate — il testo dell'agente
 *    le proporrà solo se sole nel quartiere, dichiarando "non è
 *    climatizzata"). Match sul nome per non duplicare OSM: se la stessa
 *    biblioteca compare in entrambe le fonti, viene tenuta la comunale.
 *
 * Farmacie: OSM (più esemplari e più orari del dataset comunale).
 * Parchi: OSM parchi.json (poligoni, tutti con nome).
 *
 * Attribuzione: dataset del Comune di Bologna sono CC-BY 4.0, va
 * riportato in README, /metodo e customAttribution della mappa.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const ROOT = join(__dirname, "..", "..", "..");
const OSM_DIR = join(ROOT, "data", "osm-bologna");
const OPENDATA_DIR = join(ROOT, "data", "bologna-opendata");
const COMUNE_ISTAT = "037006";

type TipoPunto =
  | "biblioteca" | "farmacia" | "centro_commerciale" | "centro_sociale"
  | "chiesa" | "fontanella" | "parco" | "casetta_iren";

interface FileMap { file: string; tipo: TipoPunto; }

// Stessa mappa di Parma: garden.json non entra come a Parma.
const FILES_OSM: FileMap[] = [
  { file: "biblioteche.json",         tipo: "biblioteca" },
  { file: "farmacie.json",            tipo: "farmacia" },
  { file: "centri-commerciali.json",  tipo: "centro_commerciale" },
  { file: "centri-sociali.json",      tipo: "centro_sociale" },
  { file: "chiese.json",              tipo: "chiesa" },
  { file: "fontanelle.json",          tipo: "fontanella" },
  { file: "parchi.json",              tipo: "parco" },
];

/**
 * Priorità intracategoria per punti OSM. Stessa mappa di Parma
 * (`carica-punti-freschi.ts`). Le biblioteche comunali di Bologna hanno
 * una regola diversa (vedi `PRIORITA_BIBLIO_COMUNALE`).
 */
const PRIORITA_OSM: Record<TipoPunto, number> = {
  biblioteca:         2,   // OSM = priorità 2 (senza AC certificata);
                           //   il comunale = priorità 1 sopra le OSM.
  centro_commerciale: 1,
  centro_sociale:     2,
  farmacia:           1,
  parco:              1,
  casetta_iren:       1,   // non usato per Bologna (Iren non gestisce qui)
  fontanella:         2,
  chiesa:             1,
};

interface PuntoIn {
  osmId: string;
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

interface OverpassJson { elements: OverpassEl[] }

function normalizzaAccessibile(v: string | undefined): PuntoIn["accessibile"] {
  if (v === "yes" || v === "no" || v === "limited" || v === "designated") return v;
  return null;
}

function componiIndirizzo(tags: Record<string, string>): string | null {
  const via = tags["addr:street"];
  const num = tags["addr:housenumber"];
  if (via && num) return `${via} ${num}`;
  if (via) return via;
  return null;
}

function estrai(el: OverpassEl, tipo: TipoPunto): PuntoIn | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;
  const tags = el.tags ?? {};
  return {
    osmId: `${el.type}/${el.id}`,
    tipo,
    nome: tags.name ?? null,
    lat, lon,
    indirizzo: componiIndirizzo(tags),
    orari: tags.opening_hours ?? null,
    accessibile: normalizzaAccessibile(tags.wheelchair),
  };
}

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

// -------------------------------- biblioteche comunali Bologna

interface BiblioComunale {
  nome: string;
  indirizzo: string | null;
  lat: number;
  lon: number;
  ariaCondi: boolean;   // 'sì' → true, 'no' → false (nessun null nel dataset)
}

/**
 * Il geojson comunale ha geometry MultiPoint (una biblioteca = un
 * MultiPoint con un singolo punto). Estraggo il primo punto.
 */
interface FeatureBiblio {
  type: "Feature";
  geometry: { type: "MultiPoint"; coordinates: [number, number][] } | { type: "Point"; coordinates: [number, number] };
  properties: {
    biblioteca?: string;
    indirizzo?: string;
    aria_condi?: string;
  };
}

function leggiBiblioComunali(): BiblioComunale[] {
  const path = join(OPENDATA_DIR, "biblioteche-comunali-di-bologna.geojson");
  if (!existsSync(path)) throw new Error(`file mancante: ${path}`);
  const data = JSON.parse(readFileSync(path, "utf8")) as { features: FeatureBiblio[] };
  const out: BiblioComunale[] = [];
  for (const f of data.features) {
    const p = f.properties;
    const nome = (p.biblioteca ?? "").trim();
    if (!nome) continue;
    let lon: number, lat: number;
    if (f.geometry.type === "MultiPoint") {
      const c = f.geometry.coordinates[0];
      if (!c) continue;
      [lon, lat] = c;
    } else {
      [lon, lat] = f.geometry.coordinates;
    }
    const aria = (p.aria_condi ?? "").trim().toLowerCase();
    // Il dataset ha solo "sì" e "no" (verificato in sessione).
    const ariaCondi = aria === "sì" || aria === "si";
    out.push({
      nome,
      indirizzo: (p.indirizzo ?? "").trim() || null,
      lat, lon,
      ariaCondi,
    });
  }
  return out;
}

/**
 * Match fra biblioteca comunale e biblioteca OSM per nome. Se una
 * comunale e una OSM sono la stessa biblioteca, teniamo la comunale
 * (ha aria_condi) e scartiamo la OSM (perderemmo comunque quel valore).
 *
 * Similarità: normalizzo entrambi i nomi (lowercase, senza
 * punteggiatura), poi verifico se uno contiene l'altro come sottostringa
 * (parole comuni tipo "biblioteca" ovvia; il match significativo è sul
 * nome specifico, es. "Cesare Pavese" o "Salaborsa").
 */
function normalizzaNome(s: string): string {
  return s.toLowerCase().replace(/[.'"'"·`]/g, "").replace(/\s+/g, " ").trim();
}
function matchNome(comunale: string, osm: string): boolean {
  const a = normalizzaNome(comunale);
  const b = normalizzaNome(osm);
  if (a === b) return true;
  // Se uno contiene l'altro (>= 8 char) è un match ragionevole.
  if (a.length >= 8 && b.includes(a)) return true;
  if (b.length >= 8 && a.includes(b)) return true;
  return false;
}

interface Riepilogo {
  tipo: TipoPunto;
  lettiJson: number;
  dopoDedup: number;
  senzaCoordinate: number;
}

function leggiFile(f: FileMap): { punti: PuntoIn[]; riepilogo: Riepilogo } {
  const path = join(OSM_DIR, f.file);
  if (!existsSync(path)) throw new Error(`file OSM mancante: ${path}`);
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
    riepilogo: { tipo: f.tipo, lettiJson: grezzi.length, dopoDedup: dopo.length, senzaCoordinate: senzaCoords },
  };
}

// -------------------------------- main

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("DATABASE_URL non impostata.\n"); process.exit(1); }
  const sql = postgres(url, { idle_timeout: 5 });

  try {
    // 1. Leggi OSM (7 file, garden escluso)
    const riepiloghi: Riepilogo[] = [];
    let osmPunti: PuntoIn[] = [];
    for (const f of FILES_OSM) {
      const { punti, riepilogo } = leggiFile(f);
      riepiloghi.push(riepilogo);
      osmPunti = osmPunti.concat(punti);
    }

    process.stderr.write("\n--- OSM Bologna: lettura JSON ---\n");
    for (const r of riepiloghi) {
      process.stderr.write(
        `  ${r.tipo.padEnd(20)} letti ${String(r.lettiJson).padStart(5)}, ` +
        `dopo dedup ${String(r.dopoDedup).padStart(5)}\n`
      );
    }
    process.stderr.write(`  ${"TOTALE".padEnd(20)} = ${osmPunti.length}\n`);

    // 2. Leggi biblioteche comunali
    const bibliCom = leggiBiblioComunali();
    process.stderr.write(`\n--- Biblioteche comunali: ${bibliCom.length} righe (${bibliCom.filter((b) => b.ariaCondi).length} con AC)\n`);

    // 3. Match nome: rimuovi dalle OSM le biblioteche già presenti nel
    // dataset comunale — vince il comunale (ha aria_condi).
    const bibliComNomi = bibliCom.map((b) => b.nome);
    const osmBiblioPrima = osmPunti.filter((p) => p.tipo === "biblioteca").length;
    const osmNonBiblio = osmPunti.filter((p) => p.tipo !== "biblioteca");
    const osmBiblioSopravvissute = osmPunti.filter((p) => {
      if (p.tipo !== "biblioteca") return false;
      if (p.nome === null) return true;
      return !bibliComNomi.some((n) => matchNome(n, p.nome!));
    });
    osmPunti = [...osmNonBiblio, ...osmBiblioSopravvissute];
    process.stderr.write(
      `--- Match biblioteche: ${osmBiblioPrima} OSM → ${osmBiblioSopravvissute.length} sopravvissute ` +
      `(${osmBiblioPrima - osmBiblioSopravvissute.length} scartate per merge col comunale)\n`
    );

    // 4. Carico OSM (transazione unica)
    let osmDentro = 0, osmFuori = 0;
    await sql.begin(async (tx) => {
      for (const p of osmPunti) {
        const inserito = await tx<Array<{ id: number }>>`
          INSERT INTO pubblico.punto_fresco
            (fonte, osm_id, tipo, priorita, nome, geom,
             indirizzo, orari, accessibile, sezione_id, quartiere)
          SELECT
            'osm', ${p.osmId}, ${p.tipo}, ${PRIORITA_OSM[p.tipo]}, ${p.nome},
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
        if (inserito.length > 0) osmDentro++;
        else {
          const [gia] = await tx<Array<{ id: number }>>`
            SELECT id FROM pubblico.punto_fresco
            WHERE fonte = 'osm' AND osm_id = ${p.osmId}
          `;
          if (!gia) osmFuori++;
        }
      }
    });
    process.stderr.write(
      `\n--- OSM: ST_Contains su ${COMUNE_ISTAT} ---\n` +
      `  dentro comune (inseriti o già presenti): ${osmDentro}\n` +
      `  fuori comune (scartati):                 ${osmFuori}\n`
    );

    // 5. Carico biblioteche comunali
    let comuneDentro = 0, comuneFuori = 0;
    for (const b of bibliCom) {
      // Priorità: aria_condi=sì → 1 (rifugio certo); aria_condi=no → 3
      // (declassata, l'agente non la propone come "dove stare ore").
      const prio = b.ariaCondi ? 1 : 3;
      const row = await sql<Array<{ id: number; quartiere: string | null }>>`
        WITH inserted AS (
          INSERT INTO pubblico.punto_fresco
            (fonte, osm_id, tipo, priorita, nome, geom,
             indirizzo, orari, accessibile, aria_condi, sezione_id, quartiere)
          SELECT
            'comune', NULL, 'biblioteca', ${prio}, ${b.nome},
            ST_SetSRID(ST_MakePoint(${b.lon}, ${b.lat}), 4326),
            ${b.indirizzo}, NULL, NULL, ${b.ariaCondi}, s.id, s.quartiere
          FROM pubblico.sezione s
          WHERE s.comune_istat = ${COMUNE_ISTAT}
            AND NOT s.fittizia
            AND ST_Contains(s.geom, ST_SetSRID(ST_MakePoint(${b.lon}, ${b.lat}), 4326))
          LIMIT 1
          RETURNING id, quartiere
        )
        SELECT * FROM inserted
      `;
      if (row.length === 0) {
        process.stderr.write(`[comune] "${b.nome}" a ${b.lat},${b.lon} fuori comune 037006\n`);
        comuneFuori++;
      } else {
        comuneDentro++;
        process.stderr.write(
          `[comune] "${b.nome}" (AC=${b.ariaCondi ? "sì" : "no"}, prio=${prio}) → sezione ${row[0]!.id}, quartiere ${row[0]!.quartiere ?? "n.d."}\n`
        );
      }
    }
    process.stderr.write(`--- Comunali: dentro ${comuneDentro}, fuori ${comuneFuori}\n`);

    // 6. Report finale per tipo (Bologna sola)
    const perTipo = await sql<Array<{ tipo: TipoPunto; fonte: string; n: number }>>`
      SELECT pf.tipo, pf.fonte, count(*)::int AS n
        FROM pubblico.punto_fresco pf
        JOIN pubblico.sezione s ON s.id = pf.sezione_id
       WHERE s.comune_istat = ${COMUNE_ISTAT}
       GROUP BY pf.tipo, pf.fonte
       ORDER BY pf.tipo, pf.fonte
    `;
    process.stderr.write("\n--- Righe in DB per tipo/fonte (Bologna) ---\n");
    for (const r of perTipo) {
      process.stderr.write(`  ${r.tipo.padEnd(20)} ${r.fonte.padEnd(8)} ${r.n}\n`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
