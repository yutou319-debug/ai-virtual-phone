import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const KEY = "ai_phone_daily_contact_rules_v1";
registerKvMigration(KEY);

export type DailyContactRule = {
    id: string;
    sessionId: string;
    characterId: string;
    createdAt: number;
};

export function loadDailyContactRules(): DailyContactRule[] {
    if (typeof window === "undefined") return [];
    try {
        const parsed = JSON.parse(kvGet(KEY) || "[]");
        return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === "string"
            && typeof item.sessionId === "string" && typeof item.characterId === "string"
            && Number.isFinite(item.createdAt)) : [];
    } catch { return []; }
}

export function saveDailyContactRule(rule: DailyContactRule): void {
    kvSet(KEY, JSON.stringify([...loadDailyContactRules().filter(item => item.sessionId !== rule.sessionId), rule]));
}

export function removeDailyContactRule(id: string): void {
    kvSet(KEY, JSON.stringify(loadDailyContactRules().filter(item => item.id !== id)));
}

/** Beijing minutes, excluding the device's configured quiet hours. */
export function dailyContactMinutes(quiet: { startMin: number; endMin: number; tzOffsetMin: number } | null): number[] {
    const slots: number[] = [];
    for (let minute = 8 * 60; minute < 23 * 60; minute++) {
        const local = ((minute - 480 + (quiet?.tzOffsetMin ?? 480)) % 1440 + 1440) % 1440;
        const blocked = quiet && quiet.startMin !== quiet.endMin && (quiet.startMin < quiet.endMin
            ? local >= quiet.startMin && local < quiet.endMin
            : local >= quiet.startMin || local < quiet.endMin);
        if (!blocked) slots.push(minute);
    }
    return slots;
}
