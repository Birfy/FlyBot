import { createElement as h } from 'react'
import { useEscape } from './overlay-hooks.js'
import { CloseIcon } from './icons.js'
import { BotMark } from './mark.js'
import { FlyBotDetails } from './flybot-slots.js'
import { t } from './i18n.js'

export const REMOTE_BOT_SETTINGS_CSS = `
.bt-remote-sheet-layer{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-end;justify-content:center;padding:16px;pointer-events:none}
.bt-remote-sheet-layer[data-leaving]{pointer-events:none}
.bt-remote-sheet-layer .bt-scrim{pointer-events:auto}
.bt-remote-sheet{pointer-events:auto;width:min(320px,calc(100vw - 32px));max-height:min(70vh,420px);margin:0 auto 0;border-radius:14px;background:var(--bt-card,#fff);border:.5px solid var(--bt-line-2);box-shadow:0 12px 40px rgba(20,20,20,.16);display:flex;flex-direction:column;overflow:hidden;animation:bt-remote-sheet-in .2s ease-out}
.bt-remote-sheet-layer[data-leaving] .bt-remote-sheet{animation:bt-remote-sheet-out .16s ease-in forwards}
.bt-remote-sheet-head{display:flex;align-items:center;gap:10px;padding:12px 12px 8px}
.bt-remote-sheet-who{display:flex;flex-direction:column;min-width:0;gap:1px;flex:1 1 auto}
.bt-remote-sheet-name{font-size:16px;line-height:22px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-remote-sheet-sub{font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-remote-sheet-body{padding:0 12px 14px;overflow:auto}
@keyframes bt-remote-sheet-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes bt-remote-sheet-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(8px)}}
@media (min-width:520px){
.bt-remote-sheet-layer{align-items:center;padding:24px}
.bt-remote-sheet{margin:0}
}
`

export function RemoteBotSettingsSheet({ bot, roster, actions, leaving = false }) {
  const close = () => actions.closeSettings()
  useEscape(close)
  if (!bot?.remote) return null
  const who = bot.remote.homeName || bot.remote.owner || bot.remote.home || t("Friend's Bot")
  return h('div', { className: 'bt-remote-sheet-layer', 'data-leaving': leaving || undefined, 'data-flybot': 'remote-bot-sheet' },
    h('div', { className: 'bt-scrim', onMouseDown: close }),
    h('div', { className: 'bt-remote-sheet', role: 'dialog', 'aria-modal': true, 'aria-label': t('Bot settings') },
      h('div', { className: 'bt-remote-sheet-head' },
        h(BotMark, { bot, size: 40, live: true }),
        h('div', { className: 'bt-remote-sheet-who' },
          h('span', { className: 'bt-remote-sheet-name' }, bot.name),
          h('span', { className: 'bt-remote-sheet-sub' }, who)),
        h('button', { type: 'button', className: 'bt-icon-btn', 'aria-label': t('Close settings'), onClick: close }, h(CloseIcon))),
      h('div', { className: 'bt-remote-sheet-body' },
        bot.remote.handle ? h('div', { className: 'bt-muted', style: { marginBottom: 8, fontSize: 12 } }, bot.remote.handle) : null,
        h(FlyBotDetails, { bot, roster, actions }))))
}
