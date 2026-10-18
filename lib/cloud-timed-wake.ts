export type CloudTimedWakeRequest = { executeAt: string; intent: string; weixinBotId?: string };

/** Only explicit, unambiguous user requests; no model inference or extra API call. */
export function parseCloudTimedWakeRequest(text: string, now = Date.now()): CloudTimedWakeRequest | undefined {
    const directive = [...text.matchAll(/那你|那就|请你|帮我/g)].pop();
    if (directive) text = text.slice(directive.index);
    else if (/昨天|上次|之前|刚才|他说/.test(text)) return;
    if (!/(给我.{0,12}(?:发|说)|找我|联系我|提醒我|叫我)/.test(text)
        || /(?:不要|不用|取消|别再).{0,20}(?:发|找|联系|提醒|叫)/.test(text)) return;
    const digits: Record<string, number> = {零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
    const normalized = text.replace(/[零〇一二两三四五六七八九十]+(?=分钟|小时|分|点)/g, word => {
        const ten = word.indexOf("十");
        const value = ten >= 0 ? (ten === 0 ? 1 : digits[word[0]]) * 10 + (digits[word[ten + 1]] ?? 0) : digits[word];
        return value === undefined ? word : String(value);
    });
    let fireAt: number;
    const relative = normalized.match(/(\d{1,4})\s*(分钟|小时)(?:之?后|以后|后面)/);
    if (relative) {
        const delay = Number(relative[1]) * (relative[2] === "小时" ? 60 : 1);
        if (delay < 1 || delay > 10080) return;
        fireAt = now + delay * 60000;
    } else {
        const clock = normalized.match(/(\d{1,2})(?:[:：](\d{2})|点(?:(\d{1,2})分?|半)?)/);
        const minuteOnly = clock ? null : normalized.match(/(?:^|[^\d])(\d{1,2})分(?!钟)/);
        if (!clock && !minuteOnly) return;
        const local = new Date(now + 480 * 60000);
        let hour = clock ? Number(clock[1]) : local.getUTCHours();
        const minute = clock ? Number(clock[2] ?? clock[3] ?? (clock[0].endsWith("半") ? 30 : 0)) : Number(minuteOnly![1]);
        if (hour > 23 || minute > 59) return;
        if (/下午|晚上|今晚/.test(normalized) && hour < 12) hour += 12;
        if (/凌晨|早上|上午/.test(normalized) && hour === 12) hour = 0;
        fireAt = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - 480 * 60000;
        if (/明天/.test(normalized)) fireAt += 86400000;
        else if (fireAt <= now) fireAt += clock ? 86400000 : 3600000;
    }
    if (fireAt - now < 1000 || fireAt - now > 7 * 86400000) return;
    return { executeAt: new Date(fireAt).toISOString(), intent: text.trim().slice(0, 300) };
}
