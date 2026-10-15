// Local hide of a friend's Bot (#90): persist the handle, drop it from Friends' Bots,
// and show it again only after it leaves the granted list and comes back (re-grant).
export function hideRemoteInSettings(settings, handle, at = Date.now()) {
  const key = String(handle ?? '')
  if (!key) return settings
  return {
    ...settings,
    hiddenRemotes: { ...(settings?.hiddenRemotes ?? {}), [key]: { hiddenAt: at } },
  }
}

export function isHiddenRemote(settings, handle) {
  return Boolean(settings?.hiddenRemotes?.[String(handle ?? '')])
}

// A handle that vanished from list_remote_bots was revoked. Forget the hide so an
// explicit re-grant (it appears again) shows the Bot in Friends' Bots.
export function forgetHiddenIfGone(settings, presentHandles) {
  const present = new Set((presentHandles ?? []).map(value => String(value ?? '')))
  const hidden = { ...(settings?.hiddenRemotes ?? {}) }
  let changed = false
  for (const handle of Object.keys(hidden)) {
    if (!present.has(handle)) {
      delete hidden[handle]
      changed = true
    }
  }
  if (!changed) return settings
  return { ...settings, hiddenRemotes: hidden }
}

export function filterHiddenHomes(homes, settings) {
  const hidden = settings?.hiddenRemotes ?? {}
  return (homes ?? []).map(entry => ({
    ...entry,
    bots: (entry.bots ?? []).filter(bot => !hidden[String(bot?.handle ?? '')]),
  }))
}

export function presentRemoteHandles(homes) {
  return (homes ?? []).flatMap(entry => (entry.bots ?? []).map(bot => String(bot?.handle ?? '')).filter(Boolean))
}

export const WAITING_OWNER = 'Waiting for approval'
export const WAITING_OTHERS = "Waiting for the owner's approval"
export const REJECT_NOTE = 'Rejected.'

export function chatApprovalTitle(canDecide) {
  return canDecide ? WAITING_OWNER : WAITING_OTHERS
}

export function approvalsForSession(items, session = {}) {
  const list = Array.isArray(items) ? items : []
  const handle = String(session.handle ?? session.bot?.remote?.handle ?? '')
  const faceId = session.faceRoomId ?? session.room?.face?.roomId
  const roomId = session.roomId ?? session.room?.id
  const handles = new Set((session.handles ?? session.room?.participants ?? [])
    .map(p => (typeof p === 'string' ? p : p?.handle))
    .filter(Boolean)
    .map(String))
  if (handle) handles.add(handle)
  return list.filter(item => {
    if (faceId && item.roomId === faceId) return true
    if (roomId && item.roomId === roomId) return true
    if (item.to && handles.has(String(item.to))) return true
    if (item.fromHandle && handles.has(String(item.fromHandle))) return true
    return false
  })
}
