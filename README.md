<!--
SPDX-License-Identifier: AGPL-3.0-or-later
-->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/logo-dark.png">
    <img src="docs/img/logo.png" alt="CheCaldo!" width="400">
  </picture>
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licenza AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg"></a>
  <img alt="PostgreSQL 16 + PostGIS 3.4" src="https://img.shields.io/badge/PostgreSQL-16%20%2B%20PostGIS%203.4-336791?logo=postgresql&logoColor=white">
  <img alt="Next.js App Router" src="https://img.shields.io/badge/Next.js-App%20Router-000?logo=nextdotjs&logoColor=white">
  <img alt="Python 3" src="https://img.shields.io/badge/Python-3-3776AB?logo=python&logoColor=white">
  <img alt="Docker Compose" src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white">
</p>

<p align="center">
  <a href="#il-motore-di-punteggio">Metodo</a> ·
  <a href="#provalo-in-locale">Installazione</a> ·
  <a href="#limiti-dichiarati">Limiti dichiarati</a> ·
  <a href="#dati-e-licenze">Licenze</a>
</p>

Ogni mattina d'estate, in un comune italiano, un'organizzazione che si
prende cura di persone anziane deve decidere **chi contattare oggi per
primo**. Le liste sono lunghe, i volontari sono meno. Oggi la scelta si
fa a intuito.

CheCaldo! risponde a quella domanda incrociando **il livello di allerta
del giorno**, **il profilo strutturale del quartiere** ricavato da dati
aperti ISTAT (persone per famiglia, densità edilizia, distanza dai
parchi urbani), e **la lista degli assistiti** che l'organizzazione
carica dalla propria anagrafe.

Non è un servizio meteorologico e non è un servizio di emergenza. È uno
strumento che aiuta un coordinatore a decidere in che ordine chiamare.

> Le mappe del caldo dicono dove piantare gli alberi. Il bollettino
> dice che oggi è livello 3. Nessuno dice a chi bussare stamattina.

Chi si prende cura di persone fragili — un'assistente sociale, un
volontario della Croce Rossa, il coordinatore di un centro anziani —
non trova strumenti pubblici che rispondano a questa domanda operativa.
CheCaldo! prova a farlo, dichiarando esattamente cosa fa e cosa no.

## Cos'è

Un'app web self-hosted. **Un'organizzazione serve un comune; una
stessa istanza può ospitare più organizzazioni**, ciascuna titolare
dei propri dati e isolata dalle altre a livello di schema (`packages/db/schema.sql`)
e di query (`packages/db/src/autorizzazione.ts` — `assertAppartiene`).
La pagina pubblica è aperta a tutti; una dashboard riservata e una
vista volontario mobile richiedono login.

## Attori e flussi

Il sistema ha **quattro attori**. Uno non tocca mai l'app.

**Cittadino** — pagina pubblica `/{comune}`, senza login. Vede il
livello di allerta del giorno con la sua provenienza dichiarata
(bollettino ministeriale o stima), il profilo del quartiere sulla
mappa coropletica, le raccomandazioni sanitarie per fasce d'età,
i punti freschi più vicini scelti dal codice (biblioteche, farmacie,
casette dell'acqua, fontanelle, parchi ombreggiati) con nome,
distanza e orari. Sotto la pagina, un consiglio locale generato dal
modello per il quartiere corrente. Nessuna funzionalità che permetta
al cittadino di segnalare una terza persona: quel canale a Parma è
già presidiato dal Piano Caldo del Comune.

![Pagina pubblica del comune: banda dell'allerta, mappa coropletica delle sezioni ISTAT, raccomandazioni e consulente di quartiere.](docs/img/pagina-pubblica.png)

_Vista d'insieme: livello di allerta con provenienza dichiarata, cosa conviene fare oggi, selettore del quartiere._

![Dettaglio di un quartiere sulla pagina pubblica: consiglio locale generato dal modello e mappa dei punti freschi vicini.](docs/img/pagina-pubblica-quartiere.png)

_Aperto un quartiere: consiglio "dove andare adesso" e i punti freschi più vicini all'utente._

**Coordinatore** — dashboard `/coordinatore`, login richiesto. Vede
la banda di stato del giorno (livello di allerta, contattati oggi,
in lista, assegnati ai volontari), la classifica delle persone per
rango, la coda dei sintomi da valutare, le persone uscite dalla
lista da ieri, il riassunto della giornata generato dal modello.
Sulle sotto-rotte `/coordinatore/persona/[id]` vede la scomposizione
del punteggio di una singola persona (ogni fattore che ha contribuito,
con il suo peso e il suo valore), e su `/coordinatore/volontari`
mette in pausa o riattiva volontari già esistenti. Agisce con: uno
slider che decide dove tagliare la lista (soglia), il pulsante
"Genera il giro" che assegna le persone in lista ai volontari attivi,
la chiusura delle segnalazioni non più valide, la rigenerazione del
giro se un volontario va in pausa dopo l'assegnazione. La creazione
di nuovi utenti volontario è da riga di comando (registro DDL), non
dalla dashboard.

![Dashboard del coordinatore: banda di stato del giorno, riassunto, soglia e classifica delle persone in lista.](docs/img/dashboard-coordinatore.png)

_In alto lo stato del giorno (in lista, tentate, senza risposta) e i controlli della soglia; sotto la classifica per rango con volontario assegnato._

![Dashboard del coordinatore: coda delle segnalazioni aperte e persone uscite dalla lista rispetto a ieri.](docs/img/dashboard-segnalazioni.png)

_Coda dei sintomi e delle condizioni da valutare, raggruppate per persona, con l'elenco di chi non è più in lista da ieri._

![Scheda "perché sta lì" di una persona: scomposizione del punteggio finale in punteggio della sezione e moltiplicatori individuali.](docs/img/scheda-persona-punteggio.png)

_Ogni fattore che ha contribuito al rango di una persona, con il valore letto e il contributo (base della sezione × moltiplicatori)._

**Volontario** — vista mobile `/volontario`, login richiesto. Vede
la coda di persone che gli sono state assegnate oggi, ognuna con
azione suggerita (prima chiamata, seconda chiamata, contatto
familiare, visita domiciliare — l'azione la decide il codice sul
numero di tentativi falliti, non il volontario). Su
`/volontario/[personaId]` apre la scheda: nome e quartiere,
spiegazione del rango di oggi, tasto chiama con link `tel:` (**il
numero di telefono non compare mai a schermo**), indirizzo rivelato
**solo se l'azione assegnata è una visita domiciliare**, ultima data
di contatto in anagrafe. Registra l'esito (sta bene / ha bisogno /
non risponde), apre o chiude segnalazioni. Le persone con un segnale
`sintomi_riferiti` aperto vengono mostrate come "valutazione
coordinatore" fin da subito: è l'unico caso in cui una persona
passa al coordinatore. La vista `/volontario/fine-giro` è un
resoconto di sola lettura del giro di oggi (raggiunte, non risponde,
da chiamare), senza alcuna azione di chiusura: non c'è un pulsante
finale, e nulla viene scritto nel DB. Il ritorno al giro è solo dal
pulsante "← Il giro di oggi" in cima alla card.

![Vista volontario: giro di oggi con quattro persone assegnate e tasto chiama per ciascuna.](docs/img/volontario-giro.png)

_La coda del giorno, ordinata: età, con chi vive, quartiere, motivo del rango. Il numero non compare, il tasto è direttamente il link `tel:`._

![Vista volontario: pagina "Fine giro" con i tre conteggi (raggiunte, non risponde, resta) e l'elenco di chi resta da chiamare.](docs/img/volontario-fine-giro.png)

_Resoconto di sola lettura di come è andato il giro. Nessuna azione di chiusura: il ritorno al giro è dal pulsante in cima alla card._

![Scheda persona lato volontario: azione suggerita, tasto chiama a tutta larghezza, situazione già nota e inizio del form d'esito.](docs/img/volontario-scheda.png)

_"Prima chiamata" come azione suggerita, tasto chiama senza numero a schermo, indirizzo assente (compare solo se l'azione è visita domiciliare)._

![Form d'esito nella scheda persona: domande "come sta oggi" e riga finale con Sta bene / Ha bisogno / Non risponde.](docs/img/volontario-form-esito.png)

_Il form d'esito con le domande di stato (bevuto, mangiato, sintomi) e i tre bottoni terminali che chiudono il contatto._

**Persona contattata** — non usa l'app. Riceve una telefonata (o,
raramente, una visita) da un volontario che ha già davanti la scheda
e sa perché sta chiamando.

**Ciclo della giornata:**

1. **06:00** — un cron esegue `generaGiroDelGiorno()` per ogni
   organizzazione servita dall'istanza, usando la previsione a +24h
   scritta dal poller del giorno prima. Legge la soglia salvata
   dal coordinatore (o il default calcolato da `capienzaSuggerita`),
   valuta tutte le persone in anagrafe con il motore di punteggio,
   ordina, taglia alla soglia, distribuisce ai volontari attivi di
   turno.
2. **Mattina** — il coordinatore apre la dashboard e trova la lista
   già pronta. Può rigenerarla a mano con il pulsante, con gli
   stessi parametri o cambiando la soglia.
3. **Giornata** — i volontari aprono `/volontario`, telefonano,
   registrano gli esiti. Dopo ogni tentativo fallito l'azione
   suggerita per quella persona cambia (prima chiamata → seconda
   chiamata → contatto familiare → visita domiciliare); la persona
   resta assegnata allo stesso volontario. L'unico caso in cui una
   persona passa al coordinatore è quando è aperto un segnale
   `sintomi_riferiti`, e succede subito, non dopo N tentativi.
4. **11:30 e 15:15** — il poller `packages/ingest/allerta.py --tutti`
   scarica il bollettino ministeriale e calcola la stima per i
   comuni fuori dalle 27 città, aggiornando `pubblico.allerta` con
   il livello di oggi e le previsioni a +24/+48/+72h.
5. **Sera** — il coordinatore genera il riassunto della giornata
   (conteggi + sintesi in prosa) sulla dashboard. La vista
   `/volontario/fine-giro` è un resoconto di sola lettura di
   raggiunte / non risponde / da chiamare, senza un'azione di
   chiusura: **non esiste uno stato di "giornata chiusa"** — il
   giro del giorno dopo viene generato al cron delle 06:00
   comunque, indipendentemente da cosa il volontario abbia
   scorso in serata.

Il ciclo è quello che c'è nel codice oggi. Gli orari cron sono in
`scripts/install-cron.sh` e sono modificabili sull'istanza.

## Chi c'è dentro il bollettino ministeriale — e chi resta fuori

Il bollettino di allerta caldo del Ministero della Salute copre **27
città italiane**: capoluoghi di regione più comuni sopra 200.000
abitanti. Le soglie sono calibrate sulla mortalità storica di ciascuna
città. **Parma ne ha circa 198.000, resta fuori per poche migliaia** —
come la stragrande maggioranza dei comuni italiani. CheCaldo! è
pensato per loro: comuni "grandi ma non abbastanza" per il perimetro
ministeriale, dove chi si prende cura di persone fragili deve comunque
decidere ogni mattina chi contattare.

Per le città nel bollettino (es. Bologna) CheCaldo! **non stima**: usa
il dato ufficiale. Nei giorni in cui il bollettino non riporta la
città — fuori dal periodo di pubblicazione (indicativamente da
maggio a settembre, con date esatte che cambiano ogni anno: il
[Ministero](https://www.salute.gov.it/new/it/tema/ondate-di-calore/bollettini-sulle-ondate-di-calore-0/)
dichiara per il 2026 la finestra 25 maggio - 20 settembre) o in un
giorno di mancata pubblicazione, CheCaldo! cade automaticamente sul
metodo di stima, dichiarandolo esplicitamente nel badge. Mai un
cambio di fonte in silenzio.

## Il motore di punteggio

Vive in `packages/scoring`, è TypeScript puro, non chiama modelli. È
la parte del sistema che non deve mai comportarsi in modo diverso a
parità di dati in ingresso.

**Due livelli.** Prima si calcola un punteggio della **sezione ISTAT**
(il quartiere fine, ~1.667 sezioni a Parma) come **somma pesata su
ranghi percentili comunali**, mai prodotto di valori normalizzati. Poi,
il punteggio della **persona** parte da quello della sua sezione e viene
**moltiplicato** per una serie di intensificatori individuali. La
distinzione è la ragione per cui una persona in un quartiere strutturalmente
fragile non finisce automaticamente prima di una in un quartiere solido
che vive sola con sintomi riferiti nella notte.

**Fattori strutturali (della sezione), pesi di default in
`packages/scoring/src/types.ts`:**

| Fattore | Da dove | Peso |
|---|---|---|
| Isolamento (`POP21 / FAM21`) | Basi territoriali ISTAT 2021 | 0,40 |
| Densità costruita (`ABI21 / EDI21`) | Basi territoriali ISTAT 2021 | 0,30 |
| Lontananza dal fresco (metri) | PostGIS su `pubblico.punto_fresco` | 0,15 |
| Esposizione termica | Strato termico da terzi — non collegato | 0,15 |

Il quarto fattore è **predisposto nel modello ma non collegato**:
la colonna `delta_termico` esiste in `pubblico.sezione` ma non è
valorizzata per nessuna sezione. Sarebbe uno scostamento in gradi
della sezione dalla media comunale, **statico** — medie stagionali
pluriennali — letto da uno strato termico già pubblicato da terzi,
non ricostruito da immagini satellitari all'interno del progetto.
Il motore lo esclude dalla somma dei pesi e normalizza sui tre
fattori presenti, che pesano di fatto **0,47 / 0,35 / 0,18** invece
di 0,40 / 0,30 / 0,15.

Cautela documentata sul significato del dato, quando ci sarà: la
temperatura superficiale non è la temperatura dell'aria, e uno
strato statico dice che un quartiere è *strutturalmente* più caldo
— la variazione giornaliera arriva dal bollettino, a livello di
città.

Il rango percentile è calcolato sulle sole sezioni **residenziali abitate
non fittizie** dello stesso comune. L'isolamento è invertito (famiglie
piccole = valore alto).

**Fattori personali, applicati come moltiplicatori:**

| Fattore | Da dove | Moltiplicatore |
|---|---|---|
| Fascia d'età | anagrafe | 65-74 ×1,00 · 75-84 ×1,30 · 85+ ×1,62 |
| Vive solo | anagrafe | ×1,42 |
| Giorni dall'ultimo contatto | registro contatti | `0,75 + min(gg,30)/120` — solo con dato certo, NULL resta a 1,00 |
| Tentativi falliti consecutivi | registro contatti | `1 + N × 0,20` |
| Sintomi riferiti | segnale volontario/MMG | ×1,45 |
| Nessuna climatizzazione | segnale | ×1,25 |
| Nessun contatto riferito | segnale | ×1,22 |
| Rete familiare assente | segnale | ×1,20 |
| Ventilatore rotto | segnale | ×1,18 |
| Difficoltà mobilità | segnale | ×1,15 |
| Posizione incerta (geocodifica non verificata) | anagrafe | ×0,85 |

I moltiplicatori sui contatti recenti sono **calibrati per non
premiare né penalizzare l'ignoto**: chi è stato visto oggi con
certezza scende di priorità (0,75), chi non ha dato di contatto in
anagrafe resta a 1,00, chi è stato visto ≥30 giorni fa resta a 1,00.
Trattare "non so" come "vista oggi" era la calibrazione precedente,
sbagliata, e l'ha portata a scomparire dalla lista chi aveva
l'anagrafe più incompleta.

**Il livello di allerta non cambia l'ordine.** È costante su tutta la
città; non ha senso che modifichi il rango relativo di persona A
rispetto a persona B. Decide invece **la capienza suggerita del
giorno**: `capienzaSuggerita(allerta, volontari, chiamatePerVolontario=6)`
propone `volontari × 6 × min(1, q(livello) + bonusNotti)`, con `q`
che va da 0,30 a livello 0 fino a 1,00 a livello 3, e un bonus fino
a +0,15 per notti tropicali consecutive oltre le prime due. Il cap
a 1 significa che a livello 3 il bonus notti non ha effetto: la
capienza è già al massimo.

**Chi entra in lista oggi** (`inListaOggi`) è chi ha posizione in
classifica sotto la soglia. La **soglia la decide il coordinatore**
con uno slider sulla dashboard e viene salvata in `riservato.soglia_giorno`
insieme al livello di allerta al momento della decisione (se
l'allerta sale dopo, la dashboard segnala la divergenza). Se il
coordinatore non ha ancora deciso, la soglia parte da
`capienzaSuggerita`.

**I pesi sono un giudizio, non un dato**, per usare le parole del
commento nel codice. Vivono in un `PESI_DEFAULT` hard-coded: cambiarli
significa modificare il file, ricompilare, rilanciare. Non li può
modificare il coordinatore dalla dashboard. Due test del motore
verificano il gradiente centro-periferia di Parma per nome di
quartiere: se cambi i pesi e rompi quel gradiente, il test cade.

Metodo per esteso e alternative scartate: pagina `/metodo` dell'app
installata.

## Dati e modello

Il database è PostgreSQL 16 con estensione PostGIS 3.4, organizzato
in **due schemi separati** per rendere sintattico il confine tra
"cosa può stare sulla pagina pubblica" e "cosa richiede login".

**Schema `pubblico`** — non contiene dati personali di nessun
assistito.

- `organizzazione` — l'ente che ospita l'istanza: nome, `comune_istat`,
  ramo di allerta (`bollettino` o `stima`), città del bollettino se
  applicabile, coordinate del centro. (La colonna `soglia_default`
  esiste ma non è letta da nessuna parte: la soglia del giorno viene
  da `capienzaSuggerita(allerta, N_volontari)` in `packages/scoring/`
  e vive in `riservato.soglia_giorno`.)
- `sezione` — sezioni ISTAT 2021 del comune servito, con geometria
  in EPSG:4326, popolazione, famiglie, `edifici_residenziali`,
  abitazioni. La colonna generata `fittizia` marca i codici problematici
  (`SEZ21` fra 8888881 e 8888889, più 999999/9999998/9999999) che
  raggruppano persone senza dimora in poligoni finti (spesso dentro
  un parco): escluse dal punteggio, documentate come limite noto.
- `punto_fresco` — biblioteche, farmacie, casette dell'acqua Iren,
  fontanelle, parchi ombreggiati. Le colonne generate `categoria` e
  `fascia_oraria` derivano entrambe dal `tipo` via `CASE`, così un
  tipo nuovo non può divergere fra classificazione visiva e regola
  oraria: se qualcuno aggiunge un tipo e dimentica un caso, l'INSERT
  fallisce sul `NOT NULL` della colonna generata.
- `allerta` — livello 0-3 del giorno per organizzazione, con
  orizzonte 24/48/72 ore e sorgente (bollettino/stima).
- `punteggio_sezione` — punteggio strutturale calcolato per
  sezione/giorno con i pesi effettivi usati.
- `uso_modello` — contatore delle chiamate agli agenti, distinto
  fra cache hit (gratuiti) e miss (a pagamento). Osservabilità
  della spesa, non un tetto.
- `consiglio_cache`, `allerta_citta_cache`, `riassunto_cache` — cache
  dei tre testi generati, con audio MP3 allegato (vedi sotto).
- `v_mappa` — vista dei punteggi più recenti per sezione, servita
  come vector tile da `ST_AsMVT` alla mappa coropletica pubblica.

**Schema `riservato`** — contiene i dati personali degli assistiti.

- `utente` — coordinatori e volontari dell'organizzazione, email
  unica, hash password, ruolo, indicatore attivo.
- `persona` — l'assistito: `id_esterno` (l'id che ha nell'anagrafe
  dell'organizzazione), anno di nascita o fascia, `vive_solo`,
  `piano`, `ascensore`, indirizzo, sezione, `posizione_incerta` per
  quando la geocodifica non ha un match sicuro.
- `segnale` — condizioni rilevate (sintomi riferiti, nessuna
  climatizzazione, ventilatore rotto, rete familiare assente,
  difficoltà mobilità, nessun contatto riferito) con origine
  (volontario/MMG/coordinatore), scadenza, chi le ha chiuse.
- `contatto` — chi ha chiamato chi, quando, con quale esito.
- `assegnazione` — chi contatta chi oggi, con motivazione.
- `rango_giorno` — storico del rango di ogni persona valutata, ogni
  giorno.
- `soglia_giorno` — la soglia impostata dal coordinatore, con
  livello di allerta al momento.
- `pausa_volontario` — turni saltati.
- `accesso_scheda` — audit log degli accessi alle schede nominative.

**L'isolamento fra organizzazioni è garantito a due livelli.** A
livello di schema, le chiavi esterne di `assegnazione`,
`pausa_volontario` e simili sono **composte** su
`(id, organizzazione_id)` — il database rifiuta al primo `INSERT`
di collegare un volontario di un'organizzazione a una persona di
un'altra. A livello di query, la funzione `assertAppartiene()` in
`packages/db/src/autorizzazione.ts` deve essere chiamata prima di
ogni mutazione a partire dall'id in sessione: dimenticarla è
visibile in code review. La coppia è ridondante di proposito.

**Dati sintetici nell'istanza demo.** Il generatore
`packages/fixtures/src/generatore.ts` produce 500 assistiti fittizi
sulle sezioni reali di Parma (e altrettanti su Bologna se
configurata), deterministici a parità di `FAKER_SEED` (default 42)
e `DATA_BASE`. Distribuzione per sezione proporzionale alla
popolazione ISTAT, età pesata verso 75-90 anni, piani e ascensori
distribuiti in modo verosimile, sei tipi di segnale generati con
probabilità realistiche (nessuna climatizzazione 35%, difficoltà
mobilità 30%, rete familiare assente 20%, nessun contatto 10%,
ventilatore rotto 5%, sintomi riferiti 3%). La banda "**dati
sintetici — nessuna persona reale**" compare in cima alle tre viste
volontario (`/volontario`, `/volontario/[personaId]`,
`/volontario/fine-giro`); **non compare** invece sulla dashboard
`/coordinatore` né sulla scheda `/coordinatore/persona/[id]`, dove
pure si leggono nome, età, telefono e indirizzo degli assistiti
(limite noto: `BandaDemo` è importata solo dalle pagine volontario in
`apps/web/app/volontario/`). Si disattiva con `DEMO_MODE=false` su
un'istanza operativa vera.

## Dove il progetto NON usa il modello

Un'architettura che sa dove fermarsi è più credibile di una che mette
l'LLM ovunque. Il modello di linguaggio interviene solo in tre punti,
tutti sulla pagina pubblica o sulla dashboard del coordinatore, tutti
con fallback silenzioso quando l'API è irraggiungibile o quando il
tetto giornaliero di cache miss è saturo.

**Sono deterministici**, senza chiamate al modello, i cinque punti
dove l'affidabilità conta:

- **Il punteggio delle persone** (`packages/scoring`) — descritto
  qui sopra. Le classifiche del coordinatore e della vista volontario
  escono da qui, non dal modello.
- **Il poller del bollettino di allerta** (`packages/ingest/allerta.py`) —
  cron con parser sul CSV di onData. Un modello non sa dire un
  livello di allerta meglio del Ministero della Salute.
- **Il calcolo delle distanze dal parco più vicino** — funzione SQL
  `pubblico.calcola_distanze_fresco` su PostGIS, `ST_Distance` su
  `geography`. Un modello non calcola distanze meglio di PostGIS.
- **Le motivazioni per gli assegnati** ("sintomo passato nella notte
  · stava peggio ieri") — `apps/web/lib/motivazione.ts`, funzione
  deterministica sui campi `why()`.
- **L'escalation nel giro del volontario** — regole esplicite sui
  tentativi falliti e sui sintomi (`azionePer` in `packages/scoring`).
  Un modello non decide quando alzare la priorità: la decisione sta
  nel dato.

I **tre agenti**, ciascuno con il proprio system prompt versionato
in `packages/agents/prompts/*.md` e ciascuno con il proprio tetto
giornaliero di cache miss oltre il quale cade in fallback:

- **Frase sull'allerta della città** (`citta.md`) — sopra tutto il
  resto sulla pagina pubblica: livello di oggi, previsioni 48/72h se
  disponibili, notti tropicali consecutive. Non è un servizio meteo.
  Tetto default 10 miss/giorno.
- **Consulente per quartiere** (`consulente.md`) — dice *dove andare
  adesso in questo quartiere* con nome, distanza e orari dei punti
  freschi vicini, scelti dal codice. Non ordina, non inventa numeri.
  Tetto default 200 miss/giorno.
- **Riassunto della giornata** (`riassunto.md`) — sulla dashboard
  del coordinatore, in poche righe cosa è successo oggi. Cache a
  scaglioni di contatti; sopra il tetto la dashboard mostra
  esplicitamente `motivo="tetto"` invece di far sparire il pulsante.
  Tetto default 20 miss/giorno.

Ogni chiamata al modello passa da un wrapper unico
(`packages/agents/src/client.ts`) che conta in `pubblico.uso_modello`
per osservabilità; **il conteggio non è un tetto** — il limite di
spesa vive sulla console Anthropic, un cap in codice fallirebbe in
silenzio nel momento peggiore.

Il **triage delle segnalazioni** e il **form pubblico di
segnalazione**, previsti nel piano originario, sono stati
**rimossi**. La ragione concreta è emersa lavorando sull'istanza di
Parma, dove il Comune gestisce un canale dedicato con segreteria
h24: duplicare quel canale avrebbe peggiorato il servizio (senza
h24, senza personale formato, senza integrazione con i servizi
sociali), e una segnalazione anonima su una terza persona non era
gestibile giuridicamente. Se un'altra organizzazione installa
CheCaldo! in un comune privo di un canale analogo, l'informazione
va comunicata all'utente sulla pagina pubblica in modo esplicito
(non c'è un fallback che l'app possa offrire da sola).

## Sintesi vocale

I tre testi generati dagli agenti hanno accanto un **pulsante di
ascolto**: la frase sull'allerta della città, il consulente di
quartiere sulla pagina pubblica, e il riassunto della giornata
sulla dashboard del coordinatore. Serve a rendere accessibili
quei tre blocchi a chi ha difficoltà a leggere — la pagina
pubblica è pensata per anziani e loro familiari, e la sintesi
vocale è la scelta di accessibilità più utile per quel pubblico.

Il servizio TTS è un microservizio Python separato
(`apps/tts/server.py`) basato su **Piper** (motore GPL-3.0, pacchetto
`piper-tts` su PyPI pubblicato da OHF-Voice, sorgente in
[OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl))
con la voce italiana **`it_IT-paola-medium`** rilasciata **CC0-1.0**.
Il servizio gira in un container separato e la web app lo chiama
esclusivamente via HTTP interno (`http://tts:8080/synth`) — non c'è
collegamento a livello di codice fra il motore Piper e il resto
dell'applicazione. Espone un endpoint che accetta un testo e
restituisce MP3 mono a 48 kbps; la web app lo chiama via
`/api/tts/{citta|consiglio|riassunto}`.

**La generazione avviene una volta sola per testo.** L'audio
risultante è salvato come `bytea` nella riga di cache del testo
corrispondente (`pubblico.consiglio_cache`, `allerta_citta_cache`,
`riassunto_cache`), e servito da lì ai click successivi. Se il
testo cambia — perché è cambiato un fattore che invalida la cache —
l'audio viene rigenerato al primo click.

Il servizio TTS si attiva con il profilo `app` di Docker Compose
(`docker compose --profile app up`) e legge `TTS_URL` dalle
variabili ambiente. Se il servizio non è raggiungibile, il
pulsante cade automaticamente in silenzio sulla Web Speech API
del browser: nessun errore visibile, l'utente sente comunque
qualcosa se il suo browser ha una voce italiana installata.

## Quanto vale il nostro numero

Il **livello di allerta** per i comuni fuori dalle 27 città del
bollettino ministeriale è **stimato**, non ufficiale. Il metodo è
il criterio percentile sulla temperatura apparente locale
(`packages/ingest/allerta.py`).

Backtest su Bologna, estate 2025 (1 giugno – 15 settembre), misurato
separatamente per i tre orizzonti pubblicati dal Ministero
(sorgente: [`backtest-bologna.json`](backtest-bologna.json)):

| Orizzonte | Giorni | Esatti | Entro un livello | Sottostime |
|---|---|---|---|---|
| Oggi (24 ore) | 70 | **74,3%** | 92,9% | **4,3%** |
| Domani (48 ore) | 15 | **≤ 73,3%** | ≤ 93,3% | **≥ 6,7%** |
| Dopodomani (72 ore) | 14 | **≤ 64,3%** | ≤ 85,7% | **≥ 7,1%** |

**I numeri a 48 e 72 ore sono un tetto massimo, non l'accuratezza
reale.** Il backtest usa la temperatura effettivamente osservata del
giorno bersaglio, come se la previsione meteo di allora fosse stata
perfetta. In produzione la stima parte dalle previsioni Open-Meteo,
che hanno un errore loro che si somma al nostro. Di quanto sia più
basso il valore reale non lo sappiamo — Open-Meteo non espone
hindcast delle forecast storiche.

**Nell'estate 2025** il bollettino di Bologna è salito a livello 3
**due volte** — il 26 giugno e l'11 agosto. In entrambi i casi il
nostro criterio, applicato ai dati del giorno, ci era già arrivato.
Due casi in una stagione non sono una misura statistica: serve
almeno un'altra estate per dire qualcosa di solido sull'anticipo del
criterio.

La sottostima è l'errore che conta: dice "meno grave del reale". Per
questo la scriviamo qui, in chiaro. Se la tenessimo nascosta in una
nota tecnica dichiareremmo un metodo migliore di quello che è.

Metodo per esteso, alternative scartate e i giorni in cui sbagliamo
per difetto sono nella pagina `/metodo` dell'app installata.

## Provalo in locale

Serve solo Docker e Docker Compose. Nessun Node, nessun Python,
nessun psql sulla macchina — tutto gira in container.

```bash
# 1. clona il repository
git clone https://github.com/diegoaneli/checaldo.git
cd checaldo

# 2. avvia PostGIS
docker compose up -d postgis

# 3. carica lo schema, le sezioni ISTAT di Parma, i punti freschi.
#    `fixtures/generated/` non e' nel repository (contiene i 500 assistiti
#    sintetici + segnali): `seed` la rigenera dal `FAKER_SEED=42` in .env,
#    `carica` la porta nel DB.
docker compose run --rm node pnpm --filter @checaldo/fixtures seed
docker compose run --rm node pnpm --filter @checaldo/fixtures carica
docker compose run --rm node pnpm --filter @checaldo/fixtures carica-punti-freschi

# 4. genera il livello di allerta di oggi per tutti i comuni serviti
#    (ramo bollettino/stima e coordinate letti da pubblico.organizzazione:
#    aggiungere un comune = una riga in seed-organizzazione.sql, non ci
#    sono codici ISTAT o lat/lon da ricordare a memoria)
docker compose run --rm ingest python packages/ingest/allerta.py --tutti

# 5. avvia la web app
docker compose --profile app up web

# apri http://localhost:3000
```

### Autenticazione — stato attuale (fase dimostrativa)

Il progetto è in fase dimostrativa. **La pagina `/{comune}/login`
non chiede credenziali**: mostra un elenco degli utenti presenti in
DB e si entra scegliendo un nome. Il cookie che ne risulta
(`checaldo_volontario_id` / `checaldo_coordinatore_id`) contiene
l'id dell'utente scelto, è `httpOnly` ma non firmato — chi cambia
il valore diventa l'utente con quell'id. **Chiunque raggiunga
l'istanza può entrare come coordinatore o volontario.** Le mutazioni
al DB restano comunque scopate all'organizzazione dell'utente in
sessione via `assertAppartiene()`
(`packages/db/src/autorizzazione.ts`): chi manipola il cookie con
un id di un'altra organizzazione espone al più i dati di
quell'organizzazione, non di tutte.

Gli utenti che compaiono nel selettore sono quelli creati dal seed
e dal carico fixtures:

- **`packages/db/seed-organizzazione.sql`** — crea due organizzazioni
  (`Distretto di Parma`, ISTAT `034027`, ramo stima; `Comune di
  Bologna`, ISTAT `037006`, ramo bollettino) e due **coordinatori
  demo** (`demo@checaldo.local`, `demo-bologna@checaldo.local`) con
  `hash_password = 'DA_GENERARE'`. La colonna `hash_password` esiste
  nello schema ma **non è letta dal codice**: l'autenticazione
  applicativa non è stata implementata.
- **`pnpm --filter @checaldo/fixtures carica`** — crea 12 **volontari
  demo** per organizzazione (`volontario1@checaldo.local`, …,
  `volontario12@checaldo.local`, tutti attivi) accanto alle 500
  persone sintetiche.

**La gestione reale degli utenti è rimandata**: nessuno script crea
il primo coordinatore in produzione, non c'è pagina di
amministrazione utenti, la revoca è manuale via SQL. Un'installazione
operativa su anagrafe reale **deve proteggere le rotte
`/{comune}/login`, `/coordinatore/*` e `/volontario/*` prima di
trattare dati reali** — la difesa minima è `basic_auth` nel
`Caddyfile` (hash con `caddy hash-password`); l'autenticazione
applicativa vera (OIDC o simile) va progettata quando serve.

## Verifica: tutto verde con un comando

```bash
sh scripts/test.sh
```

La suite copre tre runtime diversi con un'unica invocazione:

- **`@checaldo/scoring`** — motore di punteggio in TypeScript: casi
  scritti a mano più le sezioni reali di Parma, con due test che
  verificano il gradiente centro-periferia per nome di quartiere
  (se cambi i pesi e rompi il gradiente, il test cade).
- **`@checaldo/db`** — schema PostGIS e query TypeScript: idempotenza
  del seed, `assertAppartiene()` contro scritture cross-organizzazione,
  generazione del giro del giorno, calcolo distanze da punti freschi.
- **`packages/ingest/test/test_allerta.py`** — logica di escalation
  del criterio di stima in Python: soglie, ondate di calore
  consecutive, fallback quando il bollettino è assente.
- **Verifica schema su cluster vuoto** — avvia un container PostgreSQL
  effimero, applica `schema.sql` + seed su un cluster pulito, controlla
  tabelle/FK/indici e idempotenza del seed. È l'unica difesa contro
  forward references dello schema che le altre suite (che girano sul
  volume di sviluppo esistente) non intercetterebbero.

Fallisce al primo errore: `set -e` interrompe subito e il ritorno
non-zero è affidabile per CI o per hook pre-push.

## Come installarlo altrove

Un'organizzazione che vuole ospitare la propria istanza:

1. VPS Linux con Docker e Docker Compose. Come ordine di grandezza:
   **≥ 4 GB RAM**, **≥ 25 GB SSD** — stime dalle dimensioni degli
   artefatti, non da un benchmark. Solo il servizio TTS tiene il
   modello vocale in RAM (~400 MB), le immagini in produzione
   sommate superano i 2 GB su disco (`docker/tts.Dockerfile` da
   solo ne dichiara ~700 MB, l'immagine `node` one-shot ne aggiunge
   ~800 MB), e ci vanno sopra il volume `pgdata`, i log
   (`/var/log/checaldo`) e i certificati Caddy.
2. Un dominio pubblico (basta un sottodominio DuckDNS gratuito).
3. Chiave API Anthropic (per il testo generato — la pagina resta
   completa e utile anche senza).
4. Copia `.env.production.example` in `.env`, valorizza le variabili
   documentate, lancia `docker compose -f docker-compose.prod.yml up -d`.
5. Cron di sistema: `scripts/install-cron.sh` installa in modo
   idempotente le tre righe di crontab (poller alle 11:30 e 15:15,
   giro del giorno alle 06:00). I log finiscono in
   `/var/log/checaldo/poller.log` e `/var/log/checaldo/genera-giri.log`.
6. Backup. L'unico stato critico dell'istanza è il volume Docker
   `pgdata` (dati anagrafici, contatti, segnali, storico ranghi).
   Prevedi un dump periodico con `pg_dump -U $POSTGRES_USER
   $POSTGRES_DB` verso storage esterno. Le immagini si ricostruiscono
   dal repo, i certificati Caddy si rigenerano.

**Accesso alle rotte riservate.** In questa istanza dimostrativa le
rotte `/coordinatore/*` e `/volontario/*` sono aperte a chiunque (vedi
"Limiti dichiarati"). Se installi CheCaldo! su un'anagrafe reale,
prima di aprire il dominio a Internet reintroduci un basic auth in
`Caddyfile` sulle stesse rotte — la sintassi è `basic_auth` con
`caddy hash-password`. Il campo `hash_password` in `riservato.utente`
oggi non è letto dal codice; l'autenticazione applicativa vera va
progettata quando serve (OIDC o simile).

## Variabili d'ambiente

Riferimento per chi installa. Il compose di sviluppo funziona con i
default di `.env.example` senza toccarle; in produzione va compilato
`.env` a partire da `.env.production.example`.

### Obbligatorie in produzione

| Variabile | Cosa succede se manca | Esempio |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | il container `postgis` non inizializza il DB al primo avvio | `checaldo` / `openssl rand -hex 24` / `checaldo` |
| `DATABASE_URL` | `apps/web/lib/db.ts` fa `throw` a load-time del modulo, il web non parte. **In produzione la assembla il compose dalle `POSTGRES_*`: non valorizzarla a mano nel `.env`.** | `postgresql://checaldo:...@postgis:5432/checaldo` |
| `APP_URL` | `apps/web/instrumentation.ts` fa `process.exit(1)`: il container **entra in restart loop visibile in `docker compose ps` come `Restarting (1)`** con `RestartCount` che sale. Se la guardia venisse aggirata, i redirect di login (`/{comune}/entra*`) e logout cadrebbero sul fallback `http://localhost:3000` — il browser dell'utente finirebbe sul localhost del VPS dopo il click di login. In sviluppo (`NODE_ENV != production`) la variabile è opzionale, si usa il fallback. | `https://checaldo-parma.duckdns.org` |
| `DOMINIO` | Caddy non risolve il vhost, TLS Let's Encrypt fallisce, il sito non risponde su HTTPS | `checaldo-parma.duckdns.org` |

### Opzionali con default sensato

| Variabile | Default | Effetto se assente |
|---|---|---|
| `ANTHROPIC_API_KEY` | vuota | I tre agenti (frase città, consulente di quartiere, riassunto giornata) cadono in **fallback silenzioso**: la pagina pubblica resta completa con raccomandazioni statiche + mappa, la dashboard resta operativa, ma senza testo generato. Il servizio funziona. |
| `LLM_MODEL` | `claude-sonnet-4-6` | Modello usato dagli agenti. |
| `LLM_DAILY_MISS_CAP_CITTA` | `10` | Tetto miss/giorno per l'agente città. Oltre → fallback silenzioso. |
| `LLM_DAILY_MISS_CAP_CONSULENTE` | `200` | Tetto miss/giorno per il consulente di quartiere. Oltre → fallback silenzioso. |
| `LLM_DAILY_MISS_CAP_RIASSUNTO` | `20` | Tetto miss/giorno per il riassunto della giornata. Oltre → pulsante mostra `motivo="tetto"` invece di sparire. |
| `TTS_URL` | `http://tts:8080` | Se assente o servizio giù, `/api/tts/*` risponde 503 e il pulsante di ascolto cade sulla sintesi Web Speech del browser (Chrome/Safari/Edge OK, Firefox default silenzioso). |
| `LETSENCRYPT_EMAIL` | vuota | Let's Encrypt non recapita gli avvisi di scadenza; i certificati continuano a rinnovarsi. |
| `DEMO_MODE` | banda visibile | Fail-safe: la banda **"dati sintetici — nessuna persona reale"** compare **sempre**, tranne che con `DEMO_MODE=false` esplicito. Su un deploy dimostrativo lasciare `true` o omettere (stesso effetto). Metterla a `false` **solo** su un'installazione operativa con anagrafe reale — senza il disclaimer i 500 assistiti sintetici (nome, indirizzo, età) sarebbero indistinguibili da persone vere. |
| `FAKER_SEED` | `42` | Determinismo del generatore sintetico: stessa demo a ogni esecuzione. |
| `DATA_BASE` | vuota (= data corrente al momento di `pnpm seed`) | Base per `valido_fino` dei segnali. Valorizzare (`YYYY-MM-DD`) solo per riprodurre un seed identico già esistente. In produzione: vuota. |
| `CHECALDO_OGGI` | vuota (= data corrente in Europe/Rome) | Forza "oggi" per la pagina. Utile a registrare un video demo o riprodurre un bug legato al giorno. In produzione: vuota. |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Geocoder. Il pubblico ha rate limit 1 req/s: in produzione reale puntare a un'istanza interna. |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Usato solo dallo script one-shot `estrai-vie.ts`, non a runtime del web. |
| `COMUNE_ISTAT`, `NOME_COMUNE`, `ORG_NOME`, `ORG_TIPO`, `RAMO_ALLERTA`, `CITTA_BOLLETTINO`, `ORG_LAT`, `ORG_LON` | vedi `.env.example` | Lette dal generatore fixtures e da `carica-punti-freschi.ts`. **Non lette dal web a runtime**: l'organizzazione è nel seed hardcoded (`packages/db/seed-organizzazione.sql`). Servono per rigenerare/ricaricare i dati sintetici. |

## Servire un comune diverso da Parma

L'app è nata su Parma; Bologna è la seconda organizzazione della
demo, aggiunta per esercitare il ramo bollettino. Aggiungere un terzo
comune non è un click ma nemmeno un porting: le cose concrete da fare
sono queste.

**Dati da caricare (`packages/ingest`).** Le basi territoriali ISTAT
2021 per il comune (shapefile in EPSG:32632, riproiettato una volta
in ingestione) si caricano con `python packages/ingest/istat.py
data/R08_21.xlsx <codice_ISTAT>`. I punti freschi (biblioteche,
farmacie, casette dell'acqua, fontanelle, parchi ombreggiati) vanno
estratti da OpenStreetMap o forniti dall'ente: c'è già uno script
dedicato per Parma e uno per Bologna in `packages/fixtures/scripts/`
da cui partire.

**Configurazione.** Una riga in `packages/db/seed-organizzazione.sql`
con nome, `comune_istat`, ramo di allerta (`bollettino` se rientra
nelle 27 città, altrimenti `stima`), città del bollettino quando
applicabile, coordinate del centro. Se si usa l'anagrafe sintetica
per una demo, un'altra riga in `SLUG_PER_ISTAT` in
`packages/fixtures/scripts/carica-nel-db.ts` e nel generatore.

**Anagrafe reale.** L'adattatore CSV/XLSX
(`packages/db/src/adattatore.ts`) legge il file dell'organizzazione,
propone una mappatura dei nomi di colonna sui campi minimi del
modello, e scarta il resto (diagnosi, note, situazione familiare
non entrano nel database). L'importazione avviene da riga di
comando; non esiste una pagina web che accetta CSV.

Quanto tempo serva davvero non lo scriviamo qui: nessuno ha ancora
aggiunto un terzo comune, e una stima inventata sarebbe la prima
cosa smentita dal primo installatore.

## Limiti dichiarati

- **Self-hosted, un'organizzazione per comune.** Un'organizzazione
  serve un comune; una stessa istanza può ospitare più organizzazioni
  (isolate a livello di schema e di query). Serve comunque
  un'organizzazione che installi e mantenga: non è un servizio
  nazionale; non pretende di esserlo.
- **Livello ufficiale solo per 27 città.** Per tutti gli altri comuni
  (Parma compresa) il livello è stimato, la pagina lo dichiara.
- **Non è un servizio di soccorso.** CheCaldo! è uno strumento
  informativo, non sostituisce i canali del comune né i numeri
  d'emergenza. Nell'istanza di Parma questo si traduce in un rimando
  esplicito al **Piano Caldo del Comune** (segreteria h24
  **0521.218444**, attiva fino al 15 settembre) e al **112** in
  emergenza. Chi installa in un altro comune deve dichiarare sulla
  pagina pubblica i numeri equivalenti locali: l'app non li conosce.
- **Persone senza dimora non trattabili.** Le sezioni ISTAT fittizie
  (codici 8888881-8888889) collocano gli abitanti in un poligono di
  comodo, tipicamente in un parco: geometricamente sarebbero a
  rischio bassissimo, in realtà sono tra i più esposti. Escluse dal
  punteggio; documentate come limite noto.
- **Il modello di punteggio non è validabile contro esiti sanitari.**
  La mortalità in tempo reale non è pubblica; il metodo è validato
  contro il bollettino ministeriale (che sulla mortalità è calibrato)
  e contro il gradiente centro-periferia di Parma. Ogni ulteriore
  validazione è materia di ricerca, non di prodotto.
- **Dati delle persone sintetici in questa istanza demo.** La banda
  "dati sintetici" compare in cima alle tre viste volontario
  (`/volontario`, `/volontario/[personaId]`, `/volontario/fine-giro`)
  ma **non** sulla dashboard `/coordinatore` né sulla scheda
  `/coordinatore/persona/[id]`, dove pure si leggono nome, età,
  telefono e indirizzo: limite noto, `BandaDemo` è importata solo
  dalle pagine volontario. Disattivabile con `DEMO_MODE=false` per
  un'installazione operativa.
- **Istanza dimostrativa ad accesso libero, per scelta.** Le pagine
  `/{comune}/login`, `/volontario`, `/coordinatore` usano un
  cookie-stub, non autenticazione: il cookie contiene l'id dell'utente
  scelto in `/{comune}/login`, nessuna password, nessuna verifica di
  credenziali. Anche il `Caddyfile` è aperto — la versione precedente
  proteggeva `/coordinatore/*` e `/volontario/*` con basic auth ma è
  stata rimossa: consegnare a mano una password limitava chi poteva
  provare la demo, e i dati sono comunque interamente sintetici (la
  banda "dati sintetici" compare però solo sulle viste volontario,
  non su `/coordinatore` né su `/coordinatore/persona/[id]` — vedi
  sopra).
  Un'installazione operativa reale, con anagrafe vera, deve
  reintrodurre autenticazione — a livello applicativo (OIDC o simile)
  e/o a livello di reverse proxy (basic auth in `Caddyfile`). Le
  mutazioni DB restano comunque protette da `assertAppartiene()`
  (`packages/db/src/autorizzazione.ts`) contro scritture
  cross-organizzazione: chi cambia il cookie con un id di un'altra
  organizzazione espone al più i dati di quella organizzazione,
  non di tutte.

## Struttura del repository

```
apps/web              Next.js: pagina pubblica, dashboard, vista volontario
apps/tts              microservizio Python (Piper) per la sintesi vocale
packages/scoring      motore di punteggio deterministico (TypeScript)
packages/agents       i tre agenti + wrapper unico Anthropic, prompt in .md
packages/ingest       Python: ISTAT, allerta, backtest, geometrie
packages/db           schema PostGIS, query TypeScript, adattatore anagrafe
packages/fixtures     generatore sintetico + carico OSM
```

## Dati e licenze

- **Codice**: [AGPL-3.0-or-later](LICENSE). Ogni file sorgente porta
  l'intestazione SPDX.
- **Basi territoriali ISTAT 2021** — CC-BY 4.0.
- **Bollettino ondate di calore**, cura dell'Associazione onData —
  CC-BY 4.0 · <https://github.com/ondata/ondate-calore>.
- **OpenStreetMap** — ODbL. Casette dell'acqua di Parma: fonte
  Comune di Parma via Iren, erogazione gratuita.
- **Open-Meteo** — dati con licenza CC-BY 4.0; API gratuita per usi
  non commerciali con tetto di 10.000 chiamate al giorno. I termini
  del servizio considerano non commerciale l'uso da parte di enti
  pubblici e organizzazioni senza scopo di lucro; chi installa in un
  contesto diverso deve verificare le condizioni.
- **Basemap Positron** (CartoCDN + OpenStreetMap contributors).
- **Sintesi vocale**: motore [Piper](https://github.com/OHF-Voice/piper1-gpl)
  (GPL-3.0), voce `it_IT-paola-medium` (CC0-1.0). Il servizio gira
  come processo separato; la web app lo raggiunge solo via HTTP
  interno.

Metadati Developers Italia: [publiccode.yml](publiccode.yml).

## Contatti

Segnalazioni, domande e proposte: **[GitHub
issues](https://github.com/diegoaneli/checaldo/issues)**. È il canale
primario — le discussioni pubbliche aiutano chi installerà l'app dopo
di te.

Autore: Diego Aneli. Per contatti diretti (installatori,
amministrazioni), l'email di manutenzione è in
[`publiccode.yml`](publiccode.yml).
