// The sidebar Bot list as one tree under the Main Bot, from a plugin's 'flybot.sidebar.structure'.
import test from 'node:test'
import assert from 'node:assert/strict'
import { botTree, SLOTS } from '../src/client/flybot-registry.js'

const names = node => [node.bot.name, ...node.children.map(names)]

test('botTree: Chief is the root; Bots without a known parent go under it; cycles are broken', () => {
  assert.ok(SLOTS.includes('flybot.sidebar.structure'))
  const bots = ['chief', 'work', 'dev', 'research', 'oldroot', 'a', 'b'].map(id => ({ id, name: id }))
  const parents = { work: 'chief', dev: 'work', research: undefined, oldroot: null, a: 'b', b: 'a' }
  const [root] = botTree(bots, 'chief', id => parents[id])
  assert.equal(root.bot.id, 'chief')
  assert.equal(root.depth, 0)
  assert.deepEqual(names(root), ['chief', ['work', ['dev']], ['research'], ['oldroot'], ['a'], ['b']])
  assert.equal(root.children[0].children[0].depth, 2)
  // A parent that is not a listed Bot, or the Bot itself, also means "under Chief".
  const [again] = botTree(bots.slice(0, 3), 'chief', id => ({ work: 'gone', dev: 'dev' })[id])
  assert.deepEqual(names(again), ['chief', ['work'], ['dev']])
  assert.deepEqual(botTree(bots, 'missing', () => undefined), [])
})
