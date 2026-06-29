-- ============================================================================
--  BiLingo Meet — Full Database Dump (schema + data)
--  Generado automáticamente por scripts/db-dump.js
--  Fecha: 2026-06-29T20:25:53.600Z
--  Base de datos: p184_project1
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';


-- ============================================================
-- Tabla: companies
-- ============================================================
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

INSERT INTO `companies` (`id`, `code`, `name`, `is_active`, `created_at`, `credit_markup`, `credit_low_threshold`) VALUES
  (1, 'DEFCMP', 'Default Company', 1, '2026-06-29 13:32:01', '1.500', 1000),
  (2, 'ACMECO', 'Acme Corp', 1, '2026-06-29 14:49:17', '2.000', 100);
-- (2 filas)

-- ============================================================
-- Tabla: users
-- ============================================================
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

INSERT INTO `users` (`id`, `email`, `password_hash`, `display_name`, `bio`, `avatar_color`, `avatar_url`, `native_language`, `learning_language`, `preferred_voice`, `default_native_voice_gender`, `default_target_voice_gender`, `default_delivery_mode`, `default_captions_enabled`, `proficiency_level`, `country`, `company_id`, `role`, `status`, `plan`, `is_online`, `last_seen`, `last_login_at`, `created_at`) VALUES
  (1, 'admin@bilingo.meet', '$2a$10$6GOYn5mDDq8Icos72FZFKemrLvX2W7Jk9LvSotxyjA8iK8Qv7soQO', 'Admin', 'Soy el administrador de BiLingo Meet', '#58CC02', NULL, 'Spanish', 'English', NULL, 'female', 'male', 'both', 1, 'advanced', 'Spain', 1, 'user', 'banned', 'free', 0, NULL, NULL, '2026-06-25 14:47:44'),
  (2, 'fhansen3@gmail.com', '$2a$10$PNJA1SisE5qzTi0ZfHQ3r.GKv2TPZOk4SHdFFDsMNBzxMMGxMh.0y', 'Fede', '', '#2B70C9', NULL, 'Spanish', 'Spanish', NULL, NULL, NULL, 'both', 1, 'beginner', 'Argentina', 1, 'superadmin', 'active', 'pro', 0, '2026-06-29 19:35:21', '2026-06-29 15:07:26', '2026-06-25 14:52:45'),
  (3, 'fhansen4@gmail.com', '$2a$10$RCIzBH2j3QbY6vTPivi.XO95fuhzWUUTRNsXtCEdU6H/odPpcAC/G', 'fede1', NULL, '#FF9600', NULL, 'English', 'Korean', NULL, NULL, NULL, 'both', 1, 'beginner', 'argentina', 1, 'user', 'active', 'free', 0, '2026-06-28 19:04:42', NULL, '2026-06-25 17:26:48'),
  (5, 'fhansen5@gmail.com', '$2a$10$tIIh0a56VLKJNNXyIXCS/ehKAZZ20pKqcGfR22f7UpMCyn5B38Bcy', 'fede2', NULL, '#CE82FF', NULL, 'English', 'Spanish', NULL, NULL, NULL, 'both', 1, 'beginner', 'Argentina', 1, 'user', 'active', 'free', 0, '2026-06-28 15:33:40', NULL, '2026-06-26 15:53:44'),
  (6, 'holaalina@hotmail.com', '$2a$10$RGCJ3/LrGKZ3nA8FY6ZSwuyktYWYJSyN64JqrjlWasYlcza5tQYce', 'Alina', NULL, '#CE82FF', NULL, 'English', 'English', NULL, NULL, NULL, 'both', 1, 'beginner', 'Argentina ', 1, 'user', 'active', 'free', 0, NULL, NULL, '2026-06-28 18:51:28'),
  (7, 'fhansen6@gmail.com', '$2a$10$QyWS/24RPBOZSN/lBc9zu.VA2RYCbHIZYJZKxR4p6MEtWiOSEmy8a', 'ladoB', NULL, '#2B70C9', NULL, 'English', 'English', NULL, NULL, NULL, 'both', 1, 'beginner', 'Argentina', 1, 'user', 'active', 'free', 0, '2026-06-28 19:11:26', NULL, '2026-06-28 19:05:32'),
  (8, 'fede44@gmail.com', '$2a$10$VUD8x8ZwGECWUP8bzZP2fuz0reBqBYVSea/qQGo/fHSgk6JpDpq4a', 'fede44', NULL, '#CE82FF', NULL, 'Spanish', 'Spanish', NULL, NULL, NULL, 'both', 1, 'beginner', 'Argentina', 1, 'user', 'active', 'free', 0, '2026-06-28 23:06:43', NULL, '2026-06-28 20:30:00'),
  (9, 'emmahansenchocolate@gmail.com', '$2a$10$yV2/KFQCpaJVDt3.YNdQquIqnQSVXXY3qV3aCl1llme6AVbjC6ljS', 'Emma', '', '#1CB0F6', NULL, 'English', 'English', NULL, NULL, NULL, 'both', 1, 'beginner', 'Argentina ', 1, 'user', 'active', 'free', 0, '2026-06-29 10:28:58', NULL, '2026-06-28 20:48:08'),
  (10, 'sofihansen23@gmail.com', '$2a$10$TebbqA/IFZUgbm4E9PcPQ.18tWbeSZg6V8.GrmZo5cPDx/7t1iXyK', 'Sofi23', '', '#1CB0F6', NULL, 'Spanish', 'Spanish', NULL, NULL, NULL, 'both', 1, 'beginner', 'Argentina ', 1, 'user', 'active', 'free', 0, '2026-06-28 23:49:47', NULL, '2026-06-28 21:52:08'),
  (11, 'natalia@acmeco.com', '!d51ebd2352c604c0b9256d38c49babd355a54b522eeedd31ca7e4e9945eb7b26', 'Naty', NULL, '#1CB0F6', NULL, 'en', NULL, NULL, NULL, NULL, 'both', 1, 'beginner', NULL, 2, 'company_admin', 'active', 'free', 0, NULL, NULL, '2026-06-29 14:54:18'),
  (12, 'probando@test.com', '!f27b9fd0ad7fa8b2a3c57893efbaf65d0497a1eb8b279881ae245203fe99c7da', 'prueba', NULL, '#1CB0F6', NULL, 'zh', NULL, NULL, NULL, NULL, 'both', 1, 'beginner', NULL, 2, 'user', 'active', 'free', 0, NULL, NULL, '2026-06-29 15:04:43'),
  (13, 'probando1@test.com', '!520a976a43a719221f6f7fea123047ef87d0e17488791fc88936e9c444db17f0', 'probando1', NULL, '#CE82FF', NULL, 'zh', NULL, NULL, NULL, NULL, 'both', 1, 'beginner', NULL, 2, 'user', 'active', 'free', 0, NULL, NULL, '2026-06-29 15:08:10'),
  (14, 'pepe@gmail.com', '$2a$10$SwuZokiUna65jAfcy27Xrua0DK8.lmSUWV8Bl38e8HSbhYDTKt9UO', 'pepe', NULL, '#CE82FF', NULL, 'Spanish', 'Spanish', NULL, NULL, NULL, 'both', 1, 'beginner', 'Argentina', NULL, 'user', 'active', 'free', 0, '2026-06-29 19:36:28', NULL, '2026-06-29 19:36:07');
-- (13 filas)

-- ============================================================
-- Tabla: admin_audit_logs
-- ============================================================
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

INSERT INTO `admin_audit_logs` (`id`, `admin_id`, `action`, `target_type`, `target_id`, `details`, `created_at`) VALUES
  (3, 2, 'user.activate', 'user', 11, '{"created":true,"email":"natalia@acmeco.com","role":"company_admin","companyId":2}', '2026-06-29 14:54:18'),
  (4, 2, 'user.activate', 'user', 11, '{"by":"fhansen3@gmail.com"}', '2026-06-29 14:59:01'),
  (5, 2, 'user.activate', 'user', 12, '{"created":true,"email":"probando@test.com","role":"user","companyId":2}', '2026-06-29 15:04:43'),
  (6, 2, 'user.activate', 'user', 13, '{"created":true,"email":"probando1@test.com","role":"user","companyId":2}', '2026-06-29 15:08:10'),
  (7, 2, '', '', 2, '{"amount":500,"description":"bonif"}', '2026-06-29 16:28:38'),
  (8, 2, '', '', 2, '{"markup":2,"threshold":100}', '2026-06-29 16:28:58'),
  (9, 2, '', '', 2, '{"amount":-100000,"description":"incidente"}', '2026-06-29 16:29:16'),
  (10, 2, '', '', 1, '{"amount":-49000,"description":"ajuste"}', '2026-06-29 18:06:31'),
  (11, 2, 'user.role_change', 'user', 1, '{"newRole":"user","by":"fhansen3@gmail.com"}', '2026-06-29 19:05:19'),
  (12, 2, 'user.suspend', 'user', 11, '{"by":"fhansen3@gmail.com"}', '2026-06-29 19:05:43'),
  (13, 2, 'user.suspend', 'user', 10, '{"by":"fhansen3@gmail.com"}', '2026-06-29 19:05:46'),
  (14, 2, 'user.suspend', 'user', 3, '{"by":"fhansen3@gmail.com"}', '2026-06-29 19:05:52'),
  (15, 2, 'user.activate', 'user', 3, '{"by":"fhansen3@gmail.com"}', '2026-06-29 19:06:00'),
  (16, 2, 'user.activate', 'user', 13, '{"by":"fhansen3@gmail.com"}', '2026-06-29 19:06:02'),
  (17, 2, 'user.activate', 'user', 12, '{"by":"fhansen3@gmail.com"}', '2026-06-29 19:06:04'),
  (18, 2, 'user.activate', 'user', 11, '{"by":"fhansen3@gmail.com"}', '2026-06-29 19:06:05'),
  (19, 2, 'user.activate', 'user', 10, '{"by":"fhansen3@gmail.com"}', '2026-06-29 19:06:06');
-- (17 filas)

-- ============================================================
-- Tabla: company_credits
-- ============================================================
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

INSERT INTO `company_credits` (`company_id`, `balance`, `total_added`, `total_consumed`, `updated_at`) VALUES
  (1, -6160, 50000, 56160, '2026-06-29 18:24:55'),
  (2, 500, 100500, 100000, '2026-06-29 16:29:16');
-- (2 filas)

-- ============================================================
-- Tabla: rooms
-- ============================================================
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

INSERT INTO `rooms` (`id`, `room_code`, `name`, `host_id`, `guest_id`, `language_focus`, `topic`, `scheduled_start`, `max_participants`, `is_public`, `waiting_room_enabled`, `is_locked`, `status`, `started_at`, `ended_at`, `duration_seconds`, `duration_limit_min`, `save_transcript`, `created_at`) VALUES
  (1, 'Q44S7Y', NULL, 2, NULL, NULL, 'Práctica de idiomas', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-25 15:03:34', 0, 60, 1, '2026-06-25 14:55:38'),
  (2, 'F9FA52', NULL, 2, NULL, NULL, 'Práctica de idiomas', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-25 15:15:33', 0, 60, 1, '2026-06-25 15:13:56'),
  (3, 'ETNEDA', NULL, 2, NULL, NULL, 'Invitación directa', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-25 15:15:51', 0, 60, 1, '2026-06-25 15:15:43'),
  (4, 'NFWZ25', NULL, 2, NULL, NULL, 'Invitación directa', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-25 17:29:52', 0, 60, 1, '2026-06-25 17:29:07'),
  (5, 'QY5BPD', NULL, 3, 2, NULL, 'Invitación directa', NULL, 2, 1, 0, 0, 'ended', '2026-06-25 17:30:18', '2026-06-25 17:34:16', 238, 60, 1, '2026-06-25 17:29:38'),
  (6, 'WYAEUJ', NULL, 2, NULL, NULL, 'Invitación directa', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-26 15:32:40', 0, 60, 1, '2026-06-25 17:34:01'),
  (9, 'cdv-xcbw-fni', NULL, 2, NULL, NULL, 'Invitación directa', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-26 15:27:29', 0, NULL, 1, '2026-06-26 15:25:41'),
  (10, 'mfe-iokc-wpr', NULL, 2, 5, NULL, 'Invitación directa', NULL, 2, 1, 0, 0, 'ended', '2026-06-26 15:55:03', '2026-06-28 15:33:36', 171513, NULL, 1, '2026-06-26 15:54:28'),
  (11, 'sdy-yxtf-aqg', NULL, 5, NULL, NULL, 'Práctica de idiomas', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-28 15:33:40', 0, NULL, 1, '2026-06-28 15:27:07'),
  (12, 'ece-nhyp-vnt', NULL, 2, NULL, NULL, 'Reunión con Alina', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-28 18:52:04', 0, NULL, 1, '2026-06-28 18:51:42'),
  (13, 'yfh-zbeo-jbm', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-28 19:04:11', 0, NULL, 1, '2026-06-28 18:52:16'),
  (14, 'bqp-vxcs-wqh', NULL, 6, 2, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', '2026-06-28 18:53:07', '2026-06-28 18:53:22', 15, NULL, 1, '2026-06-28 18:52:28'),
  (15, 'con-xthb-gkb', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-28 19:04:03', 0, NULL, 1, '2026-06-28 19:03:55'),
  (16, 'pbr-aspe-zrh', NULL, 7, NULL, NULL, 'Reunión con fede1', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-28 19:08:50', 0, NULL, 1, '2026-06-28 19:08:23'),
  (17, 'kak-bxiz-hmn', NULL, 7, 2, NULL, 'Reunión con Fede', NULL, 2, 1, 0, 0, 'ended', '2026-06-28 19:09:04', '2026-06-29 18:24:55', 83751, NULL, 1, '2026-06-28 19:08:59'),
  (18, 'wth-mvsq-ykh', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 19:21:15'),
  (19, 'wrm-qnyx-ttm', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 19:21:18'),
  (20, 'got-tmso-gsy', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 19:25:05'),
  (21, 'zyi-csyh-ciu', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 19:25:14'),
  (22, 'wwo-iioz-tjp', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 19:27:06'),
  (23, 'ycy-poti-uvp', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 19:57:45'),
  (24, 'vcc-ysnm-dgw', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 19:59:50'),
  (25, 'qhx-zzev-zmx', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 20:09:58'),
  (26, 'bnb-nygn-mge', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 20:10:52'),
  (27, 'mfu-egus-dxg', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 20:11:23'),
  (28, 'edb-qqaq-yvq', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 20:13:16'),
  (29, 'wpk-nkba-fup', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 20:18:15'),
  (30, 'vuv-qesm-jmm', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 20:20:00'),
  (31, 'jur-ibmw-cyt', NULL, 2, NULL, NULL, 'Reunión de equipo', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 20:25:25'),
  (32, 'tvj-kxez-kva', NULL, 8, NULL, NULL, 'Reunión con Fede', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 20:30:09'),
  (33, 'kyb-rhjo-wcp', NULL, 9, NULL, NULL, 'Reunión con Fede', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 20:56:54'),
  (34, 'uwe-obzw-uno', NULL, 10, NULL, NULL, 'Reunión con Emma', NULL, 2, 1, 0, 0, 'ended', NULL, '2026-06-29 18:24:55', 0, NULL, 1, '2026-06-28 21:52:33');
-- (32 filas)

-- ============================================================
-- Tabla: credit_transactions
-- ============================================================
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

INSERT INTO `credit_transactions` (`id`, `company_id`, `kind`, `amount`, `balance_after`, `meeting_id`, `cost_usd`, `markup`, `description`, `created_by`, `created_at`) VALUES
  (1, 1, 'topup', 50000, 50000, NULL, NULL, NULL, 'Recarga inicial de prueba (50.000 créditos = $500 USD)', NULL, '2026-06-29 16:11:28'),
  (2, 2, 'topup', 100000, 100000, NULL, NULL, NULL, 'Recarga inicial de prueba (100.000 créditos = $1000 USD)', NULL, '2026-06-29 16:11:29'),
  (3, 1, 'debit', -17, 49983, 16, '0.107492', '1.500', 'Llamada pbr-aspe-zrh · 6 llamadas IA', NULL, '2026-06-29 16:12:10'),
  (4, 2, 'adjustment', 500, 100500, NULL, NULL, NULL, 'bonif', 2, '2026-06-29 16:28:38'),
  (5, 2, 'adjustment', -100000, 500, NULL, NULL, NULL, 'incidente', 2, '2026-06-29 16:29:16'),
  (6, 1, 'adjustment', -49000, 983, NULL, NULL, NULL, 'ajuste', 2, '2026-06-29 18:06:31'),
  (7, 1, 'debit', -7119, -6136, 17, '47.458900', '1.500', 'Llamada kak-bxiz-hmn · 1 llamadas IA', NULL, '2026-06-29 18:24:55'),
  (8, 1, 'debit', -2, -6138, 14, '0.008500', '1.500', 'Llamada bqp-vxcs-wqh · 1 llamadas IA', NULL, '2026-06-29 18:24:55'),
  (9, 1, 'debit', -1, -6139, 10, '0.001360', '1.500', 'Llamada mfe-iokc-wpr · 1 llamadas IA', NULL, '2026-06-29 18:24:55'),
  (10, 1, 'debit', -21, -6160, 5, '0.134867', '1.500', 'Llamada QY5BPD · 1 llamadas IA', NULL, '2026-06-29 18:24:55');
-- (10 filas)

-- ============================================================
-- Tabla: meeting_participants
-- ============================================================
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

-- (sin datos)

-- ============================================================
-- Tabla: feedback_ratings
-- ============================================================
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

-- (sin datos)

-- ============================================================
-- Tabla: languages
-- ============================================================
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

INSERT INTO `languages` (`id`, `code`, `name`, `native_name`, `direction`, `is_enabled`, `sort_order`, `created_at`) VALUES
  (1, 'en', 'English', 'English', 'ltr', 1, 10, '2026-06-26 11:21:53'),
  (2, 'es', 'Spanish', 'Español', 'ltr', 1, 20, '2026-06-26 11:21:53'),
  (3, 'fr', 'French', 'Français', 'ltr', 1, 30, '2026-06-26 11:21:53'),
  (4, 'de', 'German', 'Deutsch', 'ltr', 1, 40, '2026-06-26 11:21:53'),
  (5, 'pt', 'Portuguese', 'Português', 'ltr', 1, 50, '2026-06-26 11:21:53'),
  (6, 'ja', 'Japanese', '日本語', 'ltr', 1, 60, '2026-06-26 11:21:53'),
  (7, 'zh', 'Chinese', '中文', 'ltr', 1, 70, '2026-06-26 11:21:53'),
  (8, 'ar', 'Arabic', 'العربية', 'rtl', 1, 80, '2026-06-26 11:21:53'),
  (9, 'hi', 'Hindi', 'हिन्दी', 'ltr', 1, 90, '2026-06-26 11:21:53'),
  (10, 'ru', 'Russian', 'Русский', 'ltr', 1, 100, '2026-06-26 11:21:53');
-- (10 filas)

-- ============================================================
-- Tabla: meeting_invitations
-- ============================================================
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

-- (sin datos)

-- ============================================================
-- Tabla: meeting_token_usage
-- ============================================================
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

INSERT INTO `meeting_token_usage` (`id`, `meeting_id`, `segment_id`, `user_id`, `provider`, `model`, `operation`, `source_lang`, `target_lang`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_cost_usd`, `completion_cost_usd`, `total_cost_usd`, `latency_ms`, `was_cached`, `created_at`) VALUES
  (7, 17, NULL, 7, 'openai', 'gpt-realtime-translate', 'realtime_audio', NULL, NULL, 0, 0, 83751, '0.000000', '0.000000', '47.458900', NULL, 0, '2026-06-29 18:24:55'),
  (8, 14, NULL, 6, 'openai', 'gpt-realtime-translate', 'realtime_audio', NULL, NULL, 0, 0, 15, '0.000000', '0.000000', '0.008500', NULL, 0, '2026-06-29 18:24:55'),
  (9, 10, NULL, 2, 'openai', 'gpt-realtime-translate', 'realtime_audio', NULL, NULL, 0, 0, 2, '0.000000', '0.000000', '0.001360', NULL, 0, '2026-06-29 18:24:55'),
  (10, 5, NULL, 3, 'openai', 'gpt-realtime-translate', 'realtime_audio', NULL, NULL, 0, 0, 238, '0.000000', '0.000000', '0.134867', NULL, 0, '2026-06-29 18:24:55');
-- (4 filas)

-- ============================================================
-- Tabla: messages
-- ============================================================
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

INSERT INTO `messages` (`id`, `room_id`, `user_id`, `content`, `source_lang`, `target_lang`, `translated_content`, `created_at`) VALUES
  (1, 1, 2, 'hola', NULL, NULL, NULL, '2026-06-25 14:59:28'),
  (2, 2, 2, 'HOLA', 'es', 'en', NULL, '2026-06-25 15:14:03'),
  (3, 5, 2, 'hola', 'es', 'en', NULL, '2026-06-25 17:30:54'),
  (4, 5, 3, 'que haces?', 'en', 'es', 'SABES,ERES UN INMADURO E IGNORANTE.CON LA SOGA QUE PREPARA PARA AHORCAR A OTRO,RESULTA QUE CON ELLA MISMA TE AHORCAS.ERES UN MENTIROSO COMPULSIVO Y TE DELATA TU SOLITO.SIEMPRE TUVE PRESENTE LO QUE ME DECIAN DE TU PERSONA PERO NO LO QUISE CREER,PERO EN ESTE MOMENTO ES DIFICIL DUDARLO PORQUE TUVE TIEMPO DEMAS PARA COMPROBAR LA VERDAD.NO ERES PERSONA DE ASUMIR TUS ERRORES SOLO SABES EVADIR Y SALIR CORRIENDO.', '2026-06-25 17:31:26'),
  (5, 5, 2, 'todo bien', 'es', 'en', 'Everything is good', '2026-06-25 17:32:40'),
  (6, 5, 3, 'what do You doing?', 'en', 'es', '¿Qué te apetece hacer?', '2026-06-25 17:33:20'),
  (7, 9, 2, 'hello', 'Spanish', 'English', NULL, '2026-06-26 15:26:26'),
  (8, 9, 2, 'hello', 'Spanish', 'es', NULL, '2026-06-26 15:26:49'),
  (9, 9, 2, 'whats you name?', 'en', 'es', NULL, '2026-06-26 15:27:08'),
  (10, 6, 2, 'hola', 'es', 'English', NULL, '2026-06-26 15:32:29'),
  (11, 10, 5, 'hola', 'es', NULL, NULL, '2026-06-26 15:55:21'),
  (12, 10, 2, 'hello', 'en', NULL, NULL, '2026-06-26 15:55:34'),
  (13, 10, 5, 'como te llamas?', 'es', NULL, NULL, '2026-06-26 15:55:43'),
  (14, 10, 2, 'my name us fede2', 'en', NULL, NULL, '2026-06-26 15:56:02'),
  (15, 10, 2, 'al rights', 'en', NULL, NULL, '2026-06-26 15:56:41'),
  (16, 10, 2, 'write your name', 'en', NULL, NULL, '2026-06-26 15:56:58'),
  (17, 10, 2, 'write your name', 'en', NULL, NULL, '2026-06-26 15:57:10'),
  (18, 10, 5, 'todo bien?', 'en', NULL, NULL, '2026-06-26 15:57:57'),
  (19, 17, 2, 'hello', 'Spanish', 'English', NULL, '2026-06-28 19:09:31'),
  (20, 17, 7, 'hola buenos dias', 'es', NULL, NULL, '2026-06-28 19:09:50'),
  (21, 17, 2, 'hello', 'Spanish', 'English', NULL, '2026-06-28 19:10:04'),
  (22, 17, 7, 'hello', 'es', NULL, NULL, '2026-06-28 19:10:11');
-- (22 filas)

-- ============================================================
-- Tabla: password_resets
-- ============================================================
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

-- (sin datos)

-- ============================================================
-- Tabla: reports
-- ============================================================
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

-- (sin datos)

-- ============================================================
-- Tabla: room_invitations
-- ============================================================
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

INSERT INTO `room_invitations` (`id`, `room_id`, `room_code`, `inviter_id`, `invitee_id`, `message`, `status`, `created_at`, `responded_at`, `expires_at`) VALUES
  (1, 12, 'ece-nhyp-vnt', 2, 6, 'Te invito a una reunión', 'pending', '2026-06-28 18:51:43', NULL, '2026-06-28 19:01:43'),
  (2, 16, 'pbr-aspe-zrh', 7, 3, 'Te invito a una reunión', 'pending', '2026-06-28 19:08:23', NULL, '2026-06-28 19:18:23'),
  (3, 17, 'kak-bxiz-hmn', 7, 2, 'Te invito a una reunión', 'accepted', '2026-06-28 19:08:59', '2026-06-28 19:09:04', '2026-06-28 19:18:59'),
  (4, 32, 'tvj-kxez-kva', 8, 2, 'Te invito a una reunión', 'accepted', '2026-06-28 20:30:09', '2026-06-28 20:30:18', '2026-06-28 20:40:09'),
  (5, 31, 'jur-ibmw-cyt', 2, 9, 'Te invito a una reunión', 'accepted', '2026-06-28 20:48:15', '2026-06-28 20:48:19', '2026-06-28 20:58:15'),
  (6, 31, 'jur-ibmw-cyt', 2, 9, 'Te invito a una reunión', 'accepted', '2026-06-28 20:55:55', '2026-06-28 21:02:31', '2026-06-28 21:05:55'),
  (7, 33, 'kyb-rhjo-wcp', 9, 2, 'Te invito a una reunión', 'accepted', '2026-06-28 20:56:55', '2026-06-28 20:57:00', '2026-06-28 21:06:55'),
  (8, 31, 'jur-ibmw-cyt', 2, 9, 'Te invito a una reunión', 'accepted', '2026-06-28 21:02:42', '2026-06-28 21:02:44', '2026-06-28 21:12:42'),
  (9, 31, 'jur-ibmw-cyt', 2, 9, 'Te invito a una reunión', 'accepted', '2026-06-28 21:03:53', '2026-06-28 21:03:55', '2026-06-28 21:13:53'),
  (10, 31, 'jur-ibmw-cyt', 2, 9, 'Te invito a una reunión', 'accepted', '2026-06-28 21:08:10', '2026-06-28 21:08:13', '2026-06-28 21:18:10'),
  (11, 31, 'jur-ibmw-cyt', 2, 9, 'Te invito a una reunión', 'accepted', '2026-06-28 21:09:46', '2026-06-28 21:09:48', '2026-06-28 21:19:46'),
  (12, 32, 'tvj-kxez-kva', 8, 9, 'Te invito a una reunión', 'accepted', '2026-06-28 21:15:17', '2026-06-28 21:15:20', '2026-06-28 21:25:17'),
  (13, 34, 'uwe-obzw-uno', 10, 9, 'Te invito a una reunión', 'declined', '2026-06-28 21:52:34', '2026-06-28 21:54:55', '2026-06-28 22:02:34'),
  (14, 34, 'uwe-obzw-uno', 10, 9, 'Te invito a una reunión', 'declined', '2026-06-28 21:54:55', '2026-06-28 21:54:56', '2026-06-28 22:04:55'),
  (15, 34, 'uwe-obzw-uno', 10, 9, 'Te invito a una reunión', 'accepted', '2026-06-28 21:55:11', '2026-06-28 21:55:12', '2026-06-28 22:05:11'),
  (16, 33, 'kyb-rhjo-wcp', 9, 10, 'Te invito a una reunión', 'accepted', '2026-06-28 21:57:33', '2026-06-28 21:57:35', '2026-06-28 22:07:33'),
  (17, 31, 'jur-ibmw-cyt', 2, 9, 'Te invito a una reunión', 'accepted', '2026-06-29 01:19:46', '2026-06-29 01:19:48', '2026-06-29 01:29:46'),
  (18, 31, 'jur-ibmw-cyt', 2, 9, 'Te invito a una reunión', 'accepted', '2026-06-29 01:20:41', '2026-06-29 01:21:52', '2026-06-29 01:30:41'),
  (19, 31, 'jur-ibmw-cyt', 2, 9, 'Te invito a una reunión', 'accepted', '2026-06-29 01:21:57', '2026-06-29 01:21:58', '2026-06-29 01:31:57');
-- (19 filas)

-- ============================================================
-- Tabla: session_history
-- ============================================================
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

INSERT INTO `session_history` (`id`, `room_id`, `user_id`, `partner_id`, `duration_seconds`, `rating`, `notes`, `created_at`) VALUES
  (1, 1, 2, NULL, 0, NULL, NULL, '2026-06-25 15:03:00'),
  (2, 1, 2, NULL, 0, NULL, NULL, '2026-06-25 15:03:34'),
  (3, 2, 2, NULL, 0, NULL, NULL, '2026-06-25 15:15:33'),
  (4, 3, 2, NULL, 0, NULL, NULL, '2026-06-25 15:15:51'),
  (5, 4, 2, NULL, 0, NULL, NULL, '2026-06-25 17:29:52'),
  (6, 5, 3, 2, 212, NULL, NULL, '2026-06-25 17:33:50'),
  (7, 5, 2, 3, 212, NULL, NULL, '2026-06-25 17:33:50'),
  (8, 5, 3, 2, 238, NULL, NULL, '2026-06-25 17:34:16'),
  (9, 5, 2, 3, 238, NULL, NULL, '2026-06-25 17:34:16'),
  (10, 9, 2, NULL, 0, NULL, NULL, '2026-06-26 15:27:29'),
  (11, 6, 2, NULL, 0, NULL, NULL, '2026-06-26 15:32:40'),
  (12, 10, 2, 5, 171513, NULL, NULL, '2026-06-28 15:33:36'),
  (13, 10, 5, 2, 171513, NULL, NULL, '2026-06-28 15:33:36'),
  (14, 11, 5, NULL, 0, NULL, NULL, '2026-06-28 15:33:40'),
  (15, 12, 2, NULL, 0, NULL, NULL, '2026-06-28 18:52:04'),
  (16, 14, 6, 2, 14, NULL, NULL, '2026-06-28 18:53:21'),
  (17, 14, 2, 6, 14, NULL, NULL, '2026-06-28 18:53:21'),
  (18, 14, 6, 2, 15, NULL, NULL, '2026-06-28 18:53:22'),
  (19, 14, 2, 6, 15, NULL, NULL, '2026-06-28 18:53:22'),
  (20, 15, 2, NULL, 0, NULL, NULL, '2026-06-28 19:04:03'),
  (21, 13, 2, NULL, 0, NULL, NULL, '2026-06-28 19:04:11'),
  (22, 16, 7, NULL, 0, NULL, NULL, '2026-06-28 19:08:50');
-- (22 filas)

-- ============================================================
-- Tabla: transcript_segments
-- ============================================================
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

INSERT INTO `transcript_segments` (`id`, `meeting_id`, `speaker_participant_id`, `speaker_user_id`, `source_language`, `original_text`, `translations`, `audio_duration_ms`, `start_ms`, `end_ms`, `confidence`, `created_at`) VALUES
  (2, 10, NULL, 2, 'es', 'Hola a todos, bienvenidos a la reunión.', '{"en":{"text":"Hello everyone, welcome to the meeting.","audioUrl":"/mock-audio/en/test.mp3"},"fr":{"text":"Bonjour à tous, bienvenue à la réunion.","audioUrl":"/mock-audio/fr/test.mp3"}}', 2400, 1700000000000, 1700000002400, '0.927', '2026-06-26 16:01:47');
-- (1 filas)

-- ============================================================
-- Tabla: translation_logs
-- ============================================================
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

INSERT INTO `translation_logs` (`id`, `room_id`, `user_id`, `source_lang`, `target_lang`, `stt_latency_ms`, `mt_latency_ms`, `tts_latency_ms`, `total_latency_ms`, `char_count`, `created_at`) VALUES
  (1, NULL, NULL, 'en', 'es', 200, 150, 300, 650, 45, '2026-06-20 14:37:06'),
  (2, 16, 7, 'es', 'en', 380, 220, 410, 1010, 42, '2026-06-29 16:11:43'),
  (3, 16, 7, 'en', 'es', 350, 195, 380, 925, 38, '2026-06-29 16:11:43'),
  (4, 16, 7, 'es', 'en', 410, 240, 425, 1075, 51, '2026-06-29 16:11:43'),
  (5, 16, 7, 'en', 'es', 360, 210, 395, 965, 35, '2026-06-29 16:11:43'),
  (6, 16, 7, 'es', 'en', 395, 230, 415, 1040, 47, '2026-06-29 16:11:43'),
  (7, 16, 7, 'es', 'en', 580, 420, 720, 1720, 68, '2026-06-29 16:11:46'),
  (8, 16, 7, 'en', 'es', 620, 380, 750, 1750, 72, '2026-06-29 16:11:46'),
  (9, 16, 7, 'es', 'en', 650, 410, 790, 1850, 85, '2026-06-29 16:11:46'),
  (10, 16, 7, 'en', 'es', 590, 395, 735, 1720, 71, '2026-06-29 16:11:46'),
  (11, 16, 7, 'es', 'en', 610, 405, 760, 1775, 74, '2026-06-29 16:11:46'),
  (12, 16, 7, 'es', 'en', 920, 1180, 1450, 3550, 95, '2026-06-29 16:11:48'),
  (13, 16, 7, 'en', 'es', 1050, 1320, 1580, 3950, 110, '2026-06-29 16:11:48'),
  (14, 16, 7, 'es', 'en', 890, 1240, 1420, 3550, 88, '2026-06-29 16:11:48');
-- (14 filas)

-- ============================================================
-- Tabla: translation_sessions
-- ============================================================
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

-- (sin datos)

-- ============================================================
-- Tabla: user_activation_tokens
-- ============================================================
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

INSERT INTO `user_activation_tokens` (`id`, `user_id`, `token`, `created_by`, `expires_at`, `used_at`, `created_at`) VALUES
  (1, 10, 'e7abab7560379aa9c626ebef6c705b77c8267221b6942b27', 2, '2026-06-30 14:44:54', '2026-06-29 14:47:14', '2026-06-29 14:44:54'),
  (2, 10, '2a0980317fd3d5b1e81d41b620be26616568d13d51692885', 2, '2026-06-30 14:47:15', NULL, '2026-06-29 14:47:14'),
  (3, 11, '49df31d31844b3842866c62f0adec2e99d11543e3ddf68e1', 2, '2026-06-30 14:54:18', '2026-06-29 14:54:49', '2026-06-29 14:54:18'),
  (4, 11, '2649308abcfe9e85a1822503413a03081ba9326ba5e183cb', 2, '2026-06-30 14:54:49', '2026-06-29 14:59:36', '2026-06-29 14:54:49'),
  (5, 11, '51572eadb5666a328b4317f08dc0ed974ea4b93c488dfc24', 2, '2026-06-30 14:59:37', NULL, '2026-06-29 14:59:36'),
  (6, 12, 'a24ada20a60341c220ef6885248c0db5ba4727eee130fab8', 2, '2026-06-30 15:04:43', '2026-06-29 19:06:07', '2026-06-29 15:04:43'),
  (7, 13, '3abb837d9d9da6165ddb4fd560da8b14ef21539759f0b2f7', 2, '2026-06-30 15:08:11', '2026-06-29 15:08:17', '2026-06-29 15:08:10'),
  (8, 13, 'a5e6feb64230e446bef4e626586dbbba2cec9f2d56a899ba', 2, '2026-06-30 15:08:18', '2026-06-29 19:06:19', '2026-06-29 15:08:18'),
  (9, 12, '243c5d4677479f3df44637f83c6c5b72d9abc0679ce4f311', 2, '2026-06-30 19:06:08', NULL, '2026-06-29 19:06:07'),
  (10, 13, 'c170c5cda24e9532c72157917de123cd17ebffece9e06942', 2, '2026-06-30 19:06:19', '2026-06-29 19:06:21', '2026-06-29 19:06:19'),
  (11, 13, '4018e3a5c8600a18b750b655d117ce0e9737fbb6571cc29b', 2, '2026-06-30 19:06:22', NULL, '2026-06-29 19:06:21');
-- (11 filas)

-- ============================================================
-- Tabla: voices
-- ============================================================
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

INSERT INTO `voices` (`id`, `language_code`, `voice_key`, `display_name`, `gender`, `provider`, `provider_voice_id`, `is_enabled`, `sort_order`, `created_at`) VALUES
  (1, 'en', 'en_male_1', 'James (US Male)', 'male', 'mock', 'mock-en-male-1', 1, 10, '2026-06-26 11:21:53'),
  (2, 'en', 'en_female_1', 'Emma (US Female)', 'female', 'mock', 'mock-en-female-1', 1, 20, '2026-06-26 11:21:53'),
  (3, 'es', 'es_male_1', 'Diego (Male)', 'male', 'mock', 'mock-es-male-1', 1, 10, '2026-06-26 11:21:53'),
  (4, 'es', 'es_female_1', 'Sofia (Female)', 'female', 'mock', 'mock-es-female-1', 1, 20, '2026-06-26 11:21:53'),
  (5, 'fr', 'fr_male_1', 'Louis (Male)', 'male', 'mock', 'mock-fr-male-1', 1, 10, '2026-06-26 11:21:53'),
  (6, 'fr', 'fr_female_1', 'Camille (Female)', 'female', 'mock', 'mock-fr-female-1', 1, 20, '2026-06-26 11:21:53'),
  (7, 'de', 'de_male_1', 'Hans (Male)', 'male', 'mock', 'mock-de-male-1', 1, 10, '2026-06-26 11:21:53'),
  (8, 'de', 'de_female_1', 'Greta (Female)', 'female', 'mock', 'mock-de-female-1', 1, 20, '2026-06-26 11:21:53'),
  (9, 'pt', 'pt_male_1', 'Lucas (Male)', 'male', 'mock', 'mock-pt-male-1', 1, 10, '2026-06-26 11:21:53'),
  (10, 'pt', 'pt_female_1', 'Mariana (Female)', 'female', 'mock', 'mock-pt-female-1', 1, 20, '2026-06-26 11:21:53'),
  (11, 'ja', 'ja_male_1', 'Haruto (Male)', 'male', 'mock', 'mock-ja-male-1', 1, 10, '2026-06-26 11:21:53'),
  (12, 'ja', 'ja_female_1', 'Sakura (Female)', 'female', 'mock', 'mock-ja-female-1', 1, 20, '2026-06-26 11:21:53'),
  (13, 'zh', 'zh_male_1', 'Wei (Male)', 'male', 'mock', 'mock-zh-male-1', 1, 10, '2026-06-26 11:21:53'),
  (14, 'zh', 'zh_female_1', 'Mei (Female)', 'female', 'mock', 'mock-zh-female-1', 1, 20, '2026-06-26 11:21:53'),
  (15, 'ar', 'ar_male_1', 'Omar (Male)', 'male', 'mock', 'mock-ar-male-1', 1, 10, '2026-06-26 11:21:53'),
  (16, 'ar', 'ar_female_1', 'Layla (Female)', 'female', 'mock', 'mock-ar-female-1', 1, 20, '2026-06-26 11:21:53'),
  (17, 'hi', 'hi_male_1', 'Arjun (Male)', 'male', 'mock', 'mock-hi-male-1', 1, 10, '2026-06-26 11:21:53'),
  (18, 'hi', 'hi_female_1', 'Priya (Female)', 'female', 'mock', 'mock-hi-female-1', 1, 20, '2026-06-26 11:21:53'),
  (19, 'ru', 'ru_male_1', 'Ivan (Male)', 'male', 'mock', 'mock-ru-male-1', 1, 10, '2026-06-26 11:21:53'),
  (20, 'ru', 'ru_female_1', 'Anastasia (Female)', 'female', 'mock', 'mock-ru-female-1', 1, 20, '2026-06-26 11:21:53');
-- (20 filas)

SET FOREIGN_KEY_CHECKS = 1;
