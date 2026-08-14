# SPDX-License-Identifier: AGPL-3.0-or-later
"""
CheCaldo! — livello di allerta.

Due rami, stessa forma in uscita, provenienza diversa. La provenienza deve
restare visibile fino all'interfaccia: "livello 3, bollettino del Ministero"
non è la stessa cosa di "livello 3 stimato, non ufficiale".

    Ramo A, 27 città   il bollettino ufficiale, ground truth
    Ramo B, tutti gli altri   stima da temperatura apparente e percentile locale

Questo modulo è un cron job con un parser. Non è un agente: la fonte
autorevole esiste già, e infilarci un modello introdurrebbe inaffidabilità
dove non serve.

Uso:
    python allerta.py --citta BOLOGNA
    python allerta.py --stima 44.8015 10.3280
    python allerta.py --backtest BOLOGNA
    python allerta.py --tutti          # tutti i comuni serviti dall'istanza
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import statistics
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

ONDATA = "https://raw.githubusercontent.com/ondata/ondate-calore/main/data"
LATEST = f"{ONDATA}/ondate-calore_latest.csv"
ARCHIVIO = f"{ONDATA}/ondate-calore_archivio.csv"
ANAGRAFICA = f"{ONDATA}/citta-anagrafica.csv"

OPEN_METEO_ARCHIVIO = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_PREVISIONI = "https://api.open-meteo.com/v1/forecast"

# Percentili della distribuzione climatologica locale che definiscono i livelli.
# Sono una scelta statistica, non una calibrazione sulla mortalità: le soglie
# ufficiali derivano da vent'anni di dati sanitari, queste no. Va dichiarato.
SOGLIE = {1: 0.85, 2: 0.95, 3: 0.98}
NOTTE_TROPICALE = 20.0


def _orizzonte_ore(giorni: int) -> int:
    """
    Orizzonte in ore per un delta giorni fra data-riga e giorno di
    riferimento (`data_estrazione` per il bollettino, `oggi` per la
    stima). Il bollettino ministeriale copre il giorno E e le due
    giornate successive: E→24h, E+1→48h, E+2→72h. Sono i tre soli
    valori ammessi dal CHECK di `pubblico.allerta.orizzonte_ore`
    (packages/db/schema.sql:92).

    Un valore fuori dominio è un cambio di formato della fonte
    upstream: alza `ValueError` invece di clamparlo silenziosamente,
    così il fatto è visibile a chi rilancia il poller.

    Estratta come helper unico dopo il bug §12eeeeee (bis, 2026-08-13):
    prima esistevano tre formule per la stessa cosa in `bollettino`,
    `stima` e `backtest`, e due davano il risultato giusto, una no.
    Adesso ce n'è una sola.
    """
    if not 0 <= giorni <= 2:
        raise ValueError(
            f"orizzonte fuori dominio: giorni={giorni} (atteso 0..2). "
            f"Se onData ha cambiato il formato del bollettino, aggiornare "
            f"_orizzonte_ore prima di rilanciare il poller."
        )
    return (giorni + 1) * 24


def _get(url: str, params: dict | None = None) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "CheCaldo/0.1"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read()


def _csv(url: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(_get(url).decode("utf-8"))))


# ------------------------------------------------------------------ ramo A

def anagrafica() -> dict[str, dict]:
    """Le 27 città con coordinate e codice ISTAT comunale (campo admin3code)."""
    return {r["citta"]: r for r in _csv(ANAGRAFICA)}


def bollettino(citta: str) -> list[dict]:
    """
    Livelli pubblicati per una città, sui tre orizzonti.

    Il bollettino esce dal lunedì al venerdì: quello di venerdì copre il
    weekend con l'orizzonte a 72 ore. Non è un caso limite da gestire dopo.

    Fonte primaria (verificato 2026-08-07):
    https://www.salute.gov.it/new/it/tema/ondate-di-calore/
      "bollettini per 27 città con previsioni a 24, 48 e 72 ore,
       aggiornati dal lunedì al venerdì dalle ore 11".
    """
    righe = [r for r in _csv(LATEST) if r["citta"].upper() == citta.upper()]
    if not righe:
        return []
    estrazione = max(r["data_estrazione"] for r in righe)
    out = []
    for r in sorted(righe, key=lambda x: x["data"]):
        if r["data_estrazione"] != estrazione:
            continue
        giorni = (date.fromisoformat(r["data"]) - date.fromisoformat(estrazione)).days
        out.append({
            "data": r["data"],
            "livello": int(r["livello"].replace("Livello", "").strip()),
            "provenienza": "bollettino",
            "orizzonteOre": _orizzonte_ore(giorni),
            "fonteUrl": r.get("URL") or None,
            "dataEstrazione": estrazione,
        })
    return out


# ------------------------------------------------------------------ ramo B

def _apparente(lat: float, lon: float, dal: str, al: str, previsioni=False) -> dict:
    base = OPEN_METEO_PREVISIONI if previsioni else OPEN_METEO_ARCHIVIO
    p = {
        "latitude": lat, "longitude": lon,
        "daily": "apparent_temperature_max,apparent_temperature_min",
        "timezone": "Europe/Rome",
    }
    p["start_date" if not previsioni else "start_date"] = dal
    p["end_date"] = al
    d = json.loads(_get(base, p))["daily"]
    return {
        t: (mx, mn)
        for t, mx, mn in zip(d["time"], d["apparent_temperature_max"],
                             d["apparent_temperature_min"])
        if mx is not None
    }


def climatologia(lat: float, lon: float, giorno: date, anni=12, finestra=10) -> list[float]:
    """
    Distribuzione storica della temperatura apparente massima attorno alla
    stessa data del calendario.

    La soglia non è un numero assoluto: 34 gradi a Bolzano e 34 a Catania sono
    eventi diversi, perché la popolazione è acclimatata diversamente. Anche il
    sistema ufficiale usa soglie specifiche per città.
    """
    valori: list[float] = []
    for k in range(1, anni + 1):
        anno = giorno.year - k
        try:
            centro = giorno.replace(year=anno)
        except ValueError:
            continue
        d = _apparente(
            lat, lon,
            (centro - timedelta(days=finestra)).isoformat(),
            (centro + timedelta(days=finestra)).isoformat(),
        )
        valori.extend(mx for mx, _ in d.values())
    return sorted(valori)


def _livello_da_percentile(mx: float, clim: list[float]) -> int:
    if not clim:
        return 0
    posizione = sum(1 for x in clim if x < mx) / len(clim)
    for lv in (3, 2, 1):
        if posizione >= SOGLIE[lv]:
            return lv
    return 0


def stima(lat: float, lon: float, oggi: date | None = None, clim=None,
          storico=None, futuro=None) -> list[dict]:
    """
    Livello stimato per i comuni fuori dalle 27 città.

    Un livello 3 richiede tre giorni consecutivi sopra soglia, come nella
    definizione ufficiale di ondata di calore.

    `storico` e `futuro` sono opzionali: se non forniti, si scaricano da
    Open-Meteo usando `lat`/`lon` come da ramo di produzione. Iniettarli
    permette di testare la logica di escalation senza rete — vedi
    `test/test_allerta.py`. Formato atteso identico a quello restituito da
    `_apparente`: `{data_iso: (temp_app_max, temp_app_min)}`. Anche `clim`
    è opzionale allo stesso scopo (lista ordinata di temperature).
    """
    oggi = oggi or date.today()
    clim = clim if clim is not None else climatologia(lat, lon, oggi)
    if storico is None:
        storico = _apparente(lat, lon, (oggi - timedelta(days=6)).isoformat(),
                             (oggi - timedelta(days=1)).isoformat())
    if futuro is None:
        futuro = _apparente(lat, lon, oggi.isoformat(),
                            (oggi + timedelta(days=2)).isoformat(), previsioni=True)
    serie = {**storico, **futuro}

    notti = 0
    for g in sorted(k for k in serie if k <= oggi.isoformat()):
        notti = notti + 1 if serie[g][1] > NOTTE_TROPICALE else 0

    out = []
    # Conta i giorni consecutivi a livello >= 2 che terminano a ieri, non
    # tutti quelli sopra soglia nella finestra di sei giorni. Il vecchio
    # `sum(1 for ... if lv >= 2)` cadeva su un buco a metà settimana:
    # storico [2,2,0,2,2] scriveva consecutivi=4 e faceva scattare
    # l'escalation al terzo giorno di previsione, quando il conteggio
    # corretto era 2 (i due che finiscono a ieri).
    consecutivi = 0
    for g in sorted(storico, reverse=True):
        if _livello_da_percentile(storico[g][0], clim) >= 2:
            consecutivi += 1
        else:
            break
    for g in sorted(futuro):
        lv = _livello_da_percentile(futuro[g][0], clim)
        if lv >= 2:
            consecutivi += 1
            if consecutivi >= 3:
                lv = 3
        else:
            consecutivi = 0
        giorni = (date.fromisoformat(g) - oggi).days
        out.append({
            "data": g,
            "livello": lv,
            "provenienza": "stima",
            "orizzonteOre": _orizzonte_ore(giorni),
            "nottiTropicali": notti,
            "fonteUrl": None,
        })
    return out


# --------------------------------------------------------------- backtest

def backtest(citta: str, dal="2025-06-01", al="2025-09-15") -> dict:
    """
    Misura quanto la stima riproduce il livello ufficiale, sulle città dove
    il bollettino esiste.

    Sostituisce "credo che la stima sia ragionevole" con un numero, ed è la
    risposta al limite dichiarato: non validiamo contro la mortalità, ma
    contro il sistema che sulla mortalità è già calibrato.

    L'archivio onData copre dal 7 luglio 2023, con tre orizzonti (24, 48,
    72 ore) per ogni data_estrazione. Il backtest misura i tre orizzonti
    SEPARATAMENTE: quello a 24h è la previsione del giorno corrente,
    48h e 72h sono le previsioni a 1 e 2 giorni.

    **Nota metodologica 1** (criterio): il confronto usa il ramo
    "istantaneo" della stima (`_livello_da_percentile` sul singolo giorno),
    non l'escalation a 3 giorni consecutivi di `stima()`. Quel vincolo è
    aggiuntivo — trattiene la stima sul livello 2 anche quando il
    percentile della giornata sarebbe da 3 — quindi ogni divergenza qui è
    un limite del percentile grezzo; le sottostime vere della `stima()`
    completa sono almeno queste, più quelle causate dal ritardo di innesco
    del livello 3.

    **Nota metodologica 2** (orizzonti 48h e 72h): la nostra stima() a più
    giorni usa OpenMeteo forecast, che ha un errore suo — il backtest
    NON riesce a riprodurre quelle previsioni storiche (Open-Meteo non
    espone hindcast delle forecast di allora). Come proxy usiamo la
    temperatura osservata del giorno bersaglio: cioè misuriamo "quanto
    il criterio percentile beccherebbe il livello a 48h/72h assunta
    previsione meteorologica perfetta". L'errore reale a 48h/72h è
    almeno questo + l'errore delle forecast; l'entità del secondo non la
    sappiamo e va dichiarata.

    **Nota metodologica 3** (anticipo del livello 3): sui giorni di
    transizione (D con ufficiale a 24h = 3 e ufficiale a 24h del giorno
    prima < 3) misuriamo quante volte il nostro criterio percentile,
    calcolato sulla temperatura osservata di D, aveva già raggiunto
    livello 3. Sotto la stessa assunzione di previsione perfetta:
    misura la capacità del criterio di riconoscere l'ondata quando
    inizia. Un coordinatore che lo sa 48 ore prima chiama più
    volontari: è la domanda operativa vera, che le percentuali
    aggregate non esprimono.
    """
    an = anagrafica()
    if citta.upper() not in an:
        raise SystemExit(f"{citta} non è tra le 27 città del bollettino")
    c = an[citta.upper()]
    lat, lon = float(c["latitude"]), float(c["longitude"])

    # Raccogli l'ufficiale separato per orizzonte. Struttura:
    #   ufficiale_per_oriz[24][data] = livello (ufficiale a 24h su data)
    # Per una riga onData con data_estrazione = E e data = D:
    #   delta = (D - E).days   →   orizzonte via `_orizzonte_ore(delta)`
    # (E,E) → 24h; (E,E+1) → 48h; (E,E+2) → 72h.
    # La guardia `delta < 0 or delta > 2` esclude righe fuori formato
    # (l'helper alzerebbe ValueError): in un archivio grande preferisco
    # saltarle silenziosamente invece di fermare il backtest — al
    # poller di produzione invece serve la segnalazione, per quello
    # `bollettino()` non ha la guardia e lascia salire.
    ufficiale_per_oriz: dict[int, dict[str, int]] = {24: {}, 48: {}, 72: {}}
    for r in _csv(ARCHIVIO):
        if r["citta"].upper() != citta.upper():
            continue
        if not (dal <= r["data"] <= al):
            continue
        delta = (date.fromisoformat(r["data"]) - date.fromisoformat(r["data_estrazione"])).days
        if delta < 0 or delta > 2:
            continue
        oriz = _orizzonte_ore(delta)
        lv = int(r["livello"].replace("Livello", "").strip())
        # Univocità: per (data, orizzonte) esiste una sola data_estrazione
        # (data - delta). Non serve tenere una lista.
        ufficiale_per_oriz[oriz][r["data"]] = lv

    if not any(ufficiale_per_oriz.values()):
        raise SystemExit("nessun dato ufficiale nel periodo richiesto")

    # Climatologia calcolata attorno all'inizio del periodo; osservazioni
    # su tutto il periodo. Riusate per tutti gli orizzonti (la temp
    # osservata di D è la stessa indipendentemente da che orizzonte la
    # guardiamo).
    prime_date = [d for m in ufficiale_per_oriz.values() for d in m]
    centro = date.fromisoformat(min(prime_date))
    clim = climatologia(lat, lon, centro)
    oss = _apparente(lat, lon, dal, al)

    def _metriche(ufficiale: dict[str, int]) -> dict:
        esatti = entro_uno = tot = sottostime = 0
        divergenze = []
        for g, lv_uff in sorted(ufficiale.items()):
            if g not in oss:
                continue
            lv_st = _livello_da_percentile(oss[g][0], clim)
            tot += 1
            if lv_st == lv_uff:
                esatti += 1
            else:
                divergenze.append({
                    "data": g,
                    "stima": lv_st,
                    "ufficiale": lv_uff,
                    "delta": lv_st - lv_uff,
                    "tempApparenteMax": round(oss[g][0], 1),
                })
            if abs(lv_st - lv_uff) <= 1:
                entro_uno += 1
            if lv_st < lv_uff:
                sottostime += 1
        return {
            "giorni": tot,
            "esatti": round(esatti / tot, 3) if tot else None,
            "entroUnLivello": round(entro_uno / tot, 3) if tot else None,
            # La sottostima è l'errore che conta: dice "meno grave del reale".
            "sottostime": round(sottostime / tot, 3) if tot else None,
            "divergenze": divergenze,
        }

    per_orizzonte = {
        f"h{oriz}": _metriche(uff) for oriz, uff in ufficiale_per_oriz.items()
    }

    # Anticipo del livello 3 — la domanda operativa. Giorni di transizione:
    # D dove ufficiale a 24h = 3 e ufficiale a 24h di D-1 < 3 (o D-1 fuori
    # dal periodo). Su ognuno, guarda cosa dice il criterio percentile
    # calcolato sulla temp osservata di D: se >= 3, l'aumento è "visto"
    # (assunta previsione meteo perfetta); se < 3, "mancato".
    #
    # Nota: la stima() completa (con escalation a 3 giorni consecutivi)
    # può frenare il livello 3 anche quando il percentile sarebbe già 3
    # — quindi in produzione l'anticipo reale può essere PEGGIORE di
    # quello misurato qui, se D è il primo giorno sopra soglia.
    ufficiale_24 = ufficiale_per_oriz[24]
    date_ordinate = sorted(ufficiale_24.keys())
    giorni_transizione_3 = []
    for i, g in enumerate(date_ordinate):
        if ufficiale_24[g] != 3:
            continue
        prev_g = date_ordinate[i - 1] if i > 0 else None
        if prev_g is None or ufficiale_24[prev_g] < 3:
            giorni_transizione_3.append(g)

    visti = mancati = 0
    dettaglio_transizioni = []
    for g in giorni_transizione_3:
        if g not in oss:
            continue
        lv_st = _livello_da_percentile(oss[g][0], clim)
        stato = "visto" if lv_st >= 3 else "mancato"
        if lv_st >= 3:
            visti += 1
        else:
            mancati += 1
        dettaglio_transizioni.append({
            "data": g,
            "stimaLivello": lv_st,
            "tempApparenteMax": round(oss[g][0], 1),
            "stato": stato,
        })

    tot_transizioni = visti + mancati
    anticipoLivello3 = {
        # "giorniDiTransizione" = giorni in cui l'ufficiale è salito a 3
        # dopo un giorno sotto 3.
        "giorniDiTransizione": tot_transizioni,
        "vistiInAnticipo": visti,
        "mancati": mancati,
        "quotaVisti": (
            round(visti / tot_transizioni, 3) if tot_transizioni else None
        ),
        "dettaglio": dettaglio_transizioni,
        "assunzione": (
            "criterio percentile su temperatura osservata (proxy della "
            "previsione meteo perfetta). L'errore reale a 48h include "
            "l'errore delle forecast di allora, che non è misurabile qui."
        ),
    }

    return {
        "citta": citta.upper(),
        "periodo": {"dal": dal, "al": al},
        "perOrizzonte": per_orizzonte,
        "anticipoLivello3": anticipoLivello3,
    }


def scrivi_db(righe: list[dict], comune_istat: str) -> int:
    """
    UPSERT delle righe di allerta in pubblico.allerta per il comune indicato.

    Chiave unica: (comune_istat, data, orizzonte_ore, data_estrazione). Usa
    ON CONFLICT DO UPDATE per rispettare "ogni rilancio riscrive con quello
    che vede adesso": se domani il bollettino cambia il livello del giorno,
    o la stima cambia con nuove previsioni, la riga si aggiorna.

    `motivo_provenienza` per riga: NULL nel caso normale; valorizzato
    quando si scrive una riga stima come fallback di un ramo bollettino
    (§12x, `citta_non_nel_bollettino`). Chiaramente segnala nel DB
    perché il livello di quella data è stimato invece di ufficiale.

    Fail-hard sul modello CLAUDE.md: se Open-Meteo non ha risposto (righe
    vuote), oppure se il DB rifiuta, lo script termina non-zero e la
    tabella non resta a metà (transazione unica). Nessun livello di
    ripiego silenzioso.
    """
    if not righe:
        raise SystemExit("nessuna riga da scrivere: fonte upstream vuota")

    import psycopg2  # import locale: la dep non serve al ramo di sola lettura

    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL non impostata")

    oggi = date.today().isoformat()
    conn = psycopg2.connect(url)
    try:
        with conn:  # transazione: commit atomico o rollback totale
            with conn.cursor() as cur:
                for r in righe:
                    cur.execute(
                        """
                        INSERT INTO pubblico.allerta
                          (comune_istat, data, livello, provenienza,
                           orizzonte_ore, notti_tropicali, fonte_url,
                           data_estrazione, motivo_provenienza)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (comune_istat, data, orizzonte_ore,
                                     data_estrazione)
                        DO UPDATE SET
                          livello = EXCLUDED.livello,
                          provenienza = EXCLUDED.provenienza,
                          notti_tropicali = EXCLUDED.notti_tropicali,
                          fonte_url = EXCLUDED.fonte_url,
                          motivo_provenienza = EXCLUDED.motivo_provenienza
                        """,
                        (
                            comune_istat,
                            r["data"],
                            r["livello"],
                            r["provenienza"],
                            r["orizzonteOre"],
                            r.get("nottiTropicali", 0),
                            r.get("fonteUrl"),
                            r.get("dataEstrazione", oggi),
                            r.get("motivo"),
                        ),
                    )
    finally:
        conn.close()
    return len(righe)


def bollettino_o_fallback(citta: str) -> list[dict]:
    """
    Ramo A completo: il bollettino ufficiale per `citta`, con fallback a
    stima quando la città non compare nel CSV di oggi (§12x). Riproduce
    la logica del ramo `--citta` di main(), estratta perché sia riusabile
    da `--tutti` senza duplicazione.

    Solleva `urllib.error.URLError` se onData è irraggiungibile — al
    chiamante decidere se propagare (single-comune fail-hard) o
    isolare (batch multi-comune: gli altri comuni procedono).
    """
    out = bollettino(citta)
    if out:
        return out
    # Fetch OK ma nessuna riga per la città: fallback a stima con motivo.
    an = anagrafica()
    if citta.upper() not in an:
        raise SystemExit(f"{citta} non è tra le 27 città del bollettino")
    info = an[citta.upper()]
    lat = float(info["latitude"])
    lon = float(info["longitude"])
    # La stagione di pubblicazione cambia ogni anno: non è "maggio-
    # settembre" fissa. Per il 2026 la finestra dichiarata dalla
    # pagina bollettini del Ministero è 25 maggio - 20 settembre
    # (https://www.salute.gov.it/new/it/tema/ondate-di-calore/
    #  bollettini-sulle-ondate-di-calore-0/, verificato 2026-08-07).
    # Il codice non guarda il calendario: se la città non è nel CSV
    # di oggi, la ragione è indistinguibile fra "fuori dalla finestra
    # annuale" e "giorno di mancata pubblicazione dentro la finestra",
    # e in entrambi i casi il fallback è la stima locale.
    print(
        f"il bollettino non riporta {citta} oggi (fuori dalla "
        f"stagione di pubblicazione o mancata pubblicazione): "
        f"fallback a stima da Open-Meteo su ({lat}, {lon})"
    )
    out = stima(lat, lon)
    for r in out:
        r["motivo"] = "citta_non_nel_bollettino"
    return out


def _comuni_serviti() -> list[dict]:
    """
    Legge da `pubblico.organizzazione` le colonne che decidono come
    aggiornare l'allerta di ogni comune servito: `comune_istat`,
    `ramo_allerta` ('bollettino'|'stima'), `citta_bollettino` (nome
    ufficiale onData per il ramo bollettino, NULL altrimenti), `lat`,
    `lon`.

    Deduplica per `comune_istat`: un comune può ospitare più
    organizzazioni ma l'allerta è una proprietà del comune, non
    dell'organizzazione. Se due organizzazioni dichiarano una
    configurazione allerta divergente sullo stesso comune, fail-hard —
    è un errore di seed, non uno stato che il poller può risolvere.
    """
    import psycopg2
    import psycopg2.extras

    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL non impostata")

    conn = psycopg2.connect(url)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT DISTINCT comune_istat, ramo_allerta,
                       citta_bollettino, lat, lon
                  FROM pubblico.organizzazione
                 ORDER BY comune_istat
                """
            )
            righe = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    per_comune: dict[str, dict] = {}
    for r in righe:
        istat = r["comune_istat"]
        if istat in per_comune:
            e = per_comune[istat]
            if (e["ramo_allerta"] != r["ramo_allerta"]
                    or e["citta_bollettino"] != r["citta_bollettino"]
                    or e["lat"] != r["lat"] or e["lon"] != r["lon"]):
                raise SystemExit(
                    f"comune {istat}: due organizzazioni con configurazione "
                    f"allerta divergente (ramo/città/coordinate). "
                    f"Correggere il seed prima di rilanciare."
                )
        else:
            per_comune[istat] = r
    return list(per_comune.values())


def tutti() -> None:
    """
    Aggiorna l'allerta per tutti i comuni serviti dall'istanza, letti da
    `pubblico.organizzazione`. Un solo comando invece di uno per comune
    con coordinate e codici ISTAT da ricordare a memoria.

    Isolamento per comune: se il bollettino di un comune è irraggiungibile
    o Open-Meteo cade su un altro, gli altri comuni procedono comunque
    (ognuno ha la sua transazione via `scrivi_db`). A fine ciclo, se
    almeno un comune è fallito, exit non-zero — così il cron lo segnala.
    """
    comuni = _comuni_serviti()
    if not comuni:
        raise SystemExit(
            "nessuna organizzazione in pubblico.organizzazione: "
            "eseguire packages/db/seed-organizzazione.sql prima."
        )

    n_ok = 0
    falliti: list[tuple[str, str]] = []
    for cfg in comuni:
        istat = cfg["comune_istat"]
        ramo = cfg["ramo_allerta"]
        try:
            if ramo == "bollettino":
                citta = cfg["citta_bollettino"]
                if not citta:
                    raise SystemExit(
                        f"{istat}: ramo_allerta='bollettino' senza "
                        f"citta_bollettino nell'organizzazione."
                    )
                righe = bollettino_o_fallback(citta)
            elif ramo == "stima":
                if cfg["lat"] is None or cfg["lon"] is None:
                    raise SystemExit(
                        f"{istat}: ramo_allerta='stima' senza lat/lon "
                        f"nell'organizzazione."
                    )
                righe = stima(float(cfg["lat"]), float(cfg["lon"]))
            else:
                raise SystemExit(f"{istat}: ramo_allerta sconosciuto: {ramo!r}")
            n = scrivi_db(righe, istat)
            print(f"[OK]   {istat} ({ramo}): {n} righe scritte")
            n_ok += 1
        except (urllib.error.URLError, SystemExit) as e:
            msg = str(e) or e.__class__.__name__
            print(f"[FAIL] {istat} ({ramo}): {msg}")
            falliti.append((istat, msg))

    print(f"\nRiepilogo: {n_ok} OK, {len(falliti)} falliti su {len(comuni)}")
    if falliti:
        raise SystemExit(
            f"{len(falliti)} comuni non aggiornati: "
            f"{', '.join(i for i, _ in falliti)}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--citta", help="ramo A: una delle 27 città")
    g.add_argument("--stima", nargs=2, type=float, metavar=("LAT", "LON"))
    g.add_argument("--backtest", metavar="CITTA")
    g.add_argument("--elenco", action="store_true", help="le 27 città")
    g.add_argument("--tutti", action="store_true",
                   help="aggiorna l'allerta per tutti i comuni serviti "
                        "dall'istanza (letti da pubblico.organizzazione). "
                        "Ramo e coordinate vengono dalla tabella, "
                        "--scrivi-db è implicito.")
    ap.add_argument("--output-file", metavar="PATH",
                    help="scrive il JSON su PATH invece che su stdout")
    # --scrivi-db accetta il codice ISTAT esplicito (retro-compat) oppure
    # nessun valore: nel ramo --citta si deriva da anagrafica.admin3code
    # (§12x punto 1). Nel ramo --stima resta obbligatorio (nulla da cui
    # dedurre). `nargs='?' const=''` distingue "flag assente" (None) da
    # "flag presente senza valore" (stringa vuota).
    ap.add_argument("--scrivi-db", metavar="COMUNE_ISTAT", nargs="?", const="",
                    help="UPSERT delle righe in pubblico.allerta per il "
                         "comune indicato (codice ISTAT a 6 cifre). Nel "
                         "ramo --citta si può omettere il valore: viene "
                         "derivato da citta-anagrafica.csv (admin3code).")
    a = ap.parse_args()

    if a.elenco:
        for k, v in sorted(anagrafica().items()):
            print(f"{k:<20} {v['admin3code']}  {v['latitude']},{v['longitude']}")
        return

    if a.tutti:
        tutti()
        return

    # Deriva il codice ISTAT quando richiesto — solo nel ramo --citta,
    # via anagrafica onData. Nel ramo --stima il codice è obbligatorio.
    if a.scrivi_db == "":
        if not a.citta:
            raise SystemExit(
                "--scrivi-db senza valore richiede --citta: "
                "il codice ISTAT si deriva da anagrafica, che ha senso "
                "solo per le 27 città del bollettino."
            )
        an = anagrafica()
        if a.citta.upper() not in an:
            raise SystemExit(f"{a.citta} non è tra le 27 città del bollettino")
        a.scrivi_db = an[a.citta.upper()]["admin3code"]
        print(f"codice ISTAT derivato da anagrafica: {a.scrivi_db}")

    if a.citta:
        # Ramo bollettino con fallback quando la città non c'è (§12x).
        # Distinguiamo due modi di fallire:
        #   - bollettino() ritorna [] dopo fetch OK: file latest.csv non
        #     contiene la città oggi (fuori stagione o mancata pubblicazione).
        #     Fallback a stima con motivo esplicito, incapsulato in
        #     `bollettino_o_fallback`. Serve solo quando scriviamo in DB —
        #     se stiamo solo stampando JSON su stdout, `out=[]` è ok.
        #   - bollettino() solleva URLError: fonte irraggiungibile
        #     (transitorio). Niente fallback silenzioso: propaghiamo,
        #     il cron termina non-zero, la riga vecchia in DB resta.
        try:
            out = (
                bollettino_o_fallback(a.citta) if a.scrivi_db
                else bollettino(a.citta)
            )
        except urllib.error.URLError as e:
            raise SystemExit(
                f"bollettino ondata non raggiungibile per {a.citta}: {e}. "
                f"Non fallback a stima: la fonte potrebbe tornare in pochi "
                f"minuti, e sovrascrivere il livello ufficiale con una "
                f"stima silenziosa toglierebbe autoritatività al dato in "
                f"DB. La riga precedente resta valida finché non si aggiorna."
            )
    elif a.stima:
        out = stima(*a.stima)
    else:
        out = backtest(a.backtest)

    if a.scrivi_db:
        if a.backtest:
            raise SystemExit("--scrivi-db non ha senso con --backtest")
        n = scrivi_db(out, a.scrivi_db)
        print(f"scritte {n} righe in pubblico.allerta per {a.scrivi_db}")
        return

    payload = json.dumps(out, ensure_ascii=False, indent=1)
    if a.output_file:
        with open(a.output_file, "w", encoding="utf-8") as f:
            f.write(payload + "\n")
    else:
        print(payload)


if __name__ == "__main__":
    main()
