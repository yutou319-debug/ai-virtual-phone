const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('tools/weixin-local-assistant/assistant-core.mjs', 'utf8');
const ast = ts.createSourceFile('core.mjs', source, ts.ScriptTarget.Latest, true);
const names = ['filterUnavailableStickerMarkers', 'resolveRuntimeStickerImage', 'buildLocalMediaReplyItem'];
const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
const context = { exports: {}, getTemplateImageDataUrl: () => { throw Error('Unknown stickers must not generate placeholder images'); } };
vm.runInNewContext(ts.transpileModule(selected.map(node => node.getText(ast)).join('\n')
    + '\n' + names.map(name => `exports.${name}=${name};`).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { filterUnavailableStickerMarkers: filter, resolveRuntimeStickerImage: resolve, buildLocalMediaReplyItem: build } = context.exports;
const image = 'data:image/png;base64,dGVzdA==';
const runtime = { promptContext: { customStickerMap: { ' 已有猫猫 ': image, '丢失素材': '' } } };
const map = runtime.promptContext.customStickerMap;
assert.equal(filter('你好[表情包:编造的猫猫]晚安', map), '你好晚安');
assert.equal(filter('你好[表情包：已有猫猫]', map), '你好[表情包：已有猫猫]');
assert.equal(filter('[表情包:丢失素材]', map), '这张表情包暂时发不了。');
assert.equal(filter('[表情包:未知]', {}), '这张表情包暂时发不了。');
assert.equal(filter('普通文字[握手]', map), '普通文字[握手]');
assert.equal(filter('A[表情包:不存在] B[表情包:已有猫猫] C[表情包:另一个]', map), 'A B[表情包:已有猫猫] C');
assert.equal(resolve(runtime, '已有猫猫'), image);
assert.equal(resolve({ customStickerMap: Object.create({ fake: image }) }, 'fake'), '');
(async () => {
    assert.equal(await build({ kind: 'sticker', label: '未知', raw: '[表情包:未知]' }, runtime), null);
    assert.equal((await build({ kind: 'sticker', label: '已有猫猫', raw: '[表情包:已有猫猫]' }, runtime)).imageDataUrl, image);
    console.log('PASS: only configured stickers send real assets; invented/missing names are removed; ordinary text survives; sticker-only fallback does not retry generation; no placeholder images, provider calls or real sends.');
})().catch(error => { console.error(error); process.exitCode = 1; });
