const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadFunctions(path, names, context) {
    const source = fs.readFileSync(path, 'utf8');
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
    assert.equal(selected.length, names.length);
    const code = selected.map(node => node.getText(ast)).join('\n')
        + '\n' + names.map(name => `exports.${name} = ${name};`).join('\n');
    vm.runInNewContext(ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    return context.exports;
}

const stored = new Map();
let writes = 0;
const core = loadFunctions('tools/weixin-local-assistant/assistant-core.mjs',
    ['extractText', 'extractIncomingMediaItem', 'storeIncomingMessage'], {
        exports: {}, MESSAGE_PREFIX: 'messages', sanitizePathPart: value => value,
        getObjectJson: async (_env, path) => stored.get(path),
        putObject: async (_env, path, data) => { writes++; stored.set(path, JSON.parse(data)); },
        fetch: () => { throw new Error('Transcript ingestion must not call an ASR/provider API'); },
    });
const browser = loadFunctions('lib/weixin-bridge.ts', ['extractIncomingText'], { exports: {} });
const voice = text => ({ type: 3, voice_item: { text } });
const text = value => ({ type: 1, text_item: { text: value } });
const fixtures = [
    [{ item_list: [voice('  早上好，我刚下课。  ')] }, '早上好，我刚下课。'],
    [{ item_list: [text('前一句'), voice('语音中间句'), text('最后一句')] }, '前一句\n语音中间句\n最后一句'],
    [{ item_list: [voice(''), voice('  '), voice(null), voice(123), { type: 3 }, null] }, ''],
    [{ item_list: 'invalid' }, ''],
    [{ item_list: [{ type: 2, voice_item: { text: 'wrong type' } }, { type: 3, ref_msg: { voice_item: { text: 'quoted' } } }] }, ''],
];
for (const [raw, expected] of fixtures) {
    assert.equal(core.extractText(raw), expected);
    assert.equal(browser.extractIncomingText(raw), expected);
}

(async () => {
    const runtime = { bot: { id: 'test-bot' }, character: { id: 'test-character' }, session: { id: 'test-session' } };
    const raw = { message_id: 123, item_list: [voice('测试转写')] };
    assert.equal(await core.storeIncomingMessage({}, runtime, raw, '2026-10-16T01:40:00Z'), '123');
    const row = [...stored.values()][0];
    assert.equal(row.content, '测试转写');
    assert.equal(row.needsReply, true);
    assert.equal(row.receivedAt, '2026-10-16T01:40:00Z');
    assert.equal(await core.storeIncomingMessage({}, runtime, raw, '2026-10-16T01:41:00Z'), false);
    assert.equal(writes, 1, 'replayed voice message must not be queued twice');
    await core.storeIncomingMessage({}, runtime, { message_id: 124, item_list: [voice(undefined)] }, '2026-10-16T01:42:00Z');
    assert.equal([...stored.values()][1].content, '[对方发来一条语音，暂时听不了]', 'missing transcript must not be invented');
    console.log('PASS: voice transcripts reach stored user content; mixed items retain order; malformed/missing/quoted content is excluded; replay is deduplicated. No ASR/model calls or real messages.');
})().catch(error => { console.error(error); process.exitCode = 1; });
