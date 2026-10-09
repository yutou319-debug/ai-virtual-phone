const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const { act } = React;
global.IS_REACT_ACT_ENVIRONMENT = true;
function load(path, mocks = {}, globals = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] || require(name),
        console, crypto: global.crypto, AbortController, Blob, ...globals }, { filename: path });
    return module.exports;
}
(async () => {
    const queueModule = load('lib/call-turn-queue.ts');
    const { CallTurnQueue, normalizeCallAutoOptions } = queueModule;
    let release, running = 0, maxRunning = 0;
    const calls = [], pending = [];
    const queue = new CallTurnQueue(n => pending.push(n));
    const execute = async text => {
        running++; maxRunning = Math.max(maxRunning, running); calls.push(text);
        if (text === 'first') await new Promise(resolve => { release = resolve; });
        running--;
    };
    const first = queue.submit('first', execute);
    for (let n = 0; n < 5; n++) assert.equal(await queue.submit(`queued-${n}`, execute), true);
    assert.equal(await queue.submit('overflow', execute), false);
    assert.equal(await queue.submit(undefined, execute), false, 'automatic turns never queue behind user turns');
    release(); await first;
    assert.deepEqual(calls, ['first', 'queued-0', 'queued-1', 'queued-2', 'queued-3', 'queued-4']);
    assert.equal(maxRunning, 1); assert.equal(pending.at(-1), 0);
    const stopped = new CallTurnQueue(() => {});
    let unblock, executions = 0;
    const ongoing = stopped.submit('a', async () => { executions++; await new Promise(resolve => { unblock = resolve; }); });
    await stopped.submit('b', async () => { executions++; });
    stopped.stop(); unblock(); await ongoing;
    assert.equal(executions, 1); assert.equal(await stopped.submit('c', execute), false);
    assert.equal(normalizeCallAutoOptions(0, 100).intervalSeconds, 120);
    assert.equal(normalizeCallAutoOptions(0, 100).limit, 10);

    const listeners = new Map();
    const document = { visibilityState: 'visible', body: {}, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
    let nextId = 0; const timers = new Map();
    const clock = { setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id), document };
    const { useCallAutoChat } = load('components/chat/use-call-auto-chat.ts', { '@/lib/call-turn-queue': queueModule }, clock);
    let options, attempts = 0, success = true, state = 'IDLE', count = 0;
    function Harness() { options = useCallAutoChat(state, async () => { attempts++; return success; }, count); return null; }
    let renderer;
    await act(async () => { renderer = Renderer.create(React.createElement(Harness)); });
    assert.equal(options.enabled, false); assert.equal(timers.size, 0);
    await act(async () => { options.setEnabled(true); options.setLimit(3); });
    const fire = async () => {
        assert.equal(timers.size, 1);
        const [id, timer] = timers.entries().next().value; assert.ok(timer.ms >= 120000);
        timers.delete(id); await act(async () => { await timer.fn(); });
    };
    await act(async () => { state = 'USER_SPEAKING'; renderer.update(React.createElement(Harness)); });
    assert.equal(timers.size, 0);
    await act(async () => { state = 'IDLE'; renderer.update(React.createElement(Harness)); });
    await act(async () => { document.visibilityState = 'hidden'; listeners.get('visibilitychange')(); });
    assert.equal(timers.size, 0); assert.equal(attempts, 0);
    await act(async () => { document.visibilityState = 'visible'; listeners.get('visibilitychange')(); });
    await fire(); await fire(); await fire();
    assert.equal(attempts, 3); assert.equal(timers.size, 0);
    await act(async () => { options.setEnabled(false); });
    await act(async () => { options.setEnabled(true); });
    assert.equal(timers.size, 0, 'toggling never resets per-call spending cap');
    await act(async () => { options.setLimit(5); }); success = false; await fire();
    assert.equal(options.enabled, false); assert.equal(options.used, 4); assert.equal(timers.size, 0);
    await act(async () => { renderer.unmount(); });
    assert.equal(timers.size, 0);

    const store = load('lib/call-session-store.ts');
    let mounts = 0, unmounts = 0;
    function Screen() { React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []); return React.createElement('call'); }
    const layer = load('components/chat/call-layer.tsx', {
        '@/lib/call-session-store': store,
        '@/lib/chat-storage': { loadChatSessions: () => [{ id: 'session', contactId: 'character' }] },
        '@/lib/character-storage': { loadCharacters: () => [{ id: 'character', name: '路辰' }] },
        '@/lib/follow-up-service': { cancelFollowUp: () => {} },
        './voice-call-screen': { VoiceCallScreen: Screen }, './video-call-screen': { VideoCallScreen: Screen },
        'react-dom': { createPortal: children => children },
    }, { document, window: { dispatchEvent: () => {} }, CustomEvent: class {} });
    function Shell({ page }) { return React.createElement(React.Fragment, null, React.createElement('page', { name: page }), React.createElement(layer.CallLayer)); }
    await act(async () => { renderer = Renderer.create(React.createElement(Shell, { page: 'chat' })); });
    await act(async () => { assert.equal(store.startCall({ sessionId: 'session', characterId: 'character', kind: 'voice', initiator: 'user' }), true); });
    assert.equal(mounts, 1);
    assert.equal(store.startCall({ sessionId: 'other', characterId: 'other', kind: 'voice', initiator: 'user' }), false);
    const id = store.getActiveCall().id;
    await act(async () => { store.minimizeCall(); renderer.update(React.createElement(Shell, { page: 'moments' })); });
    await act(async () => { store.restoreCall(); renderer.update(React.createElement(Shell, { page: 'desktop' })); });
    assert.equal(mounts, 1); assert.equal(unmounts, 0, 'navigation/minimize never remount the paid executor');
    await act(async () => { store.endCall('stale-call-id'); }); assert.equal(store.getActiveCall().id, id);
    await act(async () => { store.endCall(id); }); assert.equal(unmounts, 1);
    await act(async () => { renderer.unmount(); });
    // Exercise the real voice screen with a slow model and slow audio player.
    let modelCalls = 0, speechCalls = 0, audioStops = 0, resolveModel, finishAudio;
    let savedId = 0;
    const history = [];
    const noOp = () => {};
    const { VoiceCallScreen } = load('components/chat/voice-call-screen.tsx', {
        '@/lib/call-turn-queue': queueModule,
        './use-call-auto-chat': { useCallAutoChat },
        './call-auto-chat-controls': { CallAutoChatControls: () => null },
        './call-mini-window': { CallMiniWindow: props => React.createElement('mini-call', props) },
        '@/lib/chat-storage': { loadChatMessages: () => history.slice(), getLatestCharacterStateValues: () => [], pushChatMessage: input => {
            const message = { ...input, id: `saved-${++savedId}` }; history.push(message); return message;
        } },
        '@/lib/chat-status-region': { getStatusRegionConfig: noOp, isCustomStatusRegionActive: () => false },
        '@/lib/rich-message-parser': { parseAIResponse: text => ({ parts: [{ content: text }], stateValues: [] }) },
        '@/lib/chat-engine': { generateChatCompletion: () => { modelCalls++; return new Promise(resolve => { resolveModel = resolve; }); }, flattenCompletionResult: value => value },
        '@/lib/settings-storage': { resolveUserIdentity: () => ({ name: '鱼头' }) },
        '@/lib/follow-up-service': { cancelFollowUp: noOp },
        '@/lib/stt-service': { createSTTSession: () => { throw new Error('text mode must not start mic'); } },
        '@/lib/tts-service': { resolveVoiceConfig: () => ({}), synthesizeSpeech: async () => { speechCalls++; return new Blob(['speech']); },
            playAudioBlobViaMediaElement: () => ({ promise: new Promise(resolve => { finishAudio = resolve; }), abort: () => { audioStops++; finishAudio(); } }), setCallAudioSessionActive: noOp },
        '@/lib/stt-cloud': { isCallRecordingSupported: () => false },
        './use-hold-to-talk': { useHoldToTalk: () => ({}) },
        '@/lib/use-weixin-bridge': { suspendKeepAliveForCall: noOp, resumeKeepAliveAfterCall: noOp },
        './message-bubble': { BilingualTextBlock: props => React.createElement('subtitle', props) },
        '@/lib/bilingual-text': { splitBilingualText: () => null },
        './use-call-keyboard-offset': { useCallKeyboardOffsetStyle: () => ({}) },
        './call-stt-warning-dialog': { CallSttWarningDialog: () => null, isCallSttWarningHidden: () => true },
        './voice-input-platform': { isAndroidBrowser: () => true, isIOSDevice: () => false },
        './call-volume-control': { CallVolumeControl: () => null },
        '@/lib/call-vibration': { startIncomingCallVibration: () => noOp },
    }, { ...clock, setInterval: clock.setTimeout, clearInterval: clock.clearTimeout, window: {} });
    const props = { session: { id: 'session', contactId: 'character' }, character: { id: 'character', name: '路辰' }, onEnd: noOp };
    await act(async () => { renderer = Renderer.create(React.createElement(VoiceCallScreen, props)); });
    const connecting = [...timers.entries()].find(([, timer]) => timer.ms === 3000);
    timers.delete(connecting[0]); await act(async () => { connecting[1].fn(); });
    async function send(text) {
        await act(async () => { renderer.root.findByType('input').props.onChange({ target: { value: text } }); });
        await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault: noOp }); });
    }
    await send('first'); await send('queued'); assert.equal(modelCalls, 1);
    await act(async () => { renderer.update(React.createElement(VoiceCallScreen, { ...props, minimized: true })); });
    await act(async () => { resolveModel('通话还在继续。'); });
    assert.equal(speechCalls, 1, 'minimized call still synthesizes and plays speech');
    assert.equal(audioStops, 0, 'minimize never aborts playback');
    await act(async () => { renderer.root.findByType('mini-call').props.onEnd(); });
    assert.equal(audioStops, 1); assert.equal(modelCalls, 1, 'hangup never executes queued reply');
    await act(async () => { renderer.unmount(); });
    timers.clear();
    console.log('PASS: serialized turns, queue limit, hangup discards queue, auto-chat disabled by default, visibility pause, cumulative budget, failure stops auto-chat, navigation keeps one call instance. No paid API calls.');
})().catch(error => { console.error(error); process.exit(1); });
