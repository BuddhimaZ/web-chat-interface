import { useCallback, useEffect, useRef, useState } from "react";
import { RTVIEvent, RTVIMessage as RTVIMessageValue, setAboutClient } from "@pipecat-ai/client-js";
import type { RTVIMessage as RTVIMessageType } from "@pipecat-ai/client-js";
import { usePipecatClient } from "@pipecat-ai/client-react";

export type ChatMessage = {
    id: string;
    role: "user" | "assistant" | "system";
    text: string;
};

export type UsePipecatChatOptions = {
    wsUrl: string;
    enableMic?: boolean;
    debug?: boolean;
};

export function usePipecatChat({ wsUrl, enableMic = false, debug = false }: UsePipecatChatOptions) {
    const [connected, setConnected] = useState(false);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isSending, setIsSending] = useState(false);
    const client = usePipecatClient();
    const streamingAssistantIdRef = useRef<string | null>(null);
    // Promise to await explicit bot readiness (RTVI 'bot-ready') before sends
    const botReadyRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
    const clientReadySentRef = useRef<boolean>(false);


    const makeReadyWaiter = () => {
        let res!: () => void;
        const promise = new Promise<void>((resolve) => {
            res = resolve;
        });
        return { promise, resolve: res };
    };

    const log = useCallback((...args: unknown[]) => {
        if (debug) console.debug("[chat]", ...args);
    }, [debug]);

    // client is supplied by PipecatClientProvider; we rely on events for state

    const appendAssistantMessage = useCallback((text: string) => {
        setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", text },
        ]);
    }, []);

    const connect = useCallback(async () => {
        log("action: connect", { wsUrl });
        setError(null);
        try {
            // New session: reset bot-ready waiter
            botReadyRef.current = makeReadyWaiter();
            if (!client) throw new Error("Client unavailable");
            clientReadySentRef.current = false;
            // Hint about the client before connecting (optional)
            setAboutClient({ library: "@pipecat-ai/client-js", platform: "web" });
            // Set mic preference if provided
            try { client.enableMic?.(enableMic); } catch (e) { log("enableMic error", e); }
            await client.connect({ ws_url: wsUrl });
            setConnected(true);
            // Do not set ready here; rely on 'bot-ready'
        } catch (e: unknown) {
            log("connect error", e);
            setError(e instanceof Error ? e.message : String(e));
        }
    }, [client, wsUrl, enableMic, log]);

    const disconnect = useCallback(async () => {
        log("action: disconnect");
        try {
            if (!client) return;
            await client.disconnect();
            botReadyRef.current = null;
        } catch {
            // ignore
        }
    }, [client, log]);

    const sendText = useCallback(
        async (text: string) => {
            log("action: sendText (queued)", text);
            if (!text?.trim()) return;
            // Optimistically add the user's message to the UI
            setMessages((prev) => [
                ...prev,
                { id: crypto.randomUUID(), role: "user", text },
            ]);
            setIsSending(true);

            // Ensure bot has sent 'bot-ready' before sending text
            const waitForReady = async () => {
                if (!botReadyRef.current) {
                    botReadyRef.current = makeReadyWaiter();
                }
                const waiter = botReadyRef.current;
                // Safety timeout
                const timeoutMs = 15000;
                const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("Timed out waiting for bot readiness")), timeoutMs)
                );
                await Promise.race([waiter.promise, timeoutPromise]);
            };

            try {
                await waitForReady();
                if (!client) throw new Error("Client unavailable");
                log("action: sendText (sending)", text);
                await client.sendText(text, { run_immediately: true, audio_response: false });
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                log("sendText error", msg);
                setError(msg);
            } finally {
                setIsSending(false);
            }
        },
        [client, log]
    );

    useEffect(() => {
        const onConnected = () => {
            log("event: Connected");
            setConnected(true);
        };
        const onDisconnected = () => {
            log("event: Disconnected");
            setConnected(false);
            setReady(false);
        };
        const onBotReady = () => {
            log("event: BotReady");
            setReady(true);
            botReadyRef.current?.resolve();
        };
        const onMessageError = (msg: RTVIMessageType) => {
            log("event: MessageError", msg);
            const data = (msg as unknown as { data?: { message?: string } }).data;
            setError(data?.message ?? "Message error");
        };
        const onTransportStateChanged = (state: string) => {
            log("event: TransportStateChanged", state);
            if (state === "connected") {
                setConnected(true);
            } else if (state === "ready") {
                setConnected(true);
                setReady(true);
                botReadyRef.current?.resolve();
            } else if (state === "disconnecting") {
                setReady(false);
            } else if (state === "error") {
                setConnected(false);
            }
        };
        const onBotTranscript = (data: { text: string }) => {
            log("event: bot-transcription", data);
            if (data?.text) {
                setConnected(true);
                appendAssistantMessage(data.text);
                streamingAssistantIdRef.current = null;
            }
        };
        const onBotLlmText = (data: { text: string }) => {
            log("event: bot-llm-text", data.text);
            if (data?.text) {
                setConnected(true);
                setMessages((prev) => {
                    const currentId = streamingAssistantIdRef.current;
                    if (currentId) {
                        return prev.map((m) =>
                            m.id === currentId ? { ...m, text: m.text + data.text } : m
                        );
                    }
                    const id = crypto.randomUUID();
                    streamingAssistantIdRef.current = id;
                    return [...prev, { id, role: "assistant", text: data.text }];
                });
            }
        };

        if (!client) return;
        client.on(RTVIEvent.Connected, onConnected);
        client.on(RTVIEvent.Disconnected, onDisconnected);
        client.on(RTVIEvent.BotReady, onBotReady);
        client.on(RTVIEvent.MessageError, onMessageError);
        client.on(RTVIEvent.TransportStateChanged, (state: string) => {
            onTransportStateChanged(state);
            // Explicitly send RTVI client-ready when transport hits 'connected' once per session
            if (state === "connected" && !clientReadySentRef.current) {
                try {
                    log("send client-ready (rtvi) after connected");
                    // transport is proxied but exposes sendMessage
                    (client.transport as unknown as { sendMessage: (msg: unknown) => void })
                        ?.sendMessage(RTVIMessageValue.clientReady());
                    clientReadySentRef.current = true;
                } catch (e) {
                    log("failed to send client-ready", e);
                }
            }
        });
        client.on(RTVIEvent.BotTranscript, onBotTranscript);
        client.on(RTVIEvent.BotLlmText, onBotLlmText);

        return () => {
            if (!client) return;
            client.off(RTVIEvent.Connected, onConnected);
            client.off(RTVIEvent.Disconnected, onDisconnected);
            client.off(RTVIEvent.BotReady, onBotReady);
            client.off(RTVIEvent.MessageError, onMessageError);
            client.off(RTVIEvent.TransportStateChanged, onTransportStateChanged);
            client.off(RTVIEvent.BotTranscript, onBotTranscript);
            client.off(RTVIEvent.BotLlmText, onBotLlmText);
        };
    }, [client, log, appendAssistantMessage]);

    return {
        client,
        connected,
        ready,
        error,
        messages,
        isSending,
        connect,
        disconnect,
        sendText,
    };
}
