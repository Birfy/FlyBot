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

    // Errors in English. ds-bot's api.js may localize transport errors ("HTTP 404" becomes
    // Chinese in a zh UI), so the panel words them from the error code instead.
    const errorText = (e) => {
      const code = String(e?.code ?? '')
      const http = code.match(/^HTTP_(\d+)$/)
      if (http) return `The FlyBot host did not answer (HTTP ${http[1]}). Reload the page; if this keeps happening, restart FlyBot web.`
      if (code === 'NETWORK') return 'Could not reach FlyBot. Check that it is still running.'
      return String(e?.message ?? e)
    }

    // What Copy puts on the clipboard: the link with how to use it, for a person or their Bot.
    const inviteMessage = ({ home, url, expires }) =>
      `Join my FlyBot home ${home ?? ''}`.trimEnd() + '. In FlyBot: open Friends\' Bots, click + Add, paste this link and click Join. ' +
      'Using a Grok bot? Send it this link and say \'join this FlyBot invite\'. ' +
      `Link: ${url} (single use${expires ? `, expires ${expires}` : ''})`

    // Styles reuse ds-bot's sidebar tokens (--bt-ink, --bt-ink-2, --bt-ink-3, --bt-hover, --bt-line,
    // --bt-line-2, --bt-card, --bt-accent, --bt-tag-bg/-ink), like @flybot/tree, so both themes follow the app.
    const CSS = `
.fs{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--bt-ink,#141414);padding:0 4px 6px;overflow:hidden;box-sizing:border-box;max-width:100%}
.fs *,.fs *::before,.fs *::after{box-sizing:border-box}
.fs-head{display:flex;align-items:center;gap:4px;padding:0 0 0 0}
.fs-head-main{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--bt-ink-2,rgba(20,20,20,.6));font:inherit;font-size:12px;line-height:16px;font-weight:500;text-align:left;cursor:pointer;transition:background-color .12s ease}
.fs-head-main:hover,.fs-icon:hover{background:var(--bt-hover,rgba(119,119,119,.09))}
.fs-chev{display:inline-flex;width:12px;justify-content:center;color:var(--bt-ink-3,rgba(20,20,20,.36));transition:transform .12s ease}
.fs-head-main[aria-expanded=false] .fs-chev{transform:rotate(-90deg)}
.fs-title{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fs-count,.fs-tag{flex:none;font-size:11px;line-height:14px;padding:1px 6px;border-radius:4px;background:var(--bt-tag-bg,rgba(20,20,20,.06));color:var(--bt-tag-ink,rgba(20,20,20,.56));font-weight:500}
.fs-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--bt-ink-2,rgba(20,20,20,.6));font:inherit;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
.fs-icon[aria-expanded=true]{background:var(--bt-active,rgba(119,119,119,.17));color:var(--bt-ink,#141414)}
.fs-body{display:flex;flex-direction:column;gap:2px;padding:2px 0 0}
.fs-empty,.fs-hint{padding:4px 10px;font-size:12px;line-height:17px;color:var(--bt-ink-2,rgba(20,20,20,.6));overflow-wrap:anywhere}
.fs-empty{padding:6px 10px 8px;font-size:13px;line-height:18px}
.fs-label{padding:8px 10px 2px;font-size:11px;line-height:14px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--bt-ink-3,rgba(20,20,20,.36));display:flex;align-items:center;gap:6px}
.fs-home{padding:6px 10px 2px;display:flex;align-items:baseline;gap:6px;min-width:0;font-size:12px;line-height:16px;font-weight:600;color:var(--bt-ink-2,rgba(20,20,20,.6))}
.fs-home span:last-child{font-weight:400;color:var(--bt-ink-3,rgba(20,20,20,.36));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.fs-row{display:flex;align-items:center;gap:8px;min-width:0;padding:5px 8px 5px 10px;border-radius:8px;transition:background-color .12s ease}
.fs-row:hover{background:var(--bt-hover,rgba(119,119,119,.09))}
.fs-avatar{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--bt-tag-bg,rgba(20,20,20,.06));color:var(--bt-ink-2,rgba(20,20,20,.6));font-size:12px;font-weight:600}
.fs-text{display:flex;flex-direction:column;flex:1 1 auto;min-width:0}
.fs-name{font-size:14px;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fs-sub{font-size:12px;line-height:16px;color:var(--bt-ink-2,rgba(20,20,20,.6));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fs-msg{white-space:normal;overflow-wrap:anywhere}
.fs-actions{flex:none;display:flex;gap:4px}
.fs-card{margin:4px 4px 2px;padding:10px;border:1px solid var(--bt-line,rgba(20,20,20,.08));border-radius:10px;background:var(--bt-card,#fff);display:flex;flex-direction:column;gap:8px}
.fs-card .fs-hint{padding:0}
.fs-line{display:flex;gap:6px;min-width:0;align-items:center}
.fs-input{flex:1 1 auto;min-width:0;width:0;height:30px;padding:0 9px;border:1px solid var(--bt-line-2,rgba(20,20,20,.15));border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;outline:none;text-overflow:ellipsis}
.fs-input:focus{border-color:var(--bt-accent,#4d6bfe)}
.fs-input[readonly]{background:var(--bt-tag-bg,rgba(20,20,20,.06));border-color:transparent}
.fs-btn{flex:none;height:30px;padding:0 12px;border:1px solid var(--bt-line-2,rgba(20,20,20,.15));border-radius:8px;background:transparent;color:var(--bt-ink,#141414);font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background-color .12s ease}
.fs-btn:hover:not(:disabled){background:var(--bt-hover,rgba(119,119,119,.09))}
.fs-btn:disabled{opacity:.45;cursor:default}
.fs-btn-primary{border-color:transparent;background:var(--bt-accent,#4d6bfe);color:#fff;width:100%}
.fs-btn-primary:hover:not(:disabled){background:var(--bt-accent,#4d6bfe);filter:brightness(1.08)}
.fs-btn-sm{height:26px;padding:0 9px;font-size:12px}
.fs-link{padding:0;border:0;background:none;color:var(--bt-accent,#4d6bfe);font:inherit;font-size:12px;cursor:pointer}
.fs-link:hover{text-decoration:underline}
.fs-status{padding:0;font-size:12px;line-height:17px;color:var(--bt-ink-2,rgba(20,20,20,.6));overflow-wrap:anywhere}
.fs-status[data-tone=error]{color:#e5484d}
`
    function useStyles() {
      useEffect(() => {
        if (typeof document === 'undefined' || document.getElementById('flybot-social-css')) return
        const style = document.createElement('style')
        style.id = 'flybot-social-css'
        style.textContent = CSS
        document.head.appendChild(style)
      }, [])
    }
    const initial = name => (String(name ?? '?').replace(/^@/, '').trim()[0] ?? '?').toUpperCase()

    // Friends' Bots grouped by their home, each with a "remote" tag; Add friend below the header.
    function FriendsBots() {
      useStyles()
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [open, setOpen] = useState(true)
      const [adding, setAdding] = useState(false)
      const load = () => call('social/remote-bots', { fresh: true }).then(value => { setData(value); setError('') }, e => setError(errorText(e)))
      useEffect(() => { load() }, [])
      const homes = data?.homes ?? []
      const count = homes.reduce((n, entry) => n + entry.bots.length, 0)
      return h('section', { className: 'fs bt-social', 'aria-label': 'Friends\' Bots' },
        h('div', { className: 'fs-head' },
          h('button', { type: 'button', className: 'fs-head-main', 'aria-expanded': open, onClick: () => setOpen(!open) },
            h('span', { className: 'fs-chev', 'aria-hidden': true }, '▾'),
            h('span', { className: 'fs-title' }, 'Friends\' Bots'),
            data ? h('span', { className: 'fs-count', title: `${count} ${count === 1 ? 'Bot' : 'Bots'}` }, String(count)) : null),
          h('button', { type: 'button', className: 'fs-icon', 'aria-expanded': adding, title: 'Add a friend', onClick: () => { setAdding(!adding); setOpen(true) } }, adding ? 'Done' : '+ Add')),
        open ? h('div', { className: 'fs-body' },
          adding ? h(AddFriend, { onChange: load }) : null,
          error ? h('div', { className: 'fs-status', 'data-tone': 'error', style: { padding: '4px 10px' } }, error) : null,
          data === null && !error ? h('div', { className: 'fs-hint' }, 'Loading…') : null,
          homes.map(entry => h('div', { key: entry.home, className: 'bt-social-home' },
            h('div', { className: 'fs-home', title: entry.owner ? `Owned by ${entry.owner}` : entry.home },
              h('span', null, entry.name ?? entry.home), entry.name ? h('span', null, entry.home) : null),
            entry.bots.length === 0 ? h('div', { className: 'fs-hint' }, 'No Bots shared yet') : null,
            entry.bots.map(bot => h('div', { key: bot.handle, className: 'fs-row bt-social-row', 'data-remote': 'true', title: bot.handle },
              h('span', { className: 'fs-avatar', 'aria-hidden': true }, initial(bot.name)),
              h('span', { className: 'fs-text' },
                h('span', { className: 'fs-name' }, bot.name),
                h('span', { className: 'fs-sub' }, bot.handle)),
              h('span', { className: 'fs-tag bt-social-badge' }, 'remote'))))),
          data && homes.length === 0 && !adding
            ? h('div', { className: 'fs-empty' }, 'No friends yet. Use ', h('b', null, '+ Add'), ' to create an invite link or join a friend\'s.')
            : null) : null)
    }

    // Add friend: share an invite link, join a friend's link, and answer requests.
    function AddFriend({ onChange }) {
      const [overview, setOverview] = useState(null)
      const [invite, setInvite] = useState(null)
      const [code, setCode] = useState('')
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const [copied, setCopied] = useState(false)
      const refresh = () => call('social/overview', {}).then(setOverview, e => setStatus({ tone: 'error', text: errorText(e) }))
      useEffect(() => { refresh() }, [])
      const run = async (label, fn) => {
        setBusy(true)
        setStatus(null)
        try {
          const message = await fn()
          if (message) setStatus({ tone: 'ok', text: message })
          await refresh()
          onChange?.()
        } catch (e) {
          setStatus({ tone: 'error', text: `${label} failed: ${errorText(e)}` })
        } finally {
          setBusy(false)
        }
      }
      const create = () => run('Creating the invite link', async () => { setCopied(false); setInvite(await call('social/create-invite', {})) })
      const join = e => {
        e.preventDefault()
        return run('Joining', async () => {
          const r = await call('social/join-invite', { code })
          setCode('')
          return r.status === 'active' ? `You are now friends with ${r.inviterName ?? r.inviter}.` : `Request sent to ${r.inviterName ?? r.inviter}. They show up here once they accept.`
        })
      }
      const respond = (item, decision) => run(decision === 'accept' ? 'Accepting' : 'Declining', async () => {
        await call('social/respond', { relationshipId: item.relationshipId, decision })
        return decision === 'accept' ? `${item.name ?? item.handle} is now a friend.` : `Declined ${item.name ?? item.handle}.`
      })
      const link = invite ? (invite.url ?? invite.code) : ''
      const copyText = (text, what) => {
        const done = () => { setCopied(what); setTimeout(() => setCopied(false), 2000) }
        const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
        if (clip?.writeText) clip.writeText(text).then(done, () => setStatus({ tone: 'error', text: 'Could not copy. Select the link and copy it by hand.' }))
        else setStatus({ tone: 'error', text: 'Copying is not available here. Select the link and copy it by hand.' })
      }
      const incoming = overview?.incoming ?? []
      const outgoing = overview?.outgoing ?? []
      const expires = invite?.expiresAt ? new Date(invite.expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : ''
      const message = inviteMessage({ home: overview?.home, url: link, expires })
      return h('div', { className: 'bt-social-add', 'data-flybot': 'add-friend' },
        h('div', { className: 'fs-card' },
          h('div', { className: 'fs-hint' }, overview?.home ? ['Invite a friend to ', h('b', { key: 'h' }, overview.home), '.'] : 'Invite a friend to your home.'),
          h('button', { type: 'button', className: 'fs-btn fs-btn-primary', disabled: busy, onClick: create }, invite ? 'Create another invite link' : 'Create invite link'),
          invite ? h('div', { className: 'bt-social-invite', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { className: 'fs-line' },
              h('input', { className: 'fs-input', readOnly: true, value: link, 'aria-label': 'Invite link', title: link, onFocus: e => e.target.select() }),
              h('button', { type: 'button', className: 'fs-btn', title: 'Copy the link with instructions for your friend', onClick: () => copyText(message, 'message'), 'aria-live': 'polite' }, copied === 'message' ? 'Copied' : 'Copy')),
            h('div', { className: 'fs-hint' }, expires ? `Works once, until ${expires}. ` : 'Works once. ',
              h('button', { type: 'button', className: 'fs-link', onClick: () => copyText(link, 'link') }, copied === 'link' ? 'Link copied' : 'Copy link only'))) : null),
        h('form', { onSubmit: join, className: 'fs-card bt-social-join' },
          h('div', { className: 'fs-hint' }, 'Got a link from a friend?'),
          h('div', { className: 'fs-line' },
            h('input', { className: 'fs-input', value: code, placeholder: 'Paste invite link or code', 'aria-label': 'Invite link or code', onChange: e => setCode(e.target.value) }),
            h('button', { type: 'submit', className: 'fs-btn', disabled: busy || !code.trim() }, 'Join'))),
        status ? h('div', { className: 'fs-status', role: 'status', 'data-tone': status.tone, style: { padding: '2px 10px' } }, status.text) : null,
        incoming.length ? h('div', { className: 'bt-social-requests' },
          h('div', { className: 'fs-label' }, 'Friend requests', h('span', { className: 'fs-count' }, String(incoming.length))),
          incoming.map(item => h('div', { key: item.relationshipId, className: 'fs-row bt-social-row' },
            h('span', { className: 'fs-avatar', 'aria-hidden': true }, initial(item.name ?? item.handle)),
            h('span', { className: 'fs-text' },
              h('span', { className: 'fs-name' }, item.name ?? item.handle),
              h('span', { className: 'fs-sub' }, item.handle),
              item.message ? h('span', { className: 'fs-sub fs-msg' }, item.message) : null),
            h('span', { className: 'fs-actions' },
              h('button', { type: 'button', className: 'fs-btn fs-btn-sm', disabled: busy, onClick: () => respond(item, 'accept') }, 'Accept'),
              h('button', { type: 'button', className: 'fs-btn fs-btn-sm', disabled: busy, onClick: () => respond(item, 'decline') }, 'Decline'))))) : null,
        outgoing.length ? h('div', { className: 'bt-social-outgoing' },
          h('div', { className: 'fs-label' }, 'Waiting for them to accept'),
          outgoing.map(item => h('div', { key: item.relationshipId ?? item.handle, className: 'fs-row' },
            h('span', { className: 'fs-avatar', 'aria-hidden': true }, initial(item.name ?? item.handle)),
            h('span', { className: 'fs-text' },
              h('span', { className: 'fs-name' }, item.name ?? item.handle),
              item.name ? h('span', { className: 'fs-sub' }, item.handle) : null),
            h('span', { className: 'fs-tag' }, 'pending')))) : null)
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
      errorText,
      inviteMessage,
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
