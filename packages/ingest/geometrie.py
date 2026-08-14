"""
CheCaldo! — MOD01: geometrie delle sezioni ISTAT in PostGIS.

Tre passi, ognuno una funzione: si possono lanciare separatamente per
riavviare da un punto senza rifare l'intero modulo.

    1. carica_shapefile  ogr2ogr riproietta EPSG:32632 → 4326, importa il
                          poligono del solo comune di Parma (PRO_COM=34027)
                          in staging.staging_sezione.
    2. aggancia_geom      UPDATE pubblico.sezione s SET geom = ss.geom
                          FROM staging_sezione ss WHERE s.id = ss.sez21_id.
                          Nessun INSERT: le 1.667 righe di Parma esistono
                          già dal caricamento attributivo di istat.py.
    3. diagnostica_distanze
                          Prima di scegliere quale misura mettere in
                          calcola_distanze_fresco, stampa entrambi i
                          conteggi di sezioni a zero (edge-to-edge vs
                          centroide-a-bordo) più le mediane. La scelta si
                          fa a valle di questi numeri, in accordo con
                          CHECALDO-PROGETTO §12c.

Poi manuale: si aggiorna eventualmente lo schema della function con la
misura scelta, si esegue SELECT pubblico.calcola_distanze_fresco('034027'),
e si rilancia `pnpm carica` per ricalcolare la classifica del giorno con
il fattore lontananza_dal_fresco attivo. I test di @checaldo/scoring
girano ancora su parma-sezioni.json, che va rigenerato separatamente se
si vuole allineare la fixture al DB (vedi §12c "Rimozione di una fonte
di verità doppia").

**Stato**: scheletro. Nessuna funzione implementata. Il file R08_21.zip
non è ancora in `data/`, senza il quale carica_shapefile fallirebbe.

SPDX-License-Identifier: AGPL-3.0-or-later
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import urllib.parse
from pathlib import Path

import psycopg2


COMUNE_ISTAT_PARMA = "034027"
PRO_COM_PARMA = 34027   # nello shapefile ISTAT il campo PRO_COM è numerico
STAGING_TABLE = "staging.staging_sezione"


def _dsn_pg_prefix(database_url: str) -> str:
    """Trasforma postgresql://user:pass@host:port/db in stringa PG: per ogr2ogr."""
    p = urllib.parse.urlparse(database_url)
    parts = []
    if p.hostname:  parts.append(f"host={p.hostname}")
    if p.port:      parts.append(f"port={p.port}")
    if p.path:      parts.append(f"dbname={p.path.lstrip('/')}")
    if p.username:  parts.append(f"user={p.username}")
    if p.password:  parts.append(f"password={p.password}")
    return "PG:" + " ".join(parts)


def carica_shapefile(shp_path: Path, database_url: str) -> None:
    """
    Crea (se manca) lo schema staging, poi:

        ogr2ogr -f PostgreSQL PG:<dsn> <shp>
          -t_srs EPSG:4326
          -where "PRO_COM = 34027"
          -nlt MULTIPOLYGON
          -nln staging.staging_sezione
          -overwrite --config PG_USE_COPY YES

    Solo Parma (~1.667 poligoni), riproiettati in EPSG:4326. Il -overwrite
    è idempotente sul carico: rilanciare non duplica. Sui livelli superiori
    (aggancia_geom) l'idempotenza sta nell'UPDATE su chiave.
    """
    with psycopg2.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS staging")

    dsn = _dsn_pg_prefix(database_url)
    cmd = [
        "ogr2ogr",
        "-f", "PostgreSQL", dsn, str(shp_path),
        "-t_srs", "EPSG:4326",
        "-where", f"PRO_COM = {PRO_COM_PARMA}",
        "-nlt", "MULTIPOLYGON",
        "-nln", STAGING_TABLE,
        "-overwrite",
        "--config", "PG_USE_COPY", "YES",
    ]
    subprocess.run(cmd, check=True)


def aggancia_geom(database_url: str) -> int:
    """
    UPDATE `pubblico.sezione` sulla chiave `SEZ21_ID`.

    In staging il campo arriva come Integer64: nel DB `pubblico.sezione.id`
    è `text` e per il comune di Parma perde il primo zero del comune
    (`034027 → 340270000001` per sez21=1). Il join è quindi
    `s.id = ss.sez21_id::text`.

    ST_Multi() forza MultiPolygon (colonna `geometry(MultiPolygon, 4326)`);
    ST_MakeValid() è preventivo — se qualche poligono ISTAT è invalido, non
    voglio scoprirlo al primo ST_Distance.
    """
    with psycopg2.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(f"""
            UPDATE pubblico.sezione s
               SET geom = ST_Multi(ST_MakeValid(ss.wkb_geometry))
              FROM {STAGING_TABLE} ss
             WHERE s.id = ss.sez21_id::text
               AND s.comune_istat = %s
        """, (COMUNE_ISTAT_PARMA,))
        return cur.rowcount


def conta_agganciate(database_url: str) -> dict:
    """
    Conteggi post-aggancio: quante righe di Parma hanno geom, quante no,
    e — se ce ne sono senza geom — un campione dei loro id/sez21/tipo per
    diagnosi. Il chiamante decide se fermarsi (mismatch di chiave, riga in
    DB senza corrispondenza nello shapefile, o viceversa).
    """
    with psycopg2.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT count(*), count(geom), count(*) - count(geom) "
            "  FROM pubblico.sezione WHERE comune_istat = %s",
            (COMUNE_ISTAT_PARMA,),
        )
        tot, con_geom, senza_geom = cur.fetchone()
        senza_campione = []
        if senza_geom > 0:
            cur.execute(
                "SELECT id, sez21, tipo_sezione, popolazione, fittizia "
                "  FROM pubblico.sezione "
                " WHERE comune_istat = %s AND geom IS NULL "
                " ORDER BY sez21 LIMIT 20",
                (COMUNE_ISTAT_PARMA,),
            )
            senza_campione = [
                {"id": r[0], "sez21": r[1], "tipo": r[2],
                 "popolazione": r[3], "fittizia": r[4]}
                for r in cur.fetchall()
            ]
        # invarianti minime
        cur.execute(
            "SELECT count(*) FILTER (WHERE ST_SRID(geom) <> 4326), "
            "       count(*) FILTER (WHERE NOT ST_IsValid(geom)) "
            "  FROM pubblico.sezione "
            " WHERE comune_istat = %s AND geom IS NOT NULL",
            (COMUNE_ISTAT_PARMA,),
        )
        srid_diverso, invalide = cur.fetchone()
    return {
        "totali": tot,
        "con_geom": con_geom,
        "senza_geom": senza_geom,
        "srid_diverso_da_4326": srid_diverso,
        "geometrie_invalide": invalide,
        "campione_senza_geom": senza_campione,
    }


def diagnostica_distanze(database_url: str) -> dict:
    """
    Tre misure affiancate: edge-to-edge (poligono→poligono),
    centroide→bordo, point-on-surface→bordo. Nessuna scrittura, tutto in
    RAM su una CTE — così se scegli di cambiare misura in schema, non hai
    già scritto valori dell'altra.

    Perché ST_PointOnSurface: `ST_Centroid` di un poligono concavo o
    multiparte può cadere *fuori* dal poligono stesso e finire dentro una
    sezione confinante — nei casi visibili è la sezione-parco vicina e
    genera uno zero, nei casi meno visibili è un'altra residenziale e
    produce una distanza calcolata da un punto in cui non abita nessuno,
    senza che il valore sia mai zero. `ST_PointOnSurface` garantisce un
    punto interno al poligono per costruzione (via ST_MaximumInscribedCircle
    o equivalente), rimuovendo la classe intera di errori.
    """
    with psycopg2.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute("""
            WITH fresche AS (
              SELECT geom FROM pubblico.sezione
               WHERE comune_istat = %(c)s
                 AND tipo_sezione IN (5, 22, 23)
                 AND geom IS NOT NULL
            ),
            residenziali AS (
              SELECT id, geom FROM pubblico.sezione
               WHERE comune_istat = %(c)s
                 AND NOT fittizia
                 AND tipo_sezione = 1
                 AND popolazione > 0
                 AND geom IS NOT NULL
            ),
            distanze AS (
              SELECT r.id,
                     (SELECT min(ST_Distance(r.geom::geography, f.geom::geography))
                        FROM fresche f) AS d_edge,
                     (SELECT min(ST_Distance(ST_Centroid(r.geom)::geography,
                                             f.geom::geography))
                        FROM fresche f) AS d_centroide,
                     (SELECT min(ST_Distance(ST_PointOnSurface(r.geom)::geography,
                                             f.geom::geography))
                        FROM fresche f) AS d_pos
                FROM residenziali r
            )
            SELECT count(*)                                                AS n,
                   count(*) FILTER (WHERE d_edge      = 0)                 AS zero_edge,
                   count(*) FILTER (WHERE d_centroide = 0)                 AS zero_centroide,
                   count(*) FILTER (WHERE d_pos       = 0)                 AS zero_pos,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY d_edge)     AS med_edge,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY d_centroide) AS med_centroide,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY d_pos)      AS med_pos,
                   percentile_cont(0.9) WITHIN GROUP (ORDER BY d_edge)     AS p90_edge,
                   percentile_cont(0.9) WITHIN GROUP (ORDER BY d_centroide) AS p90_centroide,
                   percentile_cont(0.9) WITHIN GROUP (ORDER BY d_pos)      AS p90_pos
              FROM distanze
        """, {"c": COMUNE_ISTAT_PARMA})
        r = cur.fetchone()
        (n, ze, zc, zp, med_e, med_c, med_p, p90_e, p90_c, p90_p) = r
    return {
        "residenziali_valutate": n,
        "zero_edge": ze,
        "zero_centroide": zc,
        "zero_pos": zp,
        "mediana_edge_m": float(med_e or 0),
        "mediana_centroide_m": float(med_c or 0),
        "mediana_pos_m": float(med_p or 0),
        "p90_edge_m": float(p90_e or 0),
        "p90_centroide_m": float(p90_c or 0),
        "p90_pos_m": float(p90_p or 0),
    }


def verifica_fittizia(database_url: str) -> dict:
    """
    Vedi docstring del §"Verifica speciale sulla sezione fittizia di Parma"
    in `moduli/MOD01-geometrie.md`. Restituisce i sei campi che servono
    a decidere se fermarsi o proseguire.
    """
    ID = "340278888888"
    with psycopg2.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT geom IS NOT NULL,
                   ST_Area(geom::geography),
                   ST_X(ST_Centroid(geom)),
                   ST_Y(ST_Centroid(geom))
              FROM pubblico.sezione
             WHERE id = %s
        """, (ID,))
        row = cur.fetchone()
        if row is None:
            return {"geom_presente": False, "errore": f"riga {ID} non esiste"}
        geom_presente, area_m2, lon, lat = row

        parchi = []
        if geom_presente:
            cur.execute("""
                SELECT s.id, s.sez21, s.tipo_sezione, s.quartiere
                  FROM pubblico.sezione s,
                       pubblico.sezione f
                 WHERE f.id = %s AND s.id <> f.id
                   AND s.comune_istat = f.comune_istat
                   AND s.tipo_sezione IN (5, 22, 23)
                   AND s.geom IS NOT NULL
                   AND ST_Intersects(s.geom, f.geom)
            """, (ID,))
            parchi = [
                {"id": r[0], "sez21": r[1], "tipo": r[2], "quartiere": r[3]}
                for r in cur.fetchall()
            ]

        # Ricalcola dal vivo la difesa della function, senza fidarsi solo dello schema.
        cur.execute("""
            SELECT EXISTS(
              SELECT 1 FROM pubblico.sezione
               WHERE id = %s AND tipo_sezione IN (5, 22, 23)
            )
        """, (ID,))
        entra_fra_fresche = cur.fetchone()[0]

        cur.execute(
            "SELECT metri_da_punto_fresco FROM pubblico.sezione WHERE id = %s",
            (ID,),
        )
        distanza = cur.fetchone()[0]

    return {
        "id": ID,
        "geom_presente": bool(geom_presente),
        "area_m2": float(area_m2) if geom_presente else None,
        "centroide_lonlat": [float(lon), float(lat)] if geom_presente else None,
        "parchi_intersecati": parchi,
        "entra_fra_fresche": bool(entra_fra_fresche),
        "riceve_distanza": distanza is not None,
        "valore_distanza_m": float(distanza) if distanza is not None else None,
    }


def esegui_calcola_distanze(database_url: str) -> int:
    """SELECT pubblico.calcola_distanze_fresco('034027') — restituisce le righe UPDATE."""
    with psycopg2.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT pubblico.calcola_distanze_fresco(%s)",
            (COMUNE_ISTAT_PARMA,),
        )
        return cur.fetchone()[0]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--shp", type=Path,
        default=Path("/app/data/R08_21_WGS84.shp"),
        help="path allo shapefile (nel container). Default: data/R08_21_WGS84.shp",
    )
    ap.add_argument(
        "--passo",
        choices=["carica", "aggancia", "diagnostica", "verifica-fittizia", "tutto"],
        default="tutto",
        help="quale passo eseguire; 'tutto' li fa in sequenza",
    )
    a = ap.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL non impostata")

    if a.passo in ("carica", "tutto"):
        if not a.shp.exists():
            sys.exit(f"shapefile non trovato: {a.shp}")
        carica_shapefile(a.shp, url)

    if a.passo in ("aggancia", "tutto"):
        n = aggancia_geom(url)
        print(f"agganciate geometrie a {n} righe di pubblico.sezione")
        c = conta_agganciate(url)
        print(
            f"Parma: {c['con_geom']}/{c['totali']} con geom, "
            f"{c['senza_geom']} senza. "
            f"SRID != 4326: {c['srid_diverso_da_4326']}. "
            f"Geometrie invalide: {c['geometrie_invalide']}."
        )
        if c["senza_geom"] > 0 or c["srid_diverso_da_4326"] > 0 or c["geometrie_invalide"] > 0:
            if c["campione_senza_geom"]:
                print("Campione righe senza geom (fino a 20):")
                for r in c["campione_senza_geom"]:
                    print(f"  id={r['id']} sez21={r['sez21']} tipo={r['tipo']} "
                          f"pop={r['popolazione']} fittizia={r['fittizia']}")
            sys.exit("aggancio incompleto: fermo prima della diagnostica")

    if a.passo in ("diagnostica", "tutto"):
        d = diagnostica_distanze(url)
        print(f"\nresidenziali abitate valutate: {d['residenziali_valutate']}")
        print("misura                | a 0 m | mediana (m) | p90 (m)")
        print("-" * 55)
        print(f"edge-to-edge          | {d['zero_edge']:>5} | "
              f"{d['mediana_edge_m']:>10.1f} | {d['p90_edge_m']:>8.1f}")
        print(f"centroide-a-bordo     | {d['zero_centroide']:>5} | "
              f"{d['mediana_centroide_m']:>10.1f} | {d['p90_centroide_m']:>8.1f}")
        print(f"point-on-surface      | {d['zero_pos']:>5} | "
              f"{d['mediana_pos_m']:>10.1f} | {d['p90_pos_m']:>8.1f}")

    if a.passo in ("verifica-fittizia", "tutto"):
        v = verifica_fittizia(url)
        print(f"\nfittizia {v['id']} (Parma, popolazione=330):")
        print(f"  geom presente          : {v['geom_presente']}")
        if v['geom_presente']:
            print(f"  area (m²)              : {v['area_m2']:.0f}")
            print(f"  centroide (lon,lat)    : {v['centroide_lonlat']}")
            print(f"  parchi intersecati     : {v['parchi_intersecati']}")
        print(f"  entra fra le fresche   : {v['entra_fra_fresche']}  (atteso: False)")
        print(f"  riceve una distanza    : {v['riceve_distanza']}    (atteso: False)")
        if v.get('valore_distanza_m') is not None:
            print(f"    valore distanza (m)  : {v['valore_distanza_m']:.1f}")


if __name__ == "__main__":
    main()
