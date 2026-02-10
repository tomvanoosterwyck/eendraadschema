import { oidcAuth } from "./OidcAuth";
import { EDStoStructure } from "../importExport/importExport";

type ShareItem = {
    id: string;
    updatedAt: string;
    createdAt?: string;
    teamId?: string | null;
};

type ShareVersionItem = {
    id: string;
    createdAt: string;
    createdBySub?: string;
};

type TeamItem = {
    id: string;
    name: string;
    role: string;
};

function authHeader(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
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

function getLocalShareName(shareId: string): string {
    try {
        const v = globalThis.appDocStorage?.get?.(`shareNames.${shareId}`);
        return v ? String(v) : "";
    } catch {
        return "";
    }
}

function setLocalShareName(shareId: string, name: string): void {
    try {
        const trimmed = String(name || "").trim();
        if (!trimmed) {
            globalThis.appDocStorage?.delete?.(`shareNames.${shareId}`);
        } else {
            globalThis.appDocStorage?.set?.(`shareNames.${shareId}`, trimmed);
        }
    } catch {
        // ignore
    }
}

async function copyToClipboard(value: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        // Fallback: prompt
        prompt("Kopieer deze tekst:", value);
        return false;
    }
}

function setConfigView(html: string) {
    const config = document.getElementById("configsection");
    if (!config) throw new Error("configsection not found");
    config.innerHTML = html;
    globalThis.toggleAppView("config");
}

async function ensureAccessToken(): Promise<string | null> {
    if (!oidcAuth.isEnabled()) {
        alert("Beheer vereist OIDC login, maar OIDC is niet geconfigureerd.");
        return null;
    }

    const token = await oidcAuth.getAccessToken();
    if (token) return token;

    const ok = confirm("Aanmelden is nodig om shares/teams te beheren. Nu aanmelden?");
    if (ok) await oidcAuth.login();
    return null;
}

function renderShell(profileLabel: string): string {
    return `
<table border="1px" style="border-collapse:collapse" align="center" width="100%">
  <tr>
    <td width="100%" align="center" bgcolor="LightGrey">
      <b>Beheer - Delen & Teams</b>
    </td>
  </tr>
  <tr>
    <td width="100%" align="left" style="padding:10px">
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <span><b>Ingelogd als:</b> <span id="stm_profile">${profileLabel}</span></span>
        <button type="button" style="font-size:14px" id="stm_back">Terug</button>
        <button type="button" style="font-size:14px" id="stm_copy_current">Kopieer deel-link (huidig schema)</button>
      </div>
      <div style="margin-top:8px" class="highlight-warning" id="stm_global_status" hidden></div>
    </td>
  </tr>
</table>
<br>

<table border="1px" style="border-collapse:collapse" align="center" width="100%">
  <tr>
    <td width="100%" align="center" bgcolor="LightGrey"><b>Mijn shares</b></td>
  </tr>
  <tr>
    <td width="100%" align="left" style="padding:10px">
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <button type="button" style="font-size:14px" id="stm_refresh_shares">Vernieuwen</button>
        <span id="stm_shares_status"></span>
      </div>
      <div style="overflow:auto; margin-top:10px">
        <table border="1px" style="border-collapse:collapse" width="100%">
          <thead>
            <tr bgcolor="LightGrey">
                            <th align="left">Naam</th>
              <th align="left">Team</th>
              <th align="left">Aangepast</th>
              <th align="left">Acties</th>
            </tr>
          </thead>
          <tbody id="stm_shares_body"></tbody>
        </table>
      </div>
    </td>
  </tr>
</table>
<br>

<table border="1px" style="border-collapse:collapse" align="center" width="100%">
  <tr>
    <td width="100%" align="center" bgcolor="LightGrey"><b>Teams</b></td>
  </tr>
  <tr>
    <td width="100%" align="left" style="padding:10px">
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <button type="button" style="font-size:14px" id="stm_refresh_teams">Vernieuwen</button>
        <span id="stm_teams_status"></span>
      </div>

      <div style="margin-top:10px; display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start;">
        <div style="min-width:320px; flex:1;">
          <b>Mijn teams</b>
          <div style="overflow:auto; margin-top:8px">
            <table border="1px" style="border-collapse:collapse" width="100%">
              <thead>
                <tr bgcolor="LightGrey">
                  <th align="left">Team ID</th>
                  <th align="left">Naam</th>
                  <th align="left">Rol</th>
                </tr>
              </thead>
              <tbody id="stm_teams_body"></tbody>
            </table>
          </div>
        </div>

        <div style="min-width:320px; flex:1;">
          <b>Team aanmaken</b>
          <div style="margin-top:8px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <input type="text" id="stm_new_team_name" placeholder="Team naam" style="min-width:220px" />
            <button type="button" style="font-size:14px" id="stm_create_team">Aanmaken</button>
          </div>
          <div id="stm_create_team_status" style="margin-top:6px"></div>

          <hr style="margin:12px 0" />

          <b>Invite maken (owner)</b>
          <div style="margin-top:8px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <input type="text" id="stm_invite_team_id" placeholder="Team ID" style="min-width:220px" />
            <input type="text" id="stm_invite_email" placeholder="Email (optioneel)" style="min-width:220px" />
            <button type="button" style="font-size:14px" id="stm_create_invite">Maak invite</button>
          </div>
          <div style="margin-top:8px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <input type="text" id="stm_invite_token" placeholder="Invite token" style="min-width:260px" readonly />
            <button type="button" style="font-size:14px" id="stm_copy_invite">Kopieer</button>
          </div>
          <div id="stm_invite_status" style="margin-top:6px"></div>

          <hr style="margin:12px 0" />

          <b>Invite accepteren</b>
          <div style="margin-top:8px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <input type="text" id="stm_accept_token" placeholder="Invite token" style="min-width:260px" />
            <button type="button" style="font-size:14px" id="stm_accept_invite">Accepteren</button>
          </div>
          <div id="stm_accept_status" style="margin-top:6px"></div>
        </div>
      </div>
    </td>
  </tr>
</table>
<br>

`;
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
        throw new Error(`${resp.status} ${text}`);
    }
    return (await resp.json()) as T;
}

function setText(id: string, value: string) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setHtml(id: string, value: string) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
}

async function refreshShares(token: string): Promise<void> {
    setText("stm_shares_status", "Laden...");
    const tbody = document.getElementById("stm_shares_body") as HTMLTableSectionElement | null;
    if (!tbody) return;
    tbody.innerHTML = "";

    let items: ShareItem[] = [];
    try {
        items = await fetchJSON<ShareItem[]>("/api/shares/mine", token, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });
    } catch (e: any) {
        setText("stm_shares_status", "");
        alert(`Kon shares niet laden: ${String(e?.message || e)}`);
        return;
    }

    if (!Array.isArray(items) || items.length === 0) {
        setText("stm_shares_status", "Geen shares");
        return;
    }

    setText("stm_shares_status", `${items.length} shares`);

    for (const s of items) {
        const tr = document.createElement("tr");

        // Keep the ID available for actions/debugging, but don't show it in the table.
        tr.dataset.shareId = s.id;

        const tdTeam = document.createElement("td");
        tdTeam.textContent = s.teamId ? String(s.teamId) : "-";

        const tdName = document.createElement("td");
        const nameSpan = document.createElement("span");
        nameSpan.textContent = getLocalShareName(s.id) || "-";
        tdName.appendChild(nameSpan);

        const tdUpd = document.createElement("td");
        tdUpd.textContent = formatIso(s.updatedAt);

        const tdAct = document.createElement("td");

        const btnName = document.createElement("button");
        btnName.type = "button";
        btnName.style.fontSize = "14px";
        btnName.textContent = "Naam";
        btnName.addEventListener("click", async () => {
            const current = getLocalShareName(s.id);
            const next = prompt("Geef een naam voor deze share (leeg = wissen):", current);
            if (next === null) return;
            setLocalShareName(s.id, next);
            nameSpan.textContent = getLocalShareName(s.id) || "-";
        });

        const btnVersions = document.createElement("button");
        btnVersions.type = "button";
        btnVersions.style.fontSize = "14px";
        btnVersions.style.marginLeft = "8px";
        btnVersions.textContent = "Versies";
        btnVersions.addEventListener("click", async () => {
            const t = await oidcAuth.getAccessToken();
            if (!t) {
                alert("Niet ingelogd.");
                return;
            }
            let versions: ShareVersionItem[] = [];
            try {
                versions = await fetchJSON<ShareVersionItem[]>(
                    `/api/shares/${encodeURIComponent(s.id)}/versions`,
                    t,
                    { method: "GET" }
                );
            } catch (e: any) {
                alert(`Kon versies niet laden: ${String(e?.message || e)}`);
                return;
            }
            if (!Array.isArray(versions) || versions.length === 0) {
                alert("Geen versies gevonden.");
                return;
            }
            const lines = versions
                .slice(0, 50)
                .map((v, idx) => `${idx + 1} = ${v.id}  (${formatIso(v.createdAt)})`);
            const pick = prompt(
                `Kies versie nummer om te openen/herstellen:\n${lines.join("\n")}`,
                "1"
            );
            if (!pick) return;
            const n = parseInt(pick, 10);
            if (!Number.isFinite(n) || n < 1 || n > versions.length) return;
            const ver = versions[n - 1];

            const action = prompt("Actie:\n1 = Open (preview/load)\n2 = Herstel (maakt deze versie de huidige)", "1");
            if (!action) return;

            if (action === "1") {
                try {
                    const data = await fetchJSON<{ schema: string }>(
                        `/api/shares/${encodeURIComponent(s.id)}/versions/${encodeURIComponent(ver.id)}`,
                        t,
                        { method: "GET" }
                    );
                    if (!data?.schema) {
                        alert("Versie bevat geen schema.");
                        return;
                    }
                    const ok = confirm("Dit zal je huidige schema vervangen. Doorgaan?");
                    if (!ok) return;
                    globalThis.currentShareId = s.id;
                    EDStoStructure(data.schema, true, true);
                    globalThis.fileAPIobj.clear();
                    globalThis.topMenu.selectMenuItemByName("Eéndraadschema");
                } catch (e: any) {
                    alert(`Kon versie niet openen: ${String(e?.message || e)}`);
                }
                return;
            }

            if (action === "2") {
                const ok = confirm("Herstellen zal de share in de cloud overschrijven. Doorgaan?");
                if (!ok) return;
                try {
                    await fetchJSON<any>(
                        `/api/shares/${encodeURIComponent(s.id)}/versions/${encodeURIComponent(ver.id)}/restore`,
                        t,
                        { method: "POST" }
                    );
                    alert("Hersteld.");
                    await refreshShares(t);
                } catch (e: any) {
                    alert(`Kon niet herstellen: ${String(e?.message || e)}`);
                }
            }
        });

        const btnOpen = document.createElement("button");
        btnOpen.type = "button";
        btnOpen.style.fontSize = "14px";
        btnOpen.textContent = "Open";
        btnOpen.addEventListener("click", async () => {
            const ok = confirm("Dit zal je huidige schema vervangen. Doorgaan?");
            if (!ok) return;

            try {
                const resp = await fetch(`/api/shares/${encodeURIComponent(s.id)}`);
                if (!resp.ok) {
                    alert(`Kon share niet laden: ${resp.status} ${await resp.text()}`);
                    return;
                }
                const data = (await resp.json()) as { id: string; schema: string; updatedAt: string };
                if (!data?.schema) {
                    alert("Share bevat geen schema.");
                    return;
                }
                globalThis.currentShareId = s.id;
                EDStoStructure(data.schema, true, true);
                globalThis.fileAPIobj.clear();
                globalThis.topMenu.selectMenuItemByName("Eéndraadschema");
            } catch (e: any) {
                alert(`Kon share niet laden: ${String(e?.message || e)}`);
            }
        });

        const btnCopy = document.createElement("button");
        btnCopy.type = "button";
        btnCopy.style.fontSize = "14px";
        btnCopy.style.marginLeft = "8px";
        btnCopy.textContent = "Kopieer link";
        btnCopy.addEventListener("click", async () => {
            const url = computeShareUrl(s.id);
            await copyToClipboard(url);
        });

        tdAct.appendChild(btnName);
        tdAct.appendChild(btnVersions);
        tdAct.appendChild(btnOpen);
        tdAct.appendChild(btnCopy);

        tr.appendChild(tdName);
        tr.appendChild(tdTeam);
        tr.appendChild(tdUpd);
        tr.appendChild(tdAct);

        tbody.appendChild(tr);
    }
}

async function refreshTeams(token: string): Promise<TeamItem[]> {
    setText("stm_teams_status", "Laden...");
    const tbody = document.getElementById("stm_teams_body") as HTMLTableSectionElement | null;
    if (!tbody) return [];
    tbody.innerHTML = "";

    let teams: TeamItem[] = [];
    try {
        teams = await fetchJSON<TeamItem[]>("/api/teams", token, { method: "GET" });
    } catch (e: any) {
        setText("stm_teams_status", "");
        alert(`Kon teams niet laden: ${String(e?.message || e)}`);
        return [];
    }

    if (!Array.isArray(teams) || teams.length === 0) {
        setText("stm_teams_status", "Geen teams");
        return [];
    }

    setText("stm_teams_status", `${teams.length} teams`);

    for (const t of teams) {
        const tr = document.createElement("tr");

        const tdId = document.createElement("td");
        const code = document.createElement("code");
        code.textContent = t.id;
        tdId.appendChild(code);

        const tdName = document.createElement("td");
        tdName.textContent = t.name;

        const tdRole = document.createElement("td");
        tdRole.textContent = t.role;

        tr.appendChild(tdId);
        tr.appendChild(tdName);
        tr.appendChild(tdRole);

        tbody.appendChild(tr);
    }

    return teams;
}

export async function openShareTeamsScreen(): Promise<void> {
    const token = await ensureAccessToken();
    if (!token) return;

    const profile = await oidcAuth.getProfile();
    const label = profile?.name || profile?.email || profile?.sub || "";

    setConfigView(renderShell(label));

    const back = document.getElementById("stm_back") as HTMLButtonElement | null;
    back?.addEventListener("click", () => {
        globalThis.topMenu.selectMenuItemByName("Bestand");
    });

    const copyCurrent = document.getElementById("stm_copy_current") as HTMLButtonElement | null;
    copyCurrent?.addEventListener("click", async () => {
        if (typeof globalThis.copyShareLink === "function") {
            await globalThis.copyShareLink();
        } else {
            alert("copyShareLink is niet beschikbaar.");
        }
    });

    const refreshSharesBtn = document.getElementById("stm_refresh_shares") as HTMLButtonElement | null;
    refreshSharesBtn?.addEventListener("click", async () => {
        const t = await oidcAuth.getAccessToken();
        if (!t) {
            alert("Niet ingelogd.");
            return;
        }
        await refreshShares(t);
    });

    const refreshTeamsBtn = document.getElementById("stm_refresh_teams") as HTMLButtonElement | null;
    refreshTeamsBtn?.addEventListener("click", async () => {
        const t = await oidcAuth.getAccessToken();
        if (!t) {
            alert("Niet ingelogd.");
            return;
        }
        await refreshTeams(t);
    });

    const createTeamBtn = document.getElementById("stm_create_team") as HTMLButtonElement | null;
    createTeamBtn?.addEventListener("click", async () => {
        const t = await oidcAuth.getAccessToken();
        if (!t) {
            alert("Niet ingelogd.");
            return;
        }
        const nameInput = document.getElementById("stm_new_team_name") as HTMLInputElement | null;
        const name = (nameInput?.value || "").trim();
        if (!name) {
            setHtml("stm_create_team_status", '<span class="highlight-warning">Naam is verplicht.</span>');
            return;
        }
        setText("stm_create_team_status", "Bezig...");
        try {
            const created = await fetchJSON<{ id: string; name: string }>("/api/teams", t, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name })
            });
            if (nameInput) nameInput.value = "";
            setHtml(
                "stm_create_team_status",
                `Team aangemaakt: <code>${created.id}</code> (${created.name})`
            );
            await refreshTeams(t);
        } catch (e: any) {
            setHtml("stm_create_team_status", `<span class="highlight-warning">Fout: ${String(e?.message || e)}</span>`);
        }
    });

    const createInviteBtn = document.getElementById("stm_create_invite") as HTMLButtonElement | null;
    createInviteBtn?.addEventListener("click", async () => {
        const t = await oidcAuth.getAccessToken();
        if (!t) {
            alert("Niet ingelogd.");
            return;
        }
        const teamId = ((document.getElementById("stm_invite_team_id") as HTMLInputElement | null)?.value || "").trim();
        const email = ((document.getElementById("stm_invite_email") as HTMLInputElement | null)?.value || "").trim();
        const tokenOut = document.getElementById("stm_invite_token") as HTMLInputElement | null;
        if (!teamId) {
            setHtml("stm_invite_status", '<span class="highlight-warning">Team ID is verplicht.</span>');
            return;
        }
        setText("stm_invite_status", "Bezig...");
        if (tokenOut) tokenOut.value = "";
        try {
            const inv = await fetchJSON<{ token: string; expiresAt: string }>(
                `/api/teams/${encodeURIComponent(teamId)}/invites`,
                t,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: email || "" })
                }
            );
            if (tokenOut) tokenOut.value = inv.token;
            setHtml(
                "stm_invite_status",
                `Invite gemaakt (vervalt ${formatIso(inv.expiresAt)}).`
            );
        } catch (e: any) {
            setHtml("stm_invite_status", `<span class="highlight-warning">Fout: ${String(e?.message || e)}</span>`);
        }
    });

    const copyInviteBtn = document.getElementById("stm_copy_invite") as HTMLButtonElement | null;
    copyInviteBtn?.addEventListener("click", async () => {
        const tokenEl = document.getElementById("stm_invite_token") as HTMLInputElement | null;
        const val = (tokenEl?.value || "").trim();
        if (!val) return;
        await copyToClipboard(val);
    });

    const acceptInviteBtn = document.getElementById("stm_accept_invite") as HTMLButtonElement | null;
    acceptInviteBtn?.addEventListener("click", async () => {
        const t = await oidcAuth.getAccessToken();
        if (!t) {
            alert("Niet ingelogd.");
            return;
        }
        const tok = ((document.getElementById("stm_accept_token") as HTMLInputElement | null)?.value || "").trim();
        if (!tok) {
            setHtml("stm_accept_status", '<span class="highlight-warning">Token is verplicht.</span>');
            return;
        }
        setText("stm_accept_status", "Bezig...");
        try {
            const res = await fetchJSON<{ teamId: string; joined: boolean }>("/api/invites/accept", t, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: tok })
            });
            setHtml(
                "stm_accept_status",
                `Toegevoegd aan team: <code>${res.teamId}</code>`
            );
            await refreshTeams(t);
        } catch (e: any) {
            setHtml("stm_accept_status", `<span class="highlight-warning">Fout: ${String(e?.message || e)}</span>`);
        }
    });


    // Initial load
    await refreshShares(token);
    await refreshTeams(token);
}
