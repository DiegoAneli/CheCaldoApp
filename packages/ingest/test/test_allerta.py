# SPDX-License-Identifier: AGPL-3.0-or-later
"""
Test unitari su stima() — logica di escalation al livello 3.

Il backtest esistente misura solo il ramo istantaneo (_livello_da_percentile
sul singolo giorno) contro il bollettino. L'escalation "tre giorni consecutivi
≥2 finiscono in una promozione a 3" non era coperta da nessun test finché,
il 4/8/2026, un difetto nell'inizializzazione di `consecutivi` è vissuto
sotto la superficie ed è stato scoperto per caso rileggendo il codice
(§6.9 di CHECALDO-PROGETTO). Questi test servono a impedire che una
prossima riscrittura reintroduca lo stesso tipo di errore.

Metodo: inietto storico/futuro come parametri di stima() (firma
esteso a questo scopo, senza toccare il calcolo). Uso una climatologia
sintetica `list(range(100))` che rende le soglie leggibili — T=95 dà
percentile 0.95 → lv=2, T=98 dà 0.98 → lv=3, T=85 dà 0.85 → lv=1.

Eseguibile: docker compose run --rm ingest python -m unittest \\
            discover -s packages/ingest/test -v
"""

import os
import sys
import unittest
import urllib.error
from datetime import date, timedelta
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import allerta  # noqa: E402
from allerta import stima  # noqa: E402


# clim = [0.0, 1.0, ..., 99.0] → soglie leggibili:
#   T=85 → posizione 0.85 → livello 1
#   T=95 → posizione 0.95 → livello 2
#   T=98 → posizione 0.98 → livello 3
CLIM = [float(x) for x in range(100)]

OGGI = date(2026, 8, 4)  # fissato: non dipende dal giorno reale


def gg(delta: int) -> str:
    """Data ISO a `delta` giorni da OGGI (delta negativo = passato)."""
    return (OGGI + timedelta(days=delta)).isoformat()


def livelli(out):
    return [r["livello"] for r in out]


class TestEscalationLivello3(unittest.TestCase):
    """Cinque casi minimi + variante di controllo."""

    def _stima(self, storico, futuro):
        # lat/lon a 0.0: non usati quando storico+futuro+clim sono iniettati.
        return stima(0.0, 0.0, oggi=OGGI, clim=CLIM,
                     storico=storico, futuro=futuro)

    # -------------------------------------------------------------- caso 1
    def test_tre_consecutivi_ieri_promuovono_oggi_a_3(self):
        """Storico [1,1,1,2,2,2] + oggi ≥2 → oggi=3."""
        storico = {
            gg(-6): (80.0, 15.0),  # lv 0
            gg(-5): (80.0, 15.0),
            gg(-4): (80.0, 15.0),
            gg(-3): (95.0, 15.0),  # lv 2 (inizio catena)
            gg(-2): (95.0, 15.0),  # lv 2
            gg(-1): (95.0, 15.0),  # lv 2 (fine catena, a ieri)
        }
        futuro = {
            gg(0):  (95.0, 15.0),  # base lv 2, cons 3+1=4 → promosso a 3
            gg(1):  (80.0, 15.0),
            gg(2):  (80.0, 15.0),
        }
        out = self._stima(storico, futuro)
        self.assertEqual(livelli(out), [3, 0, 0])

    # -------------------------------------------------------------- caso 2
    def test_buco_in_mezzo_non_promuove(self):
        """
        Storico [2,2,0,0,0,0]: tre ≥2 totali nella finestra ma solo i primi
        due giorni (6 e 5 gg fa); ieri è a 0. Il vecchio conteggio bacato
        (`sum(1 for ... if lv>=2)`) faceva consecutivi=2 → oggi cons=3 →
        promosso a 3. Il conteggio corretto (backward-scan fino al primo
        buco) fa consecutivi=0 → oggi cons=1, nessuna promozione.
        """
        storico = {
            gg(-6): (95.0, 15.0),  # lv 2
            gg(-5): (95.0, 15.0),  # lv 2
            gg(-4): (80.0, 15.0),  # lv 0 (buco)
            gg(-3): (80.0, 15.0),  # lv 0
            gg(-2): (80.0, 15.0),  # lv 0
            gg(-1): (80.0, 15.0),  # lv 0 (ieri sotto soglia → cons=0)
        }
        futuro = {
            gg(0):  (95.0, 15.0),  # base lv 2, cons 0+1=1 → resta 2
            gg(1):  (95.0, 15.0),  # base lv 2, cons 1+1=2 → resta 2
            gg(2):  (95.0, 15.0),  # base lv 2, cons 2+1=3 → promosso a 3
        }
        out = self._stima(storico, futuro)
        # Oggi e domani restano al livello base (2). Solo dopodomani
        # sale a 3 perché nel FUTURO ci sono tre giorni consecutivi ≥2.
        # È il comportamento corretto: la catena parte da oggi, non
        # dallo storico interrotto.
        self.assertEqual(livelli(out), [2, 2, 3])

    # -------------------------------------------------------------- caso 3
    def test_due_consecutivi_ieri_e_oggi_sotto_non_promuovono(self):
        """
        Storico [0,0,0,0,2,2]: due consecutivi che finiscono a ieri
        (cons=2). Oggi <2 azzera cons; nessuna promozione né oggi né dopo.
        """
        storico = {
            gg(-6): (80.0, 15.0),
            gg(-5): (80.0, 15.0),
            gg(-4): (80.0, 15.0),
            gg(-3): (80.0, 15.0),
            gg(-2): (95.0, 15.0),  # lv 2
            gg(-1): (95.0, 15.0),  # lv 2 (cons=2 entrando in futuro)
        }
        futuro = {
            gg(0):  (80.0, 15.0),  # base lv 0 → cons reset a 0
            gg(1):  (95.0, 15.0),  # base lv 2 → cons 1, nessuna promozione
            gg(2):  (95.0, 15.0),  # base lv 2 → cons 2, nessuna promozione
        }
        out = self._stima(storico, futuro)
        self.assertEqual(livelli(out), [0, 2, 2])

    # ----------------------------------------------- caso 3 (variante di design)
    def test_due_consecutivi_ieri_piu_oggi_promuovono(self):
        """
        Variante di controllo: due consecutivi in storico + oggi ≥2 = tre
        consecutivi che INCLUDONO oggi. Design: promuove a 3 oggi.
        Se questo test fallisce, la logica di escalation è cambiata
        e va riletta la definizione ufficiale in `stima()` docstring.
        """
        storico = {
            gg(-6): (80.0, 15.0),
            gg(-5): (80.0, 15.0),
            gg(-4): (80.0, 15.0),
            gg(-3): (80.0, 15.0),
            gg(-2): (95.0, 15.0),  # lv 2
            gg(-1): (95.0, 15.0),  # lv 2 (cons=2)
        }
        futuro = {
            gg(0):  (95.0, 15.0),  # base lv 2, cons 3 → promosso a 3
            gg(1):  (80.0, 15.0),
            gg(2):  (80.0, 15.0),
        }
        out = self._stima(storico, futuro)
        self.assertEqual(livelli(out), [3, 0, 0])

    # -------------------------------------------------------------- caso 4
    def test_tre_consecutivi_ma_finiscono_tre_giorni_fa_non_contano(self):
        """
        Storico [2,2,2,0,0,0]: tre consecutivi ma terminati 4 giorni fa.
        Il vecchio bug contava cons=3 e promuoveva oggi. Il conteggio
        corretto (backward-scan si ferma al primo giorno <2, quindi al -1)
        fa cons=0 → oggi non viene promosso.
        """
        storico = {
            gg(-6): (95.0, 15.0),  # lv 2
            gg(-5): (95.0, 15.0),  # lv 2
            gg(-4): (95.0, 15.0),  # lv 2 (tre consecutivi)
            gg(-3): (80.0, 15.0),  # lv 0 (rottura)
            gg(-2): (80.0, 15.0),
            gg(-1): (80.0, 15.0),
        }
        futuro = {
            gg(0):  (95.0, 15.0),  # base lv 2, cons 0+1=1 → resta 2
            gg(1):  (80.0, 15.0),
            gg(2):  (80.0, 15.0),
        }
        out = self._stima(storico, futuro)
        self.assertEqual(livelli(out), [2, 0, 0])

    # ----------------------------------------------------- caso 5 (vuoto)
    def test_storico_vuoto_nessun_errore_nessuna_promozione(self):
        """Serie storica non disponibile: cons=0, base level puro."""
        storico = {}
        futuro = {
            gg(0):  (95.0, 15.0),  # base lv 2, cons 1
            gg(1):  (95.0, 15.0),  # base lv 2, cons 2
            gg(2):  (95.0, 15.0),  # base lv 2, cons 3 → promosso a 3
        }
        out = self._stima(storico, futuro)
        self.assertEqual(livelli(out), [2, 2, 3])

    # ------------------------------------------------- caso 5 (parziale)
    def test_storico_parziale_un_solo_giorno_non_errore(self):
        """
        Storico con solo ieri (lv 2): cons=1 entrando in futuro. Oggi
        ≥2 → cons=2, no promozione. Domani ≥2 → cons=3, promosso.
        """
        storico = {gg(-1): (95.0, 15.0)}  # solo ieri, lv 2
        futuro = {
            gg(0):  (95.0, 15.0),  # base lv 2, cons 2, no promozione
            gg(1):  (95.0, 15.0),  # base lv 2, cons 3, promosso a 3
            gg(2):  (80.0, 15.0),
        }
        out = self._stima(storico, futuro)
        self.assertEqual(livelli(out), [2, 3, 0])


class TestNottiTropicali(unittest.TestCase):
    """
    Test di regressione sul conteggio consecutivo delle notti tropicali
    (T_app_min > 20°C), che condivide il pattern "consecutivi fino a oggi"
    con l'escalation ma è calcolato correttamente da sempre — coperto per
    non perderlo se qualcuno tocca quel blocco.
    """

    def _stima(self, storico, futuro):
        return stima(0.0, 0.0, oggi=OGGI, clim=CLIM,
                     storico=storico, futuro=futuro)

    def test_sette_notti_consecutive_arriva_a_sette(self):
        storico = {gg(d): (80.0, 25.0) for d in range(-6, 0)}
        futuro = {gg(0): (80.0, 25.0), gg(1): (80.0, 25.0), gg(2): (80.0, 25.0)}
        out = self._stima(storico, futuro)
        # nottiTropicali è calcolato UNA volta e propagato a tutte le
        # righe di out (una fotografia al momento del poller).
        self.assertEqual(out[0]["nottiTropicali"], 7)

    def test_notte_fresca_azzera_il_contatore(self):
        storico = {
            gg(-6): (80.0, 25.0),
            gg(-5): (80.0, 25.0),
            gg(-4): (80.0, 18.0),  # fresca → contatore azzerato
            gg(-3): (80.0, 25.0),
            gg(-2): (80.0, 25.0),
            gg(-1): (80.0, 25.0),
        }
        futuro = {gg(0): (80.0, 25.0), gg(1): (80.0, 25.0), gg(2): (80.0, 25.0)}
        out = self._stima(storico, futuro)
        # 3 giorni fa fino a oggi = 4 notti consecutive (comprende oggi).
        self.assertEqual(out[0]["nottiTropicali"], 4)


ANAGRAFICA_MOCK = {
    "BOLOGNA": {
        "citta": "BOLOGNA", "name": "Bologna", "geonameid": "6541998",
        "latitude": "44.50657", "longitude": "11.35041", "admin3code": "037006",
    },
    "TORINO": {
        "citta": "TORINO", "name": "Torino", "geonameid": "3165524",
        "latitude": "45.07049", "longitude": "7.68682", "admin3code": "001272",
    },
}

RIGHE_BOLLETTINO = [
    {"data": "2026-08-04", "livello": 3, "provenienza": "bollettino",
     "orizzonteOre": 24, "fonteUrl": "https://…", "dataEstrazione": "2026-08-03"},
]

RIGHE_STIMA = [
    {"data": "2026-11-15", "livello": 0, "provenienza": "stima",
     "orizzonteOre": 24, "nottiTropicali": 0, "fonteUrl": None},
    {"data": "2026-11-16", "livello": 0, "provenienza": "stima",
     "orizzonteOre": 48, "nottiTropicali": 0, "fonteUrl": None},
]


class TestCliRamoCitta(unittest.TestCase):
    """
    §12x — auto-derive codice ISTAT + fallback fuori stagione + distinzione
    fonte irraggiungibile. Test attraverso `main()` con monkey patch di
    bollettino/anagrafica/scrivi_db: nessuna rete, nessun DB.
    """

    def test_scrivi_db_deriva_istat_da_anagrafica(self):
        """`--citta BOLOGNA --scrivi-db` senza valore → 037006 dal CSV."""
        catturato: dict = {}
        def fake_scrivi_db(righe, comune_istat):
            catturato["righe"] = righe
            catturato["comune_istat"] = comune_istat
            return len(righe)

        with mock.patch.object(allerta, "anagrafica", return_value=ANAGRAFICA_MOCK), \
             mock.patch.object(allerta, "bollettino", return_value=RIGHE_BOLLETTINO), \
             mock.patch.object(allerta, "scrivi_db", side_effect=fake_scrivi_db), \
             mock.patch.object(sys, "argv",
                               ["allerta.py", "--citta", "BOLOGNA", "--scrivi-db"]):
            allerta.main()

        self.assertEqual(catturato["comune_istat"], "037006")
        self.assertEqual(len(catturato["righe"]), 1)
        # motivo NULL/assente: bollettino OK, nessun fallback
        self.assertNotIn("motivo", catturato["righe"][0])

    def test_scrivi_db_esplicito_retro_compat(self):
        """`--citta BOLOGNA --scrivi-db 037006` (formato vecchio) continua a funzionare."""
        catturato: dict = {}
        def fake_scrivi_db(righe, comune_istat):
            catturato["comune_istat"] = comune_istat
            return len(righe)

        with mock.patch.object(allerta, "anagrafica", return_value=ANAGRAFICA_MOCK), \
             mock.patch.object(allerta, "bollettino", return_value=RIGHE_BOLLETTINO), \
             mock.patch.object(allerta, "scrivi_db", side_effect=fake_scrivi_db), \
             mock.patch.object(sys, "argv",
                               ["allerta.py", "--citta", "BOLOGNA",
                                "--scrivi-db", "037006"]):
            allerta.main()
        self.assertEqual(catturato["comune_istat"], "037006")

    def test_scrivi_db_senza_valore_richiede_citta(self):
        """`--stima ... --scrivi-db` senza valore → SystemExit."""
        with mock.patch.object(sys, "argv",
                               ["allerta.py", "--stima", "44.8", "10.3", "--scrivi-db"]):
            with self.assertRaises(SystemExit) as ctx:
                allerta.main()
            self.assertIn("--scrivi-db senza valore", str(ctx.exception))

    def test_fallback_bollettino_vuoto_scrive_stima_con_motivo(self):
        """
        bollettino() ritorna [] (fetch OK, ma nessuna riga per la città):
        fallback a stima con motivo='citta_non_nel_bollettino' su ogni
        riga. Copre due condizioni indistinguibili dal dato: fuori dalla
        stagione ministeriale (mag-set) o giorno di mancata pubblicazione.
        Il codice non guarda il calendario, guarda il fatto osservato.
        """
        catturato: dict = {}
        def fake_scrivi_db(righe, comune_istat):
            catturato["righe"] = righe
            catturato["comune_istat"] = comune_istat
            return len(righe)

        with mock.patch.object(allerta, "anagrafica", return_value=ANAGRAFICA_MOCK), \
             mock.patch.object(allerta, "bollettino", return_value=[]), \
             mock.patch.object(allerta, "stima", return_value=list(RIGHE_STIMA)), \
             mock.patch.object(allerta, "scrivi_db", side_effect=fake_scrivi_db), \
             mock.patch.object(sys, "argv",
                               ["allerta.py", "--citta", "BOLOGNA", "--scrivi-db"]):
            allerta.main()

        self.assertEqual(catturato["comune_istat"], "037006")
        self.assertEqual(len(catturato["righe"]), 2)
        for r in catturato["righe"]:
            self.assertEqual(r["motivo"], "citta_non_nel_bollettino",
                             f"riga {r} senza motivo di fallback")
            self.assertEqual(r["provenienza"], "stima",
                             f"riga {r} non è stima: fallback rotto")

    def test_fonte_irraggiungibile_niente_fallback(self):
        """
        bollettino() solleva URLError (rete giù): NON fallback a stima.
        Il cron fallisce, la riga vecchia in DB resta, coordinatore vedrà
        `dataEstrazione` che invecchia e capirà che è un problema
        transitorio, non un cambio stagionale.
        """
        chiamate_scrivi_db = []
        def fake_scrivi_db(righe, comune_istat):
            chiamate_scrivi_db.append((righe, comune_istat))
            return 0

        def fake_bollettino(citta):
            raise urllib.error.URLError("Name or service not known")

        with mock.patch.object(allerta, "anagrafica", return_value=ANAGRAFICA_MOCK), \
             mock.patch.object(allerta, "bollettino", side_effect=fake_bollettino), \
             mock.patch.object(allerta, "stima", return_value=list(RIGHE_STIMA)), \
             mock.patch.object(allerta, "scrivi_db", side_effect=fake_scrivi_db), \
             mock.patch.object(sys, "argv",
                               ["allerta.py", "--citta", "BOLOGNA", "--scrivi-db"]):
            with self.assertRaises(SystemExit) as ctx:
                allerta.main()
            self.assertIn("non raggiungibile", str(ctx.exception))

        self.assertEqual(chiamate_scrivi_db, [],
                         "scrivi_db non deve essere chiamato quando la fonte "
                         "bollettino è irraggiungibile — il DB resta com'è")


class TestOrizzonteOre(unittest.TestCase):
    """
    Regressione §12eeeeee-bis (2026-08-13): la formula dell'orizzonte
    è (giorni + 1) * 24 per giorni in [0, 2].

    Prima della correzione, `bollettino()` usava
    `24 if giorni <= 0 else min(72, giorni * 24)` che per giorni 1 e 2
    produceva 24 e 48 invece di 48 e 72 — le righe finivano in DB con
    l'etichetta sbagliata sulla colonna `orizzonte_ore`. `stima()` e
    `backtest()` avevano invece la formula giusta ma scritta in modi
    diversi, e la triplicazione della stessa formula era il vero
    difetto: adesso c'è un unico `_orizzonte_ore` che tutti usano.
    """

    def test_giorno_di_estrazione_e_24_ore(self):
        """E → 24h."""
        self.assertEqual(allerta._orizzonte_ore(0), 24)

    def test_giorno_dopo_e_48_ore(self):
        """E+1 → 48h. Verifica il bug §12eeeeee-bis: prima dava 24."""
        self.assertEqual(allerta._orizzonte_ore(1), 48)

    def test_due_giorni_dopo_e_72_ore(self):
        """E+2 → 72h. Verifica il bug §12eeeeee-bis: prima dava 48."""
        self.assertEqual(allerta._orizzonte_ore(2), 72)

    def test_giorno_negativo_solleva(self):
        """Fuori dominio: alza invece di clampare, così un cambio
        di formato della fonte upstream è visibile."""
        with self.assertRaises(ValueError):
            allerta._orizzonte_ore(-1)

    def test_giorno_oltre_dopodomani_solleva(self):
        with self.assertRaises(ValueError):
            allerta._orizzonte_ore(3)


if __name__ == "__main__":
    unittest.main()
