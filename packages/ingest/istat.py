# SPDX-License-Identifier: AGPL-3.0-or-later
"""
CheCaldo! — ingestione delle sezioni di censimento ISTAT.

Uso:
    python istat.py R08_21.xlsx 034027 --out sezioni.json
    python istat.py R08_21.xlsx 034027 --sql --out carica.sql

Sorgente: basi territoriali ISTAT 2021, licenza CC-BY 4.0.
    https://www.istat.it/storage/cartografia/basi_territoriali/2021/R08_21.zip

Nota sui sistemi di riferimento: lo shapefile arriva in EPSG:32632
(WGS 84 UTM 32N). Va riproiettato una volta in EPSG:4326 al caricamento.
L'incoerenza fra CRS non solleva errori: restituisce distanze sbagliate.

Questo script legge il foglio Excel di corredo, che contiene gli stessi
attributi dello shapefile senza geometrie. Per le geometrie serve lo
shapefile e GeoPandas: vedi carica_geometrie() in fondo.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

# COD_TIPO_S delle sezioni che offrono raffrescamento.
TIPI_FRESCHI = {5, 22, 23}
TIPO_RESIDENZIALE = 1

CAMPI_NUMERICI = [
    "PRO_COM", "SEZ21", "SEZ21_ID", "COD_TIPO_S", "TIPO_LOC",
    "POP21", "FAM21", "ABI21", "EDI21", "COM_ASC1",
]


def e_fittizia(sez21: int) -> bool:
    """
    Sezioni fittizie ISTAT.

    I codici 8888881-8888889 collocano le persone senza dimora iscritte in
    anagrafe a un indirizzo convenzionale. ISTAT le disegna in un'area
    disabitata, di norma un parco urbano vicino alla casa comunale.

    Vanno escluse dal punteggio: contengono persone reali in un poligono
    geograficamente falso che, essendo un parco, avrebbe il punteggio termico
    più basso possibile. Il limite va dichiarato nel README, non nascosto:
    le persone senza dimora sono tra le più esposte al caldo e questo
    sistema non le può trattare perché il loro dato geografico non esiste.
    """
    return 8888881 <= sez21 <= 8888889 or sez21 in (999999, 9999998, 9999999)


def _foglio(xlsx: Path, nome: str) -> pd.DataFrame:
    """Legge un foglio ISTAT saltando la riga di titolo."""
    raw = pd.read_excel(xlsx, sheet_name=nome, skiprows=1)
    intestazioni = raw.iloc[0].tolist()
    df = raw.iloc[1:].copy()
    df.columns = intestazioni
    return df


def leggi_sezioni(xlsx: Path, comune_istat: str) -> pd.DataFrame:
    pro_com = int(comune_istat)
    regione = xlsx.stem.split("_")[0]

    df = _foglio(xlsx, f"SEZ_{regione}_21")
    for c in CAMPI_NUMERICI:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df[df.PRO_COM == pro_com].copy()
    if df.empty:
        sys.exit(f"nessuna sezione per PRO_COM {pro_com} in {xlsx.name}")

    # Nomi dei quartieri: disponibili solo per 76 comuni, fra cui Parma e Bologna.
    try:
        asc = _foglio(xlsx, f"ASC1_{regione}_21")
        asc["COM_ASC1"] = pd.to_numeric(asc["COM_ASC1"], errors="coerce")
        col = next(c for c in asc.columns if "DEN" in str(c).upper())
        nomi = dict(zip(asc.COM_ASC1, asc[col]))
    except (ValueError, StopIteration):
        nomi = {}

    df["quartiere"] = df.COM_ASC1.map(nomi)
    df["fittizia"] = df.SEZ21.apply(e_fittizia)
    return df


def a_record(df: pd.DataFrame, comune_istat: str) -> list[dict]:
    out = []
    for _, r in df.iterrows():
        q = r.get("quartiere")
        out.append({
            "id": str(int(r.SEZ21_ID)),
            "comuneIstat": comune_istat,
            "sez21": int(r.SEZ21),
            "quartiere": None if pd.isna(q) else str(q),
            "popolazione": int(r.POP21) if pd.notna(r.POP21) else 0,
            "famiglie": int(r.FAM21) if pd.notna(r.FAM21) else 0,
            "abitazioni": int(r.ABI21) if pd.notna(r.ABI21) else 0,
            "edificiResidenziali": int(r.EDI21) if pd.notna(r.EDI21) else 0,
            "tipoSezione": int(r.COD_TIPO_S) if pd.notna(r.COD_TIPO_S) else 99,
            "fittizia": bool(r.fittizia),
        })
    return out


def riepilogo(rec: list[dict]) -> None:
    tot = len(rec)
    fitt = [r for r in rec if r["fittizia"]]
    res = [r for r in rec if r["tipoSezione"] == TIPO_RESIDENZIALE
           and r["popolazione"] > 0 and r["famiglie"] > 0 and not r["fittizia"]]
    fresche = [r for r in rec if r["tipoSezione"] in TIPI_FRESCHI]
    quartieri = {r["quartiere"] for r in rec if r["quartiere"]}

    print(f"sezioni totali:            {tot:>7,}")
    print(f"residenziali abitate:      {len(res):>7,}")
    print(f"fresche (verde e acqua):   {len(fresche):>7,}")
    print(f"fittizie da escludere:     {len(fitt):>7,}"
          f"  (popolazione: {sum(r['popolazione'] for r in fitt):,})")
    print(f"quartieri:                 {len(quartieri):>7,}")
    print(f"popolazione residenziale:  {sum(r['popolazione'] for r in res):>7,}")

    if len(fresche) < 20:
        print(f"\n  Attenzione: solo {len(fresche)} sezioni fresche. La distanza dal punto")
        print("  fresco cattura i parchi che hanno una sezione propria, non il verde")
        print("  di quartiere. Dichiararlo come 'distanza dal parco urbano'.")


def a_sql(rec: list[dict]) -> str:
    """
    Genera l'INSERT senza geometrie: le geometrie arrivano dallo shapefile.
    La riproiezione va fatta al caricamento, una volta.
    """
    righe = []
    for r in rec:
        q = "NULL" if r["quartiere"] is None else "'" + r["quartiere"].replace("'", "''") + "'"
        righe.append(
            f"('{r['id']}','{r['comuneIstat']}',{r['sez21']},{q},"
            f"{r['popolazione']},{r['famiglie']},{r['abitazioni']},"
            f"{r['edificiResidenziali']},{r['tipoSezione']})"
        )
    return (
        "INSERT INTO pubblico.sezione\n"
        "  (id, comune_istat, sez21, quartiere, popolazione, famiglie,\n"
        "   abitazioni, edifici_residenziali, tipo_sezione)\nVALUES\n  "
        + ",\n  ".join(righe)
        + "\nON CONFLICT (id) DO UPDATE SET\n"
        "  popolazione = EXCLUDED.popolazione,\n"
        "  famiglie = EXCLUDED.famiglie,\n"
        "  abitazioni = EXCLUDED.abitazioni,\n"
        "  edifici_residenziali = EXCLUDED.edifici_residenziali;\n"
    )


def carica_geometrie(shp: Path, comune_istat: str, tabella="pubblico.sezione"):
    """
    Le geometrie richiedono GeoPandas. Da eseguire una volta sola.

        import geopandas as gpd
        g = gpd.read_file(shp)
        g = g[g.PRO_COM == int(comune_istat)]
        g = g.to_crs(4326)              # da EPSG:32632, obbligatorio
        g.to_postgis(tabella, engine, if_exists="append")

    In alternativa, senza Python, con ogr2ogr:

        ogr2ogr -f PostgreSQL PG:"$DATABASE_URL" R08_21_WGS84.shp \\
          -nln pubblico.sezione -t_srs EPSG:4326 \\
          -where "PRO_COM = 34027" -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom
    """
    raise NotImplementedError(carica_geometrie.__doc__)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("xlsx", type=Path, help="R08_21.xlsx dal pacchetto ISTAT")
    ap.add_argument("comune", help="codice ISTAT a 6 cifre, es. 034027 per Parma")
    ap.add_argument("--out", type=Path, help="file di uscita")
    ap.add_argument("--sql", action="store_true", help="genera SQL invece di JSON")
    a = ap.parse_args()

    rec = a_record(leggi_sezioni(a.xlsx, a.comune), a.comune)
    riepilogo(rec)

    if a.out:
        testo = a_sql(rec) if a.sql else json.dumps(rec, ensure_ascii=False, indent=1)
        a.out.write_text(testo, encoding="utf-8")
        print(f"\nscritto {a.out} ({a.out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
