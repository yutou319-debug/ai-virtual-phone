// Only explicit, standalone cues are interpreted; narrative prose stays intact.
const CUES: Record<string, string> = {
    "轻笑": "chuckle", "笑声": "laughs", "叹气": "sighs",
    "换气": "breath", "吸气": "inhale", "呼气": "exhale",
    "chuckle": "chuckle", "laughs": "laughs", "sighs": "sighs",
    "breath": "breath", "inhale": "inhale", "exhale": "exhale",
};

export function prepareSpeechText(text: string, provider: string, model: string, automatic = false): string {
    const expressive = provider === "Minimax" && /^speech-2\.8-(hd|turbo)$/.test(model);
    let hasExplicitCue = false;
    const prepared = text.replace(/\[([^\[\]\n]+)\]|【([^【】\n]+)】|\(([^()\n]+)\)|（([^（）\n]+)）/g,
        (whole, square, wideSquare, round, wideRound) => {
            const name = String(square ?? wideSquare ?? round ?? wideRound).trim().toLowerCase();
            if (!Object.prototype.hasOwnProperty.call(CUES, name)) return whole;
            hasExplicitCue = true;
            const cue = CUES[name];
            return expressive ? `(${cue})` : "";
        }).trim();
    if (!expressive || !automatic || hasExplicitCue) return prepared;
    // Conservative local detection, not sentiment inference: only standalone
    // interjections at sentence boundaries. One cue per utterance, no new API call.
    let inserted = false;
    return prepared.replace(/(^|[。！？\n])(\s*)(哈哈+|嘿嘿+|唉)([，。！？…\s]|$)/g,
        (whole, boundary, space, interjection, punctuation) => {
            if (inserted) return whole;
            inserted = true;
            const cue = interjection === "唉" ? "sighs" : "chuckle";
            return `${boundary}${space}(${cue})${punctuation}`;
        });
}
