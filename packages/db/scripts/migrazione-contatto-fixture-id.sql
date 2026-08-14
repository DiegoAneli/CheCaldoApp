-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migrazione one-shot §12rrrr — aggiunge `fixture_id` a
-- `riservato.contatto` per distinguere le righe generate dal canone
-- sintetico (`packages/fixtures/scripts/genera-contatti-storici.ts`)
-- da quelle scritte dall'app (`registraContatto`).
--
-- Pattern e motivo simmetrici a `segnale.fixture_id` (§12qqq/uuu). Il
-- partial UNIQUE INDEX rende il generatore idempotente: rilanciarlo
-- sullo stesso seed non moltiplica righe.
--
-- Applicare UNA volta con:
--   docker compose exec postgis psql -U checaldo -d checaldo \
--     -f /app/packages/db/scripts/migrazione-contatto-fixture-id.sql
-- (idempotente sul DB già migrato: ALTER e CREATE INDEX usano IF NOT EXISTS).
--
-- `packages/db/schema.sql` è già stato aggiornato per gli install nuovi.

ALTER TABLE riservato.contatto
  ADD COLUMN IF NOT EXISTS fixture_id text;

CREATE UNIQUE INDEX IF NOT EXISTS contatto_fixture_id_idx
  ON riservato.contatto (fixture_id) WHERE fixture_id IS NOT NULL;
