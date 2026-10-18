const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('lib/tool-executor.ts', 'utf8');
const ast = ts.createSourceFile('tool-executor.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['executeTimedWakeTool', 'numberArg', 'cleanToolString']);
const code = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name?.text)).map(n => n.getText(ast)).join('\n')
    .replace('await import("./push-bailout-client")', 'cloudModule');
const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const make = new Function('getInternalCapability', 'TIMED_WAKE_CAPABILITY_ID', 'makeTimedWakeId', 'saveTimedWakeSchedule', 'cloudModule', js + ';return executeTimedWakeTool;');
const context = {sessionId:'s', characterId:'c', appId:'chat', sourceEngine:'chat'};
const call = {args:{intent:'问候用户', delayMinutes:5}};
(async () => {
    for (const mode of ['confirmed', 'rejected', 'lost-ack']) {
        let saved = 0, calls = 0, resolve;
        const pending = new Promise(r => { resolve = r; });
        const run = make(() => ({enabled:true, mode:'on'}), 'wake', () => 'wake-id', () => {saved++;}, {
            armTimedWakeBailout: async () => { calls++; await pending; if(mode === 'lost-ack') throw Error('network'); return {ok: mode === 'confirmed'}; }
        });
        let settled = false;
        const result = run(call, context).then(r => {settled = true; return r;});
        await Promise.resolve(); await Promise.resolve();
        assert.equal(settled, false, 'must wait for cloud acknowledgement');
        assert.equal(saved, 1); assert.equal(calls, 1);
        resolve();
        const value = await result;
        assert.equal(value.success, true, 'keep the saved local schedule');
        assert.equal(value.userNotice.includes('云端已确认'), mode === 'confirmed');
        if(mode !== 'confirmed') assert.match(value.data, /仅保存了本机定时/);
        assert.equal(calls, 1, 'lost acknowledgement must not retry');
    }
    console.log('PASS: timed wake waits for cloud ACK; failures remain explicitly local; uncertain registration never retries.');
})().catch(error => {console.error(error); process.exit(1);});
