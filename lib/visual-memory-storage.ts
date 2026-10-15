import Dexie from "dexie";
import type { ChatMessage } from "./chat-storage";

/** Explicit annotations only. Separate local database: never included in automatic cloud backup. */
export type VisualAnnotation = {
    messageId: string;
    sessionId: string;
    assetFingerprint: string;
    text: string;
    confirmedBy: "user";
    updatedAt: string;
};
class VisualMemoryDatabase extends Dexie {
    declare annotations: Dexie.Table<VisualAnnotation, string>;
    constructor() {
        super("FloatVisualAnnotations");
        this.version(1).stores({ annotations: "messageId, sessionId" });
    }
}
const db = new VisualMemoryDatabase();
export function annotationImageRef(message: ChatMessage): string | undefined {
    if (message.role !== "user" || message.isRetracted) return undefined;
    return message.mediaType === "image" || (message.mediaType === "media_file" && message.mediaData?.fileType === "image")
        ? message.mediaUrl : undefined;
}
export async function visualAssetFingerprint(ref: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ref));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function listVisualAnnotations(sessionId: string): Promise<VisualAnnotation[]> {
    return db.annotations.where("sessionId").equals(sessionId).toArray();
}
export async function saveVisualAnnotation(message: ChatMessage, text: string): Promise<void> {
    const assetRef = annotationImageRef(message);
    if (!assetRef || !text.trim()) throw new Error("请选择有效图片并填写标注");
    await db.annotations.put({ messageId: message.id, sessionId: message.sessionId, assetFingerprint: await visualAssetFingerprint(assetRef),
        text: text.trim().slice(0, 500), confirmedBy: "user", updatedAt: new Date().toISOString() });
}
export async function deleteVisualAnnotation(messageId: string): Promise<void> {
    await db.annotations.delete(messageId);
}
