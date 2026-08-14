# Contenitore Piper TTS per CheCaldo! (§12ggggg).
#
# Servizio persistente: tiene il modello Piper caricato in RAM ed espone
# un endpoint HTTP interno che sintetizza i testi generati dagli agenti
# (riassunto, allerta città, consiglio locale) in MP3 48 kbps mono.
#
# Vincoli operativi:
#   - Il modello viene scaricato al BUILD, non a runtime: l'installazione
#     non deve dipendere da HuggingFace al primo `docker compose up`.
#     Chi installa clona il repo, `docker compose build tts`, up. Se
#     HuggingFace è down al deploy, la build precedente resta valida.
#   - Il servizio non è esposto all'esterno: nel compose `ports:` è
#     assente, solo la rete interna raggiunge :8080.
#   - Immagine finale ~700 MB (base python + piper-tts + espeak-ng-data
#     + ffmpeg + modello voce 61 MB). Verificato a build: pesante ma
#     accettabile — la voce da sola è 61 MB e non c'è alternativa più
#     leggera per la qualità che ci serve. La `medium` è più che
#     `low` per numeri e nomi propri.
#
# `python:3.11-slim`: 3.11 perché è la versione più matura con supporto
# lungo per onnxruntime (che piper-tts wrappa). 3.12 andrebbe pure.

FROM python:3.11-slim

# Pin del modello. it_IT-paola-medium è CC0-1.0 (dataset
# paolapersico1/Voice-Dataset-Italian su HuggingFace), compatibile con
# AGPL e senza vincoli da propagare a chi installa. Se si sceglierà
# in futuro un'altra voce (paola-x_low più leggera, o voce diversa),
# cambiare qui e ribuild — il codice in server.py legge PIPER_MODEL.
ARG PIPER_VOICE=it_IT-paola-medium
ARG PIPER_VOICES_BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium

# Sistema: ffmpeg per conversione WAV → MP3 nel server.py + curl per
# scaricare il modello + ca-certificates per HTTPS su HuggingFace.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Piper 1.3.x è la versione con `PiperVoice.load()` e
# `synthesize_wav()` — API stabili, quella che uso in server.py.
# gunicorn 23 è il WSGI production-grade. Pin espliciti così il
# comportamento non cambia con release future.
RUN pip install --no-cache-dir \
    piper-tts==1.3.0 \
    flask==3.1.0 \
    gunicorn==23.0.0

# Modello scaricato al build. Se la connessione a HF fallisce, la
# build fallisce esplicitamente — meglio scoprire il problema durante
# l'installazione che al primo `docker compose up` in produzione.
WORKDIR /voices
RUN curl -fSL -o ${PIPER_VOICE}.onnx      ${PIPER_VOICES_BASE}/${PIPER_VOICE}.onnx \
 && curl -fSL -o ${PIPER_VOICE}.onnx.json ${PIPER_VOICES_BASE}/${PIPER_VOICE}.onnx.json \
 && ls -la ${PIPER_VOICE}.onnx*

# Server Flask. Copiato dopo il modello così cambiare il server non
# invalida il layer del modello (rebuild in secondi invece di minuti).
COPY apps/tts/server.py /app/server.py
WORKDIR /app

ENV PIPER_MODEL=/voices/it_IT-paola-medium.onnx
ENV PYTHONUNBUFFERED=1

EXPOSE 8080

# Gunicorn worker=1 threads=1: la sintesi è CPU-bound, workers
# multipli si mangerebbero ~400 MB di RAM ciascuno (la voce caricata)
# senza servire più richieste in parallelo — piper non fa yield.
# --timeout 180: un riassunto lungo (60+ secondi di sintesi) non deve
# scattare il timeout di default 30s di gunicorn.
# --preload: carica l'app UNA volta prima di fork (serve poco con
# workers=1, ma tiene il boot deterministico anche se in futuro si
# alza il numero di worker).
CMD ["gunicorn", "-w", "1", "--threads", "1", "--timeout", "180", \
     "--preload", "-b", "0.0.0.0:8080", "server:app"]
