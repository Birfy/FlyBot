// flybot-social browser half: plain JS, loaded by DSH as a classic script. Registers
// into the FlyBot slot registry that ds-bot's client renders (src/client/flybot-slots.js).
window.__ModuleLoader__.load({
  id: '@flybot/social',
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
      const [adding, setAdding] = useState(false)
      const load = () => call('social/remote-bots', { fresh: true }).then(setData, e => setError(String(e?.message ?? e)))
      useEffect(() => { load() }, [])
      const homes = data?.homes ?? []
      return h('div', { className: 'bt-social' },
        h('div', { className: 'bt-hint', style: { fontWeight: 600 } }, 'Friends\' Bots ',
          h('button', { type: 'button', 'aria-expanded': adding, onClick: () => setAdding(!adding) }, adding ? 'Close' : 'Add friend')),
        adding ? h(AddFriend, { onChange: load }) : null,
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

    // Add friend: share an invite link, join a friend's link, and answer requests.
    function AddFriend({ onChange }) {
      const [overview, setOverview] = useState(null)
      const [invite, setInvite] = useState(null)
      const [code, setCode] = useState('')
      const [status, setStatus] = useState('')
      const [busy, setBusy] = useState(false)
      const refresh = () => call('social/overview', {}).then(setOverview, e => setStatus(String(e?.message ?? e)))
      useEffect(() => { refresh() }, [])
      const run = async (label, fn) => {
        setBusy(true)
        setStatus('')
        try {
          const message = await fn()
          if (message) setStatus(message)
          await refresh()
          onChange?.()
        } catch (e) {
          setStatus(`${label} failed: ${String(e?.message ?? e)}`)
        } finally {
          setBusy(false)
        }
      }
      const create = () => run('Invite', async () => { setInvite(await call('social/create-invite', {})) })
      const join = e => {
        e.preventDefault()
        return run('Join', async () => {
          const r = await call('social/join-invite', { code })
          setCode('')
          return r.status === 'active' ? `You are now friends with ${r.inviterName ?? r.inviter}.` : `Request sent to ${r.inviterName ?? r.inviter}; it shows here once they accept.`
        })
      }
      const respond = (item, decision) => run(decision === 'accept' ? 'Accept' : 'Decline', async () => {
        await call('social/respond', { relationshipId: item.relationshipId, decision })
        return decision === 'accept' ? `${item.name ?? item.handle} is now a friend.` : `Declined ${item.name ?? item.handle}.`
      })
      const copy = text => navigator.clipboard?.writeText(text).then(() => setStatus('Invite link copied.'), () => {})
      const incoming = overview?.incoming ?? []
      const outgoing = overview?.outgoing ?? []
      return h('div', { className: 'bt-social-add', 'data-flybot': 'add-friend' },
        overview?.home ? h('div', { className: 'bt-hint' }, 'Your home: ', overview.home) : null,
        h('button', { type: 'button', disabled: busy, onClick: create }, 'Create invite link'),
        invite ? h('div', { className: 'bt-social-invite' },
          h('input', { readOnly: true, value: invite.url ?? invite.code, 'aria-label': 'Invite link', onFocus: e => e.target.select(), style: { width: '100%' } }),
          h('button', { type: 'button', onClick: () => copy(invite.url ?? invite.code) }, 'Copy'),
          h('div', { className: 'bt-hint' }, `One friend can use it, until ${new Date(invite.expiresAt).toLocaleString()}.`)) : null,
        h('form', { onSubmit: join, className: 'bt-social-join' },
          h('input', { value: code, placeholder: 'Paste a friend\'s invite link or code', 'aria-label': 'Invite link or code', onChange: e => setCode(e.target.value), style: { width: '100%' } }),
          h('button', { type: 'submit', disabled: busy || !code.trim() }, 'Join')),
        incoming.length ? h('div', { className: 'bt-social-requests' },
          h('div', { className: 'bt-hint', style: { fontWeight: 600 } }, 'Friend requests'),
          incoming.map(item => h('div', { key: item.relationshipId, className: 'bt-social-row' },
            h('span', null, item.name ?? item.handle, ' ', h('span', { className: 'bt-hint' }, item.handle)),
            item.message ? h('div', { className: 'bt-hint' }, item.message) : null,
            h('button', { type: 'button', disabled: busy, onClick: () => respond(item, 'accept') }, 'Accept'),
            h('button', { type: 'button', disabled: busy, onClick: () => respond(item, 'decline') }, 'Decline')))) : null,
        outgoing.length ? h('div', { className: 'bt-hint' }, 'Waiting for: ', outgoing.map(item => item.name ?? item.handle).join(', ')) : null,
        status ? h('div', { className: 'bt-hint', role: 'status' }, status) : null)
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
