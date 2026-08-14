# SPDX-License-Identifier: AGPL-3.0-or-later
"""
CheCaldo! — conversione one-shot Google Sans TTF variable → WOFF2 con
sottoinsieme latin + latin-ext.

Perché: i due file TTF originali pesano ~4.7 MB e ~5.1 MB. Servirli
così a ogni caricamento della pagina pubblica è inaccettabile.
WOFF2 con subset comprime fino a ~1/20 (~200-300 KB effettivi) e
copre tutti i caratteri accentati che l'italiano usa (latin) più
quelli di lingue vicine (latin-ext) per un possibile futuro comune
non italiano nella stessa istanza.

Uso:
    docker compose run --rm ingest python \\
        packages/ingest/converti_google_sans.py

Input:  apps/web/public/fonts/GoogleSans-VariableFont_GRAD,opsz,wght.ttf
        apps/web/public/fonts/GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf
Output: apps/web/public/fonts/google-sans.woff2
        apps/web/public/fonts/google-sans-italic.woff2

Script one-shot: se un giorno cambia il pacchetto Google Sans si
rilancia a mano. Non è build step di apps/web (nessuna dipendenza
Python in quel workspace).

Subset (unicode ranges Google Fonts standard):
- latin: Basic Latin + Latin-1 Supplement + segnaposti tipografici.
- latin-ext: Latin Extended-A e Extended-B, simboli aggiuntivi.

Sorgente Google Sans: pacchetto scaricato manualmente da
https://fonts.google.com/ (licenza SIL Open Font License 1.1,
`OFL.txt` deve accompagnare il font — resta in `public/fonts/`).
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter


# Unicode ranges: allineati alla convenzione di Google Fonts.
# Referenza: https://fonts.googleapis.com/css2 (i loro CSS espliciti).
UNICODES_LATIN = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,"
    "U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,"
    "U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
)
UNICODES_LATIN_EXT = (
    "U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,"
    "U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"
)
UNICODES = f"{UNICODES_LATIN},{UNICODES_LATIN_EXT}"


def descrivi_assi(font: TTFont, nome_file: str) -> dict[str, tuple[float, float, float]]:
    """
    Legge la tabella fvar e ritorna dict {tag: (min, default, max)}.
    Riporta a schermo per il rapporto all'utente.
    """
    fvar = font["fvar"]
    assi = {}
    print(f"  Assi di {nome_file}:")
    for a in fvar.axes:
        assi[a.axisTag] = (a.minValue, a.defaultValue, a.maxValue)
        print(
            f"    {a.axisTag:<6} min={a.minValue:>6.1f} "
            f"default={a.defaultValue:>6.1f} max={a.maxValue:>6.1f}"
        )
    return assi


def sottoinsieme_e_woff2(src: Path, dst: Path) -> tuple[int, int]:
    """
    Applica il subset di caratteri latin+latin-ext, converte in WOFF2,
    e scrive `dst`. Ritorna (bytes_prima, bytes_dopo).

    Preserva le tabelle degli assi variable (fvar/HVAR/MVAR/etc.) —
    Subsetter lo fa di default con `layout_features='*'`; qui uso
    l'API di default che tiene i glyph shapes e le tabelle necessarie
    al font variable.
    """
    dimensione_prima = src.stat().st_size

    font = TTFont(str(src))
    print(f"\n[{src.name}]")
    descrivi_assi(font, src.name)

    print(f"  applico subset ({len(UNICODES.split(','))} range unicode)…")
    opts = Subsetter().options
    opts.name_IDs = ["*"]  # tieni tutti i nomi (family, style, etc.)
    opts.name_legacy = True
    opts.name_languages = ["*"]
    opts.retain_gids = False
    opts.layout_features = ["*"]  # tieni le OpenType features (ligature, ecc.)
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.recalc_timestamp = False
    opts.canonical_order = True
    sub = Subsetter(options=opts)
    sub.populate(unicodes=_parsa_unicodes(UNICODES))
    sub.subset(font)

    font.flavor = "woff2"
    font.save(str(dst))
    font.close()

    dimensione_dopo = dst.stat().st_size
    return dimensione_prima, dimensione_dopo


def _parsa_unicodes(spec: str) -> list[int]:
    """
    Converte "U+0000-00FF,U+0131,…" in una lista di codepoint singoli.
    Semplice, senza dipendenze — la sintassi è quella di CSS
    `unicode-range` che fonttools accetta direttamente in
    `Subsetter.populate(unicodes=…)` ma solo come lista di interi.
    """
    codepoints: list[int] = []
    for token in spec.split(","):
        token = token.strip().replace("U+", "")
        if "-" in token:
            a, b = token.split("-")
            codepoints.extend(range(int(a, 16), int(b, 16) + 1))
        else:
            codepoints.append(int(token, 16))
    return codepoints


def main() -> None:
    repo = Path(__file__).resolve().parents[2]
    fonts = repo / "apps" / "web" / "public" / "fonts"
    coppie = [
        (
            fonts / "GoogleSans-VariableFont_GRAD,opsz,wght.ttf",
            fonts / "google-sans.woff2",
        ),
        (
            fonts / "GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf",
            fonts / "google-sans-italic.woff2",
        ),
    ]

    for src, dst in coppie:
        if not src.exists():
            sys.exit(f"input mancante: {src}")

    print("=" * 60)
    print("Google Sans TTF → WOFF2 (subset latin + latin-ext)")
    print("=" * 60)

    totale_prima = totale_dopo = 0
    report_finale = []
    for src, dst in coppie:
        prima, dopo = sottoinsieme_e_woff2(src, dst)
        rap = 100 * dopo / prima
        print(
            f"  scritto {dst.name}: "
            f"{prima/1024:>7.1f} KB → {dopo/1024:>6.1f} KB "
            f"({rap:.1f}% dell'originale)"
        )
        totale_prima += prima
        totale_dopo += dopo
        report_finale.append((dst.name, prima, dopo))

    print()
    print("=" * 60)
    print("Rapporto peso file:")
    for nome, p, d in report_finale:
        print(f"  {nome:<28} {p/1024:>8.1f} KB  →  {d/1024:>7.1f} KB")
    print(
        f"  {'TOTALE':<28} {totale_prima/1024:>8.1f} KB  →  "
        f"{totale_dopo/1024:>7.1f} KB  "
        f"({100 * totale_dopo / totale_prima:.1f}%)"
    )
    print("=" * 60)


if __name__ == "__main__":
    main()
