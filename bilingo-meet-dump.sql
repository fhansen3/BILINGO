-- ============================================================================
-- BiLingo Meet — Database dump
-- Database: p184_project1
-- Generated: 2026-06-28
-- ============================================================================
-- This dump contains all data from the live project database.
-- The schema (CREATE TABLE statements) lives in db/schema.sql — apply it
-- first, then run this file to restore the data.
--
-- Restore order:
--   1) mysql -u <user> -p <db> < db/schema.sql
--   2) mysql -u <user> -p <db> < bilingo-meet-dump.sql
-- ============================================================================

SET FOREIGN_KEY_CHECKS=0;
SET NAMES utf8mb4;
SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';

-- ----------------------------------------------------------------------------
-- Table: users (4 rows)
-- ----------------------------------------------------------------------------
INSERT INTO `users` (`id`,`email`,`password_hash`,`display_name`,`bio`,`avatar_color`,`avatar_url`,`native_language`,`learning_language`,`preferred_voice`,`default_native_voice_gender`,`default_target_voice_gender`,`default_delivery_mode`,`default_captions_enabled`,`proficiency_level`,`country`,`role`,`status`,`plan`,`is_online`,`last_seen`,`last_login_at`,`created_at`) VALUES
(1,'admin@bilingo.meet','$2a$10$6GOYn5mDDq8Icos72FZFKemrLvX2W7Jk9LvSotxyjA8iK8Qv7soQO','Admin','Soy el administrador de BiLingo Meet','#58CC02',NULL,'Spanish','English',NULL,'female','male','both',1,'advanced','Spain','admin','active','free',0,NULL,NULL,'2026-06-25 14:47:44'),
(2,'fhansen3@gmail.com','$2a$10$PNJA1SisE5qzTi0ZfHQ3r.GKv2TPZOk4SHdFFDsMNBzxMMGxMh.0y','Fede','','#2B70C9',NULL,'Spanish','English',NULL,NULL,NULL,'both',1,'beginner','Argentina','user','active','free',1,'2026-06-26 16:02:06',NULL,'2026-06-25 14:52:45'),
(3,'fhansen4@gmail.com','$2a$10$RCIzBH2j3QbY6vTPivi.XO95fuhzWUUTRNsXtCEdU6H/odPpcAC/G','fede1',NULL,'#FF9600',NULL,'English','Korean',NULL,NULL,NULL,'both',1,'beginner','argentina','user','active','free',0,'2026-06-26 15:58:57',NULL,'2026-06-25 17:26:48'),
(5,'fhansen5@gmail.com','$2a$10$tIIh0a56VLKJNNXyIXCS/ehKAZZ20pKqcGfR22f7UpMCyn5B38Bcy','fede2',NULL,'#CE82FF',NULL,'English','Spanish',NULL,NULL,NULL,'both',1,'beginner','Argentina','user','active','free',0,'2026-06-26 16:00:57',NULL,'2026-06-26 15:53:44');

-- ----------------------------------------------------------------------------
-- Table: languages (10 rows)
-- ----------------------------------------------------------------------------
INSERT INTO `languages` (`id`,`code`,`name`,`native_name`,`direction`,`is_enabled`,`sort_order`,`created_at`) VALUES
(1,'en','English','English','ltr',1,10,'2026-06-26 11:21:53'),
(2,'es','Spanish','Español','ltr',1,20,'2026-06-26 11:21:53'),
(3,'fr','French','Français','ltr',1,30,'2026-06-26 11:21:53'),
(4,'de','German','Deutsch','ltr',1,40,'2026-06-26 11:21:53'),
(5,'pt','Portuguese','Português','ltr',1,50,'2026-06-26 11:21:53'),
(6,'ja','Japanese','日本語','ltr',1,60,'2026-06-26 11:21:53'),
(7,'zh','Chinese','中文','ltr',1,70,'2026-06-26 11:21:53'),
(8,'ar','Arabic','العربية','rtl',1,80,'2026-06-26 11:21:53'),
(9,'hi','Hindi','हिन्दी','ltr',1,90,'2026-06-26 11:21:53'),
(10,'ru','Russian','Русский','ltr',1,100,'2026-06-26 11:21:53');

-- ----------------------------------------------------------------------------
-- Table: voices (20 rows)
-- ----------------------------------------------------------------------------
INSERT INTO `voices` (`id`,`language_code`,`voice_key`,`display_name`,`gender`,`provider`,`provider_voice_id`,`is_enabled`,`sort_order`,`created_at`) VALUES
(1,'en','en_male_1','James (US Male)','male','mock','mock-en-male-1',1,10,'2026-06-26 11:21:53'),
(2,'en','en_female_1','Emma (US Female)','female','mock','mock-en-female-1',1,20,'2026-06-26 11:21:53'),
(3,'es','es_male_1','Diego (Male)','male','mock','mock-es-male-1',1,10,'2026-06-26 11:21:53'),
(4,'es','es_female_1','Sofia (Female)','female','mock','mock-es-female-1',1,20,'2026-06-26 11:21:53'),
(5,'fr','fr_male_1','Louis (Male)','male','mock','mock-fr-male-1',1,10,'2026-06-26 11:21:53'),
(6,'fr','fr_female_1','Camille (Female)','female','mock','mock-fr-female-1',1,20,'2026-06-26 11:21:53'),
(7,'de','de_male_1','Hans (Male)','male','mock','mock-de-male-1',1,10,'2026-06-26 11:21:53'),
(8,'de','de_female_1','Greta (Female)','female','mock','mock-de-female-1',1,20,'2026-06-26 11:21:53'),
(9,'pt','pt_male_1','Lucas (Male)','male','mock','mock-pt-male-1',1,10,'2026-06-26 11:21:53'),
(10,'pt','pt_female_1','Mariana (Female)','female','mock','mock-pt-female-1',1,20,'2026-06-26 11:21:53'),
(11,'ja','ja_male_1','Haruto (Male)','male','mock','mock-ja-male-1',1,10,'2026-06-26 11:21:53'),
(12,'ja','ja_female_1','Sakura (Female)','female','mock','mock-ja-female-1',1,20,'2026-06-26 11:21:53'),
(13,'zh','zh_male_1','Wei (Male)','male','mock','mock-zh-male-1',1,10,'2026-06-26 11:21:53'),
(14,'zh','zh_female_1','Mei (Female)','female','mock','mock-zh-female-1',1,20,'2026-06-26 11:21:53'),
(15,'ar','ar_male_1','Omar (Male)','male','mock','mock-ar-male-1',1,10,'2026-06-26 11:21:53'),
(16,'ar','ar_female_1','Layla (Female)','female','mock','mock-ar-female-1',1,20,'2026-06-26 11:21:53'),
(17,'hi','hi_male_1','Arjun (Male)','male','mock','mock-hi-male-1',1,10,'2026-06-26 11:21:53'),
(18,'hi','hi_female_1','Priya (Female)','female','mock','mock-hi-female-1',1,20,'2026-06-26 11:21:53'),
(19,'ru','ru_male_1','Ivan (Male)','male','mock','mock-ru-male-1',1,10,'2026-06-26 11:21:53'),
(20,'ru','ru_female_1','Anastasia (Female)','female','mock','mock-ru-female-1',1,20,'2026-06-26 11:21:53');

-- ----------------------------------------------------------------------------
-- Table: rooms (8 rows)
-- ----------------------------------------------------------------------------
INSERT INTO `rooms` (`id`,`room_code`,`name`,`host_id`,`guest_id`,`language_focus`,`topic`,`scheduled_start`,`max_participants`,`is_public`,`waiting_room_enabled`,`is_locked`,`status`,`started_at`,`ended_at`,`duration_seconds`,`duration_limit_min`,`save_transcript`,`created_at`) VALUES
(1,'Q44S7Y',NULL,2,NULL,NULL,'Práctica de idiomas',NULL,2,1,0,0,'ended',NULL,'2026-06-25 15:03:34',0,60,1,'2026-06-25 14:55:38'),
(2,'F9FA52',NULL,2,NULL,NULL,'Práctica de idiomas',NULL,2,1,0,0,'ended',NULL,'2026-06-25 15:15:33',0,60,1,'2026-06-25 15:13:56'),
(3,'ETNEDA',NULL,2,NULL,NULL,'Invitación directa',NULL,2,1,0,0,'ended',NULL,'2026-06-25 15:15:51',0,60,1,'2026-06-25 15:15:43'),
(4,'NFWZ25',NULL,2,NULL,NULL,'Invitación directa',NULL,2,1,0,0,'ended',NULL,'2026-06-25 17:29:52',0,60,1,'2026-06-25 17:29:07'),
(5,'QY5BPD',NULL,3,2,NULL,'Invitación directa',NULL,2,1,0,0,'ended','2026-06-25 17:30:18','2026-06-25 17:34:16',238,60,1,'2026-06-25 17:29:38'),
(6,'WYAEUJ',NULL,2,NULL,NULL,'Invitación directa',NULL,2,1,0,0,'ended',NULL,'2026-06-26 15:32:40',0,60,1,'2026-06-25 17:34:01'),
(9,'cdv-xcbw-fni',NULL,2,NULL,NULL,'Invitación directa',NULL,2,1,0,0,'ended',NULL,'2026-06-26 15:27:29',0,NULL,1,'2026-06-26 15:25:41'),
(10,'mfe-iokc-wpr',NULL,2,5,NULL,'Invitación directa',NULL,2,1,0,0,'active','2026-06-26 15:55:03',NULL,0,NULL,1,'2026-06-26 15:54:28');

-- ----------------------------------------------------------------------------
-- Table: messages (18 rows)
-- ----------------------------------------------------------------------------
INSERT INTO `messages` (`id`,`room_id`,`user_id`,`content`,`source_lang`,`target_lang`,`translated_content`,`created_at`) VALUES
(1,1,2,'hola',NULL,NULL,NULL,'2026-06-25 14:59:28'),
(2,2,2,'HOLA','es','en',NULL,'2026-06-25 15:14:03'),
(3,5,2,'hola','es','en',NULL,'2026-06-25 17:30:54'),
(4,5,3,'que haces?','en','es','SABES,ERES UN INMADURO E IGNORANTE.CON LA SOGA QUE PREPARA PARA AHORCAR A OTRO,RESULTA QUE CON ELLA MISMA TE AHORCAS.ERES UN MENTIROSO COMPULSIVO Y TE DELATA TU SOLITO.SIEMPRE TUVE PRESENTE LO QUE ME DECIAN DE TU PERSONA PERO NO LO QUISE CREER,PERO EN ESTE MOMENTO ES DIFICIL DUDARLO PORQUE TUVE TIEMPO DEMAS PARA COMPROBAR LA VERDAD.NO ERES PERSONA DE ASUMIR TUS ERRORES SOLO SABES EVADIR Y SALIR CORRIENDO.','2026-06-25 17:31:26'),
(5,5,2,'todo bien','es','en','Everything is good','2026-06-25 17:32:40'),
(6,5,3,'what do You doing?','en','es','¿Qué te apetece hacer?','2026-06-25 17:33:20'),
(7,9,2,'hello','Spanish','English',NULL,'2026-06-26 15:26:26'),
(8,9,2,'hello','Spanish','es',NULL,'2026-06-26 15:26:49'),
(9,9,2,'whats you name?','en','es',NULL,'2026-06-26 15:27:08'),
(10,6,2,'hola','es','English',NULL,'2026-06-26 15:32:29'),
(11,10,5,'hola','es',NULL,NULL,'2026-06-26 15:55:21'),
(12,10,2,'hello','en',NULL,NULL,'2026-06-26 15:55:34'),
(13,10,5,'como te llamas?','es',NULL,NULL,'2026-06-26 15:55:43'),
(14,10,2,'my name us fede2','en',NULL,NULL,'2026-06-26 15:56:02'),
(15,10,2,'al rights','en',NULL,NULL,'2026-06-26 15:56:41'),
(16,10,2,'write your name','en',NULL,NULL,'2026-06-26 15:56:58'),
(17,10,2,'write your name','en',NULL,NULL,'2026-06-26 15:57:10'),
(18,10,5,'todo bien?','en',NULL,NULL,'2026-06-26 15:57:57');

-- ----------------------------------------------------------------------------
-- Table: session_history (11 rows)
-- ----------------------------------------------------------------------------
INSERT INTO `session_history` (`id`,`room_id`,`user_id`,`partner_id`,`duration_seconds`,`rating`,`notes`,`created_at`) VALUES
(1,1,2,NULL,0,NULL,NULL,'2026-06-25 15:03:00'),
(2,1,2,NULL,0,NULL,NULL,'2026-06-25 15:03:34'),
(3,2,2,NULL,0,NULL,NULL,'2026-06-25 15:15:33'),
(4,3,2,NULL,0,NULL,NULL,'2026-06-25 15:15:51'),
(5,4,2,NULL,0,NULL,NULL,'2026-06-25 17:29:52'),
(6,5,3,2,212,NULL,NULL,'2026-06-25 17:33:50'),
(7,5,2,3,212,NULL,NULL,'2026-06-25 17:33:50'),
(8,5,3,2,238,NULL,NULL,'2026-06-25 17:34:16'),
(9,5,2,3,238,NULL,NULL,'2026-06-25 17:34:16'),
(10,9,2,NULL,0,NULL,NULL,'2026-06-26 15:27:29'),
(11,6,2,NULL,0,NULL,NULL,'2026-06-26 15:32:40');

-- ----------------------------------------------------------------------------
-- Table: transcript_segments (1 row)
-- ----------------------------------------------------------------------------
INSERT INTO `transcript_segments` (`id`,`meeting_id`,`speaker_participant_id`,`speaker_user_id`,`source_language`,`original_text`,`translations`,`audio_duration_ms`,`start_ms`,`end_ms`,`confidence`,`created_at`) VALUES
(2,10,NULL,2,'es','Hola a todos, bienvenidos a la reunión.','{"en":{"text":"Hello everyone, welcome to the meeting.","audioUrl":"/mock-audio/en/test.mp3"},"fr":{"text":"Bonjour à tous, bienvenue à la réunion.","audioUrl":"/mock-audio/fr/test.mp3"}}',2400,1700000000000,1700000002400,0.927,'2026-06-26 16:01:47');

-- ----------------------------------------------------------------------------
-- Table: translation_logs (1 row)
-- ----------------------------------------------------------------------------
INSERT INTO `translation_logs` (`id`,`room_id`,`user_id`,`source_lang`,`target_lang`,`stt_latency_ms`,`mt_latency_ms`,`tts_latency_ms`,`total_latency_ms`,`char_count`,`created_at`) VALUES
(1,NULL,NULL,'en','es',200,150,300,650,45,'2026-06-20 14:37:06');

-- ----------------------------------------------------------------------------
-- Empty tables (kept for reference — no data to insert):
--   admin_audit_logs, feedback_ratings, meeting_invitations,
--   meeting_participants, password_resets, reports, translation_sessions
-- ----------------------------------------------------------------------------

SET FOREIGN_KEY_CHECKS=1;

-- End of dump
