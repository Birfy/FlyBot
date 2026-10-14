# @flybot/tree

Recursive bot tree plugin for FlyBot (built on ds-bot / DeepSeek Harness).

## English

### What it does
- **Chief is the root.** ds-bot's Main Bot (`BotView.isMain`, i.e. `state.mainBotIds`; the one named `Chief` if there are several) is adopted as the root with `treeRole: 'root'` (no `parent`); no bot is created. Every other tree bot has `parent` (its parent's id) and `treeRole` (its role). Adoption runs at startup, a few retries later and on every `bot.created`, so a Chief created after startup is picked up. Only if the team has bots but no Main Bot is a separate `Root` created. `config.rootBotId` picks the root explicitly.
- **Migration:** a separate `Root` auto-created by earlier versions (parent `null`, not a Main Bot) hands its children to Chief and loses its tree fields and tree prompt; the bot itself is **not** deleted. Idempotent.
- **Prompt injection:** the tree text sits in a marked block (`<!-- flybot-tree:start -->…<!-- flybot-tree:end -->`) inside each bot's `systemPrompt`; only that block is replaced, so Chief's own prompt text is never overwritten. Chief gets the coordinator rules for its direct children.
- `bot.send` middleware `tree`: inside the tree a bot may message only its parent and direct children (`deny` otherwise). A non-root tree bot may not message local bots outside the tree; the root (Chief) may message any local bot. Local bots outside the tree may message only the root. Remote traffic and outside-to-outside sends get no opinion (`undefined`, social decides).
- Delegation is level by level: coordinators delegate to direct children whose scope fits and aggregate upward; a bot with no children does the work itself. Answers start with a one-line trace like `Chief → Work → Dev`.
- Tools (visible only to tree bots): `list_children()` and `create_child_bot(name, role_description)`. The parent is always the calling bot. Limits: depth 5 (root = 1), 8 children per node; duplicate sibling names (case/space-insensitive) are rejected. Every new child gets the same recursive system prompt template (`src/prompt.js`).
- Frontend (`client.js`, bundle id `@flybot/tree`): injects the browser `flybot` service and registers into FlyBot's own slot registry (`ctx.flybot.slots.register('flybot.sidebar.section', …)`, not the shell `slots` service); refreshed on `parent`/`treeRole` field changes and every 10 s. Collapsible "Tree" header with a node count, an empty state ("No child bots yet. Ask Chief to take on a task and it will create child bots.", shown under Chief while it has no children or when there is no root), an indented tree with guide lines, name and one-line role; clicking a node opens its chat (`actions.openSession`). Styles reuse ds-bot sidebar tokens (`--bt-*`). Chief is shown as the root ("Main bot · root of the tree").

### Config
```yaml
- id: tree
  name: "@flybot/tree"
  config:
    maxDepth: 5        # default from limits.json
    maxChildren: 8
    bypassSocial: false # true: allowed tree edges skip social friend/approval checks
    rootName: Root      # name of the fallback root, only when the team has no Main Bot
    rootBotId: ''       # optional: adopt this bot as the root instead of the Main Bot
    autoRoot: true      # false: do not adopt/create the root at startup
```

### Plugin format (matches ds-bot)
`package.json` has `"type": "module"`, keyword `dsh-plugin`, `exports` `.` (host) and `./client` (browser), and `"dsh": { "client": { "platform": "web" } }`. The host entry exports `name`, `inject`, `apply(ctx, config)` (cordis style). `client.js` uses `window.__ModuleLoader__.load({ id, factory(require) })` with `react` provided by the shell; it exports `inject: ['flybot']` + `apply(ctx)` and registers its section via `ctx.flybot.slots.register`.

### Interface (ctx.flybot, finalized by bot-im 2026-10-14 — all in `src/adapter.js`)
| API | Shape |
|---|---|
| `ctx.flybot.scope('flybot-tree')` | every call below goes through this scoped handle, so fields land in `fields['flybot-tree']` (never `shared`) |
| `bot.list()` | `BotView[]` |
| `bot.create({ name, systemPrompt, fields })` | **async**, resolves to the new id (awaited; `create_child_bot` returns the id) |
| `bot.setSystemPrompt(id, text)` | text ds-bot appends to the bot's system prompt (`BotView.systemPrompt`); the tree only replaces its own marked block |
| `fields.get/set` | **sync**, namespaced by the scope; `null` removes a key |
| `on('change' \| 'bot.created' \| 'bot.removed', fn, { all? })` | `change`: `{ botId, plugin, key, value, prev }`, own plugin unless `{ all: true }`; `bot.removed`: `{ botId, bot }` after deletion, parent read from `bot.fields['flybot-tree'].parent`; children re-attach to it |
| `bot.send.use({ name, before, after, handle })` | tree bot → parent/direct child only; local non-tree bot → tree root only; non-root tree bot → local non-tree bot **deny**, root (Chief) → any local bot ok; `bypass:['social']` only if `bypassSocial: true` |
| `tools.register` | `visibleTo(botId)` sync; `execute(args, { botId })`. JSON Schema `minLength`/`maxLength` are dropped by register, so `execute` validates them (`validateArgs`) |
| browser | `ctx.flybot.bots()` items carry `fields: { [plugin]: {...} }` (read `fields['flybot-tree']`); tree built in-plugin |
| remote targets | `target.remote === true` (`{ handle, home }`), fallback `bot.isRemote(to)`; never tree members: passed to social |
| `bot.created` | handled by social; tree does not subscribe |
| root | ds-bot's Main Bot (Chief) adopted with `treeRole: 'root'` (`ensureRoot`, idempotent); fallback `Root` only without a Main Bot; earlier auto-created `Root` migrated, not deleted |

### Test
`pnpm --filter @flybot/tree test` (or `node --test "test/*.test.js"`). `test/mock-flybot.js` is an in-memory mock of `ctx.flybot`.

### ds-bot hook changes
The plugin now lives in `ds-bot/plugins/tree` of FlyBot; `ds-bot/test/tree-plugin.test.js` runs its tests under ds-bot's `npm test`/CI, and `scripts/lint.mjs` lints `plugins/`. ds-bot itself is NOT changed otherwise. The official hooks (`ctx.flybot` service) must touch:

| File | Change |
|---|---|
| `ds-bot/index.js` | add `hooks` to `MODULES` (after `store`, before `tools`); provide service `flybot` (e.g. `ctx.set('flybot', rt.flybot)`), add to plugin docs |
| `ds-bot/src/host/hooks.js` (new) | fields get/set + `change` events, `send.use` middleware chain (allow/deny/hold, `bypass`), tool registry with `visibleTo`, `bot.list/create` |
| `ds-bot/src/host/store.js` | persist `state.bots[id].fields` in `state.json` (+ legacy load default `{}`) |
| `ds-bot/src/host/roster.js` | `createBot` accepts `fields` / `systemPrompt`; `deleteBot` emits field removal so the tree prunes |
| `ds-bot/src/host/delivery.js` | run the send chain inside `rt.deliver` for `request` role (single choke point: `message_bot`, groups, schedules) |
| `ds-bot/src/host/tools.js` | `message_bot` reports deny/hold reasons; `list_bots` may hide non-reachable bots |
| `ds-bot/src/host/approvals.js` | `hold` → approval card (used by social) |
| `ds-bot/src/host/agents.js` | per-agent tool visibility through the existing `agent.ctx.tools.restrict({ deny })` using `visibleTo(botId)`; tool `execute` gets `{ botId }` from `rt.selfOf(exec.agent.id)` |
| `ds-bot/src/host/prompt.js` | append the bot's `systemPrompt` field to its system prompt |
| `ds-bot/src/client/sidebar.js` + `index.js` | render `ctx.slots` entries of `flybot.sidebar.section` in `TeamSidebar`; client `ctx.flybot` (tree data + field events over `channel.js`); rebuild `client.js` (`build-client.mjs --check` in CI) |
| `ds-bot/test/fake-ctx.js` | add a `flybot` service stub for host tests |
