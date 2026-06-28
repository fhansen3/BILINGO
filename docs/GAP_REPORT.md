# BiLingo Meet — Gap Report

_Audit date: step 2 of plan_

This report enumerates what is currently present in the codebase vs what the design specifies, and flags what is missing. It is the input for the remaining alignment steps.

---

## 1. Inventory snapshot

### 1.1 Backend files (present)
- `server.js` — Express + Socket.IO bootstrap, SPA fallback, healthz, JSON, cookie-parser, static.
- `config/db.js`, `config/env.js`
- `routes/` — `index.js`, `auth.routes.js`, `users.routes.js`, `rooms.routes.js`, `admin.routes.js`
- `controllers/` — `auth`, `users`, `rooms`, `admin`
- `services/` — `auth`, `users`, `rooms`, `admin`
- `middleware/` — `auth.js` (requireAuth, requireRole), `errors.js`
- `sockets/index.js` — JWT-auth handshake, room:join, lang:update, WebRTC signaling (offer/answer/ice), chat:send (per-recipient translation), media:state, room:leave, disconnect/presence
- `utils/` — `code.js`, `hash.js`, `jwt.js`, `translate.js` (MyMemory-backed)
- `db/schema.sql`, `db/seed-admin.js`

### 1.2 Frontend files (present)
- `public/index.html` — SPA shell, loads Bootstrap 5 + FontAwesome + Nunito + Socket.IO + all view scripts.
- `public/css/style.css`, `public/css/components.css`
- `public/js/app.js`, `public/js/router.js` (hash-based), `public/js/api.js`, `public/js/auth.js`, `public/js/ui.js`
- `public/js/views/` — `landing.js`, `login.js`, `register.js`, `dashboard.js`, `profile.js`, `partners.js`, `room.js`, `admin.js`

### 1.3 Live MySQL tables (`p184_project1`)
`users`, `rooms`, `messages`, `session_history`, `reports`.

---

## 2. Concept blocks → routes/views coverage

| Concept block | Backend route(s) | Frontend view | Status |
|---|---|---|---|
| Landing / marketing | (static SPA) | `views/landing.js` | ✅ present |
| Register | `POST /api/auth/register` | `views/register.js` | ✅ present |
| Login | `POST /api/auth/login` | `views/login.js` | ✅ present |
| Session (me / logout) | `GET /api/auth/me`, `POST /api/auth/logout` | `auth.js` client | ✅ present |
| Dashboard | (uses rooms/users/me) | `views/dashboard.js` | ✅ present |
| Profile (self edit) | `PUT /api/users/me` | `views/profile.js` | ✅ present |
| Public profile | `GET /api/users/:id` | (consumed by partners view) | ✅ present |
| Partner discovery | `GET /api/users/partners` | `views/partners.js` | ✅ present |
| Create room | `POST /api/rooms` | dashboard form | ✅ present |
| Join room by code | `POST /api/rooms/:code/join` + `GET /api/rooms/:code` | `views/room.js` | ✅ present |
| Active room (video+chat+translation) | sockets `room:join`, `chat:send`, `webrtc:*`, `lang:update`, `media:state` | `views/room.js` | ✅ present |
| End room | `POST /api/rooms/:id/end` | leave button in room view | ✅ present |
| Room messages history | `GET /api/rooms/:id/messages` | room view (on load) | ✅ present |
| My rooms history | `GET /api/rooms/mine` | dashboard | ✅ present |
| Report user/room | `POST /api/admin/reports` | TBD (see gaps) | ⚠️ backend only |
| Admin stats | `GET /api/admin/stats` | `views/admin.js` | ✅ present |
| Admin user management | `GET /api/admin/users`, `PUT /api/admin/users/:id/status` | `views/admin.js` | ✅ present |
| Admin room list | `GET /api/admin/rooms` | `views/admin.js` | ✅ present |
| Admin reports | `GET /api/admin/reports`, `PUT /api/admin/reports/:id` | `views/admin.js` | ✅ present |

---

## 3. Data objects → MySQL tables coverage

| Data object | Table | Status | Notes |
|---|---|---|---|
| User profile | `users` | ✅ | All design fields present: email, password_hash, display_name, bio, avatar_color, native_language, learning_language, proficiency_level, country, role, status, is_online, last_seen, created_at. |
| Room | `rooms` | ✅ | room_code, host_id, guest_id, language_focus, topic, max_participants, is_public, status (`waiting/open/active/ended/closed`), started_at, ended_at, duration_seconds. |
| Chat message | `messages` | ✅ | room_id, user_id, content, **source_lang, target_lang, translated_content**, created_at. The translation columns exist in the live DB but are **not reflected in `db/schema.sql`** — see Gap 4.1. |
| Session history | `session_history` | ✅ | room_id, user_id, partner_id, duration_seconds, rating, notes, created_at. |
| Report | `reports` | ✅ | reporter_id, reported_user_id, room_id, reason, details, status, created_at, reviewed_at. |

All 5 expected tables are LIVE.

---

## 4. Gaps to close in subsequent steps

### 4.1 Schema file vs live DB drift (high priority)
- `db/schema.sql` still defines `messages` with only `(id, room_id, user_id, content, created_at)` — **missing `source_lang`, `target_lang`, `translated_content`** that the live DB and code (`rooms.service.addMessage`, `sockets/index.js chat:send`) already use.
- Action: update `db/schema.sql` so a clean install matches the live DB. Optionally add an `idx_messages_created_at` to support history pagination.

### 4.2 Reporting flow has backend, no UI entry point
- `POST /api/admin/reports` exists; admin can list/resolve.
- No "Report user" button is visible to regular users in the room sidebar or partner profile.
- Action: add a "Report" affordance in `views/room.js` (per-participant) and/or in the partner profile modal that hits `/api/admin/reports`.

### 4.3 Room status enum & lifecycle nuance
- DB enum is `waiting/open/active/ended/closed` but the code only ever sets `waiting → active → ended`. `open` and `closed` are dead values today.
- Pragmatic deviation: keep the enum (no breaking change, no data) but document in the audit that the active set is `{waiting, active, ended}`. If the design later requires `open` (= public waiting room visible in a lobby), we'll wire it then.

### 4.4 Socket.IO transport hard-coded to polling
- `views/room.js` forces `transports: ['polling'], upgrade: false`. Real-time signaling will still work but with higher latency.
- Action (later step): allow websocket upgrade once the runtime/proxy is confirmed to support it. Not blocking.

### 4.5 No public room discovery / lobby
- `rooms.is_public` exists, but there is no `GET /api/rooms/public` or lobby UI. The "join by code" flow is the only entry.
- Action: optional — only build if the design block calls for a public lobby. Defer until confirmed.

### 4.6 No video/audio device picker
- `getUserMedia` is called with defaults; no device selector in the pre-join screen or sidebar.
- Action: optional polish, not in the critical path.

### 4.7 No room scheduling / invite emails / calendar links
- The design (landing copy) markets "salas con un clic" — explicitly NOT scheduling. Confirmed out of scope.

### 4.8 `session_history.rating` / `notes` never written
- The columns exist but `endRoom` only writes duration. There is no post-call rating UI.
- Action: optional — add a "Rate your partner" modal after `leaveRoom()` if the design block requires it. Defer unless requested.

### 4.9 No `idx_messages_created_at`
- Chat history ordering uses `ORDER BY created_at ASC` and is unbounded per room. Add the index when convenient.

### 4.10 No seed users for partner discovery demo
- Only an admin is seeded (`db/seed-admin.js`). Empty users list = empty partners view. Consider seeding a few demo learners so the partner discovery view isn't empty on a fresh install.

---

## 5. Summary

The codebase already covers the design's **happy path** end-to-end: register → login → dashboard → create/join room → WebRTC video + translated chat → end → history → admin moderation. The main alignment work is:

1. **Sync `db/schema.sql`** with the live `messages` table (translation columns). — _drift fix_
2. **Add a user-facing "Report" entry point** in the room view. — _missing UI for an existing API_
3. **Decide whether to support a public room lobby and post-call rating UI.** — _scope confirmation_

Everything else is polish (websocket upgrade, device picker, seed users, history index).---

## STEP 17 — Navigation, role-based visibility & business rules

This step closed the design's audit gaps for nav, role-based visibility and business rules. Concretely:

### Schema additions
- `users.plan ENUM('free','pro') NOT NULL DEFAULT 'free'` — drives free-tier limits.
- `rooms.duration_limit_min SMALLINT UNSIGNED NULL` — host's enforced cap (NULL = unlimited).
- `rooms.save_transcript TINYINT(1) NOT NULL DEFAULT 1` — host's transcript-retention choice.

Existing free-tier rooms were back-filled with `duration_limit_min = 60`.

### Rules implemented

| Rule | Where enforced |
|---|---|
| `rule_languages_required` | `services/rooms.service.js#joinRoom` (legacy API) — throws 400 with `code: LANGUAGES_REQUIRED` if the joining user has no `native_language` or `learning_language`. The lobby form (`POST /m/:code/join`) already validates both fields. |
| `rule_delay_cap` (≤ 5000ms) | `routes/meetings.js#clampDelay` — `DELAY_CAP_MS = 5000`. Applied on settings save and per-remote listening-prefs save. |
| `rule_host_only_actions` | `routes/meetings.js#requireHost` — returns 403 for non-host & non-admin on every `/m/:code/host/*` route. |
| `rule_free_tier_limits` | • `createInstant` and `POST /schedule` cap `duration_limit_min` at 60 for `plan='free'` hosts. • In-room view (`in_meeting_room.ejs`) shows a 5-minute "ending soon" warning and auto-leaves at the cap via the existing leave POST. |
| `rule_transcript_retention` | • `meeting_ended.ejs` & `past_meeting_detail.ejs` hide the .txt/.json download buttons when `save_transcript=0`. • `routes/meetings.js#authoriseTranscript` returns 403 to non-admins when `save_transcript=0`. |
| `rule_transcript_privacy` | `authoriseTranscript` returns `{ redact: true }` for admin viewers who weren't participants (and also when the host disabled saving). Both transcript downloads and `past_meeting_detail.ejs` honor `redact`, stripping `originalText` + `translations` while keeping metadata (who, when, language codes, char-count). |

### Nav / role visibility
- `views/partials/main-sidebar.ejs` — the **Administración** link was already wrapped in `<% if (user && user.role === 'admin') { %>`. ✓ Confirmed.
- `views/in_meeting_room.ejs` — the **Anfitrión** (host controls) button was already wrapped in `<% if (isHost) { %>`. ✓ Confirmed.
- Session `user` now carries `plan` (added in `routes/auth.js#publicUser` and `routes/app.js#refreshSessionUser`) so plan-conditional UI works app-wide.

### Pragmatic deviations
- **Schedule form duration cap.** Free-tier users see the `<select>` disabled and locked to 60 min. The server *also* hard-caps the value server-side regardless of what was posted, so a tampered request can't bypass it.
- **Per-remote listener prefs.** The previously-documented schema deviation (no `participant_listening_prefs` table) still stands — we accept the POST and only persist when the listener targets their own participant row. The DELAY_CAP_MS clamp still applies.