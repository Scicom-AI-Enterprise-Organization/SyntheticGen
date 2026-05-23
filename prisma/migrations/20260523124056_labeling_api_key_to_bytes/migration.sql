-- Change column type from TEXT to BYTEA. Safe because the column was
-- just added and contains no data (nobody could save a token before this
-- migration since the runtime crashed on first save).
ALTER TABLE "Project"
  ALTER COLUMN "labelingApiKeyEnc" TYPE BYTEA
  USING NULL;
