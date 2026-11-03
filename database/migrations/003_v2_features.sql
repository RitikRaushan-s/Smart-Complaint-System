USE college_complaints;

ALTER TABLE complaints
  ADD COLUMN assigned_department VARCHAR(80) NULL AFTER category,
  ADD COLUMN rating TINYINT UNSIGNED NULL AFTER status,
  ADD COLUMN feedback_note TEXT NULL AFTER rating,
  ADD COLUMN image_url MEDIUMTEXT NULL AFTER description;
