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
    silentRedirectUri?: string;
    useRefreshToken?: boolean;
    renewSkewSeconds: number;
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
    const silentRedirectUri =
        readRuntimeConfig("VITE_OIDC_SILENT_REDIRECT_URI") || (import.meta as any).env?.VITE_OIDC_SILENT_REDIRECT_URI || "";
    const useRefreshTokenRaw =
        readRuntimeConfig("VITE_OIDC_USE_REFRESH_TOKEN") || (import.meta as any).env?.VITE_OIDC_USE_REFRESH_TOKEN || "";
    const renewSkewSecondsRaw =
        readRuntimeConfig("VITE_OIDC_RENEW_SKEW_SECONDS") || (import.meta as any).env?.VITE_OIDC_RENEW_SKEW_SECONDS || "";

    if (!issuerUrl || !clientId) return null;
    const useRefreshToken = String(useRefreshTokenRaw).trim().toLowerCase();
    const useRefreshTokenBool = useRefreshToken === "1" || useRefreshToken === "true" || useRefreshToken === "yes";
    const renewSkewSecondsParsed = Number(String(renewSkewSecondsRaw).trim() || "30");
    return {
        issuerUrl: String(issuerUrl),
        clientId: String(clientId),
        audience: audience ? String(audience) : undefined,
        scope: String(scope),
        silentRedirectUri: silentRedirectUri ? String(silentRedirectUri) : undefined,
        useRefreshToken: useRefreshTokenBool,
        renewSkewSeconds: Number.isFinite(renewSkewSecondsParsed) ? Math.max(0, renewSkewSecondsParsed) : 30
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
    private renewPromise: Promise<User | null> | null;

    constructor() {
        this.env = getOidcEnv();
        this.renewPromise = null;
        const allowSilentRenew = !!this.env?.silentRedirectUri || !!this.env?.useRefreshToken;
        this.manager = this.env
            ? new UserManager({
                  authority: this.env.issuerUrl,
                  client_id: this.env.clientId,
                  redirect_uri: buildRedirectUri(),
                  response_type: "code",
                  scope: this.env.scope,
                  ...(this.env.silentRedirectUri ? { silent_redirect_uri: this.env.silentRedirectUri } : {}),
                  // Store tokens in sessionStorage by default to avoid long-lived secrets.
                  // If you want persistence across restarts, switch to localStorage.
                  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
                  // Silent renew is opt-in: requires either a silent_redirect_uri (iframe) or refresh tokens.
                  automaticSilentRenew: allowSilentRenew,
                  ...(this.env.useRefreshToken ? { useRefreshToken: true } : {}),
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
        const isSilentRenew = qs.has("silent-renew");
        if (hasCode && isSilentRenew) {
            try {
                await this.manager.signinSilentCallback();
            } catch (e) {
                console.warn("OIDC silent callback handling failed", e);
            } finally {
                // Keep the iframe URL clean to avoid repeated callback handling.
                window.history.replaceState(null, document.title, window.location.origin + window.location.pathname);
            }
            return;
        }

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

        // Best-effort renewal hooks (only effective if silent renew is configured)
        try {
            this.manager.events.addAccessTokenExpiring(() => {
                void this.tryRenewUser("expiring");
            });
            this.manager.events.addAccessTokenExpired(() => {
                void this.tryRenewUser("expired");
            });
        } catch {
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
        if (!user) return null;

        if (user.expired) {
            const renewed = await this.tryRenewUser("expired-getUser");
            return renewed;
        }

        if (this.isExpiringSoon(user)) {
            // Keep using the current token if renewal fails; it's still valid.
            await this.tryRenewUser("expiring-soon-getUser");
            const fresh = await this.manager.getUser();
            if (fresh && !fresh.expired) return fresh;
        }

        return user;
    }

    private isExpiringSoon(user: User): boolean {
        const expiresAt = (user as any)?.expires_at;
        if (!expiresAt || typeof expiresAt !== "number") return false;
        const msLeft = expiresAt * 1000 - Date.now();
        const skew = this.env?.renewSkewSeconds ?? 30;
        return msLeft <= skew * 1000;
    }

    private async tryRenewUser(_reason: string): Promise<User | null> {
        if (!this.manager) return null;
        if (this.renewPromise) return this.renewPromise;

        this.renewPromise = (async () => {
            try {
                const renewed = await this.manager!.signinSilent();
                if (renewed && !renewed.expired) return renewed;
                return null;
            } catch {
                return null;
            } finally {
                this.renewPromise = null;
            }
        })();

        return this.renewPromise;
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
