---
subsystem: ds-bot-core
owned_paths:
  - core/index.js
  - core/src/
  - core/client.js
  - core/web-search.js
  - core/dev/
  - core/types/
  - core/test/identity.test.js
  - core/test/room-membership.test.js
  - core/test/remote-room.test.js
  - core/test/reach-policy.test.js
  - ds-bot/
  - ds-bot.pin.json
  - patches/ds-bot/
  - scripts/ds-bot-patches.mjs
---

# ds-bot-core

Patched upstream `ds-bot` that ships as `core/`. Never edit `ds-bot/` by hand; change `core/` and regenerate patches.

## Owns

- Core server: roster/store, tools, turns/delivery, groups, conversation parts, search index, images, browser bridge, `api/bot` channel.
- Browser client: sidebar, chat, panels, themes, characters, Bot browser panel (`core/client.js` generated from `core/src/client/`).
- `core/web-search.js` — standalone `auto` web-search provider.
- `core/dev/` — harness packages, mock model, test bench, smoke test.
- `core/test/identity.test.js` — the state identity schema tests (store `state.json` v2, #47).
- `core/test/room-membership.test.js` — typed room participants, authorship and the membership-window history rule (#50).
- `core/test/remote-room.test.js` — published remote participants, per-viewer presentation and unpublished-Bot refusal; #51 room rules (a room with friends' Bots takes published local Bots only, unpublish evicts, fanout checks author and recipient, room-code Bots).
- `core/test/reach-policy.test.js` — #51 reach policy: the published default, the allow/deny matrix per direction, no bypass, hold release and flagged deliveries re-checked, setPublished and its event.
- Pin (`ds-bot.pin.json`) and ordered patches (`patches/ds-bot/`).

## Does not own

- FlyBot plugin API surface → [plugin-runtime](plugin-runtime.md) (except `core/types/` which this page claims for now).
- `plugins/tree/`, `plugins/social/` → their own pages.
- `core/scripts/`, arch-doc checks → [install](install.md).

## Key files

| File | Role |
| --- | --- |
| `core/index.js` | Server entry. |
| `core/src/client/` | Client sources → build to `core/client.js`. |
| `core/src/host/` | Host-side helpers (non-hooks). |
| `ds-bot.pin.json` | Upstream pin. |
| `patches/ds-bot/` | Ordered patch topics. |
| `scripts/ds-bot-patches.mjs` | generate / check patches. |
| `core/src/host/room-membership.js` | Typed room participants (human / local bot / published remote), authorship, membership-window history (#50); rooms with friends' Bots or other owners take published local Bots only and evict a Bot that stops qualifying (#51). |
| `core/src/host/reach.js` | The `published` flag and the owner-policy `reach()` check that hooks.js runs outside the plugin chain (#51); `rt.setPublished`, `rt.isPublished`. |
| `core/src/shared/remote-label.js` | Owner-badge labels for a friend's Bot and “Shared room from …” titles. |

## Entry points

- `core/index.js` — plugin server.
- `core/client.js` — built browser bundle (generated; never hand-edit).
- `dev/bench.sh`, `dev/smoke.mjs` — test bench.

## Invariants

1. `ds-bot/` stays pristine; CI fails if it differs from the pin.
2. `core/` == `ds-bot/` + `patches/ds-bot/`; regenerate after every `core/` change.
3. `client.js` matches `core/src/client/`; `npm run build` + `--check`.
4. Never touch the user's `~/.dsh`.
5. The saved team (`state.json`) is versioned. Version 2 (#47) carries the identity schema — `members` records, a per-Bot `ownerId`, the owner's `designatedChiefId`. A legacy version-1 file is migrated on load with a one-time `state.json.v1` backup; an existing backup counts only when it is a readable file holding a parseable version-1 state, and anything else (or any malformed ownership) fails closed (read-only). An older binary refuses a newer version read-only. This is schema foundation only — team mode stays disabled, see [team](team.md). On top of it, member auth (#48) adds host module `src/host/member-auth.js`, installed after `store` in `MODULES` (`core/index.js`): `invitations` and `authSessions` maps live on state (no `STATE_VERSION` bump), the channel resolves the actor from the `x-flybot-member-session` header, and endpoints are `auth-invite` / `auth-redeem` / `auth-revoke` / `auth-whoami` / `auth-remove-member` / `auth-revoke-invite` with `body.actorId` ignored; `auth-invite` alone also opens for an anonymous caller on a host with no sessions yet (bootstrap first invite), `auth-revoke-invite` kills an unredeemed invitation (redeeming it afterwards fails with `revoked`), `removeMember` refuses a member that still owns a Bot (`has_bots`), and the auth mutations are serialized behind an in-process lock so concurrent `removeMember` calls cannot both pass the last-owner check. Sign-in surface only — still not team mode; details in [team](team.md). On top of it, owner-scoped access (#49) adds host module `src/host/authz.js`, installed after member-auth: when any `authSessions` exist, the channel `authorize()` default-denies cross-owner Bot/room/session access, blocks shared non-isolatable resources (secrets, connectors, folder picks, browser bridge, update-install, diagnostics, set-prefs) with `bot/blocked-shared` when more than one member exists, stamps `create-bot` with `actor.memberId`, and filters `view()`/`live()` to the actor; with no sessions the single-human behavior is unchanged. On top of it, room membership (#50) adds host module `src/host/room-membership.js`, installed after groups: a room may carry typed `participants` (`human` / local `bot` / published remote `bot` with `handle` + owner fields, roles `admin` / `member`, `joinedSeq` / `leftSeq`); log lines carry `authorId` + `authorKind`; history is the membership window (current members and the owner of an invited Bot see `seq >=` their interval; leave withdraws access; rejoin starts a new interval); local cross-owner rooms accept each side's *published* Bots (#51: the owner's choice, the designated Chief by default); a friend's Bot from `social/remote-bots` (`cleanRemote`) may be added and unpublished Bots stay private, and a room with a friend's Bot holds only published local Bots (a Bot that joined by room code, `viaCode`, only for that room); `view()` labels remotes with an owner badge and shows an invited owner **Shared room from \<inviter\>**. Still not team mode — see [team](team.md). Published reach (#51) adds host module `src/host/reach.js`, installed after room-membership: `state.bots[id].published` (true / false, unset = the designated Chief is published, every other Bot is not; a Bot whose owner is not a member never is), set by its owner with the `set-published` endpoint (`rt.setPublished`), exposed as `BotView.published`, `flybot.bot.isPublished` and the `bot.published` event. `reach()` is the owner policy: a friend's Bot may reach only published local Bots, only a published Bot (or one code-joined in that room) may message a friend's Bot, another owner's Bot is reached only if both sides are published or both are members of the room the message belongs to. It is not a middleware: hooks.js runs it before the `bot.send` chain, again on approval release, and on every deliver with a sender or remote origin (resumed, retried, deferred, re-sent), so no verdict or `bypass` can skip it and a queued message is judged by what is true when it is delivered. Unpublishing a Bot, or replacing its Chief, removes it from rooms that have friends' Bots or several owners at once (`rt.evictUnshared`).
6. Host diagnostics never depend on `ctx.logger`: DSH may export no logger, and a test or plugin-local host may carry one without `warn`. `rt.warn` still writes stderr and the diagnostics log in that case (`src/host/diagnostics.js`). Plugins reach the same log through `flybot.warn` (#68); see [plugin-runtime](plugin-runtime.md).
7. `remoteTurn` (`src/host/remote-chat.js`) finds what the user typed on a friend's remote chat by skipping host-appended `role:'user'` context: forms `snapshot`, `instructions` (the AGENTS.md baseline on a chat's first turn) and `notice`, and the time-context kinds. Match by form, not by a whitelist of senders, or the first message of a new chat is dropped (#66).
8. A friend's remote Bot is stored and delivered by its handle (`@<bot>.<home>` — what the @ menu inserts and `sendUserMentions` matches). Where the user reads it — mention chips (`src/client/user-message.js`) and sidebar previews (`nameMentions` in `src/client/text.js`) — the client rewrites the handle to the display name taken from the local roster (`roster.bots[].remote`, `roster.remoteBots`), never from message text, so a remote-controlled name reaches the UI only through the sanitized roster records (#71; display names, #9).
9. `0002-flybot-api-host` `cleanRemote` sanitizes those peer-controlled `name` / `homeName` / `owner` labels (strip `@` and controls/newlines, 60-char cap) before they are stored. Details in [plugin-runtime](plugin-runtime.md) (#75).

## Tests

`npm test` in `core/`; smoke test for `index.js` / `src/host/` changes.

## Common mistakes

- Hand-editing `ds-bot/` or `client.js`.
- Forgetting `node scripts/ds-bot-patches.mjs generate && check`.
- Running the bench against `~/.dsh`.
