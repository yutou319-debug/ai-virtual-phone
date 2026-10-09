/** One paid conversation turn (including speech playback) at a time. */
export class CallTurnQueue {
    private busy = false;
    private stopped = false;
    private pending: string[] = [];
    constructor(private changed: (pending: number) => void, readonly capacity = 5) {}
    get isBusy() { return this.busy; }
    get pendingCount() { return this.pending.length; }
    stop() { this.stopped = true; this.pending = []; this.changed(0); }
    async submit(text: string | undefined, execute: (text?: string) => Promise<void>): Promise<boolean> {
        if (this.stopped) return false;
        if (this.busy) {
            // Do not queue automatic/regenerate requests: they have no new user input.
            if (!text || this.pending.length >= this.capacity) return false;
            this.pending.push(text); this.changed(this.pending.length); return true;
        }
        this.busy = true; // Set before execute's first await, not in a React effect.
        try {
            let next = text;
            do {
                await execute(next);
                if (this.stopped || !this.pending.length) break;
                next = this.pending.shift(); this.changed(this.pending.length);
            } while (!this.stopped);
            return true;
        } finally { this.busy = false; }
    }
}

export function normalizeCallAutoOptions(intervalSeconds: number, limit: number) {
    return {
        intervalSeconds: Math.max(120, Math.min(600, Number.isFinite(intervalSeconds) ? Math.floor(intervalSeconds) : 180)),
        limit: Math.max(1, Math.min(10, Number.isFinite(limit) ? Math.floor(limit) : 5)),
    };
}
