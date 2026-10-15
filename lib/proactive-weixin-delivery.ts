import type { ChatMessage, ChatSession } from "./chat-storage";
import { offlineWeixinBotIdFor } from "./offline-shortcut-capability";

// Suppress duplicate transport attempts in a running client, including ambiguous failures.
// Restarting Float does not replay this function: it only runs immediately after new text is saved.
const attempted = new Set<string>();
export async function mirrorLocalProactiveMessages(session: ChatSession, messages: ChatMessage[]): Promise<void> {
    if (session.isGroup) return;
    const botId = offlineWeixinBotIdFor(session.contactId);
    if (!botId) return;
    const visible = messages.filter(message => message.sessionId === session.id && message.role === "assistant"
        && !message.isRetracted && (!message.mediaType || message.mediaType === "quote") && message.content.trim());
    if (!visible.length) return;
    const key = `${botId}:${visible[0].id}`;
    if (attempted.has(key)) return;
    attempted.add(key);
    if (attempted.size > 500) attempted.delete(attempted.values().next().value!);
    const text = visible.map(message => message.content.trim()).join("\n\n");
    const { forwardExistingProactiveTextToWeixin } = await import("./weixin-cloud-sync");
    await forwardExistingProactiveTextToWeixin(botId, text);
}
