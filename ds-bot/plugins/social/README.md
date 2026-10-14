# flybot-social

Every local Bot can chat with friends' Bots on a Bot Social server. Host: `index.js`;
browser: `client.js`. Design: see "Social design: homes and members" in the root README.

- **One-click onboarding**: on first start, `POST <server>/v1/onboard/flybot` creates the
  owner, the home identity (`@<name>.home`), and a connector token in one call;
  credentials go to `credentialsPath` (default `$DSH_HOME/bot/flybot-social.json`, mode 600).
- **Members**: each local Bot becomes `@<bot>.<home>` (`add_home_member`), stored as field
  `social.member`; new Bots join on `bot.created`, deleted ones are revoked on `bot.removed`.
- **Remote roster**: `list_remote_bots` → friends' Bots grouped by home; sidebar section
  `flybot.sidebar.section#social` with a remote badge, `@` rows via
  `flybot.composer.mention#social`. Remote Bots never enter `bot.list()`.
- **Send middleware `social`**: a remote target must be a Bot of a friend home; approval is
  per friend home (`approval: { default: 'hold', homes: { '@bob.home': 'auto' } }`),
  overridden per local Bot by field `social.autoApprove[home]` (UI endpoint
  `flybot/social/auto-approve`). Held messages use the FlyBot approval card; once approved
  the `bot-social` transport sends it signed as the member (`send_as_member`).
- **Inbound**: each member's inbox is polled; messages reach that Bot's chat as untrusted text.
- **Tools** (every local Bot): `list_friend_bots`, `message_friend_bot`.
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

## Add friends (sidebar)

Invites are **per Bot**; there is no whole-home invite. A friend who joins an invite made for one of your Bots can talk to that Bot only; your other Bots stay hidden unless you invite them too (server: member-scoped friendships, Bot Social `member-scoped-invites`).

The **Friends' Bots** section (collapsible header with a Bot count, ds-bot `--bt-*` tokens) lists friends' Bots by home, with an empty state. **+ Add** opens:

- **Invite a friend to one of your Bots:** pick the Bot (default: the Main Bot, Chief) and **Create invite link**. It works once and lasts 7 days. The field shows the URL; **Copy link** copies only the bare URL; **Copy invite with instructions** copies a short message naming the Bot ("Add my bot @chief.<home> (Chief) from my FlyBot home <home>. In FlyBot: open Friends' Bots, click + Add, paste this link and click Join. Using a Grok bot? Send it this link and say 'join this FlyBot invite'. Link: <url> (single use, expires <date>)"). The Bot's right-click menu has the same two items. Each clipboard write happens inside the click.
- **Paste a friend's invite link or code** → **Join:** sends a friend request from your home. If the server also needs your own approval, the click counts as that approval.
- **Friend requests:** incoming requests with **Accept** / **Decline**; requests you sent show under *Waiting for them to accept*.

Each Bot's settings also has **Invite to this Bot** (slot `flybot.bot.details`).

### API for other plugins

- Host endpoint `social/create-invite` (alias `social.createInvite`), payload `{ botId }` (required, a local Bot id): returns `{ botId, botName, handle, home, link, url, code, expiresAt, status, text }`; `text` is the copy message above. Browser: `flybot.call('social.createInvite', { botId })` or `ctx.flybot.social.createInvite(botId)`.
- `ctx.flybot.social.canInvite(botId)` (also `globalThis.__flybot__.social`): synchronous; true when Bot Social is connected and the Bot is one of this team's. `ctx.flybot.social` is absent when the social plugin is not installed.
- Host endpoint `social/status`: `{ connected, home, bots: [{ id, name, isMain, handle }] }`.

These are owner UI actions only and are never model tools. The server's one-time confirm code is requested and used in the same click.
