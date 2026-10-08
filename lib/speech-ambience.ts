/** A deliberately narrow local rule, not a model or a scene classifier. */
export function detectSpeechAmbience(text: string): "rain" | null {
    // Avoid negated, hypothetical, future and quoted descriptions.
    if (/[“”「」『』"']|(?:没|不|停|别|希望|如果|假如|可能|会|明天|昨天|刚才|之前).{0,12}(?:雨|下雨)/.test(text)) return null;
    return /(?:窗外|外面|这里|这儿|现在)(?:正|正在|还在|又在|在)?下(?:着)?(?:小|大)?雨|(?:听|听听|听着)[，,：:\s]*(?:窗外的|外面的|这|那)?雨声/.test(text) ? "rain" : null;
}

// Quiet procedural rain: generated and mixed entirely on-device. No asset downloads.
export function rainBed(voice: Float32Array, sampleRate: number): Float32Array {
    const result = new Float32Array(voice.length);
    let peak = 0;
    for (const value of voice) peak = Math.max(peak, Math.abs(value));
    if (peak === 0) return result;
    let smooth = 0;
    let seed = 1729;
    const fade = Math.max(1, Math.floor(sampleRate * 0.5));
    for (let i = 0; i < voice.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = (seed / 4294967296) * 2 - 1;
        smooth = smooth * 0.75 + noise * 0.25;
        const envelope = Math.min(1, i / fade, (voice.length - 1 - i) / fade);
        // Mix toward available headroom; voice samples never clip.
        const bed = smooth * peak * 0.08 * envelope;
        const value = voice[i] + bed * (1 - Math.min(1, Math.abs(voice[i])));
        result[i] = Math.max(-1, Math.min(1, value));
    }
    return result;
}

function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const word = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    word(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true);
    word(8, "WAVE"); word(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    word(36, "data"); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    return new Blob([buffer], { type: "audio/wav" });
}

export async function addSpeechAmbience(blob: Blob, ambience: "rain" | null): Promise<Blob> {
    if (!ambience || typeof OfflineAudioContext === "undefined") return blob;
    try {
        const context = new OfflineAudioContext(1, 1, 24000);
        const decoded = await context.decodeAudioData(await blob.arrayBuffer());
        // Keep long recordings and memory-heavy audio untouched.
        if (decoded.duration > 120 || !decoded.length) return blob;
        const voice = new Float32Array(decoded.length);
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
            const data = decoded.getChannelData(channel);
            for (let i = 0; i < data.length; i++) voice[i] += data[i] / decoded.numberOfChannels;
        }
        return encodeMonoWav(rainBed(voice, decoded.sampleRate), decoded.sampleRate);
    } catch {
        // A local mixing problem must never regenerate the paid speech request.
        return blob;
    }
}
