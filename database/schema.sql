CREATE DATABASE IF NOT EXISTS college_complaints
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE college_complaints;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT,
  PRIMARY KEY (session_id),
  KEY idx_sessions_expires (expires)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  student_number VARCHAR(40) NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student', 'admin') NOT NULL DEFAULT 'student',
  session_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_student_number (student_number)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS complaints (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tracking_code CHAR(20) NOT NULL,
  student_id BIGINT UNSIGNED NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  location VARCHAR(100) NOT NULL,
  building VARCHAR(120) NULL,
  floor VARCHAR(40) NULL,
  room VARCHAR(80) NULL,
  category VARCHAR(80) NOT NULL,
  priority ENUM('low', 'medium', 'high') NOT NULL,
  description TEXT NOT NULL,
  status ENUM('pending', 'in_review', 'in_progress', 'resolved', 'rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_complaints_tracking_code (tracking_code),
  KEY idx_complaints_status_created (status, created_at),
  KEY idx_complaints_student_created (student_id, created_at),
  KEY idx_complaints_owner_created (owner_user_id, created_at),
  KEY idx_complaints_building (building),
  CONSTRAINT fk_complaints_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_complaints_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS complaint_updates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  complaint_id BIGINT UNSIGNED NOT NULL,
  admin_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'in_review', 'in_progress', 'resolved', 'rejected') NOT NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_updates_complaint_created (complaint_id, created_at),
  CONSTRAINT fk_updates_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
  CONSTRAINT fk_updates_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
