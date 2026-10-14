# @flybot/tree

Recursive bot tree plugin for FlyBot (built on ds-bot / DeepSeek Harness).

## English

### What it does
- **Chief is the root.** ds-bot's Main Bot (`BotView.isMain`, i.e. `state.mainBotIds`; the one named `Chief` if there are several) is adopted as the root with `treeRole: 'root'` (no `parent`); no bot is created. Every other tree bot has `parent` (its parent's id) and `treeRole` (its role). Adoption runs at startup, a few retries later and on every `bot.created`, so a Chief created after startup is picked up. Only if the team has bots but no Main Bot is a separate `Root` created. `config.rootBotId` picks the root explicitly.
- **Migration:** a separate `Root` auto-created by earlier versions (parent `null`, not a Main Bot) hands its children to Chief, loses its tree fields and tree prompt, and gets `fields['flybot-tree'].retired = true` so adoption skips it. The bot itself is **never** deleted (bot-im / the user decide). Idempotent.
- **Adoption (`adoptExisting`, default true):** every local bot with no tree fields that is not retired and not another Main Bot (e.g. existing 研究员, 数据分析师, 文案, 程序员) becomes a child of Chief at startup and on `bot.created` when the creator set no `parent`. Chief's `maxChildren` is respected: extra bots stay unattached and a warning is logged. Adopted bots keep their own prompt; the tree block is added. Message rules apply to them like any tree child (Chief ↔ them; they → only Chief and their own children).
- **Prompt injection:** the tree text sits in a marked block (`<!-- flybot-tree:start -->…<!-- flybot-tree:end -->`) inside each bot's `systemPrompt`; only that block is replaced, so Chief's own prompt text is never overwritten. Chief gets the coordinator rules for its direct children.
- `bot.send` middleware `tree`: inside the tree a bot may message only its parent and direct children (`deny` otherwise). A non-root tree bot may not message local bots outside the tree; the root (Chief) may message any local bot. Local bots outside the tree may message only the root. Remote traffic and outside-to-outside sends get no opinion (`undefined`, social decides).
- Delegation is level by level: coordinators delegate to direct children whose scope fits and aggregate upward; a bot with no children does the work itself. Answers start with a one-line trace like `Chief → Work → Dev`.
- Tools (visible only to tree bots): `list_children()` and `create_child_bot(name, role_description)`. The parent is always the calling bot. Limits: depth 5 (root = 1), 8 children per node; duplicate sibling names (case/space-insensitive) are rejected. Every new child gets the same recursive system prompt template (`src/prompt.js`).
- Frontend (`client.js`, bundle id `@flybot/tree`, injects `flybot`): the tree is drawn by ds-bot's own Bot list, so this plugin's separate "Tree" sidebar section is **off by default** (`sidebarSection: true` in the client config brings it back). It always exposes the synchronous helper `ctx.flybot.tree.forest(bots)` (also `globalThis.__flybot__.tree.forest(bots)`), see **Tree data** below. It also registers `flybot.sidebar.structure` (`{ parentOf(botId) }`, parents from `forestOf` over `ctx.flybot.bots()`, refreshed on field changes and every 10 s); ds-bot's sidebar uses it to draw its Bot list as one expandable tree with Chief on top. Retired and non-tree Bots have no parent there, so ds-bot shows them directly under Chief. The entry also has `nodeActions`, a component ds-bot renders next to each tree row with `{ bot }`: a small link icon (revealed on hover) that copies the bot's invite message. It shows only when the social plugin is installed and `social.canInvite(botId)` is true (checked on every render and every 3 s); a click calls `social.createInvite(botId)` (or `flybot.call('social.createInvite', { botId })`), copies `text` with `navigator.clipboard` (textarea fallback) and shows "Copied" or the error inline. It stops propagation, so the row's click-to-open is unaffected.

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
    adoptExisting: true # false: do not attach existing/new parentless bots to Chief
    # client side (browser plugin config): sidebarSection: false  # true: show the separate Tree section
```

### Tree data (for ds-bot's sidebar)
Everything is synchronous.

**Fields** (per bot, `bot.fields['flybot-tree']`; also on every bot in the browser roster, which spreads the stored bot record including `fields` and `createdAt`):

| key | value |
|---|---|
| `treeRole` | `'root'` on the root (Chief); the role text (may be `''`) on other members |
| `parent` | parent bot id; absent on the root |
| `retired` | `true` on the old auto-created Root: not a member, never re-adopted |

A bot is a tree member when it has `treeRole` or `parent` and is not `retired`.

**Helper:** `forest(bots)` turns bot records into nested nodes:
- browser: `ctx.flybot.tree.forest(roster.bots)` or `globalThis.__flybot__.tree.forest(roster.bots)`
- host: `apply(...).tree.forest()` (reads `bot.list()` and the scoped fields)
- module: `forestOf(bots)` from `src/forest.js`

```ts
type TreeNode = {
  id: string
  name: string
  role: string          // 'Main bot · root of the tree' for the root, else treeRole ('' allowed)
  root: boolean         // treeRole === 'root'
  createdAt: number | null  // the record's createdAt, null when absent
  children: TreeNode[]
}
forest(bots: Array<{ id: string, name: string, createdAt?: number, fields?: { 'flybot-tree'?: { parent?: string, treeRole?: string, retired?: boolean } } }>): TreeNode[]
```
Top level: roots first, then members whose parent is missing (orphans). Siblings are ordered by `createdAt`; records without it keep their input order; ties go by name. Cycles are cut. Non-members, retired bots and remote bots (never in the roster's `bots`) are left out, so ds-bot draws them as before.

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
