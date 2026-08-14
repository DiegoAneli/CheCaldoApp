-- SPDX-License-Identifier: AGPL-3.0-or-later
-- CheCaldo! — schema PostGIS
--
-- Due piani separati:
--   pubblico     dati aperti aggregati, nessuna persona
--   riservato    dati dell'organizzazione, non lasciano la sua istanza
--
-- CRS interno: EPSG:4326. Lo shapefile ISTAT arriva in EPSG:32632 e va
-- riproiettato una volta in ingestione. Per le distanze si usa il tipo
-- geography: con geometry i metri sono sbagliati e non c'è errore.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS pubblico;
CREATE SCHEMA IF NOT EXISTS riservato;

-- ========================================================== PIANO PUBBLICO

CREATE TABLE pubblico.organizzazione (
  id              serial PRIMARY KEY,
  nome            text NOT NULL,
  -- Mai "comune": una parrocchia o un comitato di quartiere sono
  -- organizzazioni quanto un ente pubblico.
  tipo            text NOT NULL CHECK (tipo IN ('comune','associazione','parrocchia','altro')),
  comune_istat    char(6) NOT NULL,
  -- 'bollettino' per le 27 città, 'stima' per tutte le altre.
  ramo_allerta    text NOT NULL CHECK (ramo_allerta IN ('bollettino','stima')),
  citta_bollettino text,
  lat             double precision,
  lon             double precision,
  -- Colonna oggi NON letta da nessuna parte del codice. La soglia
  -- effettiva del giorno viene calcolata da `capienzaSuggerita(allerta,
  -- N_volontari_attivi)` in `packages/scoring/src/index.ts` e scritta
  -- in `riservato.soglia_giorno` dal ramo "manca la riga" di
  -- `generaGiroDelGiorno` (`packages/db/src/query.ts` intorno a riga
  -- 2893-2913). Non rimossa qui per non fare `ALTER TABLE DROP COLUMN`
  -- su istanze già esistenti: se in futuro serve un default per-org
  -- (parametro operativo dell'organizzazione, non del giorno), la
  -- colonna è già pronta.
  soglia_default  int NOT NULL DEFAULT 60,
  creata_il       timestamptz NOT NULL DEFAULT now(),
  -- §12bbbbb — UNIQUE (nome, comune_istat) invece di UNIQUE (comune_istat):
  -- il commento su `tipo` chiarisce che più organizzazioni possono coesistere
  -- sullo stesso comune (parrocchia + ente pubblico + associazione), quindi
  -- il comune singolo non è la giusta chiave di deduplicazione. La coppia
  -- (nome, comune_istat) identifica un'entità realmente unica e serve al
  -- seed idempotente (`seed-organizzazione.sql` fa `ON CONFLICT (nome,
  -- comune_istat) DO NOTHING`). Verificato in §12bbbbb che due esecuzioni
  -- consecutive del seed lasciano il conteggio a 2.
  UNIQUE (nome, comune_istat)
);

CREATE TABLE pubblico.sezione (
  -- SEZ21_ID: identificativo nazionale.
  id                    text PRIMARY KEY,
  comune_istat          char(6) NOT NULL,
  sez21                 int NOT NULL,
  -- `quartiere` = unità di selezione dell'utente sulla pagina pubblica.
  -- Per Parma: quartiere ufficiale ISTAT (13 valori). Per Bologna: **zona**
  -- ISTAT (18 valori, es. "Bolognina", "Corticella") — i 6 quartieri
  -- amministrativi ufficiali sono troppo grandi (~65k ab.) per essere
  -- l'unità di selezione. Vedi CHECALDO-PROGETTO §12n.
  quartiere             text,          -- da COM_ASC1 / DEN_ASC1 (Parma) o da spatial join con aree statistiche (Bologna)
  -- Rollup amministrativo di secondo livello. NULL per Parma (`quartiere`
  -- è già amministrativo). Per Bologna: uno dei 6 quartieri ufficiali
  -- (es. "Navile", "San Donato - San Vitale") — usato per aggregati, non
  -- per il selettore utente.
  quartiere_amministrativo text,
  popolazione           int NOT NULL,  -- POP21
  famiglie              int NOT NULL,  -- FAM21
  abitazioni            int NOT NULL,  -- ABI21
  edifici_residenziali  int NOT NULL,  -- EDI21
  tipo_sezione          int NOT NULL,  -- COD_TIPO_S
  -- Nullable di proposito: gli attributi arrivano dal foglio Excel (istat.py),
  -- le geometrie dallo shapefile (MOD01). Sono due caricamenti separati, e il
  -- motore di punteggio non ha bisogno della geometria per funzionare.
  geom                  geometry(MultiPolygon, 4326),
  -- Sezioni ISTAT fittizie: persone senza dimora collocate in un poligono
  -- falso, di norma un parco. Vanno escluse dal punteggio e dichiarate
  -- come limite nel README.
  fittizia              boolean GENERATED ALWAYS AS (
                          sez21 BETWEEN 8888881 AND 8888889
                          OR sez21 IN (999999, 9999998, 9999999)
                        ) STORED,
  metri_da_punto_fresco double precision,
  -- Da strato satellitare esterno. NULL finché non è collegato: il motore
  -- rinormalizza i pesi sui fattori realmente presenti.
  delta_termico         double precision
);

CREATE INDEX ON pubblico.sezione USING gist (geom);
CREATE INDEX ON pubblico.sezione (comune_istat) WHERE NOT fittizia;
CREATE INDEX ON pubblico.sezione (quartiere);

CREATE TABLE pubblico.allerta (
  id              bigserial PRIMARY KEY,
  comune_istat    char(6) NOT NULL,
  data            date NOT NULL,
  livello         smallint NOT NULL CHECK (livello BETWEEN 0 AND 3),
  provenienza     text NOT NULL CHECK (provenienza IN ('bollettino','stima')),
  orizzonte_ore   smallint NOT NULL CHECK (orizzonte_ore IN (24,48,72)),
  notti_tropicali smallint NOT NULL DEFAULT 0,
  -- Link al PDF del Ministero, dalla colonna URL di onData. È la
  -- tracciabilità che l'interfaccia mostra accanto al livello.
  fonte_url       text,
  data_estrazione date NOT NULL,
  -- Perché il livello ha questa provenienza. NULL nel caso normale.
  -- Valorizzato quando si scrive una riga stima come fallback di un
  -- ramo bollettino: `citta_non_nel_bollettino` = il file `latest.csv`
  -- di onData non contiene la città oggi (§12x). Copre due condizioni
  -- reali indistinguibili dal dato: fuori dalla finestra annuale di
  -- pubblicazione ministeriale, oppure giorno di mancata pubblicazione
  -- dentro la finestra. La finestra cambia ogni anno — nel 2026 è
  -- 25 maggio - 20 settembre secondo la pagina bollettini del
  -- Ministero (https://www.salute.gov.it/new/it/tema/ondate-di-calore/
  -- bollettini-sulle-ondate-di-calore-0/, verificato 2026-08-07). Il
  -- nome del valore descrive il fatto osservabile, non un'ipotesi
  -- sul calendario. Senza motivo, la stima è quella scelta di design
  -- (comuni non nelle 27 città del ministero, come Parma).
  motivo_provenienza text NULL CHECK (motivo_provenienza IN ('citta_non_nel_bollettino')),
  UNIQUE (comune_istat, data, orizzonte_ore, data_estrazione)
);

CREATE INDEX ON pubblico.allerta (comune_istat, data DESC);

CREATE TABLE pubblico.punteggio_sezione (
  sezione_id  text NOT NULL REFERENCES pubblico.sezione(id),
  data        date NOT NULL,
  punteggio   double precision NOT NULL CHECK (punteggio BETWEEN 0 AND 1),
  -- I ranghi e i pesi usati, per rendere il calcolo ispezionabile.
  ranghi      jsonb NOT NULL,
  pesi        jsonb NOT NULL,
  fattori_disponibili text[] NOT NULL,
  PRIMARY KEY (sezione_id, data)
);

-- ======================================================== PIANO RISERVATO

-- §12aaaaa — `riservato.utente` è dichiarata QUI, prima di `segnale` e
-- `soglia_giorno`, perché entrambe la referenziano in colonne FK
-- (`chiuso_da` e `impostata_da`) inline. Prima di §12aaaaa la definizione
-- viveva dopo `soglia_giorno`: su volume esistente lo storico aveva
-- risolto l'ordine, su initdb fresco `CREATE TABLE segnale` cadeva con
-- `relation "riservato.utente" does not exist` e a cascata `utente`,
-- `assegnazione`, `rango_giorno`, `accesso_scheda` non venivano create.
-- Il bug era invisibile in dev (volume storico) e visibile solo a chi
-- clonasse il progetto da zero. Vedi CHECALDO-PROGETTO §12aaaaa per la
-- diagnosi completa e l'audit di tutti i forward references dello schema.
CREATE TABLE riservato.utente (
  id                serial PRIMARY KEY,
  organizzazione_id int NOT NULL REFERENCES pubblico.organizzazione(id),
  nome              text NOT NULL,
  email             text NOT NULL UNIQUE,
  hash_password     text NOT NULL,
  ruolo             text NOT NULL CHECK (ruolo IN ('coordinatore','volontario')),
  -- Designazione art. 29 GDPR, accettata al primo accesso.
  istruzioni_accettate_il timestamptz,
  attivo            boolean NOT NULL DEFAULT true,
  -- UNIQUE compound aggiuntivo (id, organizzazione_id): serve come
  -- target della FK compound in riservato.assegnazione (vedi §12u
  -- audit isolamento 2026-08-03, fix G).
  UNIQUE (id, organizzazione_id)
);

CREATE TABLE riservato.persona (
  id                serial PRIMARY KEY,
  organizzazione_id int NOT NULL REFERENCES pubblico.organizzazione(id),
  -- Chiave dell'organizzazione: il sistema non genera identità.
  id_esterno        text NOT NULL,
  sezione_id        text REFERENCES pubblico.sezione(id),
  -- Anno, non data di nascita: la granularità in più non serve al modello.
  anno_nascita      smallint,
  vive_solo         boolean,
  piano             smallint,
  ascensore         boolean,
  -- Ultimo contatto dell'organizzazione con la persona **prima** che
  -- CheCaldo entrasse in servizio (anagrafe pre-esistente). NULL =
  -- l'anagrafe non ne ha traccia (persona in intake, o registro non
  -- tenuto). Motore: se NULL, il fattore `giorni_da_ultimo_contatto`
  -- non si applica — comportamento neutro, non invenzione. Vedi
  -- §12jjj per la conseguenza sulla classifica.
  data_ultimo_contatto date,
  -- Il medico dice CHI, non perché. Nessun motivo clinico, mai.
  segnalato_da_mmg  boolean NOT NULL DEFAULT false,
  -- Geocodifica non risolta al civico: non sale in cima senza verifica.
  posizione_incerta boolean NOT NULL DEFAULT false,
  telefono          text,
  indirizzo         text,
  attiva            boolean NOT NULL DEFAULT true,
  UNIQUE (organizzazione_id, id_esterno),
  -- UNIQUE compound aggiuntivo (id, organizzazione_id): serve come
  -- target della FK compound in riservato.assegnazione. Impone che ogni
  -- riga di assegnazione nomini una persona che appartiene alla stessa
  -- organizzazione dichiarata nella riga di assegnazione. Vedi §12u
  -- audit isolamento 2026-08-03, fix G.
  UNIQUE (id, organizzazione_id)
);

CREATE INDEX ON riservato.persona (organizzazione_id) WHERE attiva;
CREATE INDEX ON riservato.persona (sezione_id);

CREATE TABLE riservato.segnale (
  id           bigserial PRIMARY KEY,
  persona_id   int NOT NULL REFERENCES riservato.persona(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (tipo IN (
                 'nessuna_climatizzazione','ventilatore_rotto',
                 'rete_familiare_assente','difficolta_mobilita',
                 'nessun_contatto_riferito','sintomi_riferiti')),
  origine      text NOT NULL CHECK (origine IN ('volontario','cittadino','mmg','coordinatore')),
  valido_fino  date,
  creato_il    timestamptz NOT NULL DEFAULT now(),
  -- Chiusura dal coordinatore: `sintomi_riferiti` nasce con valido_fino NULL
  -- e non scade a calendario; l'unico modo di uscirne è che un umano dica
  -- "visto, valutato". Il filtro `chiuso_il IS NULL` vive nella query di
  -- caricamento del motore (fonte autoritativa), non in `segnaliValidi` —
  -- vedi CHECALDO-PROGETTO §12d. La colonna resta libera per gli altri
  -- segnali, che potrebbero chiudersi anche prima della scadenza.
  chiuso_il    timestamptz,
  chiuso_da    int REFERENCES riservato.utente(id),
  -- Marcatore dei segnali caricati dal generatore sintetico via
  -- `packages/fixtures/scripts/carica-nel-db.ts`. I segnali scritti
  -- dall'app (`registraContatto`) hanno fixture_id NULL. Il partial
  -- UNIQUE INDEX rende idempotente il carica ripetuto: la chiave
  -- 's-<idEsterno>-<tipo>' è unica per costruzione del generatore
  -- (una sola riga per (persona, tipo) sintetica).
  fixture_id   text
);

CREATE INDEX ON riservato.segnale (persona_id, valido_fino);
-- Partial per la query più calda: segnali attivi (non chiusi, non scaduti)
-- caricati per il motore. La query di lettura filtra `chiuso_il IS NULL`;
-- questo indice la serve senza scandire i segnali storicamente chiusi.
CREATE INDEX ON riservato.segnale (persona_id, valido_fino) WHERE chiuso_il IS NULL;
-- Idempotenza del carica fixture: `ON CONFLICT (fixture_id) WHERE
-- fixture_id IS NOT NULL DO NOTHING`. Le scritture del generatore
-- restano idempotenti; le scritture dell'app (fixture_id NULL) sono
-- disciplinate dal vincolo sotto.
CREATE UNIQUE INDEX ON riservato.segnale (fixture_id) WHERE fixture_id IS NOT NULL;

-- §12uuu — unicità della condizione aperta per persona/tipo. Al massimo
-- una riga di uno stesso tipo può essere aperta (`chiuso_il IS NULL`)
-- sulla stessa persona; il vincolo copre sia le righe fixture sia quelle
-- app-side. Quando una riga viene chiusa esce dal vincolo, quindi una
-- riapertura successiva (segnale che si ripresenta dopo essere stato
-- risolto — es. ventilatore aggiustato che si rirompe) resta legittima
-- inserendo una nuova riga. Complemento operativo lato applicazione:
-- `registraContatto` fa `INSERT … ON CONFLICT DO NOTHING` per non
-- rilanciare un errore al volontario che ha risposto a una domanda
-- la cui condizione era già registrata (§12uuu).
CREATE UNIQUE INDEX ON riservato.segnale (persona_id, tipo)
  WHERE chiuso_il IS NULL;

CREATE TABLE riservato.contatto (
  id            bigserial PRIMARY KEY,
  persona_id    int NOT NULL REFERENCES riservato.persona(id) ON DELETE CASCADE,
  volontario_id int,
  data          timestamptz NOT NULL DEFAULT now(),
  esito         text NOT NULL CHECK (esito IN ('sta_bene','ha_bisogno','non_risponde')),
  -- Testo del volontario. L'agente ne estrae segnali strutturati; il testo
  -- non entra nel punteggio.
  nota_libera   text,
  azione_svolta text,
  -- Marker fixture (§12rrrr). Simmetrico a `riservato.segnale.fixture_id`:
  -- `NOT NULL` = riga generata dal canone sintetico
  -- (`packages/fixtures/scripts/genera-contatti-storici.ts`); `NULL` = riga
  -- scritta dall'app tramite `registraContatto`. Il wrapper invariante
  -- della suite di `@checaldo/db` (`packages/db/scripts/test-con-invariante.ts`,
  -- §12nnnn) filtra `fixture_id IS NULL` per contare come residuo solo
  -- ciò che i test scriverebbero — così i contatti fixture non fanno
  -- fallire la verifica di ripetibilità.
  fixture_id    text
);

CREATE INDEX ON riservato.contatto (persona_id, data DESC);
-- Partial unique per idempotenza del generatore contatti storici (§12rrrr).
-- Stessa forma dell'index su `segnale (fixture_id) WHERE fixture_id IS NOT NULL`:
-- rilanciare `genera-contatti-storici.ts` sullo stesso seed non moltiplica.
CREATE UNIQUE INDEX ON riservato.contatto (fixture_id) WHERE fixture_id IS NOT NULL;

-- Soglia del giorno: il coordinatore la imposta dalla dashboard (MOD04),
-- `carica-nel-db.ts` la legge invece della costante N_VOLONTARI × 6 = 36
-- di §12b. Se non impostata, `capienzaSuggerita(livello, N_VOLONTARI)`
-- fornisce il default e viene registrato con `impostata_da = NULL`.
-- PRIMARY KEY (organizzazione, data) → una soglia per giorno; per cambiarla
-- si UPDATE, non si accumulano righe.
CREATE TABLE riservato.soglia_giorno (
  organizzazione_id int NOT NULL REFERENCES pubblico.organizzazione(id),
  data              date NOT NULL,
  valore            int NOT NULL CHECK (valore >= 0),
  impostata_il      timestamptz NOT NULL DEFAULT now(),
  impostata_da      int REFERENCES riservato.utente(id),
  -- Livello di allerta al momento del salvataggio, per la banda della
  -- dashboard "soglia scelta quando l'allerta era X, oggi è Y". Nullable
  -- solo per retro-compat sulle righe scritte prima di §12w (2026-08-04).
  -- Nuove INSERT/UPDATE (batch + slider + riallinea) lo popolano sempre.
  livello_al_salvataggio smallint CHECK (livello_al_salvataggio BETWEEN 0 AND 3),
  PRIMARY KEY (organizzazione_id, data)
);

-- §12jjjjj — Presenza giornaliera dei volontari.
--
-- Semantica **solo assenze**: nessuna riga per (volontario, data) = di
-- turno oggi (default). Riga presente = il coordinatore ha messo il
-- volontario in pausa per quella data.
--
-- Perché "solo assenze" e non booleano `di_turno` con default TRUE:
-- retro-compatibilità completa con la storia. I giorni pre-§12jjjjj
-- non hanno righe: `generaGiroDelGiorno` interpreta "no riga = di
-- turno" e produce esattamente la distribuzione di prima. Nessun
-- backfill necessario. Un booleano avrebbe richiesto una scelta
-- ambigua per l'assenza di riga.
--
-- Default zero-config: prima installazione, prima esecuzione del
-- cron alle 3:00, primo giorno dopo il seed → nessuna riga → tutti
-- gli attivi sono di turno → il giro parte senza toccare nulla.
--
-- FK compound `(volontario_id, organizzazione_id) → utente(id,
-- organizzazione_id)`: stesso pattern §12u (audit isolamento
-- 2026-08-03). Impedisce che si scriva una pausa cross-org.
--
-- `impostata_da` traccia chi ha messo in pausa (audit); il seed
-- non popola righe qui, quindi il campo è NOT NULL per costruzione
-- (chi scrive è sempre l'utente autenticato via server action).
--
-- Nessun cascading: se un volontario viene disattivato/eliminato,
-- le sue righe di pausa non hanno più significato. Non ci sono
-- eliminazioni logiche di utenti nel dominio (solo `attivo=false`),
-- quindi il caso non si presenta. Se un giorno servirà, si aggiunge
-- `ON DELETE CASCADE` alla FK.
CREATE TABLE riservato.pausa_volontario (
  volontario_id     int NOT NULL,
  data              date NOT NULL,
  organizzazione_id int NOT NULL REFERENCES pubblico.organizzazione(id),
  impostata_il      timestamptz NOT NULL DEFAULT now(),
  impostata_da      int NOT NULL REFERENCES riservato.utente(id),
  PRIMARY KEY (volontario_id, data),
  FOREIGN KEY (volontario_id, organizzazione_id)
    REFERENCES riservato.utente(id, organizzazione_id)
);

-- Copre la query centrale di `generaGiroDelGiorno`:
-- "quali vol dell'org sono in pausa oggi?" — WHERE data = $today AND
-- organizzazione_id = $org, poi filter volontari NOT IN.
CREATE INDEX ON riservato.pausa_volontario (organizzazione_id, data);

CREATE TABLE riservato.assegnazione (
  id            bigserial PRIMARY KEY,
  data          date NOT NULL,
  -- organizzazione_id qui non è ridondante: le due FK compound sotto
  -- vincolano che volontario_id.organizzazione = organizzazione_id E
  -- persona_id.organizzazione = organizzazione_id, quindi volontario e
  -- persona finiscono per forza nella stessa organizzazione. Il DB
  -- rifiuta cross-org al primo INSERT, non "solo se il generatore ci
  -- prova con attenzione" (vedi §12u audit isolamento 2026-08-03, fix G).
  organizzazione_id int NOT NULL REFERENCES pubblico.organizzazione(id),
  persona_id    int NOT NULL,
  volontario_id int NOT NULL,
  posizione     int NOT NULL,
  -- Indice nella classifica del giorno ordinata per punteggio, prima della
  -- spartizione per quartiere fra i volontari. `posizione` è 1..6 (dentro
  -- il giro di UN volontario) e non discrimina; `rango_globale` è 1..N
  -- (fra tutte le persone in lista in città) ed è ciò che la motivazione
  -- "era Nª ieri" confronta con il rango_globale di data-1. Nullable per
  -- accogliere le righe scritte prima dell'introduzione della colonna.
  rango_globale int,
  azione        text NOT NULL,
  -- Motivazione dell'agente redattore, generata solo sopra soglia e messa
  -- in cache finché i fattori non cambiano.
  motivazione   text,
  fattori       jsonb NOT NULL,
  UNIQUE (data, persona_id),
  -- FK compound: sostituiscono le semplici REFERENCES riservato.persona(id)
  -- e riservato.utente(id). ON DELETE CASCADE lato persona resta.
  FOREIGN KEY (persona_id, organizzazione_id)
    REFERENCES riservato.persona(id, organizzazione_id) ON DELETE CASCADE,
  FOREIGN KEY (volontario_id, organizzazione_id)
    REFERENCES riservato.utente(id, organizzazione_id)
);

CREATE INDEX ON riservato.assegnazione (data, volontario_id, posizione);

-- Rango del giorno per TUTTE le persone valutate del comune, non solo per
-- quelle in lista. Serve al ramo motivazionale "era Nª ieri" della vista
-- volontario, che confronta il rango di data-1 con quello di oggi. Se il
-- rango vivesse solo in `assegnazione` (una riga per persona-in-lista),
-- chi ieri era 40ª e oggi entra in lista non avrebbe rango di ieri, e il
-- ramo tacerebbe proprio nel caso che conta — l'ingresso in lista. Vedi
-- CHECALDO-PROGETTO §12b "Rango globale come spazio del confronto".
-- Popolata da `carica-nel-db.ts` con l'output di `classificaPersone`
-- (rango = PersonaValutata.posizione, 1..N su tutte le persone attive
-- dell'organizzazione). `assegnazione.rango_globale` resta per coerenza
-- interna della riga (rango cristallizzato al momento dell'assegnazione).
CREATE TABLE riservato.rango_giorno (
  organizzazione_id int NOT NULL REFERENCES pubblico.organizzazione(id),
  data              date NOT NULL,
  persona_id        int NOT NULL REFERENCES riservato.persona(id) ON DELETE CASCADE,
  rango             int NOT NULL,
  punteggio         double precision NOT NULL,
  PRIMARY KEY (organizzazione_id, data, persona_id)
);

-- Serve la subquery di query.ts: `WHERE persona_id = X AND data = Y`.
-- La PK ha organizzazione_id come prefisso, non usa persona_id da sola.
CREATE INDEX ON riservato.rango_giorno (persona_id, data);

-- Log degli accessi alle schede nominative: è ciò che permette
-- all'organizzazione di dimostrare di aver fatto le cose in ordine.
CREATE TABLE riservato.accesso_scheda (
  id         bigserial PRIMARY KEY,
  utente_id  int NOT NULL REFERENCES riservato.utente(id),
  persona_id int NOT NULL REFERENCES riservato.persona(id) ON DELETE CASCADE,
  quando     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON riservato.accesso_scheda (persona_id, quando DESC);

-- Punti freschi della città: biblioteche, farmacie, centri commerciali,
-- centri sociali, chiese, fontanelle, parchi da OpenStreetMap (ODbL 1.0);
-- casette dell'acqua Iren da comune.parma.it come dato più affidabile
-- (impianti gestiti, non tag comunitario). L'agente consulente cittadino
-- ne riceve i più vicini per quartiere e li nomina nel suo output;
-- vincolo: non nomina luoghi che non ha ricevuto, non inventa distanze
-- né orari.
--
-- `sezione_id` NOT NULL: i punti fuori dal comune (la bbox Overpass è più
-- larga del confine di Parma per sicurezza) vengono DELETE in caricamento
-- prima di questo vincolo. `quartiere` è denormalizzato dalla sezione per
-- evitare join nella query di prossimità, calda per ogni pagina pubblica
-- con quartiere selezionato.
--
-- `fonte` distingue le tre origini possibili: OSM (contributor), Iren
-- (impianti dell'acqua Parma) e 'comune' (dataset comunale open data,
-- es. Bologna che pubblica biblioteche+farmacie in geojson). L'agente
-- lo usa per dire "casetta dell'acqua Iren, gratuita" (impianto
-- gestito) contro "fontanella" (tag OSM, verificabilità variabile);
-- 'comune' ha valenza analoga: dato ufficiale del gestore. `osm_id`
-- è il tipo+id OSM ("node/12345", "way/67890") — nullable per iren e
-- comune; il partial UNIQUE su (fonte, osm_id) rende il carica
-- ripetuto idempotente sui punti OSM.
CREATE TABLE pubblico.punto_fresco (
  id           serial PRIMARY KEY,
  fonte        text NOT NULL CHECK (fonte IN ('osm','iren','comune')),
  osm_id       text,
  tipo         text NOT NULL CHECK (tipo IN (
                 'biblioteca','farmacia','centro_commerciale','centro_sociale',
                 'chiesa','fontanella','parco','casetta_iren'
               )),
  -- Cosa fa il posto per il cittadino nelle ore di caldo. Cinque
  -- categorie distinte, non un continuum: mescolare parco e biblioteca
  -- come "rifugio" faceva finire i parchi al livello alto e l'agente li
  -- proponeva alle 14 quando le raccomandazioni sanitarie dicono di
  -- stare al chiuso — consiglio sbagliato per un anziano.
  --   rifugio       chiuso + AC, si sta ore (biblioteca, CC, centro sociale)
  --   sosta_fresca  chiuso + AC, sosta breve (farmacia)
  --   ombra_aperta  aperto, ombra (parco)
  --   acqua         bere (casetta Iren, fontanella)
  --   ripiego       massa muraria + orari incerti (chiesa)
  -- Derivato dal tipo con una CASE: una sola fonte di verità, cambiare
  -- il mapping richiede un'unica modifica in schema.sql. L'INSERT
  -- fallisce (NOT NULL su categoria) se qualcuno aggiunge un tipo alla
  -- whitelist e dimentica di estendere il CASE — difesa contro la
  -- divergenza silenziosa.
  categoria    text NOT NULL GENERATED ALWAYS AS (
                 CASE tipo
                   WHEN 'biblioteca'          THEN 'rifugio'
                   WHEN 'centro_commerciale'  THEN 'rifugio'
                   WHEN 'centro_sociale'      THEN 'rifugio'
                   WHEN 'farmacia'            THEN 'sosta_fresca'
                   WHEN 'parco'               THEN 'ombra_aperta'
                   WHEN 'casetta_iren'        THEN 'acqua'
                   WHEN 'fontanella'          THEN 'acqua'
                   WHEN 'chiesa'              THEN 'ripiego'
                 END
               ) STORED,
  -- Quando è utile — asse indipendente dalla categoria. Un parco è
  -- proponibile solo mattina e sera: la finestra sconsigliata è
  -- 11:00-18:00, come dice la raccomandazione della pagina pubblica
  -- ("Evita di uscire tra le 11 e le 18" — testo dal prototipo,
  -- `web/prototipo.html`, ripreso in `components/raccomandazioni.tsx`).
  -- Fuori da quella finestra il parco va bene: nessun orario di alba o
  -- tramonto codificato qui, l'agente vede solo "sconsigliato dentro
  -- 11-18, altrimenti sì".
  -- Tutto il resto (chiuso, o acqua) ha fascia `giorno_intero`: non
  -- implica un orario di apertura specifico — solo che il vincolo
  -- temporale del parco non si applica. Se il posto ha un opening_hours
  -- reale, sta nel campo `orari`; se non ce l'ha (quasi tutte le
  -- chiese, quasi tutti i parchi), l'agente deve dire "verifica gli
  -- orari" invece di presumere. Vedi anche il commento sulla priorita
  -- delle chiese sotto.
  fascia_oraria text NOT NULL GENERATED ALWAYS AS (
                  CASE tipo
                    WHEN 'parco' THEN 'mattina_sera'
                    ELSE              'giorno_intero'
                  END
                ) STORED,
  -- Ordine dentro la categoria, 1 = alto. La gerarchia sta nel dato,
  -- l'agente non decide (§CLAUDE vincolo 2). Con 5 categorie, ognuna ha
  -- 1-3 tipi, quindi priorita = 1, 2 o 3.
  --   rifugio:       biblioteca=1, centro_commerciale=1 (AC affidabile,
  --                  ore lunghe), centro_sociale=2 (orari meno certi).
  --   sosta_fresca:  farmacia=1.
  --   ombra_aperta:  parco=1.
  --   acqua:         casetta_iren=1 (impianto gestito Iren, dato ufficiale),
  --                  fontanella=2 (tag OSM, verificabilità variabile).
  --   ripiego:       chiesa=1. Su 121 chiese OSM, solo 1 ha
  --                  opening_hours: l'agente riceverà `orari = NULL`
  --                  praticamente sempre e deve dire "verifica gli
  --                  orari, molte chiudono nel primo pomeriggio" invece
  --                  di presumere. Meglio "non so" che mandare qualcuno
  --                  davanti a una porta chiusa.
  priorita     smallint NOT NULL CHECK (priorita BETWEEN 1 AND 3),
  nome         text,
  geom         geometry(Point, 4326) NOT NULL,
  indirizzo    text,
  orari        text,
  accessibile  text CHECK (accessibile IS NULL
                           OR accessibile IN ('yes','no','limited','designated')),
  -- Aria condizionata certificata dal gestore (biblioteche comunali
  -- di Bologna). NULL = dato non ricevuto (default: OSM non ha questo
  -- attributo). true/false = valore dal dataset comunale. L'agente
  -- lo usa come informazione ricevuta ("con aria condizionata"), non
  -- come attributo da inventare.
  aria_condi   boolean,
  sezione_id   text NOT NULL REFERENCES pubblico.sezione(id),
  quartiere    text,
  caricato_il  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON pubblico.punto_fresco USING gist (geom);
CREATE INDEX ON pubblico.punto_fresco (quartiere, categoria, priorita);
CREATE UNIQUE INDEX ON pubblico.punto_fresco (fonte, osm_id)
  WHERE osm_id IS NOT NULL;

-- Contatore giornaliero delle chiamate al modello, per osservabilità.
-- **NON è un tetto**: il limite di spesa vive sulla console Anthropic,
-- dove è più affidabile — un cap hardcoded in codice fallirebbe in
-- silenzio nel momento peggiore, un'ondata di caldo con picco di
-- richieste è esattamente quando serve che il sistema funzioni
-- (CHECALDO-PROGETTO §13.1). Popolato dal wrapper
-- `packages/agents/src/client.ts` prima di ogni chiamata reale
-- (da_cache=false); i cache hit dell'agente si registrano con da_cache=true.
--
-- `da_cache` in PK: due righe per giorno, una per contare le chiamate reali
-- al modello (che costano), una per i cache hit (gratuiti). Senza la
-- distinzione, statistiche di latenza mescolerebbero i due mondi e "l'agente
-- impiega 5 ms" sarebbe una risposta falsa.
CREATE TABLE pubblico.uso_modello (
  data      date    NOT NULL,
  da_cache  boolean NOT NULL,
  chiamate  int     NOT NULL DEFAULT 0,
  PRIMARY KEY (data, da_cache)
);

-- Cache dei consigli dell'agente MOD06 (consulente cittadino, §12k
-- Parte 4). Chiave semantica: `(quartiere_slug, livello, ora_finestra,
-- prompt_version)`.
--
-- Perché queste 4 colonne insieme:
--   quartiere_slug: dominio piccolo (~13 per Parma), il testo cambia
--     completamente al variare del quartiere (punti diversi, distanze
--     diverse, presenza/assenza di rifugio primario);
--   livello: 0..3, cambia una volta al giorno (aggiornato dal poller
--     ondate di calore); a livello diverso l'agente dice cose diverse;
--   ora_finestra: 2 valori (`diurna` fra 06:00-18:00, `serale`
--     18:00-06:00). Con lo scatto sulla finestra, non sul minuto, la
--     chiave non si invalida ogni 60 secondi;
--   prompt_version: SHA-256 dei primi 8 caratteri della hash del file
--     `packages/agents/prompts/consulente.md`, calcolato lato TypeScript
--     e passato qui come stringa. Cambiare il prompt invalida da solo
--     tutte le voci precedenti — le "vecchie" non vengono più servite
--     perché la chiave nuova non le troverà.
--
-- Combinazioni teoriche a regime: 13 × 4 × 2 = 104 righe/prompt-version.
-- Un'ondata di caldo genera 30-60 miss al giorno (chi apre la pagina in
-- fasce orarie diverse), poi tutto è cache hit.
--
-- Nessun TTL esplicito: livello e ora_finestra fanno già da chiave — un
-- consiglio "vecchio" con la stessa chiave è per definizione ancora
-- valido, e alla mezzanotte del giorno dopo il livello può cambiare e
-- la nuova chiave produce una nuova generazione naturale. Le righe di
-- ieri restano in tabella; non danno fastidio (~140 righe/giorno max).
CREATE TABLE pubblico.consiglio_cache (
  quartiere_slug text NOT NULL,
  livello        smallint NOT NULL CHECK (livello BETWEEN 0 AND 3),
  ora_finestra   text NOT NULL CHECK (ora_finestra IN ('diurna','serale')),
  prompt_version text NOT NULL,
  testo          text NOT NULL,
  generato_il    timestamptz NOT NULL DEFAULT now(),
  -- §12ggggg — audio MP3 cachato con la stessa PK del testo. NULL
  -- finché nessuno preme "Ascolta"; quando qualcuno preme, la route
  -- /api/tts/consiglio invoca il servizio tts, salva qui i byte MP3
  -- e li serve. Sparisce insieme al testo su UPDATE/DELETE (stessa
  -- riga = stessa sensibilità: contiene identificativi di quartiere).
  -- TOAST fuori-riga automatico per file >2 KB; MP3 tipici ~250-400 KB.
  audio             bytea,
  audio_generato_il timestamptz,
  PRIMARY KEY (quartiere_slug, livello, ora_finestra, prompt_version)
);

-- Cache del secondo agente (MOD06 BLOCCO B, §12l): il testo sopra
-- ConsiglioLocale che parla della città intera — livello di oggi +
-- previsioni 48h e 72h. Chiave: (comune_istat, livello_oggi,
-- livello_domani, livello_dopodomani, prompt_version). A regime la
-- città genera 1 chiamata/giorno (i livelli cambiano una volta al
-- giorno con il poller allerta.py).
--
-- Sentinel -1 per "livello previsto assente": PostgreSQL NON tratta
-- NULL come "uguale" in ON CONFLICT, quindi con `smallint NULL` la
-- chiave (…, NULL, NULL, …) non collide mai con sé stessa e la cache
-- crescerebbe illimitata. CHECK BETWEEN -1 AND 3 e conversione a null
-- lato applicazione. Le notti_tropicali NON stanno nella chiave — sono
-- una statistica che il modello può citare ma un +1 al conteggio non
-- deve invalidare l'intero testo (al peggio la frase dice "settimo
-- giorno" quando siamo all'ottavo; la cache scade comunque a ogni
-- cambio livello).
CREATE TABLE pubblico.allerta_citta_cache (
  comune_istat        text     NOT NULL,
  livello_oggi        smallint NOT NULL CHECK (livello_oggi BETWEEN 0 AND 3),
  livello_domani      smallint NOT NULL CHECK (livello_domani BETWEEN -1 AND 3),
  livello_dopodomani  smallint NOT NULL CHECK (livello_dopodomani BETWEEN -1 AND 3),
  prompt_version      text     NOT NULL,
  testo               text     NOT NULL,
  generato_il         timestamptz NOT NULL DEFAULT now(),
  -- §12ggggg — audio MP3 con la stessa PK del testo (vedi commento
  -- analogo in consiglio_cache sopra).
  audio               bytea,
  audio_generato_il   timestamptz,
  PRIMARY KEY (comune_istat, livello_oggi, livello_domani, livello_dopodomani, prompt_version)
);

-- §12ddddd — Cache del terzo agente (MOD06, riassunto della giornata
-- per il coordinatore). Il coordinatore preme un pulsante in dashboard
-- e riceve un testo in prosa che racconta cosa hanno fatto i volontari
-- oggi. Chiave a SCAGLIONI: il testo dipende dallo stato dei contatti
-- al momento della lettura, ma non deve rigenerarsi a ogni pressione.
--
-- `(organizzazione_id, data, scaglione, prompt_version)` dove
-- `scaglione = ceil(n_contatti / 5)`. La chiave cambia solo ogni 5
-- contatti nuovi. Con una giornata da ~25 contatti = ~5 miss;
-- ripremere il pulsante senza che sia successo niente = cache hit.
-- Tetto `LLM_DAILY_MISS_CAP_RIASSUNTO` default 20 (vedi
-- packages/agents/src/riassunto.ts) protegge il caso "coordinatore
-- che pigia N volte" oltre la variazione naturale del giorno.
--
-- `scaglione = 0` significa "zero contatti oggi": in quel caso
-- l'agente NON viene invocato affatto (gestione a livello TS,
-- vedi generaRiassunto). La chiave con scaglione=0 non nasce mai.
CREATE TABLE pubblico.riassunto_cache (
  organizzazione_id int  NOT NULL REFERENCES pubblico.organizzazione(id),
  data              date NOT NULL,
  scaglione         int  NOT NULL CHECK (scaglione >= 1),
  prompt_version    text NOT NULL,
  testo             text NOT NULL,
  generato_il       timestamptz NOT NULL DEFAULT now(),
  -- §12ggggg — audio MP3 con la stessa PK del testo. Contiene
  -- identificativi di persone assistite ("Persona 0064, novantunenne,
  -- senza contatti familiari, ventilatore rotto"): stessa
  -- sensibilità del testo, deve sparire con lui.
  audio             bytea,
  audio_generato_il timestamptz,
  PRIMARY KEY (organizzazione_id, data, scaglione, prompt_version)
);

-- ================================================================= viste

-- Vector tiles per la mappa pubblica. Migliaia di sezioni in GeoJSON
-- bloccano la pagina: si serve MVT.
--
-- LATERAL LIMIT 1 sulla data DESC: `punteggio_sezione` è una serie
-- temporale (una riga per sezione per giorno) e la view espone SOLO
-- l'ultimo punteggio disponibile. Un LEFT JOIN 1:N moltiplicherebbe le
-- righe (1.039 × N giorni) con geometrie ripetute — la coropleta si
-- romperebbe al secondo carica. LEFT (non INNER) perché una sezione
-- senza punteggio ancora scritto deve comunque comparire come poligono
-- grigio, non sparire dalla mappa.
CREATE OR REPLACE VIEW pubblico.v_mappa AS
SELECT s.id, s.comune_istat, s.quartiere, s.popolazione, s.tipo_sezione,
       round((s.popolazione::numeric / NULLIF(s.famiglie,0)), 2) AS persone_per_famiglia,
       p.punteggio, p.data, s.geom
FROM pubblico.sezione s
LEFT JOIN LATERAL (
  SELECT ps.punteggio, ps.data
    FROM pubblico.punteggio_sezione ps
   WHERE ps.sezione_id = s.id
   ORDER BY ps.data DESC
   LIMIT 1
) p ON true
WHERE NOT s.fittizia AND s.tipo_sezione = 1 AND s.popolazione > 0;

-- Distanza dalla sezione fresca più vicina, in metri reali, misurata da
-- un punto interno della sezione residenziale (ST_PointOnSurface, che
-- garantisce un punto DENTRO il poligono anche per sezioni concave o
-- multiparte — a differenza di ST_Centroid, che può cadere fuori) al
-- bordo della sezione-parco più vicina. La misura edge-to-edge
-- poligono→poligono darebbe 186/1039 residenziali a zero (17.9%) su
-- Parma, appiattendo il rango percentile proprio dove serve
-- discriminare. Vedi CHECALDO-PROGETTO §12c per i numeri della diagnostica.
CREATE OR REPLACE FUNCTION pubblico.calcola_distanze_fresco(p_comune char(6))
RETURNS int LANGUAGE sql AS $$
  WITH fresche AS (
    SELECT geom FROM pubblico.sezione
    WHERE comune_istat = p_comune AND tipo_sezione IN (5, 22, 23)
  ), agg AS (
    UPDATE pubblico.sezione s
    SET metri_da_punto_fresco = (
      SELECT min(ST_Distance(ST_PointOnSurface(s.geom)::geography,
                             f.geom::geography))
        FROM fresche f
    )
    WHERE s.comune_istat = p_comune AND NOT s.fittizia AND s.tipo_sezione = 1
    RETURNING 1
  ) SELECT count(*)::int FROM agg;
$$;
