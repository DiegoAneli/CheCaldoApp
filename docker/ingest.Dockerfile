# Contenitore Python per l'ingestione.
#
# pandas e openpyxl bastano per istat.py.
# psycopg2-binary serve ad allerta.py --scrivi-db (upsert in pubblico.allerta)
# e a geometrie.py (chiamata a calcola_distanze_fresco + query diagnostica).
# gdal-bin (~150 MB installato) porta ogr2ogr, l'unico strumento GDAL che
# usiamo: MOD01 riproietta EPSG:32632 → 4326 e carica lo shapefile ISTAT.
# geopandas + libgdal-dev sarebbero altri ~300 MB per un solo uso a inizio
# modulo, decisione scartata in CHECALDO-PROGETTO §12c.
# shapely (~2 MB installato, riusa la libgeos che GDAL già trascina)
# serve a svg_province_emiliaromagna.py per la semplificazione dei
# poligoni (Douglas-Peucker) prima dell'emissione SVG. Il dissolvimento
# pesante (60k sezioni → 3 geometrie) resta a ogr2ogr, shapely si limita
# a leggere 3 poligoni via json + simplify + iterazione vertici.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      gdal-bin && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    pandas==2.2.3 openpyxl==3.1.5 psycopg2-binary==2.9.10 shapely==2.0.6 \
    fonttools==4.55.0 brotli==1.1.0

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
