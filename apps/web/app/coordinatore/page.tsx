/**
 * MOD04 — Dashboard coordinatore.
 *
 * Stato giornata, slider soglia, tabella "usciti dalla lista", classifica
 * di oggi con colonna comodato, sintomi_riferiti aperti (chiusura), più
 * il pulsante "Genera il giro" e la banda "riallinea soglia" (§12w).
 *
 * Desktop, meno curata della vista volontario di proposito, ma stessa
 * palette e stesso registro di microcopy del prototipo.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import {
  allertaCorrente,
  assegnaComodato,
  chiudiSegnale,
  classificaDiOggi,
  comuneDellOrganizzazione,
  generaGiroDelGiorno,
  impostaSogliaGiorno,
  presenzaVolontariOggi,
  riallineaSoglia,
  sogliaCorrente,
  statoLiveDashboard,
  uscitiRispettoAIeri,
  utentePerId,
} from "@checaldo/db";
import { capienzaSuggerita, type Allerta } from "@checaldo/scoring";
import { coordinatoreIdCorrente } from "@/lib/auth-demo";
import { isoOggi, formatoUmano } from "@/lib/data-oggi";
import { Navbar } from "@/components/navbar";
import { comunePerIstat } from "@/lib/comuni";
import { BandaAllertaStati } from "@/components/banda-allerta-stati";
import { VolontariSogliaAzioni } from "@/components/volontari-soglia-azioni";
import { TabellaUsciti } from "@/components/tabella-usciti";
import { ClassificaOggi } from "@/components/classifica-oggi";
import { PulsanteRiallinea } from "@/components/pulsante-riallinea";
import { PulsanteGenera, type AllertaScaduta } from "@/components/pulsante-genera";
import { FasciaStatiLive } from "@/components/fascia-stati-live";
import { CardRiassunto } from "@/components/card-riassunto";
import { generaRiassunto, type RisultatoRiassunto } from "@checaldo/agents";

const N_CHIAMATE_PER_VOLONTARIO = 6;
// Soglia comodati: costante nel codice per BLOCCO 2. Da rendere
// configurabile (colonna in `pubblico.organizzazione` o
// `riservato.soglia_giorno`) quando lo scenario lo richiede.
const N_COMODATI = 10;

export default async function Coordinatore() {
  const coordinatoreId = await coordinatoreIdCorrente();
  if (!coordinatoreId) redirect("/");

  const utente = await utentePerId(sql, coordinatoreId);
  if (!utente || utente.ruolo !== "coordinatore") redirect("/");

  const oggi = isoOggi();
  const orgId = utente.organizzazioneId;
  const comuneIstat = await comuneDellOrganizzazione(sql, orgId);

  // Stato live (§12ooo, revisione §12gggg): batch di query che
  // alimenta la fascia superiore + il pulsante Genera. Passato come
  // `stato` a `<FasciaStatiLive>` ad ogni render server. Il client
  // component chiama `router.refresh()` ogni 20s, non fa più fetch
  // di un JSON dedicato — quindi TUTTE le sei query di questo
  // `Promise.all` girano ad ogni ciclo, non solo `statoLiveDashboard`.
  // È voluto: allinea classifica, usciti, banda soglia, badge allerta
  // insieme alle chip. Vedi §12gggg per il motivo e le alternative
  // scartate.
  // §12jjjjj — `presenzaVolontariOggi` sostituisce `contaVolontariAttivi`
  // qui: torna l'elenco dei vol attivi con lo stato di pausa per oggi e
  // il carico assegnato. Dopo l'addendum 2026-08-12 la card Volontari-
  // soglia non ha più interruttori, ma la sintesi (di turno / in pausa
  // oggi) ha comunque bisogno dell'elenco per stampare i nomi; e
  // `capienzaSuggerita` filtra sotto per `!inPausa` per contare solo chi
  // è di turno.
  const [allerta, statoLive, soglia, volontari, usciti, classifica] = await Promise.all([
    comuneIstat ? allertaCorrente(sql, comuneIstat) : Promise.resolve(null),
    statoLiveDashboard(sql, orgId, oggi),
    sogliaCorrente(sql, orgId, oggi),
    presenzaVolontariOggi(sql, orgId, oggi),
    uscitiRispettoAIeri(sql, orgId, oggi),
    classificaDiOggi(sql, orgId, oggi),
  ]);
  const stato = statoLive;  // alias per il resto del render server
  const contattatiOggi = statoLive.contattatiOggi;
  // §12jjjjj — conteggi derivati. `volontariAttivi` (anagrafe) resta
  // esposto per la pagina di gestione; `volontariDiTurno` è quello che
  // conta per capienza e distribuzione del giro.
  const volontariAttivi = volontari.length;
  const volontariDiTurno = volontari.filter((v) => !v.inPausa).length;
  const N_CHIAMATE = 6;
  const postiTotaliDiTurno = volontariDiTurno * N_CHIAMATE;

  // §12dddd — Comodato del condizionatore. La regola (prime N in
  // classifica per rango fra chi ha clima 'assente' o 'rotto',
  // saltando chi ha 'presente') vive nella funzione pura
  // `assegnaComodato` di @checaldo/db (§12iiii). Qui solo la
  // chiamata; il test di regressione la usa direttamente, senza
  // riscriverla.
  const idsConComodato = assegnaComodato(classifica, N_COMODATI);

  // Capienza suggerita: input al motore, non fonte autoritativa. Se manca
  // l'allerta (batch non ancora eseguito o comune non caricato) mostriamo
  // una lede sotto e proponiamo capienza su livello 2 come segnaposto,
  // non silenziosamente autoritativo.
  const allertaPerCapienza: Allerta = allerta
    ? {
        livello: allerta.livello,
        provenienza: allerta.provenienza,
        data: allerta.data,
        orizzonteOre: 24,
        nottiTropicali: allerta.nottiTropicali,
      }
    : { livello: 2, provenienza: "stima", data: oggi, orizzonteOre: 24, nottiTropicali: 0 };
  // §12jjjjj — capienzaSuggerita usa `volontariDiTurno` (chi c'è oggi),
  // non `volontariAttivi` (anagrafe globale). Un vol in pausa oggi non
  // conta nel calcolo della capienza per il giorno corrente.
  const suggerita = capienzaSuggerita(
    allertaPerCapienza, volontariDiTurno, N_CHIAMATE_PER_VOLONTARIO,
  );

  const sogliaEffettiva = soglia?.valore ?? suggerita;
  const chiHaImpostato =
    soglia == null
      ? "nessuna soglia ancora fissata"
      : soglia.impostataDa == null
      ? "default"
      : soglia.impostataDa === coordinatoreId
      ? "impostata da te"
      : `impostata da utente #${soglia.impostataDa}`;

  const livelloCorrente = allerta?.livello ?? null;

  // Freschezza dell'allerta rispetto a oggi (Europe/Rome). §12zzzz —
  // dopo l'unificazione, `oggi` (isoOggi() → Rome via oggiRome()) è
  // la stessa nozione del CURRENT_DATE del DB (postgis con
  // -c timezone=Europe/Rome). La banda sotto il badge lo dichiara,
  // e la doppia conferma su "Genera il giro" impedisce di formare la
  // lista sul valore vecchio senza saperlo.
  const allertaScaduta: AllertaScaduta | null = (() => {
    if (!allerta || allerta.data === oggi) return null;
    const dRiga = new Date(allerta.data + "T00:00:00Z").getTime();
    const dOggi = new Date(oggi + "T00:00:00Z").getTime();
    const giorniFa = Math.round((dOggi - dRiga) / 86_400_000);
    if (giorniFa <= 0) return null; // riga futura: caso limite ignorato
    return {
      dataRiga: allerta.data,
      dataLeggibile: formatoUmano(allerta.data),
      giorniFa,
    };
  })();

  // §12jjjjj — Due bande di divergenza legate ai vol di turno.
  //
  // (a) `sogliaSuperaCap`: la soglia salvata supera i posti disponibili
  //     dei vol di turno. Precede la banda-lista sotto perché la vera
  //     causa dello scarto lista≠soglia in questo caso è il cap (le
  //     persone eccedenti sono state escluse silenziosamente dalla
  //     generazione, §12jjjjj). Il messaggio dichiara i due numeri —
  //     persone in lista teorica (soglia salvata) e posti reali —
  //     e suggerisce le due azioni possibili (riprendere un vol o
  //     abbassare la soglia).
  //
  // (b) `personeAssegnateAVolInPausa`: somma del carico dei vol
  //     attualmente in pausa. > 0 quando il coord ha messo in pausa un
  //     vol DOPO che il giro era generato: le persone di quel vol
  //     restano assegnate a lui finché il coord non rigenera.
  //     Nessuna ridistribuzione automatica (regola §12jjjjj).
  const sogliaSuperaCap =
    soglia != null && soglia.valore > postiTotaliDiTurno;
  const personeAssegnateAVolInPausa = volontari
    .filter((v) => v.inPausa)
    .reduce((sum, v) => sum + v.personeInCarico, 0);

  // Divergenza soglia-vs-lista: la soglia salvata non corrisponde al
  // numero di assegnazioni oggi. Il coordinatore ha cambiato la soglia
  // dopo l'ultima generazione, o la generazione non è mai stata fatta
  // per oggi.
  //
  // §12jjjjj — soppresso quando `sogliaSuperaCap`: in quel caso lo
  // scarto lista≠soglia è causato dal cap saturo, non da un cambio
  // soglia. Il messaggio pre-§12jjjjj "il giro contiene ancora N
  // persone" sarebbe fuorviante ("il coord non ha rigenerato" quando
  // invece la generazione è appena avvenuta ma con esclusioni). La
  // banda sogliaSuperaCap ha semantica corretta per il caso e ha la
  // precedenza; questa scatta solo per il caso residuo.
  const sogliaDivergeDaListaOggi =
    soglia != null && soglia.valore !== stato.inLista && !sogliaSuperaCap;

  // Divergenza soglia-vs-livello (§12w): la soglia salvata è stata
  // scelta quando l'allerta aveva un livello diverso da quello di oggi.
  // Se `livelloAlSalvataggio` è NULL, la riga è precedente a §12w e non
  // sappiamo sotto quale livello fu scelta — lo dichiariamo.
  const livelloDelSalvataggio = soglia?.livelloAlSalvataggio ?? null;
  const sogliaDivergeDalLivello =
    soglia != null && livelloCorrente != null
    && livelloDelSalvataggio != null
    && livelloDelSalvataggio !== livelloCorrente;
  const sogliaLivelloIgnoto =
    soglia != null && livelloDelSalvataggio == null;

  async function salvaSoglia(valore: number) {
    "use server";
    if (!coordinatoreId) return;
    const clamped = Math.max(0, Math.min(200, Math.round(valore)));
    await impostaSogliaGiorno(sql, orgId, oggi, clamped, coordinatoreId, livelloCorrente);
    revalidatePath("/coordinatore");
  }

  // §12jjjjj addendum (2026-08-12) — le server action pausa/riprendi
  // vivevano qui prima che la card "Volontari e soglia" perdesse gli
  // interruttori. Oggi le mutazioni sui vol stanno solo in
  // /coordinatore/volontari; lasciare qui action non chiamate era
  // codice morto. Le funzioni `metteInPausa`/`riprendeDallaPausa` di
  // @checaldo/db restano invariate — le usa la pagina di gestione.

  async function chiudiSintomoAction(segnaleId: number) {
    "use server";
    if (!coordinatoreId) return;
    // organizzazioneSessione dal cookie (utente autenticato) — impedisce
    // che un coordinatore chiuda segnali di persone di altra org anche se
    // conosce/indovina il segnaleId (fix A audit isolamento 2026-08-03).
    await chiudiSegnale(sql, orgId, segnaleId, coordinatoreId);
    revalidatePath("/coordinatore");
  }

  async function riallineaAction() {
    "use server";
    if (!coordinatoreId) return;
    await riallineaSoglia(sql, orgId, oggi, coordinatoreId);
    revalidatePath("/coordinatore");
  }

  async function generaRiassuntoAction(): Promise<RisultatoRiassunto> {
    "use server";
    // Autorizzazione: solo un coordinatore autenticato della stessa org
    // può generare il riassunto (usa `orgId` dal cookie, non
    // parametrizzato dal client). Se manca l'utente ritorniamo un
    // ritorno "vuoto" simbolico — il client mostra il messaggio senza
    // errore fatale (non dovrebbe capitare: la pagina redirect a "/"
    // sopra se non c'è coordinatoreId).
    if (!coordinatoreId) {
      return { testo: null, motivo: "vuoto", contattiTotali: 0, scaglione: 0, daCache: false };
    }
    return generaRiassunto(sql, orgId, oggi);
  }

  async function generaAction(): Promise<{ ok: boolean; motivo?: string }> {
    "use server";
    if (!coordinatoreId) return { ok: false };
    try {
      await generaGiroDelGiorno(sql, orgId, oggi);
      revalidatePath("/coordinatore");
      return { ok: true };
    } catch (e) {
      // Fail applicativo noto: manca la riga in pubblico.allerta per
      // oggi. Il messaggio dell'Error è tecnico ("nessuna allerta in
      // pubblico.allerta per 034027 al ..."), lo sostituiamo con un
      // testo user-facing e lo restituiamo al client. Ogni altro
      // errore (DB giù, permessi, bug) risale come prima: quello
      // stack trace deve arrivare a chi installa, non a chi opera.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("nessuna allerta in pubblico.allerta")) {
        return {
          ok: false,
          motivo:
            "Non posso generare il giro di oggi: manca il livello di " +
            "allerta per il tuo comune. Il livello si aggiorna " +
            "automaticamente ogni giorno; se non compare, segnalalo a " +
            "chi ha installato CheCaldo! per la tua organizzazione.",
        };
      }
      throw e;
    }
  }

  // Nome+slug del comune per la Navbar. `comuneIstat` è già stato
  // ricavato sopra da `comuneDellOrganizzazione`; qui la lookup finale
  // per il render. Fallback: se l'organizzazione non ha comune_istat
  // (dato di configurazione errato), la Navbar mostra "Comune di —".
  const comuneOrg = comunePerIstat(comuneIstat);

  return (
    <>
      <Navbar
        ruolo="coordinatore"
        nomeComune={comuneOrg?.nome ?? "—"}
        slugComune={comuneOrg?.slug ?? ""}
        contesto={`${utente.nome} — ${formatoUmano(oggi)}`}
      />
      {/* MOD07-microcopy 2d: la riga "Coordinatore demo — mercoledì 12
          agosto 2026" è stata spostata dentro la Navbar (prop
          `contesto`). Qui non c'è più il <p> sopra il primo contenuto:
          si guadagna una fascia di ~40 px di verticale sopra la
          BandaAllertaStati senza perdere l'informazione. */}
      <div className="max-w-6xl mx-auto py-6 px-6">
      <div className="space-y-3">
        {/* §12llll — banda unica: livello + badge + 3 contatori.
            Sostituisce la coppia `BadgeLivello` a tutta larghezza +
            griglia 3 stat dentro `FasciaStatiLive`. Il polling a 20s
            (§12gggg) resta attivo: il timer vive nel client
            `FasciaStatiLive` sotto e chiama `router.refresh()`, che
            rigenera l'intero server component e passa `statoLive`
            fresco alla banda ad ogni ciclo. Skyline rimosso in
            §12mmmm addendum — a 80 px il ritaglio era una texture
            non una città; resta il fondo `bg-card` + border colorato
            del livello. */}
        <BandaAllertaStati allerta={allerta} stato={statoLive} />

        {/* Banda freschezza allerta: dichiara il fatto (data, quanti
            giorni fa, cosa lo usa) senza chiedere al coordinatore una
            valutazione meteo che non è il suo mestiere. La doppia
            conferma sul bottone Genera è la difesa contro la scelta
            inconsapevole. Fuori dalla banda unica: è un warning
            temporaneo, non appartiene al blocco livello. */}
        {allertaScaduta && (
          <div className="border border-red-300 bg-red-50 text-red-900 rounded-btn px-4 py-3 text-[13px] leading-normal">
            Il livello di allerta mostrato qui è di{" "}
            <b>{allertaScaduta.dataLeggibile}</b>,{" "}
            {allertaScaduta.giorniFa === 1
              ? "ieri"
              : `${allertaScaduta.giorniFa} giorni fa`}. Il livello di oggi
            non è ancora disponibile: la capienza suggerita e la
            generazione del giro stanno usando questo valore.
          </div>
        )}
      </div>

      {/* Card "Riassunto della giornata" (§12fffff BLOCCO A). Sta
          sotto la BandaAllertaStati e sopra "Volontari e soglia",
          come da brief: prima le informazioni di sfondo (livello,
          contatori), poi la sintesi in prosa di cosa hanno fatto i
          volontari, poi l'azione (soglia + genera).
          Client component con stato locale così sopravvive al
          `router.refresh()` del polling a 20 s (§12gggg) — la banda
          e le altre card sotto si ricaricano ma la card riassunto
          resta montata e non lampeggia. */}
      <div className="mt-6">
        <CardRiassunto
          contattatiOggi={contattatiOggi}
          genera={generaRiassuntoAction}
        />
      </div>

      {/* Ordine dei blocchi dalla banda in giù:
            (a) "Volontari e soglia" full-width — l'azione: fissare la
                soglia + generare il giro.
            (b) "Classifica di oggi" full-width — cosa ha prodotto
                l'azione appena compiuta. Tabella a 8 colonne, sta
                comoda a piena larghezza.
            (c) "Segnalazioni aperte" + "Usciti rispetto a ieri"
                affiancate — consultazione, si guardano quando serve.

          Motivo del riordino: il coordinatore fissa la soglia, genera
          il giro, e la prima cosa che vuole vedere è la lista di oggi
          (la conseguenza diretta). Segnalazioni e usciti sono
          consultazione: allo stesso livello, sotto. */}

      {/* (a) Azione — Volontari e soglia. Card full-width con
          disposizione orizzontale (grid 3fr:2fr) delegata al
          componente client `VolontariSogliaAzioni`: slider e info a
          sinistra, [Salva] + [Genera] affiancati in alto a destra,
          bande condizionali sotto i bottoni.

          Vecchia versione (pre-§12pppp) aveva `max-w-2xl` interno
          che lasciava metà card vuota a destra e stack verticale:
          slider → bande → bottoni impilati. La nuova disposizione
          usa tutta la larghezza della card senza dilatare lo slider
          a 1088 px (resta sui ~600 px della colonna sinistra) e
          affianca i due bottoni per chiarire che sono azioni
          alternative sullo stesso oggetto (la soglia). */}
      <div className="mt-6">
        <Card titolo="Volontari e soglia">
          <VolontariSogliaAzioni
            iniziale={sogliaEffettiva}
            min={0}
            max={Math.max(60, volontariAttivi * N_CHIAMATE_PER_VOLONTARIO)}
            volontari={volontari}
            capienzaSuggerita={suggerita}
            chiHaImpostato={chiHaImpostato}
            salva={salvaSoglia}
            helperText="La soglia è dove taglia la lista di oggi: dice a quante persone il giro arriva."
            aiuto={
              <details className="mb-4 text-[12px] text-muted">
                <summary className="cursor-pointer hover:text-slate">
                  Come funziona
                </summary>
                <p className="mt-2 max-w-prose">
                  Salvare la soglia qui non riordina il giro già in corso
                  — cambia dove il taglio cadrà alla prossima generazione.
                  Chi è già stato contattato oggi resta nel giro con il
                  suo volontario anche se rigeneri, si aggiorna solo la
                  coda non ancora lavorata.
                </p>
              </details>
            }
            slotBottoneGenera={
              <PulsanteGenera
                contattatiOggi={contattatiOggi}
                inLista={stato.inLista}
                soglia={soglia?.valore ?? 0}
                allertaScaduta={allertaScaduta}
                genera={generaAction}
              />
            }
            slotBande={
              <>
                {/* Divergenza fra livello di allerta corrente e livello
                    sotto cui la soglia fu scelta. Se il coordinatore
                    fissò 25 con allerta 1, e oggi l'allerta è 3, la
                    banda glielo dice e offre il riallineo con un click. */}
                {sogliaDivergeDalLivello && (
                  <div className="border border-demorule bg-demoband text-demoink rounded-btn px-3 py-2 text-[12px] leading-normal flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex-1 min-w-[12rem]">
                      Soglia <span className="font-mono">{soglia!.valore}</span>,
                      scelta quando l&apos;allerta era{" "}
                      <span className="font-mono">{livelloDelSalvataggio}</span>.
                      Oggi è <span className="font-mono">{livelloCorrente}</span>,
                      la capienza suggerita sarebbe{" "}
                      <span className="font-mono">{suggerita}</span>.
                    </span>
                    <PulsanteRiallinea riallinea={riallineaAction} />
                  </div>
                )}
                {/* Banda "livello al salvataggio ignoto": raggiungibile
                    quando il coordinatore preme Salva in una giornata
                    in cui `pubblico.allerta` non ha ancora una riga
                    per oggi. */}
                {sogliaLivelloIgnoto && livelloCorrente != null && (
                  <div className="border border-rule bg-foot text-muted rounded-btn px-3 py-2 text-[12px] leading-normal">
                    Soglia <span className="font-mono">{soglia!.valore}</span>,
                    salvata quando il livello di allerta di oggi non era
                    ancora disponibile. Modifica lo slider per rifissarla
                    col livello di oggi.
                  </div>
                )}
                {sogliaDivergeDaListaOggi && (
                  <div className="border border-demorule bg-demoband text-demoink rounded-btn px-3 py-2 text-[12px] leading-normal">
                    Soglia salvata:{" "}
                    <span className="font-mono">{soglia!.valore}</span>,
                    il giro di oggi contiene ancora{" "}
                    <span className="font-mono">{stato.inLista}</span>{" "}
                    {stato.inLista === 1 ? "persona" : "persone"}. Premi
                    &laquo;{stato.inLista === 0 ? "Genera" : "Rigenera"} il
                    giro di oggi&raquo; per allineare la lista al valore
                    attuale.
                  </div>
                )}
                {/* §12jjjjj — Banda "soglia > posti disponibili". Compare
                    quando il coord ha salvato una soglia superiore al
                    cap dei vol di turno (12 vol × 6 = 72; se il coord
                    salva 72 e mette in pausa un vol, restano 66 posti
                    per 72 persone).

                    Precedenza (via `sogliaSuperaCap` in page.tsx):
                    quando questa banda è visibile, la banda
                    `sogliaDivergeDaListaOggi` sopra è soppressa —
                    il messaggio pre-§12jjjjj "il giro contiene
                    ancora N persone" sarebbe fuorviante (suggerirebbe
                    "il coord non ha rigenerato" mentre invece la
                    generazione è appena avvenuta ma con esclusioni).

                    Il coord vede due numeri e decide: abbassare la
                    soglia, riprendere un vol, o accettare. Nessuna
                    azione automatica. */}
                {sogliaSuperaCap && (
                  <div className="border border-demorule bg-demoband text-demoink rounded-btn px-3 py-2 text-[12px] leading-normal">
                    Soglia salvata:{" "}
                    <span className="font-mono">{soglia!.valore}</span>,{" "}
                    posti disponibili oggi:{" "}
                    <span className="font-mono">{postiTotaliDiTurno}</span>{" "}
                    ({volontariDiTurno}{" "}
                    {volontariDiTurno === 1 ? "volontario di turno" : "volontari di turno"}
                    {" "}× 6). Alla prossima generazione{" "}
                    <span className="font-mono">
                      {soglia!.valore - postiTotaliDiTurno}
                    </span>{" "}
                    {soglia!.valore - postiTotaliDiTurno === 1 ? "persona" : "persone"}
                    {" "}rimarranno senza volontario. Riprendi un
                    volontario dalla pausa o abbassa la soglia.
                  </div>
                )}
                {/* §12jjjjj — Banda "persone assegnate a vol non di
                    turno". Compare quando il coord ha messo in pausa
                    un vol DOPO che il giro era già distribuito: le
                    persone di quel vol restano assegnate a lui
                    finché il coord non rigenera. Regola §12jjjjj:
                    nessuna ridistribuzione automatica — un vol che
                    sta telefonando non deve trovarsi sei nomi nuovi
                    in lista senza che nessuno l'abbia deciso.

                    §12jjjjj addendum (2026-08-12) — la banda è un
                    link a /coordinatore/volontari: chi la legge deve
                    poter agire in un click. Il wrap `<Link>` copre
                    l'intera banda con hover; il "Rigenera il giro"
                    resta come alternativa testuale (menzionata nella
                    frase). */}
                {personeAssegnateAVolInPausa > 0 && (
                  <Link
                    href="/coordinatore/volontari"
                    className="block border border-demorule bg-demoband text-demoink rounded-btn px-3 py-2 text-[12px] leading-normal hover:bg-demoband/70 no-underline"
                  >
                    <span className="font-mono">{personeAssegnateAVolInPausa}</span>{" "}
                    {personeAssegnateAVolInPausa === 1
                      ? "persona è assegnata a un volontario in pausa"
                      : "persone sono assegnate a volontari in pausa"}
                    . Restano nella lista di chi ha messo in pausa: se
                    vuoi riassegnarle premi &laquo;Rigenera il giro di
                    oggi&raquo;, altrimenti resteranno lì fino a fine
                    giornata.{" "}
                    <span className="underline underline-offset-2">
                      Gestisci volontari &rarr;
                    </span>
                  </Link>
                )}
              </>
            }
          />
        </Card>
      </div>

      {/* (b) Conseguenza dell'azione — Classifica di oggi. La tabella
          ha 8 colonne (Rango / Persona / Quartiere / Età / Vive sola /
          Condizionatore / Stato contatto / Segnalazioni): sta comoda a
          piena larghezza e sarebbe schiacciata sotto due colonne
          strette. */}
      <div className="mt-6">
        <Card titolo="Classifica di oggi">
          <p className="text-[12.5px] text-slate px-5 pb-3 max-w-prose">
            Persone in lista oggi, ordinate per rango globale; comodato del
            condizionatore alle prime {N_COMODATI} senza clima presente.
          </p>
          {/* La spiegazione della colonna "Condizionatore" è nel `title`
              dell'intestazione in ClassificaOggi. Limite noto: title
              non è discoverable su touch, e non è raggiungibile da
              tastiera in nessun browser mainstream — accettato perché
              la dashboard è desktop-only. */}
          <ClassificaOggi righe={classifica} idsConComodato={idsConComodato} />
        </Card>
      </div>

      {/* (c) Consultazione — Segnalazioni aperte + Usciti rispetto a
          ieri, affiancate in grid 1:1 con `items-start`. Motivi delle
          scelte:
          - `grid-cols-2` senza ratio: la lista Segnalazioni è già in
            scroll interno (`max-h-96`, cap ~500 px totali di card) e
            non guadagna a essere più larga; la tabella Usciti a 5
            colonne (con `w-20` sui ranghi) sta comoda su ~544 px.
          - `items-start` invece di `items-stretch`: nei giorni senza
            uscite (la maggioranza nel canone) la card Usciti è ~195 px
            contro ~500 px di Segnalazioni; stretch la stirerebbe con
            vuoto interno, items-start la lascia corta col vuoto sotto
            — semantica onesta ("nessuno è uscito" è un'informazione).
          - Su mobile il grid collassa a colonna singola; l'ordine JSX
            mette Segnalazioni prima di Usciti, coerente con la
            priorità di attenzione (una condizione aperta pesa più di
            un'uscita già avvenuta).

          Il polling a 20s (`router.refresh` in FasciaStatiLive) non
          è toccato dal riordino: `<FasciaStatiLive>` resta lo stesso
          elemento nel tree, montato una volta e mantenuto — React lo
          riconcilia sulla base della posizione e del tipo di
          componente, non della classe del div genitore. Il timer nel
          useEffect vive fintanto che il componente resta in vita. */}
      <div className="mt-6 grid md:grid-cols-2 gap-5 items-start">
        <FasciaStatiLive stato={statoLive} chiudi={chiudiSintomoAction} />

        <Card titolo="Usciti dalla lista rispetto a ieri">
          <p className="text-[12.5px] text-slate px-5 pb-2 max-w-prose">
            Chi era in lista ieri e oggi no. Non sono rimozioni: il
            motivo di ogni riga è indicato accanto.
          </p>
          <details className="text-[12px] text-muted px-5 pb-3">
            <summary className="cursor-pointer hover:text-slate">
              Come funziona
            </summary>
            <p className="mt-2 max-w-prose">
              Le uscite hanno cause diverse. Il punteggio si ricalcola
              ogni notte con i fattori del giorno: segnali scaduti,
              contatti risolutivi. Anche la soglia può cambiare — se
              il livello di allerta scende, la lista si accorcia e
              persone che erano dentro finiscono fuori senza aver
              cambiato niente loro. La colonna motivo di ogni riga
              dichiara il caso specifico.
            </p>
          </details>
          <TabellaUsciti usciti={usciti} />
        </Card>
      </div>
      </div>
    </>
  );
}

function Card({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  // Intestazione: `text-slate` (medio) invece del vecchio `text-muted`
  // (grigio chiaro). Su small caps 13 px uppercase, `text-ink` era
  // troppo aggressivo e competeva con i contenuti della card; `slate`
  // è più scuro del muted quanto basta per rendere il titolo un
  // ancoraggio riconoscibile. Coerente con le intestazioni della
  // CardRiassunto e della Segnalazioni aperte, e con i Th delle
  // tabelle sotto (MOD07-microcopy 2a/2b).
  return (
    <div className="border rounded-card bg-card border-gray-400">
      <h3 className="font-display font-semibold text-[13px] tracking-label uppercase text-slate px-5 pt-4 pb-3">
        {titolo}
      </h3>
      {children}
    </div>
  );
}

// La funzione Stat locale è stata spostata in
// `apps/web/components/fascia-stati-live.tsx` insieme al rendering
// dei tre contatori (§12ooo). Sulla page.tsx non c'è più uno Stat
// server-rendered — la fascia superiore è tutta client con primo
// render SSR via prop iniziale.
