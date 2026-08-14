-- SPDX-License-Identifier: AGPL-3.0-or-later
-- CheCaldo! — prima organizzazione e primo utente.
--
-- Da eseguire una volta, dopo schema.sql. In produzione l'organizzazione la
-- crea l'installatore e il primo coordinatore si crea da riga di comando:
-- non esiste auto-registrazione.
--
--   psql $DATABASE_URL -f packages/db/seed-organizzazione.sql

INSERT INTO pubblico.organizzazione
  (nome, tipo, comune_istat, ramo_allerta, citta_bollettino, lat, lon, soglia_default)
VALUES
  -- Parma non è tra le 27 città del bollettino ministeriale: ramo stima.
  ('Distretto di Parma', 'comune', '034027', 'stima', NULL, 44.8015, 10.3280, 84),
  -- Bologna sì, via ARPA Emilia-Romagna. Seconda organizzazione demo: serve a
  -- dimostrare il ramo bollettino e a fare il backtest dello stimatore.
  ('Comune di Bologna', 'comune', '037006', 'bollettino', 'BOLOGNA', 44.4949, 11.3426, 120)
-- §12bbbbb — target esplicito del conflict. Prima usava `ON CONFLICT DO
-- NOTHING` bare, che senza il vincolo UNIQUE (nome, comune_istat) su
-- pubblico.organizzazione non aveva effetto: due esecuzioni successive
-- accumulavano righe (in §12aaaaa post-seed count=4 invece di 2).
-- Aggiunto il UNIQUE in schema.sql, qui si nomina la target di conflict.
ON CONFLICT (nome, comune_istat) DO NOTHING;

-- Coordinatore demo per Parma. La password va sostituita: questo hash è un
-- segnaposto e non deve finire su un'istanza raggiungibile da internet.
INSERT INTO riservato.utente
  (organizzazione_id, nome, email, hash_password, ruolo)
SELECT o.id, 'Coordinatore demo', 'demo@checaldo.local', 'DA_GENERARE', 'coordinatore'
FROM pubblico.organizzazione o
WHERE o.comune_istat = '034027'
ON CONFLICT (email) DO NOTHING;

-- Coordinatore demo per Bologna — seconda organizzazione della stessa
-- istanza. Aggiunto 2026-08-03 (audit isolamento, fix F): senza questa
-- riga Bologna non poteva avere nessun coordinatore nella dashboard e
-- il ruolo non era testabile su ramo bollettino.
INSERT INTO riservato.utente
  (organizzazione_id, nome, email, hash_password, ruolo)
SELECT o.id, 'Coordinatore demo (bologna)', 'demo-bologna@checaldo.local', 'DA_GENERARE', 'coordinatore'
FROM pubblico.organizzazione o
WHERE o.comune_istat = '037006'
ON CONFLICT (email) DO NOTHING;

-- Verifica
SELECT o.id, o.nome, o.comune_istat, o.ramo_allerta,
       (SELECT count(*) FROM pubblico.sezione s WHERE s.comune_istat = o.comune_istat) AS sezioni,
       (SELECT count(*) FROM pubblico.sezione s
        WHERE s.comune_istat = o.comune_istat AND NOT s.fittizia
          AND s.tipo_sezione = 1 AND s.popolazione > 0) AS residenziali_abitate
FROM pubblico.organizzazione o
ORDER BY o.id;
