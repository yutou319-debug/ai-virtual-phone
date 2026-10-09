"use client";

import type { useCallAutoChat } from "./use-call-auto-chat";

export function CallAutoChatControls({ options, pending }: { options: ReturnType<typeof useCallAutoChat>; pending: number }) {
    return <div className="px-4 py-2 text-center text-white text-xs" style={{ background: "rgba(0,0,0,0.35)", position: "relative", zIndex: 2 }}>
        <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={options.enabled} onChange={e => options.setEnabled(e.target.checked)} />
            自动找话题（{options.used}/{options.limit} 次）
        </label>
        {options.enabled && <div className="flex justify-center gap-3 mt-2">
            <label>间隔 <select aria-label="自动找话题间隔" value={options.intervalSeconds} onChange={e => options.setIntervalSeconds(Number(e.target.value))} style={{ background: "#222", color: "white" }}>
                {[120, 180, 300, 600].map(n => <option key={n} value={n}>{n / 60} 分钟</option>)}
            </select></label>
            <label>上限 <select aria-label="每次通话自动找话题上限" value={options.limit} onChange={e => options.setLimit(Number(e.target.value))} style={{ background: "#222", color: "white" }}>
                {[1, 3, 5, 10].map(n => <option key={n} value={n}>{n} 次</option>)}
            </select></label>
        </div>}
        <div className="mt-1 opacity-80">{pending ? `${pending} 条消息排队中 · ` : ""}主动搭话会消耗模型与语音额度；切出 Float 暂停自动搭话。</div>
    </div>;
}
