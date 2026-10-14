# FlyBot plugins

Each plugin is a Cordis plugin for DeepSeek Harness with `inject: ['flybot']`. It touches
ds-bot only through the `flybot` service (`../src/host/hooks.js`, types in
`../types/flybot.d.ts`) and the browser slots (`../src/client/flybot-slots.js`).

- `social/`: chat with friends' Bots on a Bot Social server; every outbound message is
  held for the owner's approval.
- `tree/`: recursive Bot tree (recursive-bot).

Each plugin's tests run under ds-bot's `npm test` through `../test/<name>-plugin.test.js`.
