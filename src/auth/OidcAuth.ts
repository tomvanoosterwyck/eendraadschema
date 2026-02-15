import { User, UserManager, WebStorageStateStore } from "oidc-client-ts";

export type AuthProfile = {
    sub: string;
    name?: string;
    email?: string;
};

type OidcEnv = {
    issuerUrl: string;
    clientId: string;
    audience?: string;
    scope: string;
};

type RuntimeConfig = Record<string, unknown>;

function readRuntimeConfig(key: string): string {
    const cfg = (globalThis as any).__EDS_RUNTIME_CONFIG as RuntimeConfig | undefined;
    if (!cfg || typeof cfg !== "object") return "";
    const v = (cfg as any)[key];
    if (v === undefined || v === null) return "";
    return String(v);
}

function getOidcEnv(): OidcEnv | null {
    const issuerUrl =
        readRuntimeConfig("VITE_OIDC_ISSUER_URL") || (import.meta as any).env?.VITE_OIDC_ISSUER_URL || "";
    const clientId =
        readRuntimeConfig("VITE_OIDC_CLIENT_ID") || (import.meta as any).env?.VITE_OIDC_CLIENT_ID || "";
    const audience =
        readRuntimeConfig("VITE_OIDC_AUDIENCE") || (import.meta as any).env?.VITE_OIDC_AUDIENCE || "";
    const scope = readRuntimeConfig("VITE_OIDC_SCOPE") || (import.meta as any).env?.VITE_OIDC_SCOPE || "openid profile email";

    if (!issuerUrl || !clientId) return null;
    return {
        issuerUrl: String(issuerUrl),
        clientId: String(clientId),
        audience: audience ? String(audience) : undefined,
        scope: String(scope)
    };
}

function buildRedirectUri(): string {
    // Keep it simple: same page, query-based callback.
    // Return URL (including hash) is carried in OIDC state.
    return window.location.origin + window.location.pathname;
}

class OidcAuth {
    private env: OidcEnv | null;
    private manager: UserManager | null;

    constructor() {
        this.env = getOidcEnv();
        this.manager = this.env
            ? new UserManager({
                  authority: this.env.issuerUrl,
                  client_id: this.env.clientId,
                  redirect_uri: buildRedirectUri(),
                  response_type: "code",
                  scope: this.env.scope,
                  // Store tokens in sessionStorage by default to avoid long-lived secrets.
                  // If you want persistence across restarts, switch to localStorage.
                  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
                  // Prevent automatic silent renew unless you configure a silent_redirect_uri.
                  automaticSilentRenew: false,
                  loadUserInfo: true
              })
            : null;
    }

    isEnabled(): boolean {
        return !!this.manager;
    }

    async init(): Promise<void> {
        if (!this.manager) return;

        // Handle redirect callback if we have OIDC params.
        const qs = new URLSearchParams(window.location.search);
        const hasCode = qs.has("code") && qs.has("state");
        if (hasCode) {
            try {
                const user = await this.manager.signinRedirectCallback();
                const returnUrl = (user as any)?.state?.returnUrl as string | undefined;
                // Clean up the URL (remove ?code=...)
                window.history.replaceState(null, document.title, returnUrl || (window.location.origin + window.location.pathname + window.location.hash));
            } catch (e) {
                // Clean URL anyway; user can retry login.
                window.history.replaceState(null, document.title, window.location.origin + window.location.pathname + window.location.hash);
                console.warn("OIDC callback handling failed", e);
            }
        }

        // Warm user cache (best-effort)
        try {
            await this.manager.getUser();
        } catch (e) {
            // ignore
        }
    }

    async login(): Promise<void> {
        if (!this.manager) {
            alert("Login is niet geconfigureerd op deze site.");
            return;
        }
        const returnUrl = window.location.href;
        try {
            await this.manager.signinRedirect({ state: { returnUrl } });
        } catch (e: any) {
            console.error("signinRedirect failed", e);
            const msg = e?.message ? String(e.message) : String(e);
            const hint = msg.toLowerCase().includes("failed to fetch")
                ? " (kan CORS/HTTPS of een onbereikbare issuer zijn)"
                : "";
            alert(`Aanmelden mislukt: ${msg}${hint}`);
            throw e;
        }
    }

    async logout(): Promise<void> {
        if (!this.manager) return;
        try {
            await this.manager.removeUser();
        } catch (e) {
            // ignore
        }
        alert("Uitgelogd.");
    }

    private async getUser(): Promise<User | null> {
        if (!this.manager) return null;
        const user = await this.manager.getUser();
        if (!user || user.expired) return null;
        return user;
    }

    async getAccessToken(): Promise<string | null> {
        const user = await this.getUser();
        return user?.access_token || null;
    }

    async getProfile(): Promise<AuthProfile | null> {
        const user = await this.getUser();
        if (!user) return null;
        const p: any = user.profile || {};
        if (!p.sub) return null;
        return {
            sub: String(p.sub),
            name: p.name ? String(p.name) : undefined,
            email: p.email ? String(p.email) : undefined
        };
    }
}

export const oidcAuth = new OidcAuth();
