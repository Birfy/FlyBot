// flybot-social browser half: plain JS, loaded by DSH as a classic script. Registers
// into the FlyBot slot registry that ds-bot's client renders (src/client/flybot-slots.js).
window.__ModuleLoader__.load({
  id: 'flybot-social',
  factory(require) {
    const { createElement: h, useEffect, useState } = require('react')
    const slots = () => {
      // Same bootstrap as ds-bot's flybot-registry.js: whichever bundle loads first creates it.
      if (globalThis.__flybot__ === undefined) throw new Error('flybot-social needs ds-bot with FlyBot slots')
      return globalThis.__flybot__.slots
    }
    const call = (endpoint, payload) => globalThis.__flybot__.call(endpoint, payload)

    // Friends' Bots grouped by their home, each with a "remote" badge.
    function FriendsBots() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      useEffect(() => {
        call('social/remote-bots', {}).then(setData, e => setError(String(e?.message ?? e)))
      }, [])
      const homes = data?.homes ?? []
      return h('div', { className: 'bt-social' },
        h('div', { className: 'bt-hint', style: { fontWeight: 600 } }, 'Friends\' Bots'),
        error ? h('div', { className: 'bt-hint' }, error) : null,
        data === null && !error ? h('div', { className: 'bt-hint' }, 'Loading…') : null,
        homes.map(entry => h('div', { key: entry.home, className: 'bt-social-home' },
          h('div', { className: 'bt-hint', title: entry.owner ? `Owned by ${entry.owner}` : undefined }, entry.name ?? entry.home, ' ', entry.home),
          entry.bots.map(bot => h('div', { key: bot.handle, className: 'bt-social-row', 'data-remote': 'true' },
            h('span', null, bot.name), ' ',
            h('span', { className: 'bt-social-badge', style: { fontSize: 10, border: '1px solid currentColor', borderRadius: 4, padding: '0 3px', opacity: 0.7 } }, 'remote'), ' ',
            h('span', { className: 'bt-hint' }, bot.handle))))),
        data && homes.length === 0 ? h('div', { className: 'bt-hint' }, 'No friends yet') : null)
    }

    let cache = { at: 0, list: [] }
    const friendRows = async (query) => {
      if (Date.now() - cache.at > 30_000) cache = { at: Date.now(), list: await call('social/friends', {}) }
      const needle = query.trim().toLowerCase().replace(/^@/, '')
      return cache.list
        .filter(friend => friend.handle.includes(needle) || String(friend.name).toLowerCase().includes(needle))
        // The inserted text asks the Bot to use message_friend_bot; the send is held for approval.
        .map(friend => ({ name: `${friend.name} · remote`, description: `${friend.handle} · ${friend.home}`, section: 'Friends\' Bots', value: `${friend.handle} (remote Bot: use message_friend_bot) ` }))
    }

    return {
      name: 'flybot-social',
      inject: [],
      apply(ctx) {
        let offs = []
        let tries = 0
        // ds-bot's client creates the registry in its apply; wait for it if this loads first.
        const attach = () => {
          if (globalThis.__flybot__ === undefined) {
            if (++tries < 100) timer = setTimeout(attach, 100)
            else console.error('flybot-social: ds-bot FlyBot slots not found')
            return
          }
          offs = [
            slots().register('flybot.sidebar.section', { id: 'social', order: 100, component: FriendsBots }),
            slots().register('flybot.composer.mention', { id: 'social', order: 100, candidates: friendRows }),
          ]
        }
        let timer
        attach()
        const dispose = () => {
          clearTimeout(timer)
          for (const off of offs.splice(0)) off()
        }
        ctx?.effect?.(() => dispose, 'flybot-social: slots')
        return dispose
      },
    }
  },
})
