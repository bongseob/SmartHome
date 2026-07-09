-- Up Migration
-- 공간 계층 (docs/erd.md A) — enterprise/site/building/floor/area
CREATE TABLE enterprise (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprise(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  name          text NOT NULL,
  UNIQUE (enterprise_id, slug)
);

CREATE TABLE building (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  slug    text NOT NULL,
  name    text NOT NULL,
  UNIQUE (site_id, slug)
);

CREATE TABLE floor_map (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url      text NOT NULL,
  width_px       integer,
  height_px      integer,
  scale_m_per_px numeric,
  uploaded_by    uuid,
  uploaded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE floor (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  uuid NOT NULL REFERENCES building(id) ON DELETE CASCADE,
  slug         text NOT NULL,
  name         text NOT NULL,
  floor_map_id uuid REFERENCES floor_map(id) ON DELETE SET NULL,
  UNIQUE (building_id, slug)
);

CREATE TABLE area (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id   uuid NOT NULL REFERENCES floor(id) ON DELETE CASCADE,
  slug       text NOT NULL,
  name       text NOT NULL,
  polygon    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  UNIQUE (floor_id, slug)
);

-- Down Migration
DROP TABLE IF EXISTS area, floor, floor_map, building, site, enterprise;
