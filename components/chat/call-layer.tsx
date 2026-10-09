"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cancelFollowUp } from "@/lib/follow-up-service";
import { loadChatSessions } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import { endCall, getActiveCall, getActiveCallServerSnapshot, minimizeCall, restoreCall, subscribeActiveCall } from "@/lib/call-session-store";
import { VoiceCallScreen } from "./voice-call-screen";
import { VideoCallScreen } from "./video-call-screen";

export function CallLayer() {
    const call = useSyncExternalStore(subscribeActiveCall, getActiveCall, getActiveCallServerSnapshot);
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    const session = call ? loadChatSessions().find(item => item.id === call.sessionId) : undefined;
    const character = call ? loadCharacters().find(item => item.id === call.characterId) : undefined;
    useEffect(() => {
        if (call && (!session || !character)) endCall(call.id);
    }, [call, session, character]);
    if (!mounted || !call || !session || !character) return null;
    const Screen = call.kind === "voice" ? VoiceCallScreen : VideoCallScreen;
    return createPortal(<div style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: call.minimized ? "none" : "auto" }}>
        <Screen key={call.id} session={session} character={character} initiator={call.initiator}
            minimized={call.minimized} onMinimize={minimizeCall} onRestore={restoreCall}
            onEnd={() => {
                endCall(call.id);
                cancelFollowUp(call.sessionId);
                window.dispatchEvent(new CustomEvent("float-call-ended", { detail: { sessionId: call.sessionId } }));
            }} />
    </div>, document.body);
}
