/**
 * CheCaldo! — geocoder Nominatim per il percorso di import CSV reale.
 *
 * NON chiamato dal generatore sintetico (decisione MOD02: nel sintetico
 * l'indirizzo è finto e la sezione viene assegnata direttamente).
 *
 * Nominatim ha fair-use policy pubblica: 1 request/second. Il wrapper
 * serializza le chiamate con un mutex a scarto costante.
 *
 * Il ponte a sezioneId (via ST_Contains sulle geometrie ISTAT) è
 * responsabilità di MOD01. Qui restituisco lat/lon + livello di fiducia.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface Punto {
  lat: number;
  lon: number;
  /** True quando Nominatim risolve al centro via/quartiere, non al civico. */
  posizioneIncerta: boolean;
  /** Testo esatto restituito da Nominatim, per audit. */
  display?: string;
}

export interface Geocoder {
  risolvi(indirizzo: string): Promise<Punto | null>;
}

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  /** address_type indica il livello di match: house/road/suburb/city ecc. */
  addresstype?: string;
  importance?: number;
}

export interface OpzioniNominatim {
  /** Base URL, default env NOMINATIM_URL o public. */
  baseUrl?: string;
  /** viewbox: lon_min,lat_max,lon_max,lat_min (Nominatim vuole quest'ordine). */
  viewbox: [number, number, number, number];
  /** Deve essere descrittivo per la fair-use policy di Nominatim. */
  userAgent?: string;
  /** Ms fra richieste. Default 1100 (poco più di 1 req/s). */
  intervalloMs?: number;
}

const PUBLIC = "https://nominatim.openstreetmap.org";

export class NominatimGeocoder implements Geocoder {
  private baseUrl: string;
  private viewbox: [number, number, number, number];
  private userAgent: string;
  private intervalloMs: number;
  private ultimaChiamata = 0;

  constructor(opz: OpzioniNominatim) {
    this.baseUrl = opz.baseUrl ?? process.env.NOMINATIM_URL ?? PUBLIC;
    this.viewbox = opz.viewbox;
    this.userAgent = opz.userAgent ?? "checaldo/0.1 (self-hosted; MOD02 geocoder)";
    this.intervalloMs = opz.intervalloMs ?? 1100;
  }

  async risolvi(indirizzo: string): Promise<Punto | null> {
    await this.attendi();
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", indirizzo);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "0");
    url.searchParams.set(
      "viewbox",
      `${this.viewbox[0]},${this.viewbox[1]},${this.viewbox[2]},${this.viewbox[3]}`,
    );
    url.searchParams.set("bounded", "1");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": this.userAgent, "Accept": "application/json" },
    });
    if (!res.ok) return null;
    const hits = (await res.json()) as NominatimHit[];
    const primo = hits[0];
    if (!primo) return null;
    return {
      lat: Number(primo.lat),
      lon: Number(primo.lon),
      posizioneIncerta: primo.addresstype !== "house",
      display: primo.display_name,
    };
  }

  private async attendi(): Promise<void> {
    const passato = Date.now() - this.ultimaChiamata;
    const rimanente = this.intervalloMs - passato;
    if (rimanente > 0) await new Promise((r) => setTimeout(r, rimanente));
    this.ultimaChiamata = Date.now();
  }
}

/** Stub per test: risolve solo indirizzi noti a un punto fissato. */
export class GeocoderStatico implements Geocoder {
  constructor(private mappa: Map<string, Punto>) {}
  async risolvi(indirizzo: string): Promise<Punto | null> {
    return this.mappa.get(indirizzo.trim().toLowerCase()) ?? null;
  }
}
