"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeCallAutoOptions } from "@/lib/call-turn-queue";

export function useCallAutoChat(state: string, run: () => Promise<boolean>, pending: number) {
    const [enabled, setEnabled] = useState(false);
    const [intervalSeconds, setIntervalSeconds] = useState(180);
    const [limit, setLimit] = useState(5);
    const [used, setUsed] = useState(0);
    const [visible, setVisible] = useState(true);
    const runRef = useRef(run);
    runRef.current = run;
    const usedRef = useRef(0);
    useEffect(() => {
        const sync = () => setVisible(document.visibilityState === "visible");
        sync(); document.addEventListener("visibilitychange", sync);
        return () => document.removeEventListener("visibilitychange", sync);
    }, []);
    useEffect(() => {
        const options = normalizeCallAutoOptions(intervalSeconds, limit);
        if (!enabled || !visible || state !== "IDLE" || pending || usedRef.current >= options.limit) return;
        const timer = setTimeout(async () => {
            if (document.visibilityState !== "visible" || usedRef.current >= options.limit) return;
            // Reserve budget before requesting; failed attempts also consume the cap.
            usedRef.current += 1; setUsed(usedRef.current);
            const ok = await runRef.current();
            if (!ok) setEnabled(false); // No automatic retry after a provider failure.
        }, options.intervalSeconds * 1000);
        return () => clearTimeout(timer);
    }, [enabled, intervalSeconds, limit, state, pending, visible, used]);
    return { enabled, setEnabled, intervalSeconds, setIntervalSeconds, limit, setLimit, used };
}
