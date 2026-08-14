/**
 * Estrazione delle vie di un comune da OSM.
 *
 * Parametri:
 *   --slug <parma|bologna|...>   comune target (default: parma).
 *
 * Comportamento:
 *   1. Se esiste `packages/fixtures/data/overpass-raw-{slug}.json`
 *      (per Parma: `overpass-raw.json`, senza suffisso — retro-compat)
 *      lo processa senza fare fetch. Sul VPS Overpass può non essere
 *      raggiungibile: partire dal raw scaricato a mano è la strada
 *      canonica in produzione.
 *   2. Altrimenti chiama Overpass API con la bbox del comune. Timeout
 *      90s. Se fallisce, exit 2 — nessun ripiego su faker.
 *
 * Output: `packages/fixtures/data/vie-{slug}.json` (versionato).
 *
 * Dati OpenStreetMap, licenza ODbL 1.0 — attribuzione nell'header del JSON.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ENDPOINT = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const TIMEOUT_MS = 90_000;

// Bbox per comune: coppia (bbox, path raw file di backup).
// Il raw è "overpass-raw.json" per Parma (esistente storico, senza slug)
// e "overpass-raw-<slug>.json" per gli altri. Non rinominato il file di
// Parma per non rompere riferimenti storici.
interface Config { bbox: string; rawFileName: string }
const CONFIG: Record<string, Config> = {
  parma:   { bbox: "44.72,10.22,44.87,10.45", rawFileName: "overpass-raw.json" },
  bologna: { bbox: "44.42,11.23,44.56,11.43", rawFileName: "overpass-raw-bologna.json" },
};

function argValue(nome: string, def: string): string {
  const idx = process.argv.indexOf(`--${nome}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]!;
  return def;
}

function buildQuery(bbox: string): string {
  return `
[out:json][timeout:60];
(
  way["highway"~"^(residential|primary|secondary|tertiary|unclassified|living_street)$"]["name"](${bbox});
);
out tags;
`.trim();
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: { name?: string; highway?: string };
}
interface OverpassResponse {
  elements: OverpassElement[];
}

async function fetchOverpass(bbox: string): Promise<OverpassResponse> {
  process.stderr.write(`chiamo ${ENDPOINT} (timeout ${TIMEOUT_MS / 1000}s)...\n`);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      body: "data=" + encodeURIComponent(buildQuery(bbox)),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "checaldo-fixtures/0.1 (self-hosted; MOD02 street corpus)",
      },
      signal: ac.signal,
    });
  } catch (e) {
    process.stderr.write(`Overpass non raggiungibile: ${(e as Error).message}\n`);
    process.stderr.write("Fermo lo script. Non ripiego su faker (decisione utente).\n");
    process.exit(2);
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    process.stderr.write(`Overpass ha risposto ${res.status} ${res.statusText}\n`);
    process.exit(2);
  }
  return (await res.json()) as OverpassResponse;
}

async function main() {
  const slug = argValue("slug", "parma");
  const cfg = CONFIG[slug];
  if (!cfg) {
    process.stderr.write(`slug sconosciuto: ${slug}. Aggiungi bbox+rawFileName a CONFIG.\n`);
    process.exit(1);
  }

  const dataDir = join(__dirname, "..", "data");
  const rawPath = join(dataDir, cfg.rawFileName);

  let data: OverpassResponse;
  if (existsSync(rawPath)) {
    process.stderr.write(`leggo raw esistente: ${rawPath}\n`);
    data = JSON.parse(readFileSync(rawPath, "utf8")) as OverpassResponse;
  } else {
    data = await fetchOverpass(cfg.bbox);
    mkdirSync(dirname(rawPath), { recursive: true });
    writeFileSync(rawPath, JSON.stringify(data), "utf8");
    process.stderr.write(`salvato raw: ${rawPath}\n`);
  }

  process.stderr.write(`ricevute ${data.elements.length} way\n`);

  const nomi = new Set<string>();
  for (const el of data.elements) {
    const nome = el.tags?.name?.trim();
    if (nome && nome.length > 0) nomi.add(nome);
  }
  const vie = [...nomi].sort((a, b) => a.localeCompare(b, "it"));
  process.stderr.write(`vie distinte con nome: ${vie.length}\n`);

  if (vie.length < 100) {
    process.stderr.write(`Trovate solo ${vie.length} vie: sospetta estrazione errata. Fermo.\n`);
    process.exit(3);
  }

  const output = {
    note: `Vie del comune (${slug}) per il generatore sintetico. NON MODIFICARE A MANO: rigenerare con \`pnpm --filter @checaldo/fixtures estrai-vie -- --slug ${slug}\`.`,
    fonte: "OpenStreetMap contributors",
    licenza: "ODbL 1.0 — https://www.openstreetmap.org/copyright",
    estrattoIl: new Date().toISOString().slice(0, 10),
    numero: vie.length,
    vie,
  };

  const outPath = join(dataDir, `vie-${slug}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  process.stderr.write(`scritto ${outPath}\n`);
}

main().catch((e) => {
  process.stderr.write(`errore: ${e?.message ?? e}\n`);
  process.exit(1);
});
