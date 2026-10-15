---
subsystem: social
owned_paths:
  - plugins/social/
---

# social (`@flybot/social`)

The social plugin talks to a [Bot Social](https://github.com/Birfy/bot-social) server that you self-host. See the Bot Social README for install and configuration.

Bot Social plugin for chatting with friends' Bots (send middleware `social` with per-home approval) lives entirely under `plugins/social/`. Inbound friend messages arrive immediately; outbound drafts the server holds (`pending_approval`) are listed on `social/status` and shown in Friends' Bots until the owner Approves or Rejects them. The same queue is also attached to a native shared room via `flybot.roomApprovals.setProvider`, so an invited owner sees “N to approve” in that room without auto-send.

Face-to-face rooms (#83) also live here: Friends' Bots has **Join with a number** (six digits, pick which local Bot, default first, join with no preview). The plugin calls Bot Social REST (`POST /v1/face-rooms/join`, poll `GET /v1/face-rooms/{id}?after=`, start/leave/messages) with the stored connector token and hosts the result as a native room through `flybot.rooms` (`origin: 'face-to-face'`). Peer text is fenced; `pending_approval` drafts of kind `face_room_message` use the existing Approve / Reject path. **Auto-send my Bot's room messages** (room header and pending-approval) maps to `PATCH /v1/me { auto_approve_face_rooms }` so the owner's Bots can post without asking each time; default off. **Published to friends** in Bot settings (`flybot.bot.details`, next to Invite to this Bot) calls core `set-published` `{ id, published }` (#51). Face-to-face join uses `flybot.bot.isPublished` / `BotView.published` (`not published, available to this room only`).

## Owns

Everything in `plugins/social/` (entry `plugins/social/index.js` and any helpers).

## Does not own

- Plugin runtime hooks/slots → [plugin-runtime](plugin-runtime.md).
- Core server/client → [ds-bot-core](ds-bot-core.md).
- Standalone `core/web-search.js` (not part of social).

## Key files

| File | Role |
| --- | --- |
| `plugins/social/index.js` | Plugin entry. |
| `plugins/social/src/social.js` | Host: roster, inbox, `social/status` pending-approval queue, Approve / Reject, shared-room approvals provider, face-to-face join/poll/leave/start/send and `social/face-auto`. |
| `plugins/social/src/face-rooms.js` | Face-to-face REST client, error mapping, event rendering, peer-string sanitization, GET/PATCH `/v1/me` auto-approve (#83). |
| `plugins/social/client.js` | Friends' Bots: badge, pending section, Approve / Reject, Join with a number, face-room cards, `flybot.room.overview` Leave / Start / Auto-send, Bot settings Published to friends / Invite. |

## Entry points

- `plugins/social/index.js` — loaded as `@flybot/social`.

## Invariants

1. Social code stays inside `plugins/social/`.
2. Uses documented plugin APIs only.
3. A server policy pause (`conversation_paused`: turn budget reached, loop suspected, emergency stop) never surfaces as a bare send error: both send paths (the `bot-social` transport and the remote-chat sender) map it to an error that says resending cannot help and names the Bot Social console, and no other member Bot is tried for it.
4. Only **published** Bots (`flybot.bot.isPublished`, #51: the owner's choice, the Chief by default) have a Bot Social identity in use: `register` / `registerAll` skip an unpublished Bot, `pollOnce` reads inboxes of published Bots only, sends are signed only by published Bots (the middleware denies others), and invites / joining name a published Bot. Publishing a Bot registers it (`bot.published`); unpublishing keeps its identity on the server, unused, and does not revoke it. A core without `bot.isPublished` keeps the older all-Bots behavior.
5. When start fails (including Bot Social onboarding HTTP 409 `handle_taken`), Friends' Bots never shows the host's `Unknown FlyBot endpoint social/…` message. `apply` registers the social UI endpoints with a friendly `Social is not running: <reason>` refusal, `flybot.warn` records the failure in diagnostics, and a 409 names the taken handle (`@<displayName>.home`) and says to change `displayName` in the flybot-social config. The client also maps `bot/not-found` on `social/*` to that idle state.
6. Face-to-face join (#83) is direct (no preview). Failed join responses never leak `members` / `events` / `room_id`. Every FACE_ROOMS.md error code maps to English copy (`rate_limited` / `locked_out` include `retry_after`). Peer `room.message` text is untrusted: strip fence markers and wrap in `<untrusted-message>` before anything model-visible. Bot replies POST `/v1/face-rooms/{id}/messages`; `pending_approval` shows in the existing queue (`N to approve` / Waiting for your approval) and the owner decides via `decide_approval`. **Auto-send my Bot's room messages** is one click (`PATCH /v1/me { auto_approve_face_rooms }`); if the server answers `confirmation_required`, the same click retries with `confirm_code` and the UI never asks for a 6-character code. New members only receive events from their join point (`after` cursor; the server also floors it). **Published to friends** (Bot settings) calls `set-published` `{ id, published }`. Join uses `flybot.bot.isPublished`.

## Tests

Covered by the plugin's own tests under `plugins/social/` / core test suite as wired.

## Common mistakes

- Putting social logic under `core/`.
- Assuming social owns `web-search.js`.
