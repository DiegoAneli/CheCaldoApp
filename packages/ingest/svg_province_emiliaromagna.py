# SPDX-License-Identifier: AGPL-3.0-or-later
"""
CheCaldo! — cartina SVG delle province dell'Emilia-Romagna.

Genera un SVG con tre geometrie:
    1. contorno esterno della regione (unione di TUTTE le sezioni non
       fittizie, senza confini interni);
    2. provincia di Parma  (COD_UTS = 34);
    3. città metropolitana di Bologna (COD_UTS = 237).

Le province diverse da Parma e Bologna NON compaiono come poligoni
separati: sono "assorbite" dentro il contorno regione. Motivo
(decisione CHECALDO-PROGETTO §12ll): (a) nella home solo Parma e
Bologna sono cliccabili, le altre sette sarebbero decorazione;
(b) senza confini interni si evita il gap topologico che nasce
semplificando province adiacenti in modo indipendente; (c) il file
cala parecchio.

Uso:
    docker compose run --rm ingest python \\
        packages/ingest/svg_province_emiliaromagna.py
    docker compose run --rm ingest python \\
        packages/ingest/svg_province_emiliaromagna.py --rigenera

Input:  data/R08_21_WGS84.shp (Emilia-Romagna, EPSG:32632).
Output: apps/web/public/emilia-romagna-province.svg (committato).
Cache:  data/cache-svg/{regione,parma,bologna}.geojson (in .gitignore).

**Cache dell'unione**: unary_union su 60k poligoni costa minuti.
Iterare sulle costanti di tolleranza rifacendo l'unione ogni volta è
uno spreco — i tre GeoJSON dissolti vengono scritti in
data/cache-svg/ e riletti da lì. Passare --rigenera per invalidarla
(es. dopo aggiornamento dello shapefile).

Script one-shot. Le basi territoriali ISTAT 2021 sono ferme fino al
prossimo censimento — non c'è motivo di rilanciarlo a ogni build.
Il file di uscita entra nel repo come qualsiasi altro asset statico.

Sorgente: basi territoriali ISTAT 2021, licenza CC-BY 4.0.
    https://www.istat.it/storage/cartografia/basi_territoriali/2021/R08_21.zip

Proiezione: EPSG:32632 (WGS 84 / UTM zone 32N). Nessuna riproiezione:
l'Emilia-Romagna sta tutta dentro la zona 32N, la distorsione a
questa scala è invisibile, l'aspetto nord-in-alto è quello canonico.

Semplificazione: Douglas-Peucker via shapely.simplify() con tolerance
in metri (unità del CRS 32632). **Tolleranza uniforme 300 m** per
tutte e tre le geometrie: con i micro-buchi rimossi (vedi sotto),
la regione a 300 m sta a ~2000 vertici / ~10 KB, il totale intorno
ai 13-15 KB. La differenziazione precedente (1500 m per regione)
serviva a compensare la spazzatura non filtrata negli interior
rings, non a un'esigenza reale della resa.

**Pulizia dei micro-buchi**: unary_union su 60k sezioni ISTAT
adiacenti non chiude perfettamente le fessure fra sezioni — restano
interior rings da poche centinaia di metri di lato, invisibili a
qualunque zoom sensato ma pesanti in path SVG (con quadrilateri
degeneri che si ripetono ~400 volte). Il filtro `rimuovi_buchi_micro`
scarta gli interior rings sotto SOGLIA_KM2 da ogni Polygon del
MultiPolygon, non solo le parti esterne. Applicato PRIMA della
semplificazione, sulla geometria cruda: se un buco è sotto 1 km²
prima di semplificare, dopo lo sarà comunque.

**Filtro exclave**: la regione dopo unary_union è un MultiPolygon
di 4 pezzi — 1 principale (22.500 km²) e 3 piccoli (0.4 km² totali,
sezioni ISTAT amministrativamente in ER ma geograficamente enclavate
altrove). Le sub-parti sotto SOGLIA_KM2 vengono scartate: sono
~500 m di lato = ~1 px a viewBox 1000 = invisibili.

I decimali si tengono a 1, che a viewBox 1000 unità valgono ~28 m
nella scala reale (0.1/1000 * 285 km). Alzare la tolleranza degrada
in modo più naturale del ridurre i decimali di stampa.

Attribuzione: la stringa nel <desc> dell'SVG cita ISTAT + versione +
licenza. L'attribuzione visibile in pagina è nel footer del sito.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from shapely.geometry import Polygon, MultiPolygon, mapping, shape
from shapely.ops import unary_union


# Codici COD_UTS delle due province cliccabili nella home. Verificati
# empiricamente sul file: le città metropolitane hanno codice 2xx
# invece del codice provinciale storico (Bologna = 237, non 37).
# COD_UTS dell'Emilia-Romagna: 33 Piacenza, 34 Parma, 35 Reggio Emilia,
# 36 Modena, 237 Città metropolitana Bologna, 38 Ferrara, 39 Ravenna,
# 40 Forlì-Cesena, 99 Rimini.
UTS_PARMA = 34
UTS_BOLOGNA = 237

# Codice ISTAT della regione (COD_REG per l'Emilia-Romagna).
COD_REG_EMILIA_ROMAGNA = 8

# Sezioni fittizie ISTAT — vanno escluse prima dell'unione. Motivo in
# packages/ingest/istat.py::e_fittizia().
CLAUSOLA_NON_FITTIZIA = (
    "(SEZ21 < 8888881 OR SEZ21 > 8888889) "
    "AND SEZ21 NOT IN (999999, 9999998, 9999999)"
)

# Tolleranze in metri. Uniforme a 300 m dopo aver risolto la
# spazzatura degli interior rings (§12ll correzione del 2026-08-05).
TOL_REGIONE_M = 300
TOL_PROVINCIA_M = 300
SOGLIA_KB = 25

# Soglia di area sotto la quale:
#   - le sub-parti esterne del MultiPolygon regione vengono scartate;
#   - gli interior rings dei singoli Polygon vengono rimossi.
# 1 km² = ~500 m di lato = ~1 px a viewBox 1000, invisibili a
# qualunque zoom praticabile a schermo.
SOGLIA_KM2 = 1.0

# viewBox — dimensione dell'asse maggiore in unità SVG. Il minore
# viene proporzionale al bounding box reale. 1000 dà precisione ~28 m
# con 1 decimale sui vertici (0.1/1000 * ampiezza_reale).
VIEWBOX_MAJOR = 1000

# Precisione dei vertici nel path SVG (numero di decimali). Un
# decimale su viewBox 1000 = ~28 m reali. Intero (0 decimali) sarebbe
# ~285 m — visibile come scalettatura a 1200 px, evitato.
DECIMALI = 1

# Nessun fill/stroke inline. Il consumatore (componente React server)
# controlla i colori via CSS sulle classi .regione .parma .bologna,
# incluso lo stato hover e il colore d'accento per le due province
# cliccabili. Se aperto standalone in un browser, l'SVG appare nero
# (fill default) sopra sfondo bianco — leggibile come diagnostica.


def estrai_via_ogr(shp: Path, dove: str, out: Path) -> None:
    """
    Chiama ogr2ogr per produrre un GeoJSON con TUTTE le sezioni che
    soddisfano `dove` (clausola WHERE), senza dissolvimento. Emette
    in EPSG:32632 (stesso CRS del sorgente).

    L'unione è fatta in Python (unary_union) invece che via SQL
    aggregata perché ST_Union come aggregata richiede SpatiaLite
    linkato dentro il dialect sqlite di GDAL — il container ha la
    libreria libspatialite ma il dialect standalone non la carica,
    e ST_Union usato come aggregata ritorna feature con geometry
    null. Verificato empiricamente. La strada che funziona è:
    export non-dissolto → shapely.ops.unary_union in memoria.
    """
    if out.exists():
        out.unlink()
    cmd = [
        "ogr2ogr", "-f", "GeoJSON", str(out), str(shp),
        "-where", dove,
    ]
    print(f"  ogr2ogr → {out.name} ({dove[:60]}{'…' if len(dove) > 60 else ''})")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr, file=sys.stderr)
        sys.exit(f"ogr2ogr ha fallito su '{dove}'")


def carica_e_unisci(geojson: Path) -> Polygon | MultiPolygon:
    """
    Legge un GeoJSON con N feature poligonali, costruisce shapely, e
    ritorna l'unione via unary_union. Feature con geometry null
    scartate silenziosamente (non dovrebbero esserci dopo il filtro).
    """
    with geojson.open(encoding="utf-8") as f:
        gj = json.load(f)
    feats = gj.get("features", [])
    polys = [shape(f["geometry"]) for f in feats if f.get("geometry")]
    if not polys:
        sys.exit(f"{geojson.name}: nessuna geometria valida")
    print(f"    {len(polys):,} poligoni → unary_union…")
    return unary_union(polys)


def conta_vertici(g: Polygon | MultiPolygon) -> int:
    """Numero totale di vertici, buchi inclusi. Per il rapporto finale."""
    if isinstance(g, Polygon):
        return len(g.exterior.coords) + sum(
            len(r.coords) for r in g.interiors
        )
    return sum(conta_vertici(p) for p in g.geoms)


def _path_da_anello(coords, sx: float, sy: float, mx: float, my: float) -> str:
    """
    Trasforma un anello (lista di coppie x,y in metri EPSG:32632)
    in un subpath SVG "M x y L x y … z", con coordinate scalate a
    viewBox e arrotondate a DECIMALI cifre.

    Y è invertito: in SVG cresce verso il basso, in UTM verso l'alto.
    """
    def fmt(v: float) -> str:
        s = f"{v:.{DECIMALI}f}"
        # Rimuove ".0" superfluo su interi per risparmiare byte
        # senza perdere precisione.
        return s[:-2] if s.endswith(".0") else s

    parti = []
    primo = True
    for x, y in coords:
        vx = (x - mx) * sx
        vy = (my - y) * sy  # inversione Y
        cmd = "M" if primo else "L"
        parti.append(f"{cmd}{fmt(vx)} {fmt(vy)}")
        primo = False
    parti.append("z")
    return "".join(parti)


def geom_a_path(
    g: Polygon | MultiPolygon,
    sx: float, sy: float, mx: float, my: float,
) -> str:
    """Concatena i subpath di tutti gli anelli (esterni + interni)."""
    if isinstance(g, Polygon):
        d = _path_da_anello(list(g.exterior.coords), sx, sy, mx, my)
        for r in g.interiors:
            d += _path_da_anello(list(r.coords), sx, sy, mx, my)
        return d
    return "".join(geom_a_path(p, sx, sy, mx, my) for p in g.geoms)


def bounding_box_comune(
    geoms: list[Polygon | MultiPolygon],
) -> tuple[float, float, float, float]:
    """(minx, miny, maxx, maxy) su tutte le geometrie."""
    xs, ys = [], []
    for g in geoms:
        x0, y0, x1, y1 = g.bounds
        xs += [x0, x1]
        ys += [y0, y1]
    return min(xs), min(ys), max(xs), max(ys)


def componi_svg(
    regione: Polygon | MultiPolygon,
    parma: Polygon | MultiPolygon,
    bologna: Polygon | MultiPolygon,
) -> str:
    """
    Compone l'SVG finale. Ordine dei path: regione prima (grigia sotto),
    Parma e Bologna sopra — così qualunque piccolo scarto ai bordi
    esterni condivisi cade dietro il layer superiore.
    """
    mx, my_min, mxmax, my_max = bounding_box_comune([regione, parma, bologna])
    w = mxmax - mx
    h = my_max - my_min
    if w >= h:
        vb_w = VIEWBOX_MAJOR
        vb_h = round(VIEWBOX_MAJOR * h / w, DECIMALI)
        sx = sy = VIEWBOX_MAJOR / w
    else:
        vb_h = VIEWBOX_MAJOR
        vb_w = round(VIEWBOX_MAJOR * w / h, DECIMALI)
        sx = sy = VIEWBOX_MAJOR / h

    # my per la trasformazione Y-inversa è il max: (my_max - y) * sy
    d_regione = geom_a_path(regione, sx, sy, mx, my_max)
    d_parma = geom_a_path(parma, sx, sy, mx, my_max)
    d_bologna = geom_a_path(bologna, sx, sy, mx, my_max)

    # Centroidi in unità viewBox: servono al componente React per
    # posizionare le etichette (<text>) senza doverli ricalcolare a
    # runtime. representative_point() invece di centroid() perché su
    # multipoligono/L-shape il centroide può cadere fuori dal poligono.
    def _cxcy(g):
        p = g.representative_point()
        return round((p.x - mx) * sx, DECIMALI), round((my_max - p.y) * sy, DECIMALI)
    cx_pr, cy_pr = _cxcy(parma)
    cx_bo, cy_bo = _cxcy(bologna)

    desc = (
        "Contorno regionale + provincia di Parma (COD_UTS=34) + "
        "città metropolitana di Bologna (COD_UTS=237). "
        "Fonte: ISTAT — Basi territoriali 2021, licenza CC-BY 4.0. "
        "Geometrie semplificate con Douglas-Peucker (tolleranza in "
        "metri EPSG:32632). Interior rings sub-1 km² rimossi. "
        "Generato da packages/ingest/svg_province_emiliaromagna.py."
    )

    return (
        '<svg xmlns="http://www.w3.org/2000/svg"'
        f' viewBox="0 0 {vb_w} {vb_h}"'
        ' aria-label="Province dell\'Emilia-Romagna">'
        "<title>Province dell'Emilia-Romagna</title>"
        f"<desc>{desc}</desc>"
        f'<path class="regione" d="{d_regione}"/>'
        f'<path class="parma" d="{d_parma}" data-cx="{cx_pr}" data-cy="{cy_pr}"/>'
        f'<path class="bologna" d="{d_bologna}" data-cx="{cx_bo}" data-cy="{cy_bo}"/>'
        "</svg>\n"
    )


def rimuovi_buchi_micro(
    g: Polygon | MultiPolygon, soglia_m2: float
) -> Polygon | MultiPolygon:
    """
    Rimuove gli interior rings (buchi) con area sotto `soglia_m2` da
    ogni Polygon della geometria. Ricostruisce ognuno come
    Polygon(exterior, [interiors_grandi]).

    Motivo: unary_union su 60k sezioni ISTAT adiacenti non chiude
    perfettamente le fessure fra sezioni — restano interior rings
    invisibili ma pesanti nel path SVG (~400 quadrilateri degeneri
    che ripetono lo stesso pattern). Il precedente filtro
    su g.geoms del MultiPolygon agiva SOLO sulle parti esterne
    disgiunte, non sui buchi interni ai singoli Polygon.

    Da chiamare PRIMA della semplificazione, sulla geometria cruda:
    Douglas-Peucker riduce vertici ma non area, quindi un buco
    sotto soglia prima resta sotto soglia dopo.
    """
    def pulisci_poly(p: Polygon) -> Polygon:
        buoni = [r for r in p.interiors if Polygon(r).area >= soglia_m2]
        if len(buoni) == len(list(p.interiors)):
            return p
        return Polygon(p.exterior, buoni)

    if isinstance(g, Polygon):
        return pulisci_poly(g)
    if isinstance(g, MultiPolygon):
        return MultiPolygon([pulisci_poly(p) for p in g.geoms])
    return g


def conta_anelli(g: Polygon | MultiPolygon) -> tuple[int, int]:
    """Ritorna (n_exterior, n_interior) sommato su tutti i Polygon."""
    if isinstance(g, Polygon):
        return 1, len(list(g.interiors))
    if isinstance(g, MultiPolygon):
        ext = intr = 0
        for p in g.geoms:
            e, i = conta_anelli(p)
            ext += e
            intr += i
        return ext, intr
    return 0, 0


def conta_anelli_degeneri(
    g: Polygon | MultiPolygon, soglia_metri: float
) -> int:
    """
    Numero di anelli (exterior + interior) il cui bbox ha diagonale
    minore di `soglia_metri`. Un anello "degenere" a viewBox 1000 su
    285 km reali equivale a bbox < 1 unità viewBox = ~285 m.
    """
    def anelli(g):
        if isinstance(g, Polygon):
            yield g.exterior
            yield from g.interiors
        elif isinstance(g, MultiPolygon):
            for p in g.geoms:
                yield from anelli(p)

    n = 0
    for a in anelli(g):
        minx, miny, maxx, maxy = a.bounds
        if max(maxx - minx, maxy - miny) < soglia_metri:
            n += 1
    return n


def _salva_cache(g: Polygon | MultiPolygon, path: Path) -> None:
    """Scrive la geometria unita in un GeoJSON minimale."""
    path.parent.mkdir(parents=True, exist_ok=True)
    gj = {"type": "Feature", "properties": {}, "geometry": mapping(g)}
    path.write_text(json.dumps(gj), encoding="utf-8")


def _leggi_cache(path: Path) -> Polygon | MultiPolygon:
    """Legge una geometria singola da un GeoJSON di cache."""
    with path.open(encoding="utf-8") as f:
        gj = json.load(f)
    return shape(gj["geometry"])


def prepara_geometrie(
    shp: Path, tmpdir: Path, cache_dir: Path, rigenera: bool
) -> tuple[Polygon | MultiPolygon, Polygon | MultiPolygon, Polygon | MultiPolygon]:
    """
    Estrae + unisce le 3 geometrie. La parte pesante (unary_union su
    ~60k poligoni) viene cachata su disco per iterazioni successive.

    Cache path: {cache_dir}/{regione,parma,bologna}.geojson. Se tutti
    e tre esistono e non `rigenera`, si rileggono da lì saltando
    ogr2ogr + shapely completamente.
    """
    files = {
        "regione": cache_dir / "regione.geojson",
        "parma": cache_dir / "parma.geojson",
        "bologna": cache_dir / "bologna.geojson",
    }
    cache_ok = all(f.exists() for f in files.values()) and not rigenera
    if cache_ok:
        print(f"Cache trovata in {cache_dir.relative_to(cache_dir.parents[1])}, "
              f"riuso (--rigenera per forzare):")
        for k, f in files.items():
            print(f"  {k:<10} ← {f.name} ({f.stat().st_size / 1024:.1f} KB)")
        return _leggi_cache(files["regione"]), _leggi_cache(files["parma"]), _leggi_cache(files["bologna"])

    print("Estrazione con ogr2ogr + unione shapely:")
    f_reg = tmpdir / "regione.geojson"
    f_pr = tmpdir / "parma.geojson"
    f_bo = tmpdir / "bologna.geojson"

    filtro_base = (
        f"COD_REG = {COD_REG_EMILIA_ROMAGNA} AND {CLAUSOLA_NON_FITTIZIA}"
    )
    estrai_via_ogr(shp, filtro_base, f_reg)
    estrai_via_ogr(shp, f"{filtro_base} AND COD_UTS = {UTS_PARMA}", f_pr)
    estrai_via_ogr(shp, f"{filtro_base} AND COD_UTS = {UTS_BOLOGNA}", f_bo)

    g_reg = carica_e_unisci(f_reg)
    g_pr = carica_e_unisci(f_pr)
    g_bo = carica_e_unisci(f_bo)

    # Filtra exclave micro dalla regione (vedi docstring modulo).
    if isinstance(g_reg, MultiPolygon):
        soglia_m2 = SOGLIA_KM2 * 1e6
        prima = len(g_reg.geoms)
        parti = [p for p in g_reg.geoms if p.area >= soglia_m2]
        if len(parti) < prima:
            print(f"  scartate {prima - len(parti)} exclave "
                  f"sub-{SOGLIA_KM2:g} km² dalla regione")
            g_reg = parti[0] if len(parti) == 1 else MultiPolygon(parti)

    print("  scrivo cache su disco:")
    for k, g, path in (
        ("regione", g_reg, files["regione"]),
        ("parma", g_pr, files["parma"]),
        ("bologna", g_bo, files["bologna"]),
    ):
        _salva_cache(g, path)
        print(f"    {k:<10} → {path.name} "
              f"({path.stat().st_size / 1024:.1f} KB)")

    return g_reg, g_pr, g_bo


def genera_svg(
    g_reg: Polygon | MultiPolygon,
    g_pr: Polygon | MultiPolygon,
    g_bo: Polygon | MultiPolygon,
    tol_reg_m: int,
    tol_prov_m: int,
) -> tuple[str, dict]:
    """Semplifica le 3 geometrie e compone l'SVG. Tolleranze differenziate."""
    s_reg = g_reg.simplify(tol_reg_m, preserve_topology=True)
    s_pr = g_pr.simplify(tol_prov_m, preserve_topology=True)
    s_bo = g_bo.simplify(tol_prov_m, preserve_topology=True)
    v_dopo = {
        "regione": conta_vertici(s_reg),
        "parma": conta_vertici(s_pr),
        "bologna": conta_vertici(s_bo),
    }
    return componi_svg(s_reg, s_pr, s_bo), v_dopo


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--rigenera", action="store_true",
        help="invalida la cache data/cache-svg/ e rifà l'unione da capo",
    )
    args = ap.parse_args()

    repo = Path(__file__).resolve().parents[2]
    shp = repo / "data" / "R08_21_WGS84.shp"
    cache_dir = repo / "data" / "cache-svg"
    out_svg = repo / "apps" / "web" / "public" / "emilia-romagna-province.svg"

    if not shp.exists():
        sys.exit(f"input mancante: {shp}")
    out_svg.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        g_reg, g_pr, g_bo = prepara_geometrie(
            shp, tmpdir, cache_dir, args.rigenera
        )

    print(f"\nGeometrie caricate. Vertici crudi: "
          f"regione {conta_vertici(g_reg):,} · "
          f"parma {conta_vertici(g_pr):,} · "
          f"bologna {conta_vertici(g_bo):,}")
    e0, i0 = conta_anelli(g_reg)
    print(f"  regione: {e0} exterior + {i0} interior rings (prima pulizia)")

    # Pulizia micro-buchi PRIMA della semplificazione. Vedi docstring
    # modulo per la ragione.
    soglia_m2 = SOGLIA_KM2 * 1e6
    g_reg = rimuovi_buchi_micro(g_reg, soglia_m2)
    g_pr = rimuovi_buchi_micro(g_pr, soglia_m2)
    g_bo = rimuovi_buchi_micro(g_bo, soglia_m2)
    e1, i1 = conta_anelli(g_reg)
    print(f"  regione: {e1} exterior + {i1} interior rings "
          f"(dopo rimozione buchi sub-{SOGLIA_KM2:g} km²)")

    print(f"\nSemplificazione: regione {TOL_REGIONE_M} m, "
          f"province {TOL_PROVINCIA_M} m")
    svg, report = genera_svg(
        g_reg, g_pr, g_bo, TOL_REGIONE_M, TOL_PROVINCIA_M
    )

    # Diagnostica anelli residui: da un viewBox 1000 su ampiezza w metri
    # reali, 1 unità viewBox = w/1000 metri. Un anello "degenere" a
    # schermo ha bbox < 1 unità = < w/1000 metri reali.
    w = max(
        max(g.bounds[2] - g.bounds[0] for g in [g_reg, g_pr, g_bo]),
        max(g.bounds[3] - g.bounds[1] for g in [g_reg, g_pr, g_bo]),
    )
    soglia_metri = w / VIEWBOX_MAJOR
    deg_reg = conta_anelli_degeneri(
        g_reg.simplify(TOL_REGIONE_M, preserve_topology=True), soglia_metri
    )
    deg_pr = conta_anelli_degeneri(
        g_pr.simplify(TOL_PROVINCIA_M, preserve_topology=True), soglia_metri
    )
    deg_bo = conta_anelli_degeneri(
        g_bo.simplify(TOL_PROVINCIA_M, preserve_topology=True), soglia_metri
    )
    tot_ext_reg, tot_int_reg = conta_anelli(
        g_reg.simplify(TOL_REGIONE_M, preserve_topology=True)
    )
    print(f"\nDiagnostica anelli (bbox < 1 unità viewBox = "
          f"~{soglia_metri:.0f} m reali):")
    print(f"  regione:  {deg_reg} degeneri su {tot_ext_reg + tot_int_reg} totali "
          f"({tot_ext_reg} exterior + {tot_int_reg} interior)")
    print(f"  parma:    {deg_pr} degeneri")
    print(f"  bologna:  {deg_bo} degeneri")

    out_svg.write_text(svg, encoding="utf-8")
    peso = out_svg.stat().st_size
    print(
        f"\nScritto {out_svg.relative_to(repo)}"
        f"\n  tolleranze:          regione {TOL_REGIONE_M} m, "
        f"province {TOL_PROVINCIA_M} m"
        f"\n  peso finale:         {peso / 1024:.2f} KB ({peso:,} byte)"
        f"\n  vertici per geometria: "
        f"regione {report['regione']:,} · "
        f"parma {report['parma']:,} · "
        f"bologna {report['bologna']:,}"
    )
    if peso > SOGLIA_KB * 1024:
        print(
            f"\n  ATTENZIONE: sopra soglia {SOGLIA_KB} KB."
        )


if __name__ == "__main__":
    main()
