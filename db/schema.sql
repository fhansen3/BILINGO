-- =====================================================================
-- BiLingo Meet — Schema (mirrors live p184_project1 1:1)
-- =====================================================================
-- This file is regenerated from the live MySQL DESCRIBE of every table.
-- migrations/001_schema.sql is kept identical for fresh-install parity.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- users  (parent of almost everything)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(100) NOT NULL,
  `bio` TEXT,
  `avatar_color` VARCHAR(20) DEFAULT '#58CC02',
  `avatar_url` VARCHAR(500) NULL,
  `native_language` VARCHAR(50) NULL,
  `learning_language` VARCHAR(50) NULL,
  `preferred_voice` VARCHAR(80) NULL,
  `default_native_voice_gender` ENUM('male','female','neutral') NULL,
  `default_target_voice_gender` ENUM('male','female','neutral') NULL,
  `default_delivery_mode` ENUM('voice','text','both') NOT NULL DEFAULT 'both',
  `default_captions_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `proficiency_level` ENUM('beginner','intermediate','advanced','fluent') DEFAULT 'beginner',
  `country` VARCHAR(80) NULL,
  `role` ENUM('user','admin') DEFAULT 'user',
  `status` ENUM('active','banned','suspended') DEFAULT 'active',
  `plan` ENUM('free','pro') NOT NULL DEFAULT 'free',
  `is_online` TINYINT(1) DEFAULT 0,
  `last_seen` TIMESTAMP NULL,
  `last_login_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_users_native_language` (`native_language`),
  INDEX `idx_users_is_online` (`is_online`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- languages  (reference data — signup, lobby, settings, admin)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `languages` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(8) NOT NULL UNIQUE,
  `name` VARCHAR(80) NOT NULL,
  `native_name` VARCHAR(80) NULL,
  `direction` ENUM('ltr','rtl') NOT NULL DEFAULT 'ltr',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_languages_is_enabled` (`is_enabled`),
  INDEX `idx_languages_sort_order` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- voices  (TTS voice options per language)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `voices` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `language_code` VARCHAR(8) NOT NULL,
  `voice_key` VARCHAR(80) NOT NULL,
  `display_name` VARCHAR(120) NOT NULL,
  `gender` ENUM('male','female','neutral') NOT NULL,
  `provider` VARCHAR(40) NOT NULL DEFAULT 'mock',
  `provider_voice_id` VARCHAR(120) NOT NULL,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_voices_lang_key` (`language_code`,`voice_key`),
  INDEX `idx_voices_lang` (`language_code`),
  INDEX `idx_voices_enabled` (`is_enabled`),
  INDEX `idx_voices_gender` (`gender`),
  CONSTRAINT `fk_voices_language` FOREIGN KEY (`language_code`) REFERENCES `languages`(`code`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- rooms  (meetings — instant + scheduled, plus host policy flags)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `rooms` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `room_code` VARCHAR(20) NOT NULL UNIQUE,
  `name` VARCHAR(120) NULL,
  `host_id` INT NOT NULL,
  `guest_id` INT NULL,
  `language_focus` VARCHAR(50) NULL,
  `topic` VARCHAR(150) NULL,
  `scheduled_start` TIMESTAMP NULL,
  `max_participants` TINYINT DEFAULT 2,
  `is_public` TINYINT(1) DEFAULT 1,
  `waiting_room_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `is_locked` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('waiting','open','active','ended','closed') NOT NULL DEFAULT 'waiting',
  `started_at` TIMESTAMP NULL,
  `ended_at` TIMESTAMP NULL,
  `duration_seconds` INT DEFAULT 0,
  `duration_limit_min` SMALLINT UNSIGNED NULL,
  `save_transcript` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_rooms_host` (`host_id`),
  INDEX `idx_rooms_guest` (`guest_id`),
  INDEX `idx_rooms_status` (`status`),
  CONSTRAINT `fk_rooms_host` FOREIGN KEY (`host_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rooms_guest` FOREIGN KEY (`guest_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- meeting_participants  (per-attendance row with voice/volume/delay state)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `meeting_participants` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `room_id` INT NOT NULL,
  `user_id` INT NULL,
  `display_name` VARCHAR(100) NOT NULL,
  `is_guest` TINYINT(1) NOT NULL DEFAULT 0,
  `native_language` VARCHAR(8) NULL,
  `target_language` VARCHAR(8) NULL,
  `speaking_voice_gender` ENUM('male','female','neutral') NULL,
  `listening_voice_gender` ENUM('male','female','neutral') NULL,
  `delivery_mode` ENUM('voice','text','both') NOT NULL DEFAULT 'both',
  `captions_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `original_volume` TINYINT UNSIGNED NOT NULL DEFAULT 40,
  `translated_volume` TINYINT UNSIGNED NOT NULL DEFAULT 100,
  `manual_extra_delay_ms` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `is_muted` TINYINT(1) NOT NULL DEFAULT 0,
  `is_hand_raised` TINYINT(1) NOT NULL DEFAULT 0,
  `is_camera_off` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('waiting','admitted','denied','left') NOT NULL DEFAULT 'admitted',
  `joined_at` TIMESTAMP NULL,
  `admitted_at` TIMESTAMP NULL,
  `left_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_mp_room_id` (`room_id`),
  INDEX `idx_mp_user_id` (`user_id`),
  INDEX `idx_mp_status` (`status`),
  CONSTRAINT `fk_mp_room` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mp_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- meeting_invitations  (scheduled invites with token)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `meeting_invitations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `room_id` INT NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `token` VARCHAR(128) NOT NULL UNIQUE,
  `invited_by` INT NOT NULL,
  `status` ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `responded_at` TIMESTAMP NULL,
  INDEX `idx_mi_room` (`room_id`),
  INDEX `idx_mi_email` (`email`),
  INDEX `idx_mi_status` (`status`),
  CONSTRAINT `fk_mi_room` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mi_inviter` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- messages  (in-meeting chat with optional translation columns)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `messages` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `room_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `content` TEXT NOT NULL,
  `source_lang` VARCHAR(8) NULL,
  `target_lang` VARCHAR(8) NULL,
  `translated_content` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_messages_room_id` (`room_id`),
  INDEX `idx_messages_user_id` (`user_id`),
  INDEX `idx_messages_created_at` (`created_at`),
  INDEX `idx_messages_room_created` (`room_id`,`created_at`),
  CONSTRAINT `fk_msg_room` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_msg_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- transcript_segments  (one row per uttered phrase, JSON of translations)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `transcript_segments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `meeting_id` INT NOT NULL,
  `speaker_participant_id` INT NULL,
  `speaker_user_id` INT NULL,
  `source_language` VARCHAR(8) NOT NULL,
  `original_text` TEXT NOT NULL,
  `translations` JSON NULL,
  `audio_duration_ms` INT NULL,
  `start_ms` BIGINT NULL,
  `end_ms` BIGINT NULL,
  `confidence` DECIMAL(4,3) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_ts_meeting` (`meeting_id`),
  INDEX `idx_ts_speaker_participant` (`speaker_participant_id`),
  INDEX `idx_ts_speaker_user` (`speaker_user_id`),
  INDEX `idx_ts_created_at` (`created_at`),
  CONSTRAINT `fk_ts_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ts_speaker_participant` FOREIGN KEY (`speaker_participant_id`) REFERENCES `meeting_participants`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ts_speaker_user` FOREIGN KEY (`speaker_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- translation_sessions  (per-listener delivery of a segment)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `translation_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `meeting_id` INT NOT NULL,
  `segment_id` INT NULL,
  `speaker_participant_id` INT NULL,
  `listener_participant_id` INT NULL,
  `listener_user_id` INT NULL,
  `source_language` VARCHAR(8) NOT NULL,
  `target_language` VARCHAR(8) NOT NULL,
  `original_text` TEXT NULL,
  `translated_text` TEXT NULL,
  `audio_url` VARCHAR(500) NULL,
  `audio_in_latency_ms` INT NULL,
  `translation_latency_ms` INT NULL,
  `tts_latency_ms` INT NULL,
  `total_latency_ms` INT NOT NULL DEFAULT 0,
  `is_degraded` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_tsess_meeting` (`meeting_id`),
  INDEX `idx_tsess_segment` (`segment_id`),
  INDEX `idx_tsess_listener_user` (`listener_user_id`),
  INDEX `idx_tsess_created_at` (`created_at`),
  CONSTRAINT `fk_tsess_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tsess_segment` FOREIGN KEY (`segment_id`) REFERENCES `transcript_segments`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tsess_speaker_participant` FOREIGN KEY (`speaker_participant_id`) REFERENCES `meeting_participants`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tsess_listener_participant` FOREIGN KEY (`listener_participant_id`) REFERENCES `meeting_participants`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tsess_listener_user` FOREIGN KEY (`listener_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- translation_logs  (telemetry — feeds /admin/usage)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `translation_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `room_id` INT NULL,
  `user_id` INT NULL,
  `source_lang` VARCHAR(8) NULL,
  `target_lang` VARCHAR(8) NULL,
  `stt_latency_ms` INT NULL,
  `mt_latency_ms` INT NULL,
  `tts_latency_ms` INT NULL,
  `total_latency_ms` INT NOT NULL DEFAULT 0,
  `char_count` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_tl_room` (`room_id`),
  INDEX `idx_tl_user` (`user_id`),
  INDEX `idx_tl_created_at` (`created_at`),
  CONSTRAINT `fk_tl_room` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tl_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- feedback_ratings  (one row per user per meeting — unique)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `feedback_ratings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `room_id` INT NOT NULL,
  `user_id` INT NULL,
  `participant_id` INT NULL,
  `translation_quality` TINYINT UNSIGNED NULL,
  `audio_quality` TINYINT UNSIGNED NULL,
  `partner_helpfulness` TINYINT UNSIGNED NULL,
  `comments` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_feedback_room_user` (`room_id`,`user_id`),
  INDEX `idx_fr_room` (`room_id`),
  INDEX `idx_fr_user` (`user_id`),
  CONSTRAINT `fk_fr_room` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fr_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_fr_participant` FOREIGN KEY (`participant_id`) REFERENCES `meeting_participants`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- session_history  (per-user history rollup)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `session_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `room_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `partner_id` INT NULL,
  `duration_seconds` INT DEFAULT 0,
  `rating` TINYINT NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_sh_room_id` (`room_id`),
  INDEX `idx_sh_user_id` (`user_id`),
  INDEX `idx_sh_partner_id` (`partner_id`),
  CONSTRAINT `fk_hist_room` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_hist_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_hist_partner` FOREIGN KEY (`partner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- reports  (user/meeting moderation queue)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reports` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `reporter_id` INT NOT NULL,
  `reported_user_id` INT NOT NULL,
  `room_id` INT NULL,
  `reason` VARCHAR(100) NOT NULL,
  `details` TEXT NULL,
  `status` ENUM('pending','reviewed','resolved','dismissed','actioned') NOT NULL DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` TIMESTAMP NULL,
  INDEX `idx_reports_reporter_id` (`reporter_id`),
  INDEX `idx_reports_reported_user_id` (`reported_user_id`),
  INDEX `idx_reports_room_id` (`room_id`),
  INDEX `idx_reports_status` (`status`),
  CONSTRAINT `fk_rep_reporter` FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rep_reported` FOREIGN KEY (`reported_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rep_room` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- password_resets
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `token` VARCHAR(80) NOT NULL UNIQUE,
  `expires_at` TIMESTAMP NOT NULL,
  `used_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_pr_user_id` (`user_id`),
  INDEX `idx_pr_token` (`token`),
  CONSTRAINT `fk_pr_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- admin_audit_logs  (one row per admin action — for /admin/usage)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_audit_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `admin_id` INT NOT NULL,
  `action` ENUM(
    'user.ban','user.unban','user.suspend','user.activate','user.delete','user.role_change',
    'room.end','room.delete',
    'report.review','report.resolve','report.dismiss','report.action',
    'language.add','language.toggle','language.update',
    'voice.add','voice.toggle','voice.update'
  ) NOT NULL,
  `target_type` ENUM('user','room','report','message','language','voice') NOT NULL,
  `target_id` INT NOT NULL,
  `details` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_aal_admin_id` (`admin_id`),
  INDEX `idx_aal_action` (`action`),
  INDEX `idx_aal_target` (`target_type`,`target_id`),
  INDEX `idx_aal_created_at` (`created_at`),
  CONSTRAINT `fk_aal_admin` FOREIGN KEY (`admin_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;