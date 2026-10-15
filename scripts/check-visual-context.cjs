const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}, globals = {}, source = fs.readFileSync(file, 'utf8')) {
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] || require(name),
        crypto: global.crypto, TextEncoder, console, URL, Blob, AbortSignal, ...globals }, { filename: file });
    return module.exports;
}
function functions(file, names, mocks, globals) {
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
    assert.equal(selected.length, names.length);
    return load(file, mocks, globals, selected.map(node => node.getText(ast)).join('\n') + '\n' + names.map(name => `exports.${name} = ${name};`).join('\n'));
}
(async () => {
    const photo = (id, ref = `data:image/png;base64,${id}`) => ({ id, sessionId: 'chat', role: 'user', mediaType: 'image', mediaUrl: ref, content: '', mediaData: { label: '照片' } });
    const photos = [photo('a'), photo('b'), photo('c')];
    const sticker = { ...photo('sticker'), mediaType: 'sticker', mediaUrl: undefined, mediaData: { stickerUrl: 'data:image/png;base64,STICKER' } };
    const limit = functions('lib/chat-engine.ts', ['isVisionPromptImageMessage', 'hasVisionPromptImageData', 'stripVisionPromptImageData', 'applyVisionImagePromptLimit'], {}, {
        normalizeVisionImagePromptLimit: value => value == null ? 3 : Math.max(0, Math.min(20, Math.floor(Number(value)))) });
    const input = [...photos, sticker];
    let output = limit.applyVisionImagePromptLimit(input.slice(), 1);
    assert.equal(output.filter(m => m.mediaUrl).length, 1);
    assert.equal(output[2].mediaUrl, photos[2].mediaUrl, 'a sticker cannot displace a photograph');
    assert.equal(output[3].mediaData.stickerUrl, undefined);
    assert.equal(input[3].mediaData.stickerUrl, sticker.mediaData.stickerUrl, 'stored originals remain intact');
    output = limit.applyVisionImagePromptLimit(input.slice(), undefined);
    assert.equal(output.filter(m => m.mediaUrl).length, 3);
    output = limit.applyVisionImagePromptLimit(input.slice(), 0);
    assert.equal(output.some(m => m.mediaUrl || m.mediaData?.stickerUrl), false);

    const rows = new Map();
    class FakeDexie {
        constructor() { this.annotations = {
            put: async row => rows.set(row.messageId, row),
            delete: async id => rows.delete(id),
            where: () => ({ equals: session => ({ toArray: async () => [...rows.values()].filter(row => row.sessionId === session) }) }),
        }; }
        version() { return { stores() {} }; }
    }
    const storage = load('lib/visual-memory-storage.ts', { dexie: { default: FakeDexie } });
    const prompt = load('lib/visual-memory-prompt.ts', { './visual-memory-storage': storage });
    await storage.saveVisualAnnotation(photos[0], '左边是我');
    await storage.saveVisualAnnotation(photos[0], '纠正：右边是我');
    let records = await storage.listVisualAnnotations('chat');
    assert.equal(records.length, 1, 'latest explicit correction replaces the old record');
    assert.equal(records[0].assetFingerprint.length, 64);
    assert.equal(JSON.stringify(records).includes('base64'), false, 'no duplicate photo stored in annotation database');
    let text = await prompt.visualAnnotationPrompt([photos[0]], records);
    assert.ok(text.includes('纠正：右边是我'));
    assert.ok(!text.includes('左边是我'));
    assert.ok(!text.includes(photos[0].mediaUrl), 'raw photo is not copied into text memory');
    // Stand-in images represent different positions/clothing/hair; none inherits an identity label.
    for (const newPhoto of [photo('new-position'), photo('new-clothes'), photo('new-hair'), photo('a', 'changed-asset')]) {
        text = await prompt.visualAnnotationPrompt([newPhoto], records);
        assert.ok(!text.includes('纠正：右边是我'));
        assert.ok(text.includes('新图中的身份请用户确认'));
    }
    text = await prompt.visualAnnotationPrompt([photos[0]], records); // correction chat text already truncated
    assert.ok(text.includes('纠正：右边是我'));
    assert.ok(!(await prompt.visualAnnotationPrompt([{ ...photos[0], mediaUrl: undefined }], records)).includes('纠正：右边是我'));
    assert.ok(!(await prompt.visualAnnotationPrompt([{ ...photos[0], isRetracted: true }], records)).includes('纠正：右边是我'));
    assert.equal((await storage.listVisualAnnotations('other-session')).length, 0);
    await storage.deleteVisualAnnotation('a');
    assert.equal((await storage.listVisualAnnotations('chat')).length, 0);
    assert.ok(!(await prompt.visualAnnotationPrompt([photos[0]], await storage.listVisualAnnotations('chat'))).includes('纠正：右边是我'));

    const helpers = load('lib/api-helpers.ts', {}, {}, functionsSource('lib/api-helpers.ts', ['determineBaseUrl', 'buildChatCompletionsUrl', 'buildRequestHeaders', 'isNativeAnthropicApi', 'isNativeGoogleApi']));
    const adapter = load('lib/llm-provider-adapter.ts', { './api-helpers': helpers, './generation-parameters': { resolveEnabledGenerationParameters: () => new Set() } });
    const config = { provider: 'Custom', baseUrl: 'https://shufulei.net/v1', apiKey: 'mock-only', defaultModel: 'gemini-test', enableImageRecognition: true };
    const messages = photos.map(m => ({ role: 'user', content: [{ type: 'text', text: m.id }, { type: 'image_url', image_url: { url: m.mediaUrl, detail: 'low' } }] }));
    const request = adapter.buildProviderRequest(config, null, messages, { stream: true });
    assert.equal(request.url, 'https://shufulei.net/v1/chat/completions');
    assert.equal(request.providerKind, 'openai-compatible');
    assert.equal(request.body.messages.flatMap(m => m.content).filter(p => p.type === 'image_url').length, 3);
    assert.equal(request.body.stream, true);
    for (const provider of ['Google', 'Anthropic']) {
        const native = adapter.buildProviderRequest({ ...config, provider, baseUrl: undefined }, null, messages);
        const body = JSON.stringify(native.body);
        assert.ok(body.includes(provider === 'Google' ? 'inlineData' : 'base64'));
        assert.ok(!body.includes('image omitted'));
        const remote = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/photo.png' } }] }];
        assert.throws(() => adapter.buildProviderRequest({ ...config, provider, baseUrl: undefined }, null, remote), /尚未/);
    }
    const off = adapter.buildProviderRequest({ ...config, enableImageRecognition: false }, null, messages);
    assert.ok(!JSON.stringify(off.body).includes('data:image'));
    const React = require('react');
    const Renderer = require('react-test-renderer');
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const { VisualAnnotationButton } = load('components/chat/visual-annotation-button.tsx', {
        '@/lib/visual-memory-storage': storage, 'react-dom': { createPortal: node => node },
    }, { document: { body: {} } });
    let ui;
    await Renderer.act(async () => { ui = Renderer.create(React.createElement(VisualAnnotationButton, { message: photos[0] })); });
    await Renderer.act(async () => { ui.root.findByType('button').props.onClick(); });
    assert.equal(ui.root.findByProps({ role: 'dialog' }).props['aria-label'], '图片标注');
    await Renderer.act(async () => { ui.root.findByType('textarea').props.onChange({ target: { value: '这是本图的确认标注' } }); });
    await Renderer.act(async () => { ui.root.findAllByType('button').find(button => button.props.children === '确认保存').props.onClick(); });
    assert.equal((await storage.listVisualAnnotations('chat'))[0].text, '这是本图的确认标注');
    await Renderer.act(async () => { ui.root.findAllByType('button').find(button => button.props.children === '删除标注').props.onClick(); });
    assert.equal((await storage.listVisualAnnotations('chat')).length, 0);
    await Renderer.act(async () => ui.unmount());
    await Renderer.act(async () => { ui = Renderer.create(React.createElement(VisualAnnotationButton, { sessionId: 'chat' })); });
    await Renderer.act(async () => { ui.root.findByType('button').props.onClick(); });
    assert.equal(ui.root.findAllByType('textarea').length, 0, 'settings manager remains available without a photo');
    await Renderer.act(async () => ui.unmount());
    const captions = functions('lib/llm-prompt-assembler.ts' , ['isImageGenerationMediaMessage', 'formatPhotoDirective', 'formatImageGenerationDirective', 'getAnnotatedSenderPrefix', 'formatAnnotatedVisionBody'], {}, {});
    assert.ok(captions.formatAnnotatedVisionBody({ ...photos[0], mediaData: { label: '[图片消息ID:a] 合照' } }, '').includes('[图片消息ID:a]'), 'native annotated history preserves the exact photo reference');
    const resolver = functions('lib/chat-engine.ts' , ['resolveVisionImageRefForApi'], {}, {
        LLM_IMAGE_MAX_SIDE: 512, ChatEngineError: Error,
        isMediaStoreRef: ref => ref.startsWith('media:'), loadMediaBlob: async () => null,
        dataUrlToBlob: () => null, isLikelyGifImageRef: () => false,
        fetchRemoteImageBlob: async () => null,
    });
    await assert.rejects(resolver.resolveVisionImageRefForApi('media:missing'), /丢失/);
    await assert.rejects(resolver.resolveVisionImageRefForApi('data:image/png;bad'), /无效/);
    await assert.rejects(resolver.resolveVisionImageRefForApi('https://example.test/a.png', true), /下载失败/);
    console.log('Visual context checks passed: image priority, original preservation, corrections, deletion, isolation, history truncation, no identity propagation, relay/native multi-image bodies, vision-off, missing media. No network or paid API calls.');
})();
function functionsSource(file, names) {
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    return ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
}
