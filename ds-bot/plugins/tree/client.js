// Browser half of @flybot/tree, in the dsh client loader format ds-bot uses
// (window.__ModuleLoader__.load, CJS factory, `require` resolves shell-provided react).
// Hand-written (no build step). Registers a collapsible tree in FlyBot's `flybot.sidebar.section` slot.
// The bundle id is the package name: the DSH client loader looks bundles up by package name.
//
// It injects the browser `flybot` service (ds-bot's client provides it). `flybot.sidebar.section`
// is a slot of FlyBot's own registry (ctx.flybot.slots), not of the shell's `slots` service: the
// shell's ctx.slots.register() throws `slot "flybot.sidebar.section" is not declared`.
window.__ModuleLoader__.load({
  id: '@flybot/tree',
  factory: (require) => {
    const { createElement: h, useEffect, useState, useCallback } = require('react')

    // Browser API (the injected flybot service, ds-bot's FlyBotClient): bots() -> [{ id, name, fields: { [plugin]: {...} } }]
    // (sync or a Promise) and fields.on('change', fn). It has no on('bot.removed'); removals are picked up
    // by the periodic refresh. The tree is built here.
    async function treeOf(flybot) {
      const nodes = {}
      for (const b of (await flybot.bots()) || []) {
        const own = b.fields?.['flybot-tree'] ?? {}
        const parent = own.parent, role = own.treeRole
        if (parent === undefined && role === undefined) continue
        // treeRole 'root' marks the root (ds-bot's Main Bot, Chief).
        nodes[b.id] = { id: b.id, name: b.name, role: role === 'root' ? 'Main bot · root of the tree' : (role ?? ''), parent: parent ?? null }
      }
      return { nodes }
    }
    function buildForest(nodes) {
      const byParent = new Map()
      for (const n of Object.values(nodes || {})) {
        const k = n.parent ?? null
        if (!byParent.has(k)) byParent.set(k, [])
        byParent.get(k).push(n)
      }
      const walk = (n, seen) => seen.has(n.id) ? null : { ...n, children: (byParent.get(n.id) || []).map(c => walk(c, new Set([...seen, n.id]))).filter(Boolean) }
      return (byParent.get(null) || []).map(r => walk(r, new Set()))
    }

    const EMPTY = 'No child bots yet. Ask Chief to take on a task and it will create child bots.'
    const countNodes = forest => forest.reduce((n, r) => n + 1 + countNodes(r.children), 0)
    // Styles reuse ds-bot's sidebar tokens (--bt-ink, --bt-ink-2, --bt-ink-3, --bt-hover, --bt-line,
    // --bt-tag-bg/-ink), so light and dark themes follow the app; fallbacks only for a bare page.
    const CSS = `
.flybot-tree{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--bt-ink,#141414);padding:0 4px 4px;overflow:hidden}
.flybot-tree-head{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--bt-ink-2,rgba(20,20,20,.6));font:inherit;font-size:12px;line-height:16px;font-weight:500;text-align:left;cursor:pointer;transition:background-color .12s ease}
.flybot-tree-head:hover{background:var(--bt-hover,rgba(119,119,119,.09))}
.flybot-tree-chev{display:inline-flex;width:12px;justify-content:center;color:var(--bt-ink-3,rgba(20,20,20,.36));transition:transform .12s ease}
.flybot-tree-head[aria-expanded=false] .flybot-tree-chev{transform:rotate(-90deg)}
.flybot-tree-title{flex:1 1 auto}
.flybot-tree-count{font-size:11px;line-height:14px;padding:1px 6px;border-radius:4px;background:var(--bt-tag-bg,rgba(20,20,20,.06));color:var(--bt-tag-ink,rgba(20,20,20,.56))}
.flybot-tree-empty{padding:8px 10px 10px;font-size:13px;line-height:18px;color:var(--bt-ink-2,rgba(20,20,20,.6))}
.flybot-tree-list,.flybot-tree-kids{list-style:none;margin:0;padding:0}
.flybot-tree-kids{position:relative;margin-left:15px;padding-left:6px}
.flybot-tree-kids::before{content:'';position:absolute;left:0;top:0;bottom:12px;border-left:1px solid var(--bt-line-2,rgba(20,20,20,.15))}
.flybot-tree-kids>.flybot-tree-node{position:relative}
.flybot-tree-kids>.flybot-tree-node::before{content:'';position:absolute;left:-6px;top:18px;width:6px;border-top:1px solid var(--bt-line-2,rgba(20,20,20,.15))}
.flybot-tree-row{display:flex;align-items:flex-start;gap:4px;min-width:0;border-radius:8px;transition:background-color .12s ease}
.flybot-tree-row:hover{background:var(--bt-hover,rgba(119,119,119,.09))}
.flybot-tree-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:36px;padding:0;border:0;background:transparent;color:var(--bt-ink-3,rgba(20,20,20,.36));font-size:10px;cursor:pointer}
.flybot-tree-toggle[aria-expanded=false]{transform:rotate(-90deg)}
.flybot-tree-dot{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:36px;color:var(--bt-ink-3,rgba(20,20,20,.36));font-size:8px}
.flybot-tree-open{display:flex;flex-direction:column;min-width:0;flex:1 1 auto;padding:4px 6px 4px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.flybot-tree-open:disabled{cursor:default}
.flybot-tree-name{font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.flybot-tree-role{font-size:12px;line-height:16px;color:var(--bt-ink-2,rgba(20,20,20,.6));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`
    function useStyles() {
      useEffect(() => {
        if (typeof document === 'undefined' || document.getElementById('flybot-tree-css')) return
        const style = document.createElement('style')
        style.id = 'flybot-tree-css'
        style.textContent = CSS
        document.head.appendChild(style)
      }, [])
    }

    function Node({ node, depth, open: openBot }) {
      const [open, setOpen] = useState(depth < 2)
      const has = node.children.length > 0
      const role = String(node.role || '').split('\n')[0]
      return h('li', { className: 'flybot-tree-node', 'data-bot-id': node.id },
        h('div', { className: 'flybot-tree-row' },
          has
            ? h('button', { type: 'button', className: 'flybot-tree-toggle', 'aria-expanded': open, 'aria-label': open ? `Collapse ${node.name}` : `Expand ${node.name}`, onClick: () => setOpen(o => !o) }, '▾')
            : h('span', { className: 'flybot-tree-dot', 'aria-hidden': true }, '●'),
          h('button', { type: 'button', className: 'flybot-tree-open', title: role ? `${node.name} · ${role}` : node.name, disabled: !openBot, onClick: () => openBot?.(node.id) },
            h('span', { className: 'flybot-tree-name' }, node.name),
            role ? h('span', { className: 'flybot-tree-role' }, role) : null)),
        has && open ? h('ul', { className: 'flybot-tree-kids', role: 'group' }, node.children.map(c => h(Node, { key: c.id, node: c, depth: depth + 1, open: openBot }))) : null)
    }

    // Pure view, also used by tests and the screenshot harness.
    function TreeView({ forest, expanded = true, onToggle, openBot }) {
      const count = countNodes(forest)
      return h('section', { className: 'flybot-tree', 'aria-label': 'Bot tree' },
        h('button', { type: 'button', className: 'flybot-tree-head', 'aria-expanded': expanded, onClick: onToggle },
          h('span', { className: 'flybot-tree-chev', 'aria-hidden': true }, '▾'),
          h('span', { className: 'flybot-tree-title' }, 'Tree'),
          h('span', { className: 'flybot-tree-count', title: `${count} ${count === 1 ? 'bot' : 'bots'}` }, String(count))),
        expanded
          ? [
              forest.length ? h('ul', { key: 'list', className: 'flybot-tree-list', role: 'tree' }, forest.map(r => h(Node, { key: r.id, node: r, depth: 0, open: openBot }))) : null,
              // No root, or a root (Chief) without children yet.
              count - forest.length === 0 ? h('div', { key: 'empty', className: 'flybot-tree-empty' }, EMPTY) : null,
            ]
          : null)
    }

    function makeSection(flybot) {
      // Props from ds-bot's FlyBotSections: { roster, actions, call }; actions.openSession(botId) opens its chat.
      return function TreeSection(props) {
        useStyles()
        const [forest, setForest] = useState([])
        const [expanded, setExpanded] = useState(true)
        const refresh = useCallback(async () => { try { setForest(buildForest((await treeOf(flybot)).nodes)) } catch { /* keep last */ } }, [])
        useEffect(() => {
          refresh()
          const offs = []
          try { offs.push(flybot.fields?.on?.('change', c => { if (c && (c.key === 'parent' || c.key === 'treeRole' || c.removed)) refresh() })) } catch { /* no change feed */ }
          // The browser API has no bot events; a removed Bot shows up through the poll.
          if (typeof flybot.on === 'function') { try { offs.push(flybot.on('bot.removed', refresh)) } catch { /* no removal event */ } }
          const timer = setInterval(refresh, REFRESH_MS) // removals emit no field change in the browser
          offs.push(() => clearInterval(timer))
          return () => { for (const off of offs) { try { off?.() } catch { /* already gone */ } } }
        }, [refresh])
        const openSession = props?.actions?.openSession
        return h(TreeView, { forest, expanded, onToggle: () => setExpanded(e => !e), openBot: typeof openSession === 'function' ? id => openSession(id) : undefined })
      }
    }

    const REFRESH_MS = 10000
    // 'flybot.sidebar.section' is a FlyBot registry slot (ds-bot renders it), not a DSH
    // shell slot, so the section goes in through the browser flybot service.
    const inject = ['flybot']
    function apply(ctx) {
      const off = ctx.flybot.slots.register('flybot.sidebar.section', { id: 'flybot-tree', order: 90, component: makeSection(ctx.flybot) })
      ctx.effect?.(() => off, 'flybot-tree: sidebar section')
      return off
    }
    return { name: 'flybot-tree', inject, apply, buildForest, treeOf, TreeView, countNodes, EMPTY, CSS }
  },
})
