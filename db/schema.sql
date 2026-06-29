-- ============================================================================
--  BiLingo Meet — Database Schema
--  Generado automáticamente por scripts/db-dump.js
--  Fecha: 2026-06-29T20:25:53.575Z
--  Base de datos: p184_project1
--  Tablas: 21
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------- Tabla: companies ----------
DROP TABLE IF EXISTS `companies`;
CREATE TABLE `companies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(6) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `credit_markup` decimal(6,3) NOT NULL DEFAULT '1.500' COMMENT 'Multiplicador aplicado al costo de IA para calcular débito en créditos',
  `credit_low_threshold` int NOT NULL DEFAULT '1000' COMMENT 'Umbral de saldo bajo (en créditos) para mostrar alerta',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_companies_code` (`code`),
  KEY `ix_companies_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: users ----------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `bio` text,
  `avatar_color` varchar(20) DEFAULT '#58CC02',
  `avatar_url` varchar(500) DEFAULT NULL,
  `native_language` varchar(50) DEFAULT NULL,
  `learning_language` varchar(50) DEFAULT NULL,
  `preferred_voice` varchar(80) DEFAULT NULL,
  `default_native_voice_gender` enum('male','female','neutral') DEFAULT NULL,
  `default_target_voice_gender` enum('male','female','neutral') DEFAULT NULL,
  `default_delivery_mode` enum('voice','text','both') NOT NULL DEFAULT 'both',
  `default_captions_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `proficiency_level` enum('beginner','intermediate','advanced','fluent') DEFAULT 'beginner',
  `country` varchar(80) DEFAULT NULL,
  `company_id` int DEFAULT NULL,
  `role` enum('user','company_admin','admin','superadmin') NOT NULL DEFAULT 'user',
  `status` enum('active','banned','suspended') DEFAULT 'active',
  `plan` enum('free','pro') NOT NULL DEFAULT 'free',
  `is_online` tinyint(1) DEFAULT '0',
  `last_seen` timestamp NULL DEFAULT NULL,
  `last_login_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_email` (`email`),
  KEY `idx_languages` (`native_language`,`learning_language`),
  KEY `idx_online` (`is_online`),
  KEY `ix_users_company` (`company_id`),
  CONSTRAINT `fk_users_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- Tabla: admin_audit_logs ----------
DROP TABLE IF EXISTS `admin_audit_logs`;
CREATE TABLE `admin_audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `admin_id` int NOT NULL,
  `action` enum('user.ban','user.unban','user.suspend','user.activate','user.delete','user.role_change','room.end','room.delete','room.lock','room.unlock','room.remove_participant','room.mute_all','report.review','report.resolve','report.dismiss','report.action','language.add','language.toggle','language.update','voice.add','voice.toggle','voice.update') COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_type` enum('user','room','report','message','language','voice') COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` int NOT NULL,
  `details` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aal_admin_id` (`admin_id`),
  KEY `idx_aal_action` (`action`),
  KEY `idx_aal_target` (`target_type`,`target_id`),
  KEY `idx_aal_created_at` (`created_at`),
  CONSTRAINT `fk_aal_admin` FOREIGN KEY (`admin_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: company_credits ----------
DROP TABLE IF EXISTS `company_credits`;
CREATE TABLE `company_credits` (
  `company_id` int NOT NULL,
  `balance` bigint NOT NULL DEFAULT '0' COMMENT 'Saldo en créditos abstractos (1 cr = 0.01 USD). Puede ser negativo.',
  `total_added` bigint NOT NULL DEFAULT '0' COMMENT 'Total histórico de créditos cargados',
  `total_consumed` bigint NOT NULL DEFAULT '0' COMMENT 'Total histórico de créditos consumidos',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`company_id`),
  CONSTRAINT `fk_company_credits_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: rooms ----------
DROP TABLE IF EXISTS `rooms`;
CREATE TABLE `rooms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `room_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `host_id` int NOT NULL,
  `guest_id` int DEFAULT NULL,
  `language_focus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `topic` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `scheduled_start` timestamp NULL DEFAULT NULL,
  `max_participants` tinyint DEFAULT '2',
  `is_public` tinyint(1) DEFAULT '1',
  `waiting_room_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `is_locked` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('waiting','open','active','ended','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'waiting',
  `started_at` timestamp NULL DEFAULT NULL,
  `ended_at` timestamp NULL DEFAULT NULL,
  `duration_seconds` int DEFAULT '0',
  `duration_limit_min` smallint unsigned DEFAULT NULL,
  `save_transcript` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`room_code`),
  UNIQUE KEY `room_code` (`room_code`),
  KEY `idx_status` (`status`),
  KEY `idx_host` (`host_id`),
  KEY `fk_rooms_guest` (`guest_id`),
  CONSTRAINT `fk_rooms_guest` FOREIGN KEY (`guest_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rooms_host` FOREIGN KEY (`host_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: credit_transactions ----------
DROP TABLE IF EXISTS `credit_transactions`;
CREATE TABLE `credit_transactions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `kind` enum('topup','debit','adjustment','refund') COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` bigint NOT NULL COMMENT 'Positivo para ingresos, negativo para débitos',
  `balance_after` bigint NOT NULL,
  `meeting_id` int DEFAULT NULL COMMENT 'FK a rooms si el movimiento corresponde a una llamada',
  `cost_usd` decimal(12,6) DEFAULT NULL COMMENT 'Costo crudo de IA en USD (sin markup)',
  `markup` decimal(6,3) DEFAULT NULL COMMENT 'Markup aplicado al momento del débito',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL COMMENT 'user_id que originó el movimiento (admin para topups)',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_company_created` (`company_id`,`created_at`),
  KEY `idx_meeting` (`meeting_id`),
  KEY `idx_kind` (`kind`),
  KEY `fk_ct_user` (`created_by`),
  CONSTRAINT `fk_ct_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ct_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ct_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: meeting_participants ----------
DROP TABLE IF EXISTS `meeting_participants`;
CREATE TABLE `meeting_participants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `room_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `display_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_guest` tinyint(1) NOT NULL DEFAULT '0',
  `native_language` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_language` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `speaking_voice_gender` enum('male','female','neutral') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `listening_voice_gender` enum('male','female','neutral') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `delivery_mode` enum('voice','text','both') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'both',
  `captions_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `original_volume` tinyint unsigned NOT NULL DEFAULT '40',
  `translated_volume` tinyint unsigned NOT NULL DEFAULT '100',
  `manual_extra_delay_ms` smallint unsigned NOT NULL DEFAULT '0',
  `is_muted` tinyint(1) NOT NULL DEFAULT '0',
  `is_hand_raised` tinyint(1) NOT NULL DEFAULT '0',
  `is_camera_off` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('waiting','admitted','denied','left') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'admitted',
  `joined_at` timestamp NULL DEFAULT NULL,
  `admitted_at` timestamp NULL DEFAULT NULL,
  `left_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mp_room_id` (`room_id`),
  KEY `idx_mp_user_id` (`user_id`),
  KEY `idx_mp_status` (`status`),
  CONSTRAINT `fk_mp_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: feedback_ratings ----------
DROP TABLE IF EXISTS `feedback_ratings`;
CREATE TABLE `feedback_ratings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `room_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `participant_id` int DEFAULT NULL,
  `translation_quality` tinyint unsigned DEFAULT NULL,
  `audio_quality` tinyint unsigned DEFAULT NULL,
  `partner_helpfulness` tinyint unsigned DEFAULT NULL,
  `comments` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_feedback_room_user` (`room_id`,`user_id`),
  KEY `idx_fr_room` (`room_id`),
  KEY `idx_fr_user` (`user_id`),
  KEY `fk_fr_participant` (`participant_id`),
  CONSTRAINT `fk_fr_participant` FOREIGN KEY (`participant_id`) REFERENCES `meeting_participants` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_fr_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fr_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: languages ----------
DROP TABLE IF EXISTS `languages`;
CREATE TABLE `languages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `native_name` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `direction` enum('ltr','rtl') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ltr',
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `idx_languages_is_enabled` (`is_enabled`),
  KEY `idx_languages_sort_order` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: meeting_invitations ----------
DROP TABLE IF EXISTS `meeting_invitations`;
CREATE TABLE `meeting_invitations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `room_id` int NOT NULL,
  `email` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `token` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `invited_by` int NOT NULL,
  `status` enum('pending','accepted','declined','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `responded_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_mi_room` (`room_id`),
  KEY `idx_mi_email` (`email`),
  KEY `idx_mi_status` (`status`),
  KEY `fk_mi_inviter` (`invited_by`),
  CONSTRAINT `fk_mi_inviter` FOREIGN KEY (`invited_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mi_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: meeting_token_usage ----------
DROP TABLE IF EXISTS `meeting_token_usage`;
CREATE TABLE `meeting_token_usage` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `segment_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `provider` varchar(40) NOT NULL DEFAULT 'openai',
  `model` varchar(80) NOT NULL,
  `operation` enum('chat_translation','realtime_audio','stt','tts','other') NOT NULL DEFAULT 'chat_translation',
  `source_lang` varchar(8) DEFAULT NULL,
  `target_lang` varchar(8) DEFAULT NULL,
  `prompt_tokens` int NOT NULL DEFAULT '0',
  `completion_tokens` int NOT NULL DEFAULT '0',
  `total_tokens` int NOT NULL DEFAULT '0',
  `prompt_cost_usd` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `completion_cost_usd` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `total_cost_usd` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `latency_ms` int DEFAULT NULL,
  `was_cached` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mtu_meeting` (`meeting_id`),
  KEY `idx_mtu_user` (`user_id`),
  KEY `idx_mtu_created` (`created_at`),
  KEY `idx_mtu_model` (`model`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- Tabla: messages ----------
DROP TABLE IF EXISTS `messages`;
CREATE TABLE `messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `room_id` int NOT NULL,
  `user_id` int NOT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_lang` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_lang` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `translated_content` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_room` (`room_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_messages_created_at` (`created_at`),
  KEY `idx_messages_room_created` (`room_id`,`created_at`),
  CONSTRAINT `fk_msg_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_msg_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: password_resets ----------
DROP TABLE IF EXISTS `password_resets`;
CREATE TABLE `password_resets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` timestamp NOT NULL,
  `used_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_pr_user_id` (`user_id`),
  KEY `idx_pr_token` (`token`),
  CONSTRAINT `fk_pr_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: reports ----------
DROP TABLE IF EXISTS `reports`;
CREATE TABLE `reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reporter_id` int NOT NULL,
  `reported_user_id` int NOT NULL,
  `room_id` int DEFAULT NULL,
  `reason` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `details` text COLLATE utf8mb4_unicode_ci,
  `status` enum('pending','reviewed','resolved','dismissed','actioned') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `fk_rep_reporter` (`reporter_id`),
  KEY `fk_rep_reported` (`reported_user_id`),
  KEY `fk_rep_room` (`room_id`),
  CONSTRAINT `fk_rep_reported` FOREIGN KEY (`reported_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rep_reporter` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rep_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: room_invitations ----------
DROP TABLE IF EXISTS `room_invitations`;
CREATE TABLE `room_invitations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `room_id` int NOT NULL,
  `room_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `inviter_id` int NOT NULL,
  `invitee_id` int NOT NULL,
  `message` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','accepted','declined','cancelled','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `responded_at` timestamp NULL DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_invitee_status` (`invitee_id`,`status`),
  KEY `idx_room` (`room_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: session_history ----------
DROP TABLE IF EXISTS `session_history`;
CREATE TABLE `session_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `room_id` int NOT NULL,
  `user_id` int NOT NULL,
  `partner_id` int DEFAULT NULL,
  `duration_seconds` int DEFAULT '0',
  `rating` tinyint DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_room` (`room_id`),
  KEY `fk_hist_partner` (`partner_id`),
  CONSTRAINT `fk_hist_partner` FOREIGN KEY (`partner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_hist_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_hist_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: transcript_segments ----------
DROP TABLE IF EXISTS `transcript_segments`;
CREATE TABLE `transcript_segments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `speaker_participant_id` int DEFAULT NULL,
  `speaker_user_id` int DEFAULT NULL,
  `source_language` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `translations` json DEFAULT NULL,
  `audio_duration_ms` int DEFAULT NULL,
  `start_ms` bigint DEFAULT NULL,
  `end_ms` bigint DEFAULT NULL,
  `confidence` decimal(4,3) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ts_meeting` (`meeting_id`),
  KEY `idx_ts_speaker_participant` (`speaker_participant_id`),
  KEY `idx_ts_speaker_user` (`speaker_user_id`),
  KEY `idx_ts_created_at` (`created_at`),
  CONSTRAINT `fk_ts_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ts_speaker_participant` FOREIGN KEY (`speaker_participant_id`) REFERENCES `meeting_participants` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ts_speaker_user` FOREIGN KEY (`speaker_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: translation_logs ----------
DROP TABLE IF EXISTS `translation_logs`;
CREATE TABLE `translation_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `room_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `source_lang` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_lang` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stt_latency_ms` int DEFAULT NULL,
  `mt_latency_ms` int DEFAULT NULL,
  `tts_latency_ms` int DEFAULT NULL,
  `total_latency_ms` int NOT NULL DEFAULT '0',
  `char_count` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tl_room` (`room_id`),
  KEY `idx_tl_user` (`user_id`),
  KEY `idx_tl_created_at` (`created_at`),
  KEY `idx_tl_pair` (`source_lang`,`target_lang`),
  CONSTRAINT `fk_tl_room` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tl_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: translation_sessions ----------
DROP TABLE IF EXISTS `translation_sessions`;
CREATE TABLE `translation_sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `segment_id` int DEFAULT NULL,
  `speaker_participant_id` int DEFAULT NULL,
  `listener_participant_id` int DEFAULT NULL,
  `listener_user_id` int DEFAULT NULL,
  `source_language` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_language` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_text` text COLLATE utf8mb4_unicode_ci,
  `translated_text` text COLLATE utf8mb4_unicode_ci,
  `audio_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `audio_in_latency_ms` int DEFAULT NULL,
  `translation_latency_ms` int DEFAULT NULL,
  `tts_latency_ms` int DEFAULT NULL,
  `total_latency_ms` int NOT NULL DEFAULT '0',
  `is_degraded` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tsess_meeting` (`meeting_id`),
  KEY `idx_tsess_segment` (`segment_id`),
  KEY `idx_tsess_listener_participant` (`listener_participant_id`),
  KEY `idx_tsess_listener_user` (`listener_user_id`),
  KEY `idx_tsess_degraded` (`is_degraded`),
  KEY `idx_tsess_created_at` (`created_at`),
  KEY `fk_tsess_speaker_participant` (`speaker_participant_id`),
  CONSTRAINT `fk_tsess_listener_participant` FOREIGN KEY (`listener_participant_id`) REFERENCES `meeting_participants` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tsess_listener_user` FOREIGN KEY (`listener_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tsess_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tsess_segment` FOREIGN KEY (`segment_id`) REFERENCES `transcript_segments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tsess_speaker_participant` FOREIGN KEY (`speaker_participant_id`) REFERENCES `meeting_participants` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tabla: user_activation_tokens ----------
DROP TABLE IF EXISTS `user_activation_tokens`;
CREATE TABLE `user_activation_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token` varchar(128) NOT NULL,
  `created_by` int DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_uat_user` (`user_id`),
  KEY `idx_uat_token` (`token`),
  KEY `fk_uat_created_by` (`created_by`),
  CONSTRAINT `fk_uat_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_uat_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- Tabla: voices ----------
DROP TABLE IF EXISTS `voices`;
CREATE TABLE `voices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `language_code` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `voice_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `gender` enum('male','female','neutral') COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'mock',
  `provider_voice_id` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_voices_lang_key` (`language_code`,`voice_key`),
  KEY `idx_voices_lang` (`language_code`),
  KEY `idx_voices_enabled` (`is_enabled`),
  KEY `idx_voices_gender` (`gender`),
  CONSTRAINT `fk_voices_language` FOREIGN KEY (`language_code`) REFERENCES `languages` (`code`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
