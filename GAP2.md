# BiLingo Meet — Gap Report 2 (post-step-19 audit)

_Audit date: follow-up plan, step 1._
_Auditor scope: every block / dataObject / flow / rule in the design vs the current code on disk and the live `p184_project1` schema._

The previous `docs/GAP_REPORT.md` was written when the project was still an SPA wrapping a single `rooms` table. Since then ~19 steps landed: server-rendered EJS views for all 24 designed pages, `meeting_participants` / `meeting_invitations` / `transcript_segments` / `translation_sessions` / `translation_logs` / `feedback_ratings` / `languages` / `voices` / `password_resets` / `admin_audit_logs` tables, the host control routes, the translation pipeline stub, and the lobby → waiting-room → in-meeting → ended flow.

This report enumerates what is **still missing or weak** at the time of this re-audit, ordered by severity and grouped by area. Every item names a concrete file path or table.

---

## 🔥 P0 — broken / dead-end behaviour the user can see

### 1. In-meeting captions UI is wired in the DOM but never fed
- `views/in_meeting_room.ejs` (lines 423–740): renders a `.bm-tile-caption` div per tile with `[data-role=cap-translated]` / `[data-role=cap-original]` placeholders, and a captions toggle button `#bm-btn-cap`. Toggling just sets `.show`.
- The socket handlers in the same file (`socket.on(...)`) cover only `room:joined`, `peer:joined`, `peer:left`, `media:state`, `chat:message`. **There is no `socket.on('speak:translated', …)` and no `socket.on('speak:transcribed', …)`**, which are the events `sockets/index.js` (lines 241–273) actually emits.
- Net effect: the pipeline runs (and inserts `transcript_segments` / `translation_sessions` rows) but no caption ever appears on screen. Fix: add `speak:translated` / `speak:transcribed` handlers that locate the speaker tile by `socketId`/`userId` and update `[data-role=cap-translated]` + `[data-role=cap-original]`, plus latency badges.

### 2. Host actions emit socket events that no client listens for
- `routes/meetings.js` `emitToRoom(...)` fires:
  - `host:mute`, `host:mute-all`
  - `host:remove`
  - `host:lock`, `host:waiting-room`
  - `host:admit`, `host:deny`
  - `host:end`
- `views/in_meeting_room.ejs` only has handlers for `room:*` / `peer:*` / `media:state` / `chat:message`. **None of the `host:*` events trigger any UI update**.
- Net effect: admit/deny/mute/end all "work" in the DB and the server log, but the affected participant's browser doesn't react until they refresh or the next HTTP poll. Specifically:
  - On `host:end`, ongoing clients should be redirected to `/m/:code/ended`.
  - On `host:remove`, the affected user should be force-redirected.
  - On `host:mute` / `host:mute-all`, the affected user's mic indicator should flip and getUserMedia audio track should mute.
  - On `host:admit`, the waiting-room page should fast-path instead of polling every 3s.

### 3. Waiting room admit is HTTP-polled (3s cadence) instead of socket-pushed
- `views/waiting_room.ejs` (lines 38–70) polls `/api/m/:code/admit-status?pid=…` every 3s.
- `routes/meetings.js#admit` (line 1657) DOES emit `host:admit` over Socket.IO, but the waiting room doesn't connect to Socket.IO at all.
- Fix: join `room:<roomId>` from the waiting page (the JWT cookie is present) and listen for `host:admit` / `host:deny` for **this specific participant id**, falling back to the existing poll. Also `waiting_room.ejs` currently shows no live count of "you are #N in line" — the design's `waiting_room` block does.

### 4. `media:mute` / `media:camera` / `hand:raise` have no server-side handler
- `views/in_meeting_room.ejs` (lines 566, 572, 582) emits these on every button press.
- `sockets/index.js` only handles `media:state` (line 284). The three new events are silently dropped — other participants never see the mute/camera/hand state.
- Fix in `sockets/index.js`: either rename the client events to `media:state` (carrying `{audio, video, screen, handRaised}`) or add server handlers that broadcast to `room:<roomId>`.

### 5. `translation_logs` table exists but is never written
- Live schema (verified): `translation_logs(id, room_id, user_id, source_lang, target_lang, stt_latency_ms, mt_latency_ms, tts_latency_ms, total_latency_ms, char_count, created_at)`.
- `services/translationPipeline.js#processSegment` writes to `transcript_segments` + `translation_sessions` but never `translation_logs`.
- The design's "telemetry per translation" lives in `translation_logs`. The admin usage page (`/admin/usage`) likely reads from it (need to verify in step 2+).
- Fix: in `processSegment`, after each MT, INSERT a row into `translation_logs` capturing the three latencies + char_count.

---

## ⚠️ P1 — design fields the schema doesn't enforce / persist

### 6. Mute state is not persisted on `meeting_participants`
- `DESCRIBE meeting_participants` has no `is_muted`, no `is_hand_raised`, no `is_camera_off`. So the host's "mute all" lasts exactly as long as the socket connection — on reconnect the participant comes back un-muted.
- Fix: `ALTER TABLE meeting_participants ADD is_muted TINYINT(1) NOT NULL DEFAULT 0, ADD is_hand_raised TINYINT(1) NOT NULL DEFAULT 0, ADD is_camera_off TINYINT(1) NOT NULL DEFAULT 0;`
- `routes/meetings.js#host/mute/:pid` and the `host:end`/`host:remove` paths should update these.

### 7. `meeting_participants.captions_enabled` only ever reflects host's setting
- The lobby form lets the joiner pick captions on/off. The settings drawer also writes captions_enabled. Good.
- BUT: the host's captions choice has no link to other participants. Captions toggle is per-user and is correctly per-participant — confirmed OK. No action.

### 8. Per-remote listening preferences acknowledged but never persisted
- `routes/meetings.js#listening-prefs` (lines 848–917) documents the deviation: target=self persists, target=remote returns ok:true with `persisted:false`.
- The accompanying socket broadcast (`listener:prefs` in the doc-comment, line 844) is **NOT actually emitted** — `grep` returns 0 hits. So the deviation is currently a no-op for remote targets.
- Either: (a) add the `listener:prefs` emit, OR (b) create the `participant_listening_prefs(listener_id, remote_id, …)` table and persist properly. (b) is cleaner; the table is small.

### 9. Feedback ratings — `audio_quality` semantics OK, but `partner_helpfulness` from design is missing
- Design's `feedback_ratings` block includes a partner-specific rating; live table only has `translation_quality`, `audio_quality`, `comments`.
- The `meeting_ended.ejs` form drives this — needs to be verified in step 2+. If the design block calls for `partner_helpfulness`, ADD COLUMN.

### 10. `users.preferred_voice_gender` / `users.delivery_mode` defaults — not on `users`
- The lobby asks for speaking + listening voice + delivery_mode every time. Designed default-on-user means a returning user should pre-fill these from their profile.
- Live `users` table has none of these. The lobby always shows blank gender selects.
- Fix: ALTER users ADD speaking_voice_gender, listening_voice_gender, delivery_mode_default; pre-fill from there in `pre_join_lobby.ejs` GET.

---

## ⚠️ P1 — `db/schema.sql` is severely out of date

`db/schema.sql` (180 lines) only covers `users`, `rooms`, `messages`, `session_history`, `reports`, `languages`, `voices`, `admin_audit_logs`, and a tail-pasted `feedback_ratings` block. The live DB has 15 tables. The file omits:

- `meeting_participants` (20 columns including all voice / volume / delay columns)
- `meeting_invitations`
- `password_resets`
- `transcript_segments`
- `translation_sessions`
- `translation_logs`

…and the `rooms` table in `db/schema.sql` doesn't have `scheduled_start`, `waiting_room_enabled`, `is_locked`, `duration_limit_min`, `save_transcript`. The `users` table doesn't have `plan`.

A fresh install via `mysql < db/schema.sql` would boot a server that crashes the moment anyone visits `/schedule` or hits the lobby. `migrations/001_schema.sql` is similarly outdated (the docblock claims it's authoritative but `DESCRIBE` proves otherwise).

**Fix**: re-derive both files from the live `DESCRIBE` of every table. This is the single most dangerous gap for a clean-environment redeploy.

---

## 🟡 P2 — flows that are missing entry points or feel incomplete

### 11. No user-facing "Report participant / report meeting" entry point
- `POST /api/admin/reports` (or wherever it's mounted) exists; the admin can list/resolve at `/admin` views.
- `views/in_meeting_room.ejs` and `views/past_meeting_detail.ejs` have **no Report button**. Design's `flow_report_user` is unreachable from the live UI.
- Fix: add a "Report" item in the participants panel (`#bm-participants-list` row) that POSTs to the existing reports endpoint.

### 12. No public-meetings discovery despite `rooms.is_public` column
- `rooms.is_public TINYINT(1) DEFAULT 1` is set on every row but there is no `GET /rooms/public` or any page that lists them.
- If the design specifies a "browse public meetings" affordance, it's missing. If not, drop the column to avoid confusion.

### 13. Schedule flow has no invitation acceptance / response page
- `meeting_invitations` rows are created with a random 64-hex token, but there is no `GET /invite/:token` route. The token is dead.
- Fix: add `GET /invite/:token` that auto-redirects to the lobby with the invitee's name pre-filled, and `POST /invite/:token/decline` that marks `status='declined'`.

### 14. `meeting_ended.ejs` feedback form drops silently if user already submitted
- `routes/meetings.js#/m/:code/feedback` allows multiple submissions (no `ON DUPLICATE KEY`). The view checks `alreadySubmitted` and just hides the form — fine, but the DB has no unique constraint guarding against a manual re-POST.
- Fix: `ALTER TABLE feedback_ratings ADD UNIQUE KEY uq_feedback_room_user (room_id, user_id);` and turn the INSERT into `INSERT … ON DUPLICATE KEY UPDATE`.

### 15. Transcript downloads work but the host-toggle to disable saving is not adjustable mid-meeting
- `rooms.save_transcript` is set at create time (instant=1, schedule=form value). The host has no in-room toggle to flip it on/off, even though the design's `host_controls` block lists transcript settings.
- Fix: add a `<form>` block in `views/host_controls.ejs` that POSTs to `/m/:code/host/save-transcript` and toggle `rooms.save_transcript`. Route does not exist yet.

### 16. `pre_join_lobby.ejs` doesn't surface a device picker
- `getUserMedia` is called with defaults; no `<select>` for microphone / camera / speakers. Design's lobby block lists explicit device pickers.
- Fix: enumerate `navigator.mediaDevices.enumerateDevices()` and render three selects, persist choice in `localStorage` (not in the DB).

### 17. Free-tier 5-minute warning fires but the "upgrade to Pro" CTA is missing
- The warning banner in `in_meeting_room.ejs` (line 50) just shows time remaining. Design copy on `landing.ejs` markets Pro; the warning should include a link to `/upgrade` or `/pricing`. Neither route exists.
- Fix: either render a `/pricing` page or remove the upgrade copy from `landing.ejs`.

---

## 🟡 P2 — admin coverage gaps

`routes/admin.js` covers stats, users (suspend/activate/role), languages (CRUD + toggle), voices (CRUD + toggle), usage. Missing vs design:

### 18. No admin "rooms / meetings" page
- The legacy SPA had `GET /api/admin/rooms`. The EJS admin nav (`partials/admin-subnav.ejs`) needs verification — likely no link.
- Fix: add `GET /admin/meetings` listing active + ended rooms with end-meeting button.

### 19. No admin "reports queue" page in the new EJS shell
- `partials/admin-subnav.ejs` likely lacks a Reports link, even though the API and the DB still support it.
- Fix: add `GET /admin/reports` page + actions.

### 20. `admin_audit_logs` never written
- Schema exists; no INSERT anywhere in `routes/admin.js`. Every admin action (suspend, role change, language toggle) should write one row.
- Fix: wrap each admin POST in a helper that logs to `admin_audit_logs`.

---

## 🟢 P3 — polish / hardening

### 21. Socket transport forced to polling
- `views/in_meeting_room.ejs` line 632 and `public/js/views/room.js` line 191 both force `transports: ['polling'], upgrade: false`.
- This was the safe choice while the reverse proxy was unverified. Re-test websocket upgrade now.

### 22. `users.is_online` set on socket connect but cleared on every disconnect
- `sockets/index.js` lines 41–43 + 301–311 do this correctly, but multiple tabs of the same user race the UPDATE. Use a per-socket counter or a `user_sessions` table for proper presence.

### 23. `rooms.status` enum still includes `open` and `closed` which are never assigned
- Carry-over from the original audit; defer unless design forces them.

### 24. No `INDEX` on `messages(created_at, room_id)` for transcript pagination
- Existing index is `idx_messages_created_at` only. Transcripts ORDER BY created_at WHERE room_id=? — a composite would be cheaper at scale.

### 25. `processSegment` calls the real MyMemory translator (HTTP) in a tight loop per listener language
- If a 5-person meeting has 4 unique target languages, every spoken segment triggers 4 outbound HTTP requests. No timeout, no cache. Will be the first thing to fail under any latency spike.
- Fix: add a small per-process LRU cache keyed by `(source, target, sha1(text))`, plus a 1500ms timeout in `utils/translate.js`.

### 26. No `helmet` / CSRF / rate-limit middleware anywhere
- Auth POSTs are unprotected against CSRF (cookie-session does NOT protect against this for HTML forms). The signup endpoint has no rate limit.
- Fix: add `csurf` or a simple token field on every state-changing form; rate-limit `/login`, `/signup`, `/api/m/*/admit-status` in particular.

### 27. `views/landing.ejs` markets features (40+ languages, AI summaries) that don't exist
- Either ship them or trim the copy. Currently the seeded `languages` table has only the small set added by `routes/admin.js` POSTs.

---

## Summary table

| # | Area | Severity | One-line fix |
|---|---|---|---|
| 1 | Sockets / captions | P0 | Wire `speak:translated` → `.bm-tile-caption` |
| 2 | Sockets / host actions | P0 | Add `host:*` listeners in `in_meeting_room.ejs` |
| 3 | Sockets / waiting room | P0 | Connect socket in `waiting_room.ejs`, listen for `host:admit` |
| 4 | Sockets / media state | P0 | Add server handlers for `media:mute`/`media:camera`/`hand:raise` |
| 5 | Translation pipeline | P0 | Write `translation_logs` row per delivery |
| 6 | Schema / persistence | P1 | Add `is_muted`, `is_hand_raised`, `is_camera_off` to `meeting_participants` |
| 7 | Per-remote prefs | P1 | Either persist properly or emit `listener:prefs` |
| 8 | Schema file drift | P1 | Regenerate `db/schema.sql` + `migrations/001_schema.sql` from live DB |
| 9 | User defaults | P1 | Persist preferred voice/delivery on `users`, pre-fill lobby |
| 10 | Reports UX | P2 | Add Report button in participants panel |
| 11 | Invitations | P2 | Add `GET /invite/:token` route |
| 12 | Feedback uniqueness | P2 | UNIQUE(room_id, user_id) + upsert |
| 13 | Host transcript toggle | P2 | Add in-meeting toggle |
| 14 | Device picker | P2 | Enumerate devices in lobby |
| 15 | Pricing page | P2 | Create `/pricing` or trim landing copy |
| 16 | Admin meetings/reports | P2 | Add `/admin/meetings`, `/admin/reports` EJS pages |
| 17 | Admin audit log | P2 | Insert on every admin action |
| 18 | Socket transport | P3 | Allow websocket upgrade |
| 19 | Translator caching | P3 | LRU + timeout on `utils/translate.js` |
| 20 | CSRF / rate-limit | P3 | Add `csurf` + per-route limiter |

**Total open items: 27** (5 × P0, 6 × P1, 9 × P2, 7 × P3).

The remaining steps in this plan should pick off P0 items first (steps 2–4 of the new plan), then P1 schema/persistence (steps 5–6), then P2 missing flows (steps 7+), reserving P3 polish for the final hardening pass and the end-to-end browser smoke (final step).