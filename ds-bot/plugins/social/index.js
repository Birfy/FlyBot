// flybot-social: a FlyBot plugin (Cordis plugin for DeepSeek Harness) that lets every
// local Bot chat with friends' Bots on a Bot Social server. Needs ds-bot with the
// FlyBot API (ctx.flybot). See README.md for the home / member model.
//
// Config:
//   server           Bot Social base URL
//   credentialsPath  where the one-call onboarding keeps { token, home } (default
//                    $DSH_HOME/bot/flybot-social.json, mode 600; never committed)
//   displayName      name for the home on first onboarding
//   webhookUrl       optional push webhook registered at onboarding
//   approval         { default: 'hold' | 'auto', homes: { '@bob.home': 'auto' } }
//   inboxPollMs      poll members' inboxes this often; 0 = off (default 15000)
//   token / botId    legacy per-bot identity (no home): owner connector token + bot id
import { join } from 'node:path'
import { startSocial } from './src/social.js'

export const name = 'flybot-social'
export const inject = ['flybot']

export function apply(ctx, config = {}) {
  let social
  let stopped = false
  const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '.', '.dsh')
  const ready = startSocial(ctx.flybot, { inboxPollMs: 15_000, credentialsPath: join(dshHome, 'bot', 'flybot-social.json'), ...config })
    .then((value) => {
      social = value
      if (stopped) social.dispose()
      return value
    })
    .catch((error) => {
      console.warn('flybot-social: start failed:', error?.message ?? error)
    })
  ctx.effect(() => () => {
    stopped = true
    social?.dispose()
  }, 'flybot-social')
  return ready
}
