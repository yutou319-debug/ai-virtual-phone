"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { ChatMessage } from "@/lib/chat-storage";
import { annotationImageRef, visualAssetFingerprint, listVisualAnnotations, saveVisualAnnotation, deleteVisualAnnotation, type VisualAnnotation } from "@/lib/visual-memory-storage";

export function VisualAnnotationButton({ message, sessionId }: { message?: ChatMessage; sessionId?: string }) {
    const scope = message?.sessionId ?? sessionId;
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const [records, setRecords] = useState<VisualAnnotation[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    if (!scope || (message && !annotationImageRef(message))) return null;
    const refresh = async () => {
        const items = await listVisualAnnotations(scope);
        setRecords(items);
        if (message) {
            const fingerprint = await visualAssetFingerprint(message.mediaUrl!);
            setText(items.find(item => item.messageId === message.id && item.assetFingerprint === fingerprint)?.text ?? "");
        }
    };
    const run = async (action: () => Promise<void>) => {
        setBusy(true); setError("");
        try { await action(); } catch { setError("本地保存或读取失败，请重试。标注尚未确认保存。"); }
        finally { setBusy(false); }
    };
    return <>
        <button className="ctx-menu-btn" onClick={() => { setOpen(true); void run(refresh); }}>{message ? "图片标注" : "管理图片标注"}</button>
        {open && createPortal(<div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4" onPointerDown={event => event.stopPropagation()}>
            <div role="dialog" aria-modal="true" aria-label="图片标注" className="w-full max-w-md rounded-2xl bg-white p-5 text-gray-900 shadow-xl max-h-[85dvh] overflow-auto">
                <h2 className="text-lg font-semibold">图片标注与纠正</h2>
                <p className="my-3 text-sm text-gray-600">可填写“这张图左边是我”等你确认的信息。仅绑定此图片，不会自动识别新照片。默认仅保存在本设备，不随云备份上传；相关图片进入聊天请求时，标注会一并发给你配置的模型服务商。</p>
                {message && <textarea aria-label="当前图片标注" maxLength={500} rows={3} value={text} onChange={event => setText(event.target.value)} className="w-full rounded-lg border p-2" />}
                {error && <p role="alert" className="text-red-600">{error}</p>}
                <div className="my-3 flex gap-4">
                    {message && <button disabled={busy || !text.trim()} onClick={() => void run(async () => { await saveVisualAnnotation(message, text); await refresh(); })}>确认保存</button>}
                    <button disabled={busy} onClick={() => setOpen(false)}>关闭</button>
                </div>
                <h3 className="font-semibold">本会话已保存标注</h3>
                {records.length === 0 && <p className="text-sm text-gray-500">暂无标注</p>}
                {records.map(item => <div key={item.messageId} className="mt-3 border-t pt-2 text-sm">
                    <p className="text-gray-500">{new Date(item.updatedAt).toLocaleString()} · {item.messageId === message?.id ? "当前图片" : "历史图片"}</p>
                    <p className="whitespace-pre-wrap break-words">{item.text}</p>
                    <button disabled={busy} className="mt-1 text-red-600" onClick={() => void run(async () => { await deleteVisualAnnotation(item.messageId); await refresh(); })}>删除标注</button>
                </div>)}
            </div>
        </div>, document.body)}
    </>;
}
