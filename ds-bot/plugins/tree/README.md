# @flybot/tree

Recursive bot tree plugin for FlyBot (built on ds-bot / DeepSeek Harness).

## English

### What it does
- Every tree bot has a `parent` field (root: `null`) and a `treeRole` field. The tree starts with only a root (`await tree.ensureRoot()`); children are created during conversations.
- `bot.send` middleware `tree`: inside the tree a bot may message only its parent and direct children (`deny` otherwise). Bots outside the tree get no opinion (`undefined`, next middleware decides).
- Delegation is level by level: coordinators delegate to direct children whose scope fits and aggregate upward; a bot with no children does the work itself. Answers start with a one-line trace like `Root → Work → Dev`.
- Tools (visible only to tree bots): `list_children()` and `create_child_bot(name, role_description)`. The parent is always the calling bot. Limits: depth 5 (root = 1), 8 children per node; duplicate sibling names (case/space-insensitive) are rejected. Every new child gets the same recursive system prompt template (`src/prompt.js`).
- Frontend (`client.js`, bundle id `@flybot/tree`): injects the browser `flybot` service and registers into FlyBot's own slot registry (`ctx.flybot.slots.register('flybot.sidebar.section', …)`, not the shell `slots` service); refreshed on `parent`/`treeRole` field changes and every 10 s. Collapsible "Tree" header with a node count, an empty state, an indented tree with guide lines, name and one-line role; clicking a node opens its chat (`actions.openSession`). Styles reuse ds-bot sidebar tokens (`--bt-*`). The root is created on startup (`autoRoot: false` turns it off).

### Config
```yaml
- id: tree
  name: "@flybot/tree"
  config:
    maxDepth: 5        # default from limits.json
    maxChildren: 8
    bypassSocial: false # true: allowed tree edges skip social friend/approval checks
    rootName: Root
    autoRoot: true      # false: do not create the root at startup
```

### Plugin format (matches ds-bot)
`package.json` has `"type": "module"`, keyword `dsh-plugin`, `exports` `.` (host) and `./client` (browser), and `"dsh": { "client": { "platform": "web" } }`. The host entry exports `name`, `inject`, `apply(ctx, config)` (cordis style). `client.js` uses `window.__ModuleLoader__.load({ id, factory(require) })` with `react` provided by the shell; it exports `inject: ['flybot']` + `apply(ctx)` and registers its section via `ctx.flybot.slots.register`.

### Interface (ctx.flybot, finalized by bot-im 2026-10-14 — all in `src/adapter.js`)
| API | Shape |
|---|---|
| `ctx.flybot.scope('flybot-tree')` | every call below goes through this scoped handle, so fields land in `fields['flybot-tree']` (never `shared`) |
| `bot.list()` | `BotView[]` |
| `bot.create({ name, systemPrompt, fields })` | **async**, resolves to the new id (awaited; `create_child_bot` returns the id) |
| `bot.setSystemPrompt(id, text)` | prompt lives on the Bot record (`BotView.systemPrompt`) |
| `fields.get/set` | **sync**, namespaced by the scope; `null` removes a key |
| `on('change' \| 'bot.created' \| 'bot.removed', fn, { all? })` | `change`: `{ botId, plugin, key, value, prev }`, own plugin unless `{ all: true }`; `bot.removed`: `{ botId, bot }` after deletion, parent read from `bot.fields['flybot-tree'].parent`; children re-attach to it |
| `bot.send.use({ name, before, after, handle })` | tree bot → parent/direct child only; local non-tree bot → tree root only (other tree nodes deny); tree bot → local non-tree bot (e.g. Chief) **deny**; `bypass:['social']` only if `bypassSocial: true` |
| `tools.register` | `visibleTo(botId)` sync; `execute(args, { botId })`. JSON Schema `minLength`/`maxLength` are dropped by register, so `execute` validates them (`validateArgs`) |
| browser | `ctx.flybot.bots()` items carry `fields: { [plugin]: {...} }` (read `fields['flybot-tree']`); tree built in-plugin |
| remote targets | `target.remote === true` (`{ handle, home }`), fallback `bot.isRemote(to)`; never tree members: passed to social |
| `bot.created` | handled by social; tree does not subscribe |
| root | created by the plugin at startup and on demand (`ensureRoot`, idempotent; concurrent calls share one creation) |

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
