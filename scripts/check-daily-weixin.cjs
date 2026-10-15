const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
(async () => {
    const source = fs.readFileSync('lib/push-bailout-client.ts', 'utf8');
    const ast = ts.createSourceFile('client.ts', source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'armDailyContactRule');
    let bot = 'paired-luchen', deployed = true, paid = 0, payloads = [];
    const context = { exports: {},
        bailoutEnabled: () => deployed,
        hasAccountPushSubscription: async () => true,
        dailyContactMinutes: () => [600, 900], buildQuietWindowMeta: () => ({}),
        loadChatSessions: () => [{ id: 'session', contactId: 'luchen' }], loadChatMessages: () => [],
        buildChatPromptMessages: async () => ({ llmMessages: [], character: { name: '路辰' }, config: {}, preset: null, regexes: [], userIdentity: { name: '鱼头' } }),
        offlineWeixinBotIdFor: characterId => characterId === 'luchen' ? bot : '',
        toLlmRequestMessages: messages => messages,
        buildProviderRequest: () => ({ url: 'https://model.invalid', headers: {}, providerKind: 'openai-compatible', body: { messages: [], tools: ['must-be-removed'] } }),
        personalPushFetch: async (action, init) => { payloads.push({ action, method: init.method, ...JSON.parse(init.body) }); return Response.json({ ok: true }); },
    };
    vm.runInNewContext(transpile(declaration.getText(ast)), context);
    const rule = { id: 'daily_session', sessionId: 'session', characterId: 'luchen' };
    assert.equal((await context.exports.armDailyContactRule(rule)).ok, true);
    let payload = payloads.at(-1).payload;
    assert.equal(payload.weixin.botId, 'paired-luchen'); assert.equal(payload.weixin.force, true);
    assert.equal(payload.request.body.tools, undefined);
    assert.equal(payload.shortcutContinuation, undefined);
    assert.equal(payload.merge.dailyRuleId, rule.id);
    bot = '';
    assert.equal((await context.exports.armDailyContactRule(rule, true)).ok, true);
    assert.equal(payloads.at(-1).payload.weixin, undefined, 'unpaired roles retain Float delivery');
    assert.equal(payloads.at(-1).method, 'PATCH', 'refresh updates already-created cloud rules');
    deployed = false;
    assert.equal((await context.exports.armDailyContactRule(rule)).ok, false);

    // Execute the existing worker delivery block with a prepared generation result.
    const worker = fs.readFileSync('supabase/functions/push-generate/index.ts', 'utf8');
    const start = worker.indexOf('    const WEIXIN_MARKER =');
    const end = worker.indexOf('    await progress("outbox written, pushing");', start);
    assert.ok(start >= 0 && end > start);
    const deliver = new AsyncFunction('payload','fetch','rest','progress','finish','stillOwnsJob','crypto','deliverDeferredShortcut','writeShortcutDeliveryDiagnostic',transpile(`
      let rawText = '今天想和你分享一件小事。';
      const supabaseUrl = 'https://cloud.invalid', serviceKey = 'mock-only', job = {user_id:'owner',id:'job',kind:'daily_random',trigger_key:'daily:test'};
      let executedShortcutMarker = null, shortcutStoragePath = '', shortcutActionNote = '', deliverAsCall = false;
      ${worker.slice(start, end)}
    `));
    for (const scenario of ['success', 'expired-context', 'network-error', 'missing-secret', 'unpaired']) {
        let sends = 0, outbox = [], finished = [];
        const fakeFetch = async (url, init) => {
            assert.ok(!url.includes('model.invalid'), 'delivery never calls the model');
            if (url.includes('cron-secret')) return scenario === 'missing-secret' ? new Response('', { status:404 }) : Response.json({ token:'mock-secret' });
            assert.ok(url.endsWith('/weixin-assistant'));
            sends++;
            const body = JSON.parse(init.body);
            assert.equal(body.bot, 'paired-luchen'); assert.equal(body.action, 'send-text');
            assert.equal(body.text, '今天想和你分享一件小事。');
            if (scenario === 'network-error') throw Error('network failed');
            return scenario === 'expired-context' ? Response.json({ ok:false,error:'no_reply_context' }, {status:500}) : Response.json({ok:true,sent:1});
        };
        await deliver({ merge:{sessionId:'session'}, ...(scenario === 'unpaired' ? {} : {weixin:{botId:'paired-luchen',force:true}}) },fakeFetch,
            async (path,init) => { assert.equal(path,'push_outbox'); outbox.push(JSON.parse(init.body)); return Response.json([]); },
            async () => {}, async (...args) => finished.push(args), async () => true, global.crypto, async () => {}, async () => {});
        assert.equal(sends, ['unpaired','missing-secret'].includes(scenario) ? 0 : 1, 'at most one WeChat delivery attempt');
        assert.equal(outbox.length, scenario === 'success' ? 0 : 1, 'successful WeChat delivery does not create a duplicate Float outbox row');
        if(outbox.length) assert.equal(outbox[0][0].raw_text, '今天想和你分享一件小事。', 'fallback preserves the same generated result');
        if(scenario === 'success') assert.equal(finished[0][0], 'done');
    }
    // Verify successful proactive sending also stores one outgoing record for Float sync.
    const core = fs.readFileSync('tools/weixin-local-assistant/assistant-core.mjs','utf8');
    const coreAst = ts.createSourceFile('core.mjs',core,ts.ScriptTarget.Latest,true);
    const sendDeclaration = coreAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'sendProactiveText');
    const recorded = [];
    const coreContext = { exports:{},
        loadRuntimeIndex: async () => ({packages:[{botId:'paired-luchen'}]}), loadRuntimePackage: async () => ({bot:{botToken:'mock-only'}}),
        loadCloudMessagesForBot: async () => [{message:{direction:'inbound',raw:{context_token:'mock-context',from_user_id:'mock-user'}}}],
        sendIlinkTextMessage: async () => ({error_code:0}), storeOutgoingMessage: async (...args) => recorded.push(args),
        setTimeout: () => { throw Error('test sends only one segment'); },
    };
    vm.runInNewContext(transpile(sendDeclaration.getText(coreAst)),coreContext);
    assert.equal((await coreContext.exports.sendProactiveText({},'paired-luchen','今天想和你分享一件小事。')).sent,1);
    assert.equal(recorded.length,1); assert.equal(recorded[0][3],'今天想和你分享一件小事。');
    assert.equal(paid,0);
    console.log('PASS: paired daily snapshots force WeChat with one generated result; unpaired stays Float; refresh works; successful send stores one WeChat/Float history record without duplicate outbox; expired context, missing secret and network failure preserve the same text in Float. No real network, WeChat messages or model calls.');
})();
