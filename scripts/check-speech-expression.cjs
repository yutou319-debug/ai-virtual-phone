const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const load = source => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
(async () => {
    const expression = fs.readFileSync('lib/speech-expression.ts', 'utf8');
    const { prepareSpeechText: prepare } = await load(expression);
    assert.equal(prepare('【轻笑】你好。（叹气）晚安。', 'Minimax', 'speech-2.8-turbo'), '(chuckle)你好。(sighs)晚安。');
    assert.equal(prepare('[breath]你好(chuckle)', 'Minimax', 'speech-2.8-hd'), '(breath)你好(chuckle)');
    assert.equal(prepare('[轻笑]你好', 'Minimax', 'speech-02-hd'), '你好');
    assert.equal(prepare('(sighs)你好', 'OpenAI', 'tts-1'), '你好');
    assert.equal(prepare('我轻笑着说你好（只是说明）', 'Minimax', 'speech-2.8-turbo'), '我轻笑着说你好（只是说明）');
    const service = fs.readFileSync('lib/tts-service.ts', 'utf8');
    const end = service.indexOf('// ── Audio Playback');
    const isolated = service.slice(0, end < 0 ? service.length : end)
        .replace(/^import .*;\n/gm, '')
        .replace(/export type VoiceApiConfigResolved = VoiceApiConfig;/, '')
        .replace(/export function resolveVoiceConfig[\s\S]*?\n}\n/, '');
    const { synthesizeSpeech } = await load(expression + '\n' + isolated);
    let requests = 0, fail = false;
    global.fetch = async () => {
        requests++;
        await new Promise(resolve => setTimeout(resolve, 5));
        if (fail) throw new Error('network interruption');
        return new Response(JSON.stringify({ data: { audio: '010203' } }));
    };
    const config = { provider: 'Minimax', model: 'speech-2.8-turbo', apiKey: 'mock', defaultVoice: 'mock-voice' };
    await Promise.all(Array.from({ length: 20 }, () => synthesizeSpeech('[轻笑]你好', config)));
    assert.equal(requests, 1);
    await synthesizeSpeech('[轻笑]你好', config);
    assert.equal(requests, 1);
    await synthesizeSpeech('[轻笑]你好', { ...config, defaultVoice: 'other-voice' });
    assert.equal(requests, 2);
    fail = true;
    await assert.rejects(synthesizeSpeech('测试失败', config));
    assert.equal(requests, 3, 'failure must not auto-retry');
    fail = false;
    await synthesizeSpeech('测试失败', config);
    assert.equal(requests, 4, 'explicit retry may send a new request');
    console.log('PASS: cue adaptation, older-model fallback, 20 concurrent requests deduplicated, cache replay, voice isolation, no automatic retry. No paid API calls.');
})().catch(error => { console.error(error); process.exit(1); });
