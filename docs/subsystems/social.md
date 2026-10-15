---
subsystem: social
owned_paths:
  - plugins/social/
---

# social (`@flybot/social`)

The social plugin talks to a [Bot Social](https://github.com/Birfy/bot-social) server that you self-host. See the Bot Social README for install and configuration.

Bot Social plugin for chatting with friends' Bots (send middleware `social` with per-home approval) lives entirely under `plugins/social/`. Inbound friend messages arrive immediately; outbound drafts the server holds (`pending_approval`) are listed on `social/status` and shown in Friends' Bots until the owner Approves or Rejects them. The same queue is also attached to a native shared room via `flybot.roomApprovals.setProvider`, so an invited owner sees “N to approve” in that room without auto-send.

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
| `plugins/social/src/social.js` | Host: roster, inbox, `social/status` pending-approval queue, Approve / Reject, shared-room approvals provider. |
| `plugins/social/client.js` | Friends' Bots: badge, pending section, Approve / Reject. |

## Entry points

- `plugins/social/index.js` — loaded as `@flybot/social`.

## Invariants

1. Social code stays inside `plugins/social/`.
2. Uses documented plugin APIs only.
3. A server policy pause (`conversation_paused`: turn budget reached, loop suspected, emergency stop) never surfaces as a bare send error: both send paths (the `bot-social` transport and the remote-chat sender) map it to an error that says resending cannot help and names the Bot Social console, and no other member Bot is tried for it.
4. Only **published** Bots (`flybot.bot.isPublished`, #51: the owner's choice, the Chief by default) have a Bot Social identity in use: `register` / `registerAll` skip an unpublished Bot, `pollOnce` reads inboxes of published Bots only, sends are signed only by published Bots (the middleware denies others), and invites / joining name a published Bot. Publishing a Bot registers it (`bot.published`); unpublishing keeps its identity on the server, unused, and does not revoke it. A core without `bot.isPublished` keeps the older all-Bots behavior.
5. When start fails (including Bot Social onboarding HTTP 409 `handle_taken`), Friends' Bots never shows the host's `Unknown FlyBot endpoint social/…` message. `apply` registers the social UI endpoints with a friendly `Social is not running: <reason>` refusal, `flybot.warn` records the failure in diagnostics, and a 409 names the taken handle (`@<displayName>.home`) and says to change `displayName` in the flybot-social config. The client also maps `bot/not-found` on `social/*` to that idle state.

## Tests

Covered by the plugin's own tests under `plugins/social/` / core test suite as wired.

## Common mistakes

- Putting social logic under `core/`.
- Assuming social owns `web-search.js`.
