// -------------------------------------------------------------------------
// FlyBot frontend slots. Feature plugins' client bundles register into one shared
// registry at globalThis.__flybot__ (created by whichever bundle loads first), and
// ds-bot's own components render whatever is registered:
//
//   flybot.sidebar.section  { id, order, component({ roster, actions, call }) }   below the Bot list
//   flybot.sidebar.structure { id, order, parentOf(botId), menuItems?, nodeActions? }   the Bot list becomes one tree under the Main Bot;
//                            menuItems({ bot }) → [{ id, label, visible, run({ bot }) }] adds items to a Bot's right-click
//                            menu (visible false hides one; a string from run shows as a toast; a throw as the error toast);
//                            nodeActions({ bot }) is drawn after each tree row
//   flybot.composer.mention { id, order, candidates(query, { sessionId, roster, call }) → rows }   rows in the "@" menu
//   flybot.bot.details      { id, order, component({ bot, roster, call }) }        in a Bot's settings
//   flybot.approvals        { id, order, component({ approval, decide, call }) }   custom card for a held send
//
// Types: ds-bot/types/flybot.d.ts (FlyBotClientRegistry).
import { createElement as h, Fragment, useEffect, useState } from 'react'
import { call as callHost } from './api.js'
import { registry as baseRegistry, remoteMembersByHome } from './flybot-registry.js'

import { createClientApi as createClientApiWith } from './flybot-registry.js'

export { SLOTS, createRegistry, mentionCandidates, botTree } from './flybot-registry.js'

// Calls a FlyBot endpoint on the host: "approvals", "decide", or a plugin's "social/...".
export const call = (endpoint, payload) => callHost(`flybot/${endpoint}`, payload)

export function registry() {
  const slots = baseRegistry()
  globalThis.__flybot__.call ??= call
  return slots
}

// The browser `flybot` service bound to this bundle's host route.
export const createClientApi = (options = {}) => createClientApiWith({ call, registry, ...options })

function useSlot(name) {
  const slots = registry()
  const [, setVersion] = useState(0)
  useEffect(() => slots.subscribe(() => setVersion(slots.version())), [slots])
  return slots.entries(name)
}

// Renders a plugin component without letting its failure take the sidebar down.
function Safe({ entry, props }) {
  try {
    return h(entry.component, props)
  } catch (error) {
    console.error(`flybot: ${entry.id} failed`, error)
    return null
  }
}

// Friends' remote Bots, grouped by home, each with a remote badge. Built in, so they
// show whichever plugin published them.
export function RemoteMembers({ roster }) {
  const homes = remoteMembersByHome(roster)
  const [open, setOpen] = useState('')
  if (homes.length === 0) return null
  return h('div', { className: 'bt-flybot-section bt-remote-members', 'data-flybot': 'remote-members' },
    h('div', { className: 'bt-flybot-title' }, 'Remote members'),
    homes.map(home => h('div', { key: home.home, className: 'bt-remote-home', title: home.home },
      h('div', { className: 'bt-remote-home-name' }, home.name),
      home.bots.map(bot => h(Fragment, { key: bot.handle },
        h('button', { type: 'button', className: 'bt-remote-member', title: `Message ${bot.handle}`, 'aria-expanded': open === bot.handle, onClick: () => setOpen(open === bot.handle ? '' : bot.handle) },
          h('span', { className: 'bt-remote-name' }, bot.name),
          h('span', { className: 'bt-remote-badge' }, 'remote')),
        open === bot.handle ? h(RemoteCompose, { bot, roster, onDone: () => setOpen('') }) : null)))))
}

const MAX_FILE_BYTES = 20 * 1024 * 1024
const readBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

// Composer for one remote member: text plus files, sent from a team Bot through
// bot.send, so the plugin's approval (with the file names and sizes) still applies.
export function RemoteCompose({ bot, roster, onDone }) {
  const bots = roster.bots ?? []
  const [from, setFrom] = useState((bots.find(b => b.isMain) ?? bots[0])?.id ?? '')
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [status, setStatus] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    const big = files.find(file => file.size > MAX_FILE_BYTES)
    if (big) return setStatus(`${big.name} is over 20 MB`)
    setStatus('Sending…')
    try {
      const payload = await Promise.all(files.map(async file => ({ name: file.name, mime: file.type, content_base64: await readBase64(file) })))
      const result = await call(`${bot.plugin ?? 'social'}/send`, { from, to: bot.handle, text: text || `${payload.length} file(s)`, files: payload })
      const value = result?.value ?? result
      setStatus(value?.action === 'hold' ? 'Waiting for your approval' : value?.action === 'deny' ? `Not sent: ${value.reason}` : 'Sent')
      if (value?.action !== 'deny') { setText(''); setFiles([]); setTimeout(onDone, 1500) }
    } catch (error) {
      setStatus(String(error?.message ?? error))
    }
  }
  return h('form', { className: 'bt-remote-compose', onSubmit: submit },
    h('select', { value: from, 'aria-label': 'Send as', onChange: e => setFrom(e.target.value) }, bots.map(b => h('option', { key: b.id, value: b.id }, b.name))),
    h('textarea', { value: text, placeholder: `Message ${bot.handle}`, onChange: e => setText(e.target.value) }),
    h('input', { type: 'file', multiple: true, 'aria-label': 'Attach files', onChange: e => setFiles([...e.target.files].slice(0, 5)) }),
    files.length ? h('div', null, files.map(file => `${file.name} · ${fileSize(file.size)}`).join(', ')) : null,
    h('button', { type: 'submit', disabled: !from || (!text.trim() && files.length === 0) }, 'Send'),
    status ? h('div', { role: 'status' }, status) : null)
}

// The first 'flybot.sidebar.structure' entry, or undefined: the sidebar then lists Bots flat.
export function useSidebarStructure() {
  return useSlot('flybot.sidebar.structure')[0]
}

export function FlyBotSections({ roster, actions }) {
  // Entries from the FlyBot registry plus any a plugin put in DSH's own slot of that name.
  const shell = (actions.flybotSlotEntries?.('flybot.sidebar.section') ?? [])
    .map((entry, index) => ({ id: entry.id ?? `slot-${index}`, order: entry.order ?? 0, component: entry.component }))
  const entries = [...useSlot('flybot.sidebar.section'), ...shell].sort((a, b) => a.order - b.order)
  return h(Fragment, null, h(RemoteMembers, { roster }), entries.map(entry => h('div', { key: entry.id, className: 'bt-flybot-section', 'data-flybot': entry.id },
    h(Safe, { entry, props: { roster, actions, call } }))))
}

export function FlyBotDetails({ bot, roster }) {
  const entries = useSlot('flybot.bot.details')
  if (entries.length === 0) return null
  return h(Fragment, null, entries.map(entry => h('div', { key: entry.id, className: 'bt-flybot-details', 'data-flybot': entry.id },
    h(Safe, { entry, props: { bot, roster, call } }))))
}

const POLL_MS = 5000

// The owner's queue of held sends: a card each, approve or reject. A plugin's
// flybot.approvals entry may draw the card for its own policy's approvals.
export function FlyBotApprovals() {
  const entries = useSlot('flybot.approvals')
  const [pending, setPending] = useState([])
  const [busy, setBusy] = useState('')
  const refresh = () => call('approvals').then(list => setPending(Array.isArray(list) ? list : [])).catch(() => {})
  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [])
  if (pending.length === 0) return null
  const decide = async (id, decision) => {
    setBusy(id)
    try {
      await call('decide', { id, decision })
    } finally {
      setBusy('')
      await refresh()
    }
  }
  return h('div', { className: 'bt-flybot-approvals', role: 'region', 'aria-label': 'Messages waiting for your approval' },
    pending.map((approval) => {
      const custom = entries.find(entry => entry.policy === undefined || entry.policy === approval.by)
      if (custom) return h('div', { key: approval.id }, h(Safe, { entry: custom, props: { approval, decide: decision => decide(approval.id, decision), call } }))
      const to = typeof approval.request.to === 'object' ? approval.request.to.handle : approval.request.to
      return h('div', { key: approval.id, className: 'bt-flybot-approval' },
        h('div', { className: 'bt-flybot-approval-head' }, `Message to ${to} · ${approval.reason}`),
        h('div', { className: 'bt-flybot-approval-text' }, approval.request.text),
        approval.request.attachments?.length
          ? h('ul', { className: 'bt-flybot-approval-files', 'aria-label': 'Attached files' }, approval.request.attachments.map((file, index) =>
            h('li', { key: index }, `${file.name} · ${fileSize(file.size)}`)))
          : null,
        h('div', { className: 'bt-flybot-approval-actions' },
          h('button', { type: 'button', disabled: busy === approval.id, onClick: () => decide(approval.id, 'approve') }, 'Approve'),
          h('button', { type: 'button', disabled: busy === approval.id, onClick: () => decide(approval.id, 'reject') }, 'Reject')))
    }))
}

export const fileSize = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

export const FLYBOT_CSS = `
.bt-flybot-approval-files { margin: 0 0 8px; padding-left: 18px; font-size: 12px; }
.bt-file-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 0 30px; }
.bt-file-chip { font-size: 12px; padding: 3px 8px; border-radius: 8px; border: 1px solid var(--bt-line, rgba(0,0,0,.15)); background: transparent; cursor: pointer; }
.bt-remote-compose { display: flex; flex-direction: column; gap: 4px; padding: 4px 12px 8px; font-size: 12px; }
.bt-remote-compose textarea { font: inherit; min-height: 48px; }
.bt-remote-badge { font-size: 10px; padding: 0 5px; margin-left: 6px; border-radius: 6px; background: rgba(120,120,160,.18); text-transform: lowercase; }
.bt-remote-member { display: flex; align-items: center; padding: 2px 12px; font-size: 13px; }
.bt-remote-home-name { padding: 4px 12px 0; font-size: 11px; opacity: .7; }

.bt-flybot-section { margin-top: 8px; border-top: 1px solid var(--bt-line, rgba(0,0,0,.08)); padding-top: 6px; }
.bt-flybot-approvals { position: fixed; right: 16px; bottom: 16px; z-index: 50; display: flex; flex-direction: column; gap: 8px; max-width: 360px; }
.bt-flybot-approval { background: var(--bt-card, #fff); border: 1px solid var(--bt-line, rgba(0,0,0,.12)); border-radius: 10px; padding: 10px 12px; box-shadow: 0 4px 16px rgba(0,0,0,.12); font-size: 13px; }
.bt-flybot-approval-head { font-weight: 600; margin-bottom: 4px; }
.bt-flybot-approval-text { white-space: pre-wrap; max-height: 120px; overflow: auto; margin-bottom: 8px; }
.bt-flybot-approval-actions { display: flex; gap: 8px; justify-content: flex-end; }
`
