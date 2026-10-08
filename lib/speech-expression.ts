// Only explicit, standalone cues are interpreted; narrative prose stays intact.
const CUES: Record<string, string> = {
    "轻笑": "chuckle", "笑声": "laughs", "叹气": "sighs",
    "换气": "breath", "吸气": "inhale", "呼气": "exhale",
    "chuckle": "chuckle", "laughs": "laughs", "sighs": "sighs",
    "breath": "breath", "inhale": "inhale", "exhale": "exhale",
};

export function prepareSpeechText(text: string, provider: string, model: string): string {
    const expressive = provider === "Minimax" && /^speech-2\.8-(hd|turbo)$/.test(model);
    return text.replace(/\[([^\[\]\n]+)\]|【([^【】\n]+)】|\(([^()\n]+)\)|（([^（）\n]+)）/g,
        (whole, square, wideSquare, round, wideRound) => {
            const name = String(square ?? wideSquare ?? round ?? wideRound).trim().toLowerCase();
            if (!Object.prototype.hasOwnProperty.call(CUES, name)) return whole;
            const cue = CUES[name];
            return expressive ? `(${cue})` : "";
        }).trim();
}
