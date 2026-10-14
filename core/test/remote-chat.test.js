import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteTurn, isRemoteChat, REMOTE_PROVIDER } from '../src/host/remote-chat.js';

const user = (content, source, id = 'm1') => ({ role: 'user', id, content, ...(source ? { source } : {}) });

test('typed user text is sent to the remote bot', () => {
    const t = remoteTurn([user('hi there')]);
    assert.equal(t.kind, 'send');
});

test('relayed remote text is echoed, not re-sent', () => {
    const t = remoteTurn([user('<fenced/>', { kind: 'bot', form: 'remote-chat', text: 'pong' })]);
    assert.equal(t.kind, 'echo');
    assert.equal(t.text, 'pong');
});

test('other sources and empty history do nothing', () => {
    assert.equal(remoteTurn([user('x', { kind: 'bot', form: 'other' })]).kind, 'none');
    assert.equal(remoteTurn([]).kind, 'none');
});

test('remote chats are recognised by their remote field', () => {
    assert.equal(isRemoteChat({ remote: { handle: '@a.b.home' } }), true);
    assert.equal(isRemoteChat({ name: 'x' }), false);
    assert.equal(REMOTE_PROVIDER, 'flybot-remote');
});

test('roster and model guards keep a friend\'s Bot on its relay route', async () => {
    const { readFileSync } = await import('node:fs')
    const src = f => readFileSync(new URL('../src/host/' + f, import.meta.url), 'utf8')
    assert.match(src('models.js'), /bot\.remote\?\.handle\) return `flybot-remote\//)
    assert.match(src('roster.js'), /bot\.remote !== undefined\) \{ delete patch\.model/)
})

test('a time-context snapshot appended after the typed text does not swallow it', () => {
    const clock = user('Current time: 2026-10-14, 19:47:33 GMT+08:00 (Asia/Shanghai).', { kind: 'ds-bot-time-context', form: 'snapshot', sections: [] }, 'm2');
    const t = remoteTurn([user('hi', { kind: 'user' }), clock]);
    assert.equal(t.kind, 'send');
    assert.equal(t.text, 'hi');
    assert.equal(t.messageId, 'm1');
});
