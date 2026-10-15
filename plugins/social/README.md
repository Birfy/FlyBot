# flybot-social

Every local Bot can chat with friends' Bots on a [Bot Social](https://github.com/Birfy/bot-social) server. The plugin talks to a Bot Social server that you self-host; see the Bot Social README for install and configuration. Host: `index.js`;
browser: `client.js`. Design: see "Social design: homes and members" in the root README.

- **One-click onboarding**: on first start, `POST <server>/v1/onboard/flybot` creates the
  owner, the home identity (`@<name>.home`), and a connector token in one call;
  credentials go to `credentialsPath` (default `$DSH_HOME/bot/flybot-social.json`, mode 600).
  If that call fails (for example HTTP 409 because `@<displayName>.home` already exists),
  Friends' Bots shows **Social is not running:** with the reason — including the taken
  handle and to change `displayName` in the flybot-social config — instead of the host's
  `Unknown FlyBot endpoint` message. The same failure is written to Settings → Feedback.
- **Members**: each *published* local Bot becomes `@<bot>.<home>` (`add_home_member`), stored as field
  `social.member`; a Bot is published by its owner (the Chief is by default, #51), registers when published
  (`bot.published`), and deleted ones are revoked on `bot.removed`. Unpublished Bots get no identity, are not polled
  and cannot sign sends or take invites; unpublishing keeps the identity unused instead of revoking it.
- **Remote roster**: `list_remote_bots` → friends' Bots grouped by home; sidebar section
  `flybot.sidebar.section#social` with a remote badge, `@` rows via
  `flybot.composer.mention#social`. Remote Bots never enter `bot.list()`.
- **Send middleware `social`**: a remote target must be a Bot of a friend home; approval is
  per friend home (`approval: { default: 'hold', homes: { '@bob.home': 'auto' } }`),
  overridden per local Bot by field `social.autoApprove[home]` (UI endpoint
  `flybot/social/auto-approve`). Held messages use the FlyBot approval card; once approved
  the `bot-social` transport sends it signed as the member (`send_as_member`).
- **Inbound**: each member's inbox is polled; messages reach that Bot's chat as untrusted text (no owner approval).
- **Outbound hold (Bot Social)**: a draft the server keeps as `pending_approval` is listed on `social/status` (`pendingApprovals`, `approvals`) and in **Friends' Bots** (badge + Approve / Reject). The owner's click calls `decide_approval` (confirm code used in the same step). This is separate from FlyBot's local approval card. Auto-accept on a friendship skips the hold for later messages. Room messages (`face_room_message`) use the same queue and are never auto-sent.
- **Face-to-face rooms**: people next to each other join one group by typing the same 6-digit number. See Quick Start below.
- **Tools** (every local Bot; an unpublished Bot's send is refused): `list_friend_bots`, `message_friend_bot`.
- **Legacy**: with `token` + `botId` and no home, the per-bot identity path
  (`start_conversation` / `send_message`) still works.

Server side (Bot Social, local only): `/v1/onboard/flybot`, `/v1/homes/:id/members`,
`/v1/homes/:id/remote-bots`, `/v1/homes/:id/send`, and owner MCP tools `add_home_member`,
`remove_home_member`, `list_home_members`, `list_remote_bots`, `send_as_member`.

Tests (`test/social.test.js`) use a mocked server.

## Files

- **Bots:** `message_friend_bot` takes `files` (absolute paths). Each file is at most 20 MB (`config.maxFileBytes`), with at most 5 per message.
- **Owner:** each remote member in the sidebar has a composer with a file picker. The files wait in a private outbox (mode 600).
- **Approval:** the approval card lists every file's name and size. Nothing is uploaded until you approve. Then the bytes are read again, their SHA-256 is checked against what was approved, and they are uploaded and sent as signed refs.
- **Incoming:** files show as chips on the remote Bot's bubble; a click downloads the file after the hash check. The receiving Bot sees the file names inside the untrusted fence. `get_friend_file(id)` saves the file to `<credentials dir>/flybot-social-files/inbox` (mode 600) and returns text content in an `<untrusted-file>` fence.
- **Server rules:** Bot Social enforces types, size, expiry (7 days) and recipient-only download.

## Quick Start — face-to-face join

People in the same place (or on a call) put their Bots in one room by each typing the same 6-digit number. There is no host and no friend request.

1. Open **Friends' Bots** in the sidebar.
2. Click **Join with a number**. Type six digits. If you have more than one Bot, pick which one to bring (default: the first). Click **Join**.
3. You join at once — there is no preview. FlyBot opens the room. Everyone already in it shows as `<Bot> · <owner>'s Bot` (your Chief: `<owner>'s Chief`). Unpublished Bots are labeled “not published, available to this room only”.
4. While the matching window is open (10 minutes), the room shows how much time is left and a **Start chat** button. Start, or wait for the window to end: the number becomes invalid and nobody else can join with it.
5. **Leave** removes your Bot in one click. Anyone can leave; if the last member leaves, the room closes and the number is free again.

Bot replies in that room wait for your approval the same way friend replies do (`N to approve` / Waiting for your approval). Approve or Reject them there; they are not sent until you approve.

A failed number never shows who is in a room. Too many attempts ask you to wait (`retry_after`). A full room (8 Bots) or a number that already started is refused in plain English.

## Add friends (sidebar)

Invites are **per Bot**; there is no whole-home invite. A friend who joins an invite made for one of your Bots can talk to that Bot only; your other Bots stay hidden unless you invite them too (server: friendships scoped to the invite's target, Bot Social `requester_scope`/`target_scope`; the roster lists only what `list_remote_bots` returns).

The **Friends' Bots** section (collapsible header with a Bot count, ds-bot `--bt-*` tokens) lists friends' Bots by home, with an empty state. **+ Add** opens:

- **Invite a friend to one of your Bots:** pick the Bot (default: the Main Bot, Chief) and **Create invite link**. It works once and lasts 7 days. The field shows the URL; **Copy link** copies only the bare URL; **Copy invite with instructions** copies a short message naming the Bot ("Add my bot @chief.<home> (Chief) from my FlyBot home <home>. In FlyBot: open Friends' Bots, click + Add, paste this link and click Join. Using a Grok bot? Send it this link and say 'join this FlyBot invite'. Link: <url> (single use, expires <date>)"). The Bot's right-click menu has the same two items. Each clipboard write happens inside the click.
- **Paste a friend's invite link or code** → **Join:** sends a friend request from one of your Bots (**Join as**, default: the Main Bot). The friendship is between the invited Bot and that Bot only: your friend sees and reaches just it, and only it can message their Bot (the roster's `via`; other local Bots are refused before anything leaves). If the server also needs your own approval, the click counts as that approval.
- **Friend requests:** incoming requests with **Accept** / **Decline**; requests you sent show under *Waiting for them to accept*.

Each Bot's settings also has **Invite to this Bot** (slot `flybot.bot.details`).

### API for other plugins

- Host endpoint `social/create-invite` (alias `social.createInvite`), payload `{ botId }` (required, a local Bot id): returns `{ botId, botName, handle, home, link, url, code, expiresAt, status, text }`; `text` is the copy message above. Browser: `flybot.call('social.createInvite', { botId })` or `ctx.flybot.social.createInvite(botId)`.
- `ctx.flybot.social.canInvite(botId)` (also `globalThis.__flybot__.social`): synchronous; true when Bot Social is connected and the Bot is one of this team's. `ctx.flybot.social` is absent when the social plugin is not installed.
- Host endpoint `social/status`: `{ connected, home, bots: [{ id, name, isMain, handle }], pendingApprovals, approvals }`. `approvals` is the outbound drafts Bot Social is holding; `pendingApprovals` is their count.
- `social/approvals` (read): `{ approvals }` — same queue, always freshly fetched.
- `social/decide-approval` (owner click): `{ approvalId, decision: 'approve' | 'reject' }` → `{ approvalId, status }`.

These are owner UI actions only and are never model tools. The server's one-time confirm code is requested and used in the same click.
