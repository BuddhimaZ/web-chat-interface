export function toWsScheme(baseUrl: string): string {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString().replace(/\/$/, "");
}

export function joinUrl(base: string, path: string): string {
    const baseNoSlash = base.replace(/\/$/, "");
    const pathNoSlash = path.replace(/^\//, "");
    return `${baseNoSlash}/${pathNoSlash}`;
}

export function getQueryParam(name: string): string | null {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
}

export function buildWsUrl(hostBaseUrl: string, agentId: string): string {
    const wsBase = toWsScheme(hostBaseUrl);
    const path = `/api/agent/web/chat/ws/${encodeURIComponent(agentId)}`;
    return joinUrl(wsBase, path);
}
