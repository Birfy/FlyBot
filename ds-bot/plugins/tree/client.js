// Browser half of @flybot/tree, in the dsh client loader format ds-bot uses
// (window.__ModuleLoader__.load, CJS factory, `require` resolves shell-provided react).
// Hand-written (no build step). Registers a collapsible tree in the `flybot.sidebar.section` slot.
window.__ModuleLoader__.load({
  id: '@flybot/tree',
  factory: (require) => {
    const { createElement: h, useEffect, useState, useCallback } = require('react')

    // Browser API: ctx.flybot.bots() -> [{ id, name, fields: { [pluginName]: {...} } }] (sync or a Promise),
    // ctx.flybot.fields.on('change', fn) and ctx.flybot.on('bot.removed', fn). The tree is built here.
    async function treeOf(flybot) {
      const nodes = {}
      for (const b of (await flybot.bots()) || []) {
        const own = b.fields?.['flybot-tree'] ?? {}
        const parent = own.parent, role = own.treeRole
        if (parent === undefined && role === undefined) continue
        nodes[b.id] = { id: b.id, name: b.name, role: role ?? '', parent: parent ?? null }
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

    function Node({ node, depth }) {
      const [open, setOpen] = useState(depth < 2)
      const has = node.children.length > 0
      return h('li', { className: 'flybot-tree-node' },
        h('div', { className: 'flybot-tree-row', style: { paddingLeft: depth * 12, cursor: has ? 'pointer' : 'default' }, title: node.role, onClick: () => has && setOpen(o => !o) },
          h('span', { 'aria-hidden': true }, has ? (open ? '▾ ' : '▸ ') : '• '), node.name),
        has && open ? h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } }, node.children.map(c => h(Node, { key: c.id, node: c, depth: depth + 1 }))) : null)
    }

    function makeSection(flybot) {
      return function TreeSection() {
        const [forest, setForest] = useState([])
        const refresh = useCallback(async () => { try { setForest(buildForest((await treeOf(flybot)).nodes)) } catch { /* keep last */ } }, [])
        useEffect(() => {
          refresh()
          const offs = [flybot.fields.on('change', c => { if (c && (c.key === 'parent' || c.key === 'treeRole' || c.removed)) refresh() })]
          // The browser API has no bot events; a removed Bot shows up through field changes and the poll.
          if (typeof flybot.on === 'function') offs.push(flybot.on('bot.removed', refresh))
          // Removals emit no field change in the browser, so the tree also refreshes every 10 s.
          const timer = setInterval(refresh, 10000)
          offs.push(() => clearInterval(timer))
          return () => { for (const off of offs) off?.() }
        }, [refresh])
        return h('section', { className: 'flybot-tree' },
          h('div', { className: 'flybot-tree-title' }, 'Tree'),
          h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } }, forest.map(r => h(Node, { key: r.id, node: r, depth: 0 }))))
      }
    }

    // 'flybot.sidebar.section' is a FlyBot registry slot (ds-bot renders it), not a DSH
    // shell slot, so the section goes in through the browser flybot service.
    const inject = ['flybot']
    function apply(ctx) {
      const off = ctx.flybot.slots.register('flybot.sidebar.section', { id: 'flybot-tree', order: 100, component: makeSection(ctx.flybot) })
      ctx.effect?.(() => off, 'flybot-tree: sidebar section')
      return off
    }
    return { inject, apply, buildForest, treeOf }
  },
})
