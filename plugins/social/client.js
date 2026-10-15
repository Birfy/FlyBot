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
.fs-home-head{display:flex;align-items:center;gap:4px;min-width:0;padding:2px 4px 0 0}
.fs-home{display:flex;align-items:baseline;gap:6px;flex:1 1 auto;min-width:0;padding:4px 8px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:12px;line-height:16px;font-weight:500;color:var(--bt-ink-2,rgba(20,20,20,.6));text-align:left;cursor:pointer}
.fs-home:hover{background:var(--bt-hover,rgba(119,119,119,.09))}
.fs-home .fs-chev[data-closed]{transform:rotate(-90deg)}
.fs-home-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.fs-home-handle{font-weight:400;color:var(--bt-ink-3,rgba(20,20,20,.36));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.fs-auto{flex:none;display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:14px;color:var(--bt-ink-3,rgba(20,20,20,.36));cursor:pointer;white-space:nowrap}
.fs-auto input{margin:0;accent-color:var(--bt-accent,#4d6bfe)}
.bt-social-rows{display:flex;flex-direction:column}
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
.fs-pending-tag{background:var(--bt-accent,#4d6bfe);color:#fff}
.fs-pending{margin:4px 4px 6px;padding:8px 10px;border:1px solid var(--bt-line-2,rgba(20,20,20,.15));border-radius:10px;background:var(--bt-card,#fff);display:flex;flex-direction:column;gap:6px}
.fs-pending .fs-label{padding:0}
.fs-draft{font-size:13px;line-height:18px;color:var(--bt-ink,#141414);white-space:pre-wrap;overflow-wrap:anywhere;max-height:96px;overflow:auto}
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

    // Outbound drafts Bot Social is holding: badge + Approve / Reject. Inbound does not wait.
    function PendingApprovals({ items, busy, onDecide }) {
      if (!items?.length) return null
      return h('div', { className: 'fs-pending', 'data-flybot': 'pending-approvals', role: 'region', 'aria-label': 'Messages waiting for your approval' },
        h('div', { className: 'fs-label' }, 'Waiting for your approval', h('span', { className: 'fs-count' }, String(items.length))),
        h('div', { className: 'fs-hint' }, 'A friend already sees their own message. These replies stay here until you Approve or Reject them. Turn on Auto-accept for that friend to skip the hold next time.'),
        items.map(item => h('div', { key: item.id, className: 'fs-row', 'data-flybot': 'pending-item' },
          h('span', { className: 'fs-avatar', 'aria-hidden': true }, initial(item.from ?? item.toName ?? item.to)),
          h('span', { className: 'fs-text' },
            h('span', { className: 'fs-name' }, item.from ? `${item.from} → ${item.toName || item.to || 'friend'}` : (item.toName || item.to || 'Outbound reply')),
            item.text ? h('span', { className: 'fs-draft' }, item.text) : (item.summary ? h('span', { className: 'fs-sub fs-msg' }, item.summary) : null),
            item.attachments?.length ? h('span', { className: 'fs-sub' }, item.attachments.map(file => file.name).join(', ')) : null),
          h('span', { className: 'fs-actions' },
            h('button', { type: 'button', className: 'fs-btn fs-btn-sm', disabled: busy === item.id, onClick: () => onDecide(item, 'approve') }, 'Approve'),
            h('button', { type: 'button', className: 'fs-btn fs-btn-sm', disabled: busy === item.id, onClick: () => onDecide(item, 'reject') }, 'Reject')))))
    }

    // Friends' Bots grouped by their home (one collapsible group each). Each Bot is drawn by
    // ds-bot's own Bot row (renderBot: avatar, preview, unread, click opens its chat).
    function FriendsBots({ renderBot, remoteChats } = {}) {
      useStyles()
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [open, setOpen] = useState(true)
      const [adding, setAdding] = useState(false)
      const [closed, setClosed] = useState({})
      const [auto, setAuto] = useState({})
      const [saving, setSaving] = useState('')
      const [pending, setPending] = useState([])
      const load = () => call('social/remote-bots', { fresh: true }).then(value => { setData(value); setError('') }, e => setError(errorText(e)))
      const loadSettings = () => call('social/settings', {}).then(value => setAuto(value?.autoAccept ?? {}), () => {})
      const loadApprovals = () => call('social/status', {}).then(value => {
        const items = Array.isArray(value?.approvals) ? value.approvals : []
        setPending(items)
        if (items.length) setOpen(true)
      }, () => {})
      useEffect(() => {
        load().then(loadSettings)
        loadApprovals()
        if (typeof setInterval !== 'function') return undefined
        const timer = setInterval(loadApprovals, 5000)
        timer?.unref?.()
        return () => clearInterval(timer)
      }, [])
      const homes = data?.homes ?? []
      const count = homes.reduce((n, entry) => n + entry.bots.length, 0)
      const chats = remoteChats ?? []
      const toggleAuto = async (home, on) => {
        setSaving(home)
        try { const r = await call('social/auto-accept', { home, on }); setAuto(value => ({ ...value, [home]: r.autoAccept })) } catch (e) { setError(errorText(e)) } finally { setSaving('') }
      }
      const decide = async (item, decision) => {
        setSaving(item.id)
        try {
          await call('social/decide-approval', { approvalId: item.id, decision })
          await loadApprovals()
        } catch (e) { setError(errorText(e)) } finally { setSaving('') }
      }
      return h('section', { className: 'fs bt-social', 'aria-label': 'Friends\' Bots' },
        h('div', { className: 'fs-head' },
          h('button', { type: 'button', className: 'fs-head-main', 'aria-expanded': open, onClick: () => setOpen(!open) },
            h('span', { className: 'fs-chev', 'aria-hidden': true }, '▾'),
            h('span', { className: 'fs-title' }, 'Friends\' Bots'),
            data ? h('span', { className: 'fs-count', title: `${count} ${count === 1 ? 'Bot' : 'Bots'}` }, String(count)) : null,
            pending.length ? h('span', { className: 'fs-tag fs-pending-tag', 'data-flybot': 'pending-badge', title: `${pending.length} outbound ${pending.length === 1 ? 'reply' : 'replies'} waiting for your approval` }, `${pending.length} to approve`) : null),
          h('button', { type: 'button', className: 'fs-icon', 'aria-expanded': adding, title: 'Add a friend', onClick: () => { setAdding(!adding); setOpen(true) } }, adding ? 'Done' : '+ Add')),
        open ? h('div', { className: 'fs-body' },
          h(PendingApprovals, { items: pending, busy: saving, onDecide: decide }),
          adding ? h(AddFriend, { onChange: () => load().then(loadSettings) }) : null,
          error ? h('div', { className: 'fs-status', 'data-tone': 'error', style: { padding: '4px 10px' } }, error) : null,
          data === null && !error ? h('div', { className: 'fs-hint' }, 'Loading…') : null,
          homes.map(entry => {
            const shut = closed[entry.home] === true
            const rows = entry.bots.map(bot => ({ bot, chat: chats.find(chat => chat.remote?.handle === bot.handle) }))
            return h('div', { key: entry.home, className: 'bt-social-home', 'data-home': entry.home },
              h('div', { className: 'fs-home-head' },
                h('button', { type: 'button', className: 'fs-home', 'aria-expanded': !shut, title: entry.owner ? `${entry.home} · owned by ${entry.owner}` : entry.home, onClick: () => setClosed(value => ({ ...value, [entry.home]: !shut })) },
                  h('span', { className: 'fs-chev', 'aria-hidden': true, 'data-closed': shut || undefined }, '▾'),
                  h('span', { className: 'fs-home-name' }, entry.name ?? entry.home),
                  entry.name ? h('span', { className: 'fs-home-handle' }, entry.home) : null),
                h('label', { className: 'fs-auto', title: 'Auto-accept: messages with this friend go through without your approval. Off: what your Bots send on their own waits for you.' },
                  h('input', { type: 'checkbox', checked: auto[entry.home] !== false, disabled: saving === entry.home, onChange: e => toggleAuto(entry.home, e.target.checked) }),
                  'Auto-accept')),
              shut ? null : entry.bots.length === 0 ? h('div', { className: 'fs-hint' }, 'No Bots shared yet') : null,
              shut ? null : h('div', { className: 'bt-social-rows' }, rows.map(({ bot, chat }) => (chat && typeof renderBot === 'function'
                ? renderBot(chat)
                : h('div', { key: bot.handle, className: 'fs-hint', title: bot.handle }, `${bot.name} · opening its chat…`)))))
          }),
          data && homes.length === 0 && !adding
            ? h('div', { className: 'fs-empty' }, 'No friends yet. Right-click one of your Bots and choose ', h('b', null, 'Copy invite link'), ' (or ', h('b', null, 'Copy invite with instructions'), '), or use ', h('b', null, '+ Add'), ' to join a friend\'s invite.')
            : null) : null)
    }

    // Add friend: join a friend's link and answer requests (invites are made from a Bot's right-click menu).
    function AddFriend({ onChange }) {
      const [overview, setOverview] = useState(null)
      const [code, setCode] = useState('')
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      // Which of my Bots joins: the friend sees and reaches only that one (default: the Main Bot).
      const [mine, setMine] = useState([])
      const [joiner, setJoiner] = useState('')
      const refresh = () => call('social/overview', {}).then(setOverview, e => setStatus({ tone: 'error', text: errorText(e) }))
      useEffect(() => {
        refresh()
        call('social/status', {}).then(value => {
          const bots = value?.bots ?? []
          setMine(bots)
          setJoiner(current => current || (bots.find(bot => bot.isMain) ?? bots[0])?.id || '')
        }, () => {})
      }, [])
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
      const join = e => {
        e.preventDefault()
        return run('Joining', async () => {
          const r = await call('social/join-invite', { code, ...(joiner ? { botId: joiner } : {}) })
          setCode('')
          const as = r.joinedAs ? ` as ${r.joinedAs.botName}` : ''
          return r.status === 'active' ? `You are now friends with ${r.inviterName ?? r.inviter}${as}.` : `Request sent to ${r.inviterName ?? r.inviter}${as}. They show up here once they accept.`
        })
      }
      const respond = (item, decision) => run(decision === 'accept' ? 'Accepting' : 'Declining', async () => {
        await call('social/respond', { relationshipId: item.relationshipId, decision })
        return decision === 'accept' ? `${item.name ?? item.handle} is now a friend.` : `Declined ${item.name ?? item.handle}.`
      })
      const incoming = overview?.incoming ?? []
      const outgoing = overview?.outgoing ?? []
      return h('div', { className: 'bt-social-add', 'data-flybot': 'add-friend' },
        h('div', { className: 'fs-hint', 'data-flybot': 'invite-hint' }, 'To invite a friend to one of your Bots, right-click it in the Bot list and choose ', h('b', null, 'Copy invite link'), ' for the bare link, or ', h('b', null, 'Copy invite with instructions'), ' for the link with how to join.'),
        h('form', { onSubmit: join, className: 'fs-card bt-social-join' },
          h('div', { className: 'fs-hint' }, 'Got a link from a friend?'),
          h('div', { className: 'fs-line' },
            h('input', { className: 'fs-input', value: code, placeholder: 'Paste invite link or code', 'aria-label': 'Invite link or code', onChange: e => setCode(e.target.value) }),
            h('button', { type: 'submit', className: 'fs-btn', disabled: busy || !code.trim() }, 'Join')),
          mine.length > 1 ? h('label', { className: 'fs-line fs-hint', 'data-flybot': 'join-as' }, 'Join as ',
            h('select', { className: 'fs-input', value: joiner, 'aria-label': 'Which of your Bots joins', onChange: e => setJoiner(e.target.value) },
              mine.map(bot => h('option', { key: bot.id, value: bot.id }, bot.name))),
            ' (your friend sees only this Bot)') : null),
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

    // Which local Bots can be invited to (social/status), cached for the synchronous canInvite.
    let status = { at: 0, value: null }
    let statusTask
    const statusListeners = new Set()
    const loadStatus = () => {
      statusTask ??= call('social/status', {}).then(value => {
        const changed = JSON.stringify(value) !== JSON.stringify(status.value)
        status = { at: Date.now(), value }
        if (changed) for (const fn of [...statusListeners]) { try { fn() } catch (error) { console.error('flybot-social: status listener failed', error) } }
        return value
      }).finally(() => { statusTask = undefined })
      return statusTask
    }
    // Fires when what canInvite answers may have changed (first status, connect/disconnect, Bots added).
    const onStatusChange = (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn) }
    // Sync: true when Bot Social is connected and botId is one of this team's Bots. Until the first
    // status answer it is false (and starts loading); the cache refreshes every 30 s.
    function canInvite(botId) {
      if (Date.now() - status.at > 30_000) void loadStatus().catch(() => {})
      return Boolean(status.value?.connected && status.value.bots.some(bot => bot.id === botId))
    }

    // In a Bot's settings: invite a friend to this Bot.
    function InviteToBot({ bot }) {
      useStyles()
      const [invite, setInvite] = useState(null)
      const [note, setNote] = useState(null)
      const [busy, setBusy] = useState(false)
      if (!bot?.id) return null
      const create = async () => {
        setBusy(true); setNote(null)
        try { setInvite(await call('social/create-invite', { botId: bot.id })) } catch (e) { setNote({ tone: 'error', text: errorText(e) }) } finally { setBusy(false) }
      }
      // Called straight from the click, so the clipboard write keeps its permission.
      const copy = text => {
        const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
        if (clip?.writeText) clip.writeText(text).then(() => setNote({ tone: 'ok', text: 'Copied.' }), () => setNote({ tone: 'error', text: 'Could not copy. Select the link and copy it by hand.' }))
      }
      return h('div', { className: 'fs fs-card', 'data-flybot': 'invite-to-bot' },
        h('div', { className: 'fs-hint' }, `Invite a friend to ${bot.name}. They can talk to ${bot.name} only.`),
        h('button', { type: 'button', className: 'fs-btn', disabled: busy, onClick: create }, invite ? 'Create another invite link' : 'Invite to this Bot'),
        invite ? h('div', { className: 'fs-line' },
          h('input', { className: 'fs-input', readOnly: true, value: invite.link, 'aria-label': 'Invite link', onFocus: e => e.target.select() }),
          h('button', { type: 'button', className: 'fs-btn', 'data-flybot': 'copy-link', onClick: () => copy(invite.link) }, 'Copy link'),
          h('button', { type: 'button', className: 'fs-btn', 'data-flybot': 'copy-invite-text', onClick: () => copy(invite.text) }, 'Copy invite with instructions')) : null,
        note ? h('div', { className: 'fs-status', 'data-tone': note.tone }, note.text) : null)
    }

    let cache = { at: 0, list: [] }
    const friendRows = async (query) => {
      if (Date.now() - cache.at > 30_000) cache = { at: Date.now(), list: await call('social/friends', {}) }
      const needle = query.trim().toLowerCase().replace(/^@/, '')
      return cache.list
        .filter(friend => friend.handle.includes(needle) || String(friend.name).toLowerCase().includes(needle))
        // The inserted text asks the Bot to use message_friend_bot; the send is held for approval.
        .map(friend => ({ name: `${friend.name} · remote`, description: `${friend.handle} · ${friend.home}`, section: 'Friends\' Bots', value: `${friend.handle} ` }))
    }

    return {
      name: 'flybot-social',
      inject: [],
      errorText,
      canInvite,
      InviteToBot,
      PendingApprovals,
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
            slots().register('flybot.bot.details', { id: 'social-invite', order: 100, component: InviteToBot }),
          ]
          // For other plugins (the tree's per-node "Copy invite link"): ctx.flybot.social.canInvite(botId)
          // is synchronous; flybot.call('social.createInvite', { botId }) returns { link, text, ... }.
          const social = { canInvite, onChange: onStatusChange, createInvite: botId => call('social.createInvite', { botId }) }
          globalThis.__flybot__.social = social
          if (globalThis.__flybot__.api) globalThis.__flybot__.api.social = social
          offs.push(() => {
            if (globalThis.__flybot__?.social === social) delete globalThis.__flybot__.social
            if (globalThis.__flybot__?.api?.social === social) delete globalThis.__flybot__.api.social
          })
          void loadStatus().catch(() => {})
          // Keep canInvite current (and onChange firing) without callers polling.
          if (typeof setInterval === 'function') {
            const statusTimer = setInterval(() => { void loadStatus().catch(() => {}) }, 30_000)
            statusTimer?.unref?.() // node tests: never keeps the process alive
            offs.push(() => clearInterval(statusTimer))
          }
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
