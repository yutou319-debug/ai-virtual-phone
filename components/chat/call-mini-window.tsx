"use client";

import { useEffect, useRef, useState } from "react";

export function CallMiniWindow({ name, image, status, onRestore, onEnd }: {
    name: string; image: string; status: string; onRestore?: () => void; onEnd: () => void;
}) {
    const [position, setPosition] = useState({ x: 12, y: 160 });
    const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    const clamp = (x: number, y: number) => ({
        x: Math.max(4, Math.min(x, window.innerWidth - 108)),
        y: Math.max(4, Math.min(y, window.innerHeight - 148)),
    });
    useEffect(() => {
        const resized = () => setPosition(p => clamp(p.x, p.y));
        resized(); window.addEventListener("resize", resized);
        return () => window.removeEventListener("resize", resized);
    }, []);
    return <div style={{ position: "absolute", left: position.x, top: position.y, width: 104, borderRadius: 14,
        background: "#222", color: "white", pointerEvents: "auto", overflow: "hidden", boxShadow: "0 4px 18px #0006" }}>
        <div aria-label="拖动通话小窗" style={{ height: 20, textAlign: "center", touchAction: "none", cursor: "move" }}
            onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, left: position.x, top: position.y };
            }}
            onPointerMove={e => { if (drag.current) setPosition(clamp(drag.current.left + e.clientX - drag.current.x, drag.current.top + e.clientY - drag.current.y)); }}
            onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>⋯</div>
        <button type="button" onClick={onRestore} aria-label={`返回与${name}的通话`}
            style={{ width: "100%", height: 92, background: image ? `linear-gradient(transparent,#000b),url(${image}) center/cover` : "#333", color: "white", border: 0, padding: 5, fontSize: 11 }}>
            <span style={{ display: "block", marginTop: 40 }}>{name}<br />{status}</span>
        </button>
        <button type="button" onClick={onEnd} aria-label="挂断通话" style={{ width: "100%", border: 0, padding: 6, background: "#a52b36", color: "white", fontSize: 12 }}>挂断</button>
    </div>;
}
