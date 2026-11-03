USE college_complaints;

ALTER TABLE complaints
  ADD COLUMN building VARCHAR(120) NULL AFTER location,
  ADD COLUMN floor VARCHAR(40) NULL AFTER building,
  ADD COLUMN room VARCHAR(80) NULL AFTER floor,
  ADD KEY idx_complaints_building (building);
