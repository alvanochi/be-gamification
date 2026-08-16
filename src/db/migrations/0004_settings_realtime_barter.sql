-- Pengaturan acara dinamis, validasi barter per pertukaran, dan penanda foto.
-- Aditif & idempoten.
--   psql -U gamification_user -d gamification_db -f src/db/migrations/0004_settings_realtime_barter.sql

BEGIN;

CREATE TABLE IF NOT EXISTS event_settings (
  id                      varchar(20) PRIMARY KEY DEFAULT 'default',
  missions_released       boolean NOT NULL DEFAULT false,
  missions_released_at    timestamp,
  announcement            text,
  announced_at            timestamp,
  formation_limit_minutes integer NOT NULL DEFAULT 30,
  formation_grace_minutes integer NOT NULL DEFAULT 15,
  formation_full_point    integer NOT NULL DEFAULT 100,
  formation_late_point    integer NOT NULL DEFAULT 50,
  yelyel_deadline_hours   integer NOT NULL DEFAULT 24,
  yelyel_ontime_point     integer NOT NULL DEFAULT 100,
  yelyel_late_point       integer NOT NULL DEFAULT 50,
  barter_point_per_step   integer NOT NULL DEFAULT 20,
  leaderboard_top_n       integer NOT NULL DEFAULT 10,
  updated_at              timestamp NOT NULL DEFAULT now()
);

INSERT INTO event_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE TYPE barter_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE barter_steps
  ADD COLUMN IF NOT EXISTS status        barter_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS awarded_point integer,
  ADD COLUMN IF NOT EXISTS reject_reason text,
  ADD COLUMN IF NOT EXISTS validated_by  varchar(50),
  ADD COLUMN IF NOT EXISTS validated_at  timestamp;

-- Langkah barter lama sudah dianggap sah, jadi tandai disetujui agar tidak
-- menyumbat antrean validasi yang baru.
UPDATE barter_steps SET status = 'APPROVED' WHERE is_valid = true AND status = 'PENDING';

COMMIT;
