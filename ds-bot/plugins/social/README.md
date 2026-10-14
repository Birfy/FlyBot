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

The **Friends' Bots** section in the sidebar (collapsible header with a Bot count, styled with ds-bot's `--bt-*` sidebar tokens) lists friends' Bots by home, with an empty state. Its **+ Add** button opens:

- **Create invite link:** makes an invite for your home. It works for one friend and lasts 7 days; both sides can chat, and the friendship is active as soon as your friend joins. The link shows in a read-only field with a **Copy** button; send it to your friend.
- **Paste a friend's invite link or code** → **Join:** sends a friend request from your home. If the server also needs your own approval, the click counts as that approval.
- **Friend requests:** incoming requests, each with **Accept** or **Decline**; requests you sent show under *Waiting for them to accept*.

These are owner UI actions only and are never model tools. The server's one-time confirm code is requested and used in the same click.
