USE college_complaints;

ALTER TABLE complaints
  MODIFY COLUMN status ENUM('pending', 'in_review', 'in_progress', 'resolved', 'rejected') NOT NULL DEFAULT 'pending';

ALTER TABLE complaint_updates
  MODIFY COLUMN status ENUM('pending', 'in_review', 'in_progress', 'resolved', 'rejected') NOT NULL;
