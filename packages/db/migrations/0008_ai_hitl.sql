-- Up Migration
-- AI 추천 · HITL (docs/erd.md G, SRS 3.5)
CREATE TABLE ai_recommendation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             recommendation_type NOT NULL,
  target_type      target_type NOT NULL,
  target_id        uuid NOT NULL,
  proposed_command text NOT NULL,
  proposed_payload jsonb,
  confidence_score numeric NOT NULL,
  requires_hitl    boolean NOT NULL DEFAULT true,
  status           recommendation_status NOT NULL DEFAULT 'PENDING_APPROVAL',
  model_version    text,
  command_id       text REFERENCES command(command_id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reco_status ON ai_recommendation(status);

CREATE TABLE hitl_decision (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES ai_recommendation(id) ON DELETE CASCADE,
  approver_id       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decision          hitl_decision_value NOT NULL,
  reason            text,
  decided_at        timestamptz NOT NULL DEFAULT now()
);

-- 학습 데이터: 결정 + 판단 시점 context 스냅샷
CREATE TABLE ai_training_sample (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recommendation_id uuid NOT NULL REFERENCES ai_recommendation(id) ON DELETE CASCADE,
  context           jsonb,
  decision          hitl_decision_value NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS ai_training_sample, hitl_decision, ai_recommendation;
