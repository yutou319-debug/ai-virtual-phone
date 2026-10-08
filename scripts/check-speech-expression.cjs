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
    assert.equal(prepare('哈哈，你来了！', 'Minimax', 'speech-2.8-turbo', true), '(chuckle)，你来了！');
    assert.equal(prepare('唉，今天好累。哈哈，没事了。', 'Minimax', 'speech-2.8-turbo', true), '(sighs)，今天好累。哈哈，没事了。');
    assert.equal(prepare('哈哈，你来了！', 'Minimax', 'speech-2.8-turbo'), '哈哈，你来了！');
    assert.equal(prepare('哈哈，你来了！', 'Minimax', 'speech-02-hd', true), '哈哈，你来了！');
    assert.equal(prepare('别笑。不要叹气。“哈哈，你来了。”', 'Minimax', 'speech-2.8-turbo', true), '别笑。不要叹气。“哈哈，你来了。”');
    assert.equal(prepare('【轻笑】哈哈，你来了！', 'Minimax', 'speech-2.8-turbo', true), '(chuckle)哈哈，你来了！');
    const service = fs.readFileSync('lib/tts-service.ts', 'utf8');
    const end = service.indexOf('// ── Audio Playback');
    const isolated = service.slice(0, end < 0 ? service.length : end)
        .replace(/^import .*;\n/gm, '')
        .replace(/export type VoiceApiConfigResolved = VoiceApiConfig;/, '')
        .replace(/export function resolveVoiceConfig[\s\S]*?\n}\n/, '');
    const ambience = fs.readFileSync('lib/speech-ambience.ts', 'utf8');
    const { detectSpeechAmbience, rainBed, addSpeechAmbience } = await load(ambience);
    assert.equal(detectSpeechAmbience('窗外正在下雨，早点休息。'), 'rain');
    assert.equal(detectSpeechAmbience('听，窗外的雨声。'), 'rain');
    for (const text of ['外面没下雨。', '如果窗外下雨就好了。', '窗外会下雨。', '他说“外面正在下雨”。', '喜欢雨天。']) assert.equal(detectSpeechAmbience(text), null);
    const voice = new Float32Array(24000).fill(0.2);
    const mixed = rainBed(voice, 24000);
    assert.equal(mixed.length, voice.length);
    assert.equal(mixed[0], voice[0]);
    assert.equal(mixed.at(-1), voice.at(-1));
    assert.ok(mixed.some((sample, index) => sample !== voice[index]));
    assert.ok(mixed.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
    const original = new Blob(['original']);
    assert.equal(await addSpeechAmbience(original, 'rain'), original, 'unsupported browser keeps original');
    global.OfflineAudioContext = class {
        async decodeAudioData() {
            return { duration: 1, length: voice.length, sampleRate: 24000, numberOfChannels: 1, getChannelData: () => voice };
        }
    };
    const wav = await addSpeechAmbience(original, 'rain');
    assert.equal(wav.type, 'audio/wav');
    const bytes = new Uint8Array(await wav.arrayBuffer());
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'RIFF');
    assert.equal(bytes.length, 44 + voice.length * 2);
    const { synthesizeSpeech } = await load(expression + '\n' + ambience + '\n' + isolated);
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
    await synthesizeSpeech('外面正在下雨。', config);
    await synthesizeSpeech('外面正在下雨。', { ...config, autoSpeechAmbience: true });
    assert.equal(requests, 5, 'ambience toggle must reuse already generated speech');
    global.OfflineAudioContext = class { async decodeAudioData() { throw new Error('decode failure'); } };
    await synthesizeSpeech('外面正在下雨。', { ...config, autoSpeechAmbience: true });
    assert.equal(requests, 5, 'local mix failure must not regenerate speech');
    console.log('PASS: cues, automatic detection, rain rules, bounded PCM and WAV encoding, 20 concurrent requests deduplicated, cached replay, ambience toggles and mix failure reuse speech, no automatic retry. No paid API calls.');
})().catch(error => { console.error(error); process.exit(1); });
