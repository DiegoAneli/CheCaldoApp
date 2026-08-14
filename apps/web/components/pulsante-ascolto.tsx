"use client";

/**
 * Pulsante di ascolto dei testi generati dagli agenti.
 *
 * Storia in due tappe:
 *   §12fffff BLOCCO B — introdotto usando la sintesi vocale del browser
 *     (Web Speech API): zero costi, zero dipendenze, qualità mediocre
 *     su Windows/Chrome e assente su Firefox default.
 *   §12ggggg — passato a Piper (servizio `tts` interno, voce
 *     `it_IT-paola-medium` in italiano naturale). L'audio arriva come
 *     MP3 dal server, cachato con la stessa chiave del testo. La
 *     sintesi del browser NON è stata rimossa: è il **ripiego** quando
 *     il servizio `tts` non risponde. Se Piper è giù, il pulsante
 *     continua a funzionare con la voce del browser invece di sparire.
 *
 * Ergonomia:
 *   - toggle avvio/stop dallo stesso pulsante;
 *   - loading esplicito con label che cambia dopo 5s;
 *   - se la fetch al server torna 503 (tts giù, timeout, chiave API
 *     mancante), fallback silenzioso al Web Speech; se anche quello
 *     manca, il pulsante non compare;
 *   - cache in-memory del blob: la seconda pressione con stesso testo
 *     evita persino la fetch (audio già scaricato);
 *   - interruzione al cambio testo o allo smontaggio.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "react";

interface SorgenteServer {
  /** Endpoint POST che ritorna audio/mpeg. */
  url: string;
  /** Body JSON da inviare (chiave della cache). */
  body: Record<string, unknown>;
}

interface Props {
  /** Testo (usato per il fallback Web Speech e per l'invalidazione al cambio). */
  testo: string;
  /** Sorgente server preferita. Se omessa, va direttamente sul fallback browser. */
  sorgente?: SorgenteServer;
  /** Etichetta per lo screen reader ("riassunto", "consiglio", "allerta"). */
  etichetta?: string;
}

// Dopo questi ms di attesa cambio la label da "Preparo l'ascolto…"
// a "Sto sintetizzando la voce, potrebbe richiedere fino a un minuto".
// 5 s è al limite superiore di una sintesi cachata veloce; oltre
// significa che stiamo aspettando Piper per un miss reale.
const SOGLIA_ATTESA_LUNGA_MS = 5_000;

export function PulsanteAscolto({ testo, sorgente, etichetta }: Props) {
  const [supportoBrowser, setSupportoBrowser] = useState(false);
  const [stato, setStato] = useState<
    "idle" | "loading" | "loading_lungo" | "playing" | "playing_browser"
  >("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const timerLungoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cache in memoria del blob: seconda pressione con stesso testo → play immediato.
  const cacheBlobRef = useRef<{ testo: string; url: string } | null>(null);

  // Rilevamento supporto Web Speech (per il fallback).
  useEffect(() => {
    setSupportoBrowser(
      typeof window !== "undefined" && "speechSynthesis" in window,
    );
  }, []);

  // Cleanup allo smontaggio: ferma qualunque riproduzione in corso.
  useEffect(() => {
    return () => {
      fermaTutto();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      if (cacheBlobRef.current) {
        URL.revokeObjectURL(cacheBlobRef.current.url);
        cacheBlobRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al cambio del testo (rigenerazione): stop + invalido la cache locale.
  useEffect(() => {
    fermaTutto();
    if (cacheBlobRef.current && cacheBlobRef.current.testo !== testo) {
      URL.revokeObjectURL(cacheBlobRef.current.url);
      cacheBlobRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testo]);

  function fermaTutto() {
    if (timerLungoRef.current) {
      clearTimeout(timerLungoRef.current);
      timerLungoRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setStato("idle");
  }

  function fallbackBrowser() {
    // Web Speech API — voce del sistema, qualità variabile ma sempre
    // disponibile (§12fffff). Se manca proprio, l'utente vede il
    // pulsante che ha fatto un tentativo e non è successo niente:
    // nascondiamo il pulsante mostrando "idle" — non ideale ma raro.
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setStato("idle");
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(testo);
    u.lang = "it-IT";
    const voci = window.speechSynthesis.getVoices();
    const voceIt =
      voci.find((v) => v.lang === "it-IT") ??
      voci.find((v) => v.lang.toLowerCase().startsWith("it"));
    if (voceIt) u.voice = voceIt;
    u.rate = 1.0;
    u.onend = () => setStato("idle");
    u.onerror = () => setStato("idle");
    window.speechSynthesis.speak(u);
    setStato("playing_browser");
  }

  function playBlobUrl(url: string) {
    const audio = new Audio(url);
    audio.onended = () => setStato("idle");
    audio.onerror = () => {
      // Il browser non riesce a decodificare l'MP3 (raro). Fallback.
      setStato("idle");
      fallbackBrowser();
    };
    audioRef.current = audio;
    void audio.play().catch(() => {
      // Autoplay bloccato o file corrotto → fallback.
      setStato("idle");
      fallbackBrowser();
    });
    setStato("playing");
  }

  async function avvia() {
    // 1) Se abbiamo il blob in cache locale per questo testo, play immediato.
    if (cacheBlobRef.current && cacheBlobRef.current.testo === testo) {
      playBlobUrl(cacheBlobRef.current.url);
      return;
    }

    // 2) Senza sorgente server, ripiego diretto al browser.
    if (!sorgente) {
      fallbackBrowser();
      return;
    }

    setStato("loading");
    // Timer per la label "sto sintetizzando" dopo N secondi.
    timerLungoRef.current = setTimeout(() => {
      setStato((s) => (s === "loading" ? "loading_lungo" : s));
    }, SOGLIA_ATTESA_LUNGA_MS);

    try {
      const resp = await fetch(sorgente.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sorgente.body),
      });
      if (timerLungoRef.current) {
        clearTimeout(timerLungoRef.current);
        timerLungoRef.current = null;
      }
      if (!resp.ok) {
        // 503 (tts giù) o 404 (testo non ancora in cache): fallback.
        // Il 404 in particolare significa che l'utente ha chiesto
        // audio ma il testo non è in cache — improbabile, ma fallback
        // pulito.
        fallbackBrowser();
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      // Cache in-memory: seconda pressione = play immediato.
      if (cacheBlobRef.current) {
        URL.revokeObjectURL(cacheBlobRef.current.url);
      }
      cacheBlobRef.current = { testo, url };
      playBlobUrl(url);
    } catch {
      if (timerLungoRef.current) {
        clearTimeout(timerLungoRef.current);
        timerLungoRef.current = null;
      }
      // Errore di rete o CORS → fallback.
      fallbackBrowser();
    }
  }

  function onClick() {
    // Toggle: se sta suonando (server o browser) o sta caricando, ferma.
    if (stato !== "idle") {
      fermaTutto();
      return;
    }
    void avvia();
  }

  // Se non c'è né server né browser, il pulsante non compare
  // (nessun modo di rendere audio).
  if (!sorgente && !supportoBrowser) return null;

  let label: string;
  switch (stato) {
    case "loading":
      label = "Preparo l'ascolto…";
      break;
    case "loading_lungo":
      label = "Sto sintetizzando la voce…";
      break;
    case "playing":
    case "playing_browser":
      label = "Ferma ascolto";
      break;
    default:
      label = "Ascolta";
  }

  const aria = etichetta
    ? stato.startsWith("playing")
      ? `Ferma la lettura del ${etichetta}`
      : `Ascolta il ${etichetta}`
    : label;

  const disabilitato = stato === "loading" || stato === "loading_lungo";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      aria-busy={disabilitato || undefined}
      className="inline-flex items-center gap-1.5 rounded-btn border border-rule bg-card px-2.5 py-1 text-[11.5px] font-display font-semibold tracking-wide uppercase text-slate hover:bg-foot hover:text-ink shadow-sm disabled:opacity-70"
    >
      {stato === "playing" || stato === "playing_browser" ? (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden
             fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="5" width="4" height="14" />
          <rect x="14" y="5" width="4" height="14" />
        </svg>
      ) : disabilitato ? (
        // Spinner minimale: rettangoli lampeggianti come waveform.
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden
             fill="currentColor" className="animate-pulse">
          <rect x="4"  y="10" width="2" height="4"  />
          <rect x="8"  y="7"  width="2" height="10" />
          <rect x="12" y="9"  width="2" height="6"  />
          <rect x="16" y="6"  width="2" height="12" />
          <rect x="20" y="8"  width="2" height="8"  />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden
             fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5 6 9H2v6h4l5 4z" />
          <path d="M15.54 8.46a5 5 0 010 7.07" />
          <path d="M19.07 4.93a10 10 0 010 14.14" />
        </svg>
      )}
      {label}
    </button>
  );
}
