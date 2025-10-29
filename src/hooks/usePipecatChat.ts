import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PipecatClient, type BotLLMTextData } from "@pipecat-ai/client-js";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
    id: string;
    role: ChatRole;
    text: string;
    final?: boolean;
};

export type UsePipecatChatOptions = {
    agentId: string;
    baseUrl: string; // http(s) base URL
};

function buildWsUrl(baseUrl: string, agentId: string): string {
    const base = new URL(baseUrl);
    const wsProto = base.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = new URL(`/api/agent/web/chat/ws/${encodeURIComponent(agentId)}`, base);
    wsUrl.protocol = wsProto;
    return wsUrl.toString();
}

export function usePipecatChat(opts?: Partial<UsePipecatChatOptions>) {
    const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const urlAgentId = search.get("agent_id") || undefined;
    const agentId = opts?.agentId ?? urlAgentId;

    const envBase = (import.meta as ImportMeta).env?.VITE_HOST_BASE_URL as string | undefined;
    const baseUrl = opts?.baseUrl ?? envBase;

    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<
        | "idle"
        | "connecting"
        | "connected"
        | "ready"
        | "disconnected"
        | "error"
    >("idle");
    const [botVersion, setBotVersion] = useState<string | null>(null);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const currentBotMsgIdRef = useRef<string | null>(null);

    const clientRef = useRef<PipecatClient | null>(null);
    const isConnectingRef = useRef(false);

    const wsUrl = useMemo(() => {
        try {
            if (!baseUrl) return undefined;
            if (!agentId) return undefined;
            return buildWsUrl(baseUrl, agentId);
        } catch (e) {
            console.error(e);
            return undefined;
        }
    }, [baseUrl, agentId]);

    useEffect(() => {
        if (!agentId) {
            setError("Missing agent_id in URL query parameters.");
            return;
        }
        if (!baseUrl) {
            setError("Missing VITE_HOST_BASE_URL env var. Create .env.local with VITE_HOST_BASE_URL=http://your-host.");
            return;
        }
        setError(null);
    }, [agentId, baseUrl]);

    const connect = useCallback(async () => {
        if (!wsUrl) return;
        if (isConnectingRef.current) return; // avoid re-entrancy
        if (clientRef.current) return; // already have a client/session
        try {
            isConnectingRef.current = true;
            setStatus("connecting");

            const client = new PipecatClient({
                transport: new WebSocketTransport(),
                enableMic: false,
                enableCam: false,
                callbacks: {
                    onConnected: () => setStatus("connected"),
                    onDisconnected: () => setStatus("disconnected"),
                    onBotReady: (data) => {
                        const version = (data && typeof data === "object" && "version" in data)
                            ? (data as { version?: string }).version ?? null
                            : null;
                        setBotVersion(version);
                        setStatus("ready");
                    },
                    onError: (msg) => {
                        const m = (msg && typeof msg === "object" && "data" in msg)
                            ? (msg as { data?: { message?: string } }).data?.message ?? "Unknown error"
                            : "Unknown error";
                        setError(m);
                        setStatus("error");
                    },
                    onBotLlmText: (data: BotLLMTextData) => {
                        const text = data?.text ?? "";
                        if (!text) return;
                        setMessages((prev) => {
                            const id = currentBotMsgIdRef.current;
                            if (id && prev.some((m) => m.id === id)) {
                                return prev.map((m) => (m.id === id ? { ...m, text: m.text + text } : m));
                            }
                            const newId = crypto.randomUUID();
                            currentBotMsgIdRef.current = newId;
                            return [...prev, { id: newId, role: "assistant", text }];
                        });
                    },
                    onBotTranscript: (data) => {
                        const text = (data && typeof data === "object" && "text" in data)
                            ? (data as { text?: string }).text ?? ""
                            : "";
                        if (!text) return;
                        const newId = crypto.randomUUID();
                        setMessages((prev) => [...prev, { id: newId, role: "assistant", text, final: true }]);
                        currentBotMsgIdRef.current = null;
                    },
                },
            });

            clientRef.current = client;
            await client.connect({ wsUrl });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("Connect failed", msg);
            setError(msg);
            setStatus("error");
            clientRef.current = null;
        } finally {
            isConnectingRef.current = false;
        }
    }, [wsUrl]);

    const disconnect = useCallback(async () => {
        try {
            await clientRef.current?.disconnect();
        } catch {
            // ignore
        } finally {
            clientRef.current = null;
            setStatus("disconnected");
        }
    }, []);

    const reconnect = useCallback(async () => {
        await disconnect();
        await connect();
    }, [disconnect, connect]);

    const sendText = useCallback(async (text: string) => {
        const client = clientRef.current;
        if (!client) throw new Error("Client not connected");
        if (!text.trim()) return;
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);
        currentBotMsgIdRef.current = null;
        await client.sendText(text, { audio_response: false, run_immediately: true });
    }, []);

    // Gesture-gated auto connect: try connecting on first user interaction
    useEffect(() => {
        if (!wsUrl) return;
        let done = false;
        const handler = () => {
            if (done) return;
            done = true;
            window.removeEventListener("pointerdown", handler);
            window.removeEventListener("keydown", handler);
            void connect();
        };
        window.addEventListener("pointerdown", handler, { once: true });
        window.addEventListener("keydown", handler, { once: true });
        return () => {
            window.removeEventListener("pointerdown", handler);
            window.removeEventListener("keydown", handler);
        };
    }, [wsUrl, connect]);

    return {
        ready: status === "ready",
        status,
        error,
        botVersion,
        messages,
        sendText,
        reconnect,
        disconnect,
        wsUrl,
        agentId,
        baseUrl,
    } as const;
}
