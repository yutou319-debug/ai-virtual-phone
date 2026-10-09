/** In-memory identity only. Reloading the page deliberately ends the call. */
export type ActiveCall = Readonly<{
    id: string;
    sessionId: string;
    characterId: string;
    kind: "voice" | "video";
    initiator: "user" | "character";
    minimized: boolean;
}>;

let activeCall: ActiveCall | null = null;
const listeners = new Set<() => void>();
export const getActiveCall = () => activeCall;
export const getActiveCallServerSnapshot = () => null;
export function subscribeActiveCall(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
function emit() { for (const listener of listeners) listener(); }
export function startCall(call: Omit<ActiveCall, "id" | "minimized">): boolean {
    if (activeCall) return false;
    activeCall = { ...call, id: crypto.randomUUID(), minimized: false };
    emit();
    return true;
}
export function minimizeCall() {
    if (!activeCall || activeCall.minimized) return;
    activeCall = { ...activeCall, minimized: true }; emit();
}
export function restoreCall() {
    if (!activeCall || !activeCall.minimized) return;
    activeCall = { ...activeCall, minimized: false }; emit();
}
export function endCall(id: string) {
    if (activeCall?.id !== id) return;
    activeCall = null; emit();
}
export const isCallActiveForSession = (sessionId: string) => activeCall?.sessionId === sessionId;
