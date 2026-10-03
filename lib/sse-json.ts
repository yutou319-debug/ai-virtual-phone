// ── 容错 SSE-JSON 解析器 ─────────────────────────────
// 非规范中转站会把超长 JSON data 行从中间冲刷切开（典型症状：JSON Parse error:
// Unterminated string），甚至在断口处插入空行使其被切成两个"事件"。
// 这里做碎片重组：解析失败的记录先暂存（carry），与后续片段直接拼接再试；
// 拼接后仍失败但新片段自身可解析时，判定旧暂存为垃圾（keepalive 等）丢弃。
// 三条流式路径（主聊天文本流 / 原生工具流 / 工坊文本流）共用。

const MAX_CARRY_CHARS = 8_000_000;

export type SseJsonParser = {
    /** 喂入一个完整 SSE 事件的文本（已按空行切分），返回解析出的 JSON 值列表 */
    pushEvent: (eventText: string) => unknown[];
    /** 流结束：清算残留暂存（可解析则返回，否则丢弃） */
    flush: () => unknown[];
};

export function createSseJsonParser(): SseJsonParser {
    let carry = "";

    const tryParse = (text: string): { ok: true; value: unknown } | { ok: false } => {
        try {
            return { ok: true, value: JSON.parse(text) as unknown };
        } catch {
            return { ok: false };
        }
    };

    const consumeRecord = (record: string, out: unknown[]): void => {
        if (!record || record === "[DONE]") {
            if (record === "[DONE]") carry = "";
            return;
        }
        if (carry) {
            const joined = tryParse(carry + record);
            if (joined.ok) {
                carry = "";
                out.push(joined.value);
                return;
            }
            const alone = tryParse(record);
            if (alone.ok) {
                // 新片段自身完整：旧暂存是拼不回去的垃圾，丢弃止损
                carry = "";
                out.push(alone.value);
                return;
            }
            carry = carry.length + record.length > MAX_CARRY_CHARS ? "" : carry + record;
            return;
        }
        const alone = tryParse(record);
        if (alone.ok) {
            out.push(alone.value);
            return;
        }
        carry = record.length > MAX_CARRY_CHARS ? "" : record;
    };

    return {
        pushEvent(eventText: string): unknown[] {
            const out: unknown[] = [];
            const records: string[] = [];
            for (const line of eventText.split("\n")) {
                if (line.startsWith("data:")) {
                    // SSE 规范：冒号后至多一个空格是分隔符；不能用 trim，
                    // 否则会破坏被切开的 JSON 字符串里的边界空格
                    records.push(line.slice(5).replace(/^ /, ""));
                } else if (/^(event:|id:|retry:|:)/.test(line)) {
                    continue; // SSE 字段/注释行（keepalive）
                } else if (line) {
                    // 无 data: 前缀的裸行：中转把长行切开产生的延续片段
                    if (records.length > 0) records[records.length - 1] += line;
                    else records.push(line);
                }
            }
            for (const record of records) consumeRecord(record, out);
            return out;
        },
        flush(): unknown[] {
            if (!carry) return [];
            const last = tryParse(carry);
            carry = "";
            return last.ok ? [last.value] : [];
        },
    };
}

/** EOF alone is not proof that a provider finished generating. */
export function createSseCompletionTracker() {
    let completed = false;
    let limited = false;
    return {
        event(text: string) {
            if (/(?:^|\n)data:\s*\[DONE\]\s*(?:\n|$)/.test(text)) completed = true;
        },
        parsed(value: unknown) {
            if (!value || typeof value !== "object") return;
            const data = value as Record<string, any>;
            const reason = data.choices?.[0]?.finish_reason
                ?? data.candidates?.[0]?.finishReason
                ?? data.delta?.stop_reason ?? data.stop_reason;
            if (typeof reason === "string" && reason) {
                completed = true;
                if (["length", "max_tokens", "MAX_TOKENS"].includes(reason)) limited = true;
            }
            if (data.type === "message_stop") completed = true;
            if (data.error || data.type === "error") throw new Error("API 流式响应返回错误，回复未完成。");
        },
        assertComplete() {
            if (limited) throw new Error("API 达到输出 token 上限，回复被截断；请检查最大输出长度设置。");
            if (!completed) throw new Error("API 流式连接结束，但未收到完成信号；回复可能被截断，请检查 API 日志。");
        },
    };
}
