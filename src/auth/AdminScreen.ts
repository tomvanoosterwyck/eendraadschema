import { oidcAuth } from "./OidcAuth";
import { EDStoStructure } from "../importExport/importExport";

type MeInfo = {
    sub: string;
    email?: string;
    name?: string;
    isAdmin?: boolean;
};

type AdminUserItem = {
    sub: string;
    email?: string;
    name?: string;
    isAdmin: boolean;
    lastSeenAt?: string;
};

type AdminShareItem = {
    id: string;
    ownerSub?: string;
    ownerName?: string;
    ownerEmail?: string;
    teamId?: string | null;
    updatedAt?: string;
    createdAt?: string;
};

function authHeader(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function setConfigView(html: string) {
    const config = document.getElementById("configsection");
    if (!config) throw new Error("configsection not found");
    config.innerHTML = html;
    globalThis.toggleAppView("config");
}

function setText(id: string, text: string): void {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setHtml(id: string, html: string): void {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function formatIso(iso: string | undefined): string {
    if (!iso) return "";
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function computeShareUrl(id: string): string {
    const baseUrl = window.location.href.split("#")[0];
    return `${baseUrl}#share=${encodeURIComponent(id)}`;
}

async function copyToClipboard(value: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        prompt("Kopieer deze tekst:", value);
    }
}

async function ensureAccessToken(): Promise<string | null> {
    if (!oidcAuth.isEnabled()) {
        alert("Admin vereist OIDC login, maar OIDC is niet geconfigureerd.");
        return null;
    }

    const token = await oidcAuth.getAccessToken();
    if (token) return token;

    const ok = confirm("Aanmelden is nodig voor admin. Nu aanmelden?");
    if (ok) await oidcAuth.login();
    return null;
}

async function fetchJSON<T>(url: string, token: string, init?: RequestInit): Promise<T> {
    const resp = await fetch(url, {
        ...init,
        headers: {
            ...(init?.headers || {}),
            ...authHeader(token)
        }
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`${resp.status} ${text || resp.statusText}`);
    }
    return (await resp.json()) as T;
}

function renderShell(profileLabel: string): string {
    return `
<table border="1px" style="border-collapse:collapse" align="center" width="100%">
  <tr>
    <td width="100%" align="center" bgcolor="LightGrey"><b>Admin</b></td>
  </tr>
  <tr>
    <td width="100%" align="left" style="padding:10px">
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <span><b>Ingelogd als:</b> <span id="adm_profile">${profileLabel}</span></span>
        <button type="button" style="font-size:14px" id="adm_back">Terug</button>
      </div>
      <div style="margin-top:8px" class="highlight-warning" id="adm_status" hidden></div>
    </td>
  </tr>
</table>
<br>

<table border="1px" style="border-collapse:collapse" align="center" width="100%">
  <tr>
    <td width="100%" align="center" bgcolor="LightGrey"><b>Users</b></td>
  </tr>
  <tr>
    <td width="100%" align="left" style="padding:10px">
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <button type="button" style="font-size:14px" id="adm_users_refresh">Vernieuwen</button>
        <span id="adm_users_status"></span>
      </div>
      <div style="overflow:auto; margin-top:10px">
        <table border="1px" style="border-collapse:collapse" width="100%">
          <thead>
            <tr bgcolor="LightGrey">
              <th align="left">Sub</th>
              <th align="left">Naam</th>
              <th align="left">Email</th>
              <th align="left">Admin</th>
              <th align="left">Laatste login</th>
              <th align="left">Acties</th>
            </tr>
          </thead>
          <tbody id="adm_users_body"></tbody>
        </table>
      </div>
    </td>
  </tr>
</table>
<br>

<table border="1px" style="border-collapse:collapse" align="center" width="100%">
  <tr>
    <td width="100%" align="center" bgcolor="LightGrey"><b>Alle schemas</b></td>
  </tr>
  <tr>
    <td width="100%" align="left" style="padding:10px">
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <button type="button" style="font-size:14px" id="adm_shares_refresh">Vernieuwen</button>
        <span id="adm_shares_status"></span>
      </div>
      <div style="overflow:auto; margin-top:10px">
        <table border="1px" style="border-collapse:collapse" width="100%">
          <thead>
            <tr bgcolor="LightGrey">
              <th align="left">Share ID</th>
              <th align="left">Owner</th>
              <th align="left">Team</th>
              <th align="left">Aangepast</th>
              <th align="left">Acties</th>
            </tr>
          </thead>
          <tbody id="adm_shares_body"></tbody>
        </table>
      </div>
    </td>
  </tr>
</table>
`;
}

async function refreshUsers(token: string): Promise<void> {
    setText("adm_users_status", "Bezig...");
    const tbody = document.getElementById("adm_users_body");
    if (tbody) tbody.innerHTML = "";

    try {
        const users = await fetchJSON<AdminUserItem[]>("/api/admin/users", token);
        if (!Array.isArray(users) || users.length === 0) {
            setText("adm_users_status", "Geen users");
            return;
        }
        setText("adm_users_status", `${users.length} users`);
        if (!tbody) return;

        for (const u of users) {
            const tr = document.createElement("tr");

            const tdSub = document.createElement("td");
            const code = document.createElement("code");
            code.textContent = u.sub;
            tdSub.appendChild(code);

            const tdName = document.createElement("td");
            tdName.textContent = u.name || "";

            const tdEmail = document.createElement("td");
            tdEmail.textContent = u.email || "";

            const tdAdmin = document.createElement("td");
            tdAdmin.textContent = u.isAdmin ? "Ja" : "Nee";

            const tdLast = document.createElement("td");
            tdLast.textContent = formatIso(u.lastSeenAt);

            const tdActions = document.createElement("td");
            const btn = document.createElement("button");
            btn.type = "button";
            btn.style.fontSize = "14px";
            btn.textContent = u.isAdmin ? "Maak geen admin" : "Maak admin";
            btn.addEventListener("click", async () => {
                const next = !u.isAdmin;
                const ok = confirm(`${next ? "Admin rechten geven aan" : "Admin rechten verwijderen van"} ${u.sub}?`);
                if (!ok) return;
                await fetchJSON(`/api/admin/users/${encodeURIComponent(u.sub)}`, token, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ isAdmin: next })
                });
                await refreshUsers(token);
            });
            tdActions.appendChild(btn);

            tr.appendChild(tdSub);
            tr.appendChild(tdName);
            tr.appendChild(tdEmail);
            tr.appendChild(tdAdmin);
            tr.appendChild(tdLast);
            tr.appendChild(tdActions);

            tbody.appendChild(tr);
        }
    } catch (e: any) {
        setHtml("adm_users_status", `<span class="highlight-warning">Fout: ${String(e?.message || e)}</span>`);
    }
}

async function refreshShares(token: string): Promise<void> {
    setText("adm_shares_status", "Bezig...");
    const tbody = document.getElementById("adm_shares_body");
    if (tbody) tbody.innerHTML = "";

    try {
        const shares = await fetchJSON<AdminShareItem[]>("/api/admin/shares", token);
        if (!Array.isArray(shares) || shares.length === 0) {
            setText("adm_shares_status", "Geen shares");
            return;
        }
        setText("adm_shares_status", `${shares.length} shares`);
        if (!tbody) return;

        for (const s of shares) {
            const tr = document.createElement("tr");

            const tdId = document.createElement("td");
            const code = document.createElement("code");
            code.textContent = s.id;
            tdId.appendChild(code);

            const tdOwner = document.createElement("td");
            const ownerLabel = (s.ownerName || s.ownerEmail || "").trim();
            tdOwner.textContent = ownerLabel || (s.ownerSub || "");

            const tdTeam = document.createElement("td");
            tdTeam.textContent = s.teamId || "";

            const tdUpd = document.createElement("td");
            tdUpd.textContent = formatIso(s.updatedAt);

            const tdActions = document.createElement("td");

            const openBtn = document.createElement("button");
            openBtn.type = "button";
            openBtn.style.fontSize = "14px";
            openBtn.textContent = "Open";
            openBtn.addEventListener("click", async () => {
                const sh = await fetchJSON<{ id: string; schema: string; updatedAt: string }>(
                    `/api/admin/shares/${encodeURIComponent(s.id)}`,
                    token
                );
                const st = EDStoStructure(sh.schema);
                globalThis.load_from_txt(st);
                globalThis.currentShareId = sh.id;
                globalThis.topMenu.selectMenuItemByName("Schema");
            });

            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.style.fontSize = "14px";
            copyBtn.textContent = "Kopieer link";
            copyBtn.style.marginLeft = "6px";
            copyBtn.addEventListener("click", async () => {
                await copyToClipboard(computeShareUrl(s.id));
            });

            tdActions.appendChild(openBtn);
            tdActions.appendChild(copyBtn);

            tr.appendChild(tdId);
            tr.appendChild(tdOwner);
            tr.appendChild(tdTeam);
            tr.appendChild(tdUpd);
            tr.appendChild(tdActions);

            tbody.appendChild(tr);
        }
    } catch (e: any) {
        setHtml("adm_shares_status", `<span class="highlight-warning">Fout: ${String(e?.message || e)}</span>`);
    }
}

export async function openAdminScreen(): Promise<void> {
    const token = await ensureAccessToken();
    if (!token) return;

    const profile = await oidcAuth.getProfile();
    const label = profile?.name || profile?.email || profile?.sub || "";

    // Must be admin.
    try {
        const me = await fetchJSON<MeInfo>("/api/me", token);
        if (!me?.isAdmin) {
            alert("Geen toegang: admin vereist.");
            return;
        }
    } catch (e: any) {
        alert(`Kon admin status niet controleren: ${String(e?.message || e)}`);
        return;
    }

    setConfigView(renderShell(label));

    const back = document.getElementById("adm_back") as HTMLButtonElement | null;
    back?.addEventListener("click", () => {
        globalThis.topMenu.selectMenuItemByName("Bestand");
    });

    const usersRefresh = document.getElementById("adm_users_refresh") as HTMLButtonElement | null;
    usersRefresh?.addEventListener("click", async () => {
        const t = await oidcAuth.getAccessToken();
        if (!t) return;
        await refreshUsers(t);
    });

    const sharesRefresh = document.getElementById("adm_shares_refresh") as HTMLButtonElement | null;
    sharesRefresh?.addEventListener("click", async () => {
        const t = await oidcAuth.getAccessToken();
        if (!t) return;
        await refreshShares(t);
    });

    await refreshUsers(token);
    await refreshShares(token);
}
