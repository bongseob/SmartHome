-- Up Migration
-- JWT refresh token rotation/revocation store (PROJECT_RULES §5.3, §6).
CREATE TABLE refresh_token (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash       text NOT NULL UNIQUE,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  replaced_by_hash text
);
CREATE INDEX idx_refresh_token_user ON refresh_token(user_id);
CREATE INDEX idx_refresh_token_active ON refresh_token(token_hash) WHERE revoked_at IS NULL;

-- Down Migration
DROP TABLE IF EXISTS refresh_token;
