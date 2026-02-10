import { oidcAuth } from "./OidcAuth";
import { openShareTeamsScreen } from "./ShareTeamsScreen";
import { openAdminScreen } from "./AdminScreen";

function authHeader(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

globalThis.authLogin = async () => {
    try {
        await oidcAuth.login();
    } catch (e: any) {
        console.error("OIDC login failed", e);
        const msg = e?.message ? String(e.message) : String(e);
        alert(`Aanmelden mislukt: ${msg}`);
    }
};

globalThis.authLogout = async () => {
    await oidcAuth.logout();
};

globalThis.authWhoAmI = async () => {
    if (!oidcAuth.isEnabled()) {
        alert("OIDC is niet geconfigureerd.");
        return;
    }
    const profile = await oidcAuth.getProfile();
    if (!profile) {
        alert("Niet ingelogd.");
        return;
    }
    alert(`Ingelogd als: ${profile.name || profile.email || profile.sub}`);
};

globalThis.openShareManager = async () => {
    if (!oidcAuth.isEnabled()) {
        alert("Share beheer vereist OIDC login, maar OIDC is niet geconfigureerd.");
        return;
    }
    const token = await oidcAuth.getAccessToken();
    if (!token) {
        const ok = confirm("Aanmelden is nodig om je shares te bekijken. Nu aanmelden?");
        if (ok) await oidcAuth.login();
        return;
    }

    const resp = await fetch("/api/shares/mine", {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            ...authHeader(token)
        }
    });

    if (!resp.ok) {
        alert(`Kon shares niet laden: ${resp.status} ${await resp.text()}`);
        return;
    }

    const data = (await resp.json()) as Array<{ id: string; updatedAt: string; createdAt?: string; teamId?: string | null }>;
    if (!Array.isArray(data) || data.length === 0) {
        alert("Geen shares gevonden.");
        return;
    }

    const baseUrl = window.location.href.split("#")[0];
    const lines = data
        .slice(0, 50)
        .map((s) => `${s.id}  (updated ${s.updatedAt})  ->  ${baseUrl}#share=${s.id}`);
    prompt("Je shares (kopieer wat je nodig hebt):", lines.join("\n"));
};

globalThis.openTeamManager = async () => {
    if (!oidcAuth.isEnabled()) {
        alert("Teams vereisen OIDC login, maar OIDC is niet geconfigureerd.");
        return;
    }
    const token = await oidcAuth.getAccessToken();
    if (!token) {
        const ok = confirm("Aanmelden is nodig voor teams. Nu aanmelden?");
        if (ok) await oidcAuth.login();
        return;
    }

    const action = prompt(
        "Team acties:\n1 = List teams\n2 = Create team\n3 = Invite to team (by team id)\n4 = Accept invite (token)",
        "1"
    );
    if (!action) return;

    if (action === "1") {
        const resp = await fetch("/api/teams", { headers: authHeader(token) });
        if (!resp.ok) {
            alert(`Kon teams niet laden: ${resp.status} ${await resp.text()}`);
            return;
        }
        const teams = (await resp.json()) as Array<{ id: string; name: string; role: string }>;
        const lines = teams.map((t) => `${t.id}  ${t.name}  (${t.role})`);
        prompt("Teams:", lines.join("\n"));
        return;
    }

    if (action === "2") {
        const name = prompt("Team naam:", "Mijn team");
        if (!name) return;
        const resp = await fetch("/api/teams", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader(token) },
            body: JSON.stringify({ name })
        });
        if (!resp.ok) {
            alert(`Kon team niet aanmaken: ${resp.status} ${await resp.text()}`);
            return;
        }
        const t = (await resp.json()) as { id: string; name: string };
        alert(`Team aangemaakt: ${t.name} (${t.id})`);
        return;
    }

    if (action === "3") {
        const teamId = prompt("Team id:", "");
        if (!teamId) return;
        const email = prompt("Invite email (optioneel):", "");
        const resp = await fetch(`/api/teams/${encodeURIComponent(teamId)}/invites`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader(token) },
            body: JSON.stringify({ email: email || "" })
        });
        if (!resp.ok) {
            alert(`Kon invite niet maken: ${resp.status} ${await resp.text()}`);
            return;
        }
        const inv = (await resp.json()) as { token: string; expiresAt: string };
        prompt("Invite token (deel dit):", inv.token);
        return;
    }

    if (action === "4") {
        const inviteToken = prompt("Invite token:", "");
        if (!inviteToken) return;
        const resp = await fetch("/api/invites/accept", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader(token) },
            body: JSON.stringify({ token: inviteToken })
        });
        if (!resp.ok) {
            alert(`Kon invite niet accepteren: ${resp.status} ${await resp.text()}`);
            return;
        }
        alert("Invite geaccepteerd.");
    }
};

globalThis.openShareTeamsScreen = async () => {
    await openShareTeamsScreen();
};

globalThis.openAdminScreen = async () => {
    await openAdminScreen();
};

export async function initFrontendAuth(): Promise<void> {
    await oidcAuth.init();

    // Best-effort: notify the backend that we're logged in so it can upsert
    // the user record in the DB immediately.
    try {
        if (oidcAuth.isEnabled()) {
            const token = await oidcAuth.getAccessToken();
            if (token) {
                await fetch("/api/me", { headers: authHeader(token) });
            }
        }
    } catch {
        // ignore
    }
}
