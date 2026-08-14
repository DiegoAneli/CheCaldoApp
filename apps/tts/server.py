"""
Piper TTS HTTP server — CheCaldo! (MOD06 §12ggggg).

Servizio persistente che tiene il modello Piper caricato in memoria e
espone un endpoint HTTP interno per la sintesi vocale dei testi
generati dagli agenti (riassunto in dashboard coord, allerta città e
consiglio locale sulla pagina pubblica).

Perché una piccola Flask nostra invece di `python -m piper.http_server`
built-in: piper.http_server ritorna solo WAV, mentre noi vogliamo MP3
per non spedire ~3 MB per un minuto d'audio a chi è su mobile. Un
wrapper di ~50 righe è più semplice che aggiungere ffmpeg al container
web e chiamarlo dalla route Next; qui il tutto sta in un posto.

Il modello vive in `/voices/it_IT-paola-medium.onnx` (scaricato al
build, non a runtime — vedi `docker/tts.Dockerfile`). Caricato una
volta al boot con `PiperVoice.load()`, tenuto in scope globale, riusato
a ogni richiesta.

Endpoint:
  GET  /health   → 200 "ok" (healthcheck compose)
  POST /synth    → body JSON {"text": "..."} → 200 audio/mpeg (bytes MP3)

Il servizio NON è esposto all'esterno: nel compose `ports:` è vuota,
solo la rete interna `checaldo_net` lo raggiunge.

Gunicorn worker=1 threads=1: la sintesi è CPU-bound, workers multipli
si mangerebbero la memoria (~400 MB per istanza voce) senza guadagno.
Una richiesta alla volta va bene: la cache in DB fa sì che ogni testo
si sintetizzi una sola volta.

SPDX-License-Identifier: AGPL-3.0-or-later
"""

import io
import os
import subprocess
import time
import wave

from flask import Flask, jsonify, request, Response
from piper.voice import PiperVoice

# Path del modello. Il Dockerfile lo pone in /voices/. Cambiabile via
# env per test locali (es. rebind di /voices dall'host).
MODEL_PATH = os.environ.get(
    "PIPER_MODEL", "/voices/it_IT-paola-medium.onnx"
)

# Bitrate MP3: 48 kbps mono. Verificato: parlato IT (voce Paola)
# regge bene la compressione; scendere a 32 kbps introduce artefatti
# sonori sui numeri lunghi. Con 48 kbps: ~350 KB per 60 s d'audio,
# ~10x più leggero del WAV originale.
MP3_BITRATE = "48k"

app = Flask(__name__)

# Carica il modello una volta sola al boot del worker. Se la voce
# non esiste (montaggio errato, modello non scaricato), Gunicorn muore
# subito con eccezione — è quello che vogliamo: preferisco un crash
# esplicito a un servizio zombie che risponde 500 a ogni richiesta.
print(f"[tts] caricamento voce da {MODEL_PATH}...", flush=True)
_t0 = time.perf_counter()
voice = PiperVoice.load(MODEL_PATH)
print(
    f"[tts] voce caricata in {time.perf_counter() - _t0:.2f}s",
    flush=True,
)


@app.route("/health", methods=["GET"])
def health():
    """Healthcheck per docker compose. Ritorna 200 solo se la voce
    è caricata (a questo punto lo è sempre — la load() sopra fallisce
    prima altrimenti)."""
    return "ok\n", 200, {"Content-Type": "text/plain"}


@app.route("/synth", methods=["POST"])
def synth():
    """Sintesi vocale con output MP3.

    Body JSON: {"text": "testo da leggere"}
    Response: 200 audio/mpeg con i byte MP3.
    Errori: 400 se `text` manca o è vuoto; 500 se ffmpeg fallisce.
    """
    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text required"}), 400

    t0 = time.perf_counter()

    # 1) Sintesi Piper → WAV in memoria (mono 22.05 kHz 16-bit).
    #    `synthesize_wav` scrive nel wave.Wave_write che gli passiamo.
    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_out:
        voice.synthesize_wav(text, wav_out)
    wav_bytes = wav_io.getvalue()
    t_wav = time.perf_counter() - t0

    # 2) Conversione WAV → MP3 via ffmpeg subprocess in-memory.
    #    -codec:a libmp3lame è il MP3 di default; -ac 1 mono; -b:a
    #    48k bitrate; -f mp3 forza il container corretto per stdout.
    #    -hide_banner + -loglevel error tiene lo stderr pulito così
    #    un errore reale non si perde nella boilerplate di ffmpeg.
    proc = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0",
            "-codec:a", "libmp3lame",
            "-b:a", MP3_BITRATE,
            "-ac", "1",
            "-f", "mp3",
            "pipe:1",
        ],
        input=wav_bytes,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        # ffmpeg è fallito: log dettagliato + 500 al client.
        # In pratica non dovrebbe succedere — WAV valido in, MP3 out
        # è il caso d'uso banale di libmp3lame.
        print(
            f"[tts] ffmpeg fallito rc={proc.returncode} "
            f"stderr={proc.stderr.decode('utf-8', errors='ignore')[:500]}",
            flush=True,
        )
        return jsonify({"error": "audio conversion failed"}), 500
    mp3_bytes = proc.stdout
    t_total = time.perf_counter() - t0

    # Log una riga per richiesta: utile per stimare i tempi reali in
    # produzione (`docker compose logs tts`).
    print(
        f"[tts] len_text={len(text)} wav={len(wav_bytes)}B "
        f"mp3={len(mp3_bytes)}B "
        f"t_wav={t_wav:.2f}s t_total={t_total:.2f}s",
        flush=True,
    )

    return Response(
        mp3_bytes,
        mimetype="audio/mpeg",
        headers={
            # Cache-Control: no-store — il client cachera' via DB, non
            # via HTTP. Se in futuro esponiamo `/synth?hash=...` posso
            # dare Cache-Control lungo.
            "Cache-Control": "no-store",
            "X-Synth-Seconds": f"{t_total:.2f}",
        },
    )


if __name__ == "__main__":
    # Modalità dev standalone (senza gunicorn): utile per test locale.
    # In compose il CMD del Dockerfile usa gunicorn direttamente.
    app.run(host="0.0.0.0", port=8080, threaded=False)
