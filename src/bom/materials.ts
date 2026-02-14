import { htmlspecialchars } from "../general";
import { ElectroItemZoeker } from "../sitplan/ElectroItemZoeker";
import { computeCableLengthSummaryForKring } from "../sitplan/CableLengthCalculator";

export type MaterialUnit = 'm' | 'pcs';

export type MaterialLine = {
    key: string;
    label: string;
    unit: MaterialUnit;
    quantity: number;
};

export type BomPrintSection = {
    heading: string;
    lines: string[];
};

export type BomPrintData = {
    title: string;
    sections: BomPrintSection[];
};

export function refreshMaterialsPageIfOpen(): void {
    if (document.getElementById('materialsscreen') == null) return;
    showMaterialsPage();
}

function round1(v: number): number {
    return Math.round(v * 10) / 10;
}

function formatMeters(v: number): string {
    if (!Number.isFinite(v)) return '—';
    return `${round1(v)} m`;
}

function formatPcs(v: number): string {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v - Math.round(v)) < 1e-9) return `${Math.round(v)} st`;
    return `${round1(v)} st`;
}

function parsePositiveInt(value: any, fallback: number): number {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

function addLine(lines: MaterialLine[], line: MaterialLine): void {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) return;
    lines.push(line);
}

function sumByKey(lines: MaterialLine[]): MaterialLine[] {
    const byKey = new Map<string, MaterialLine>();
    for (const l of lines) {
        const existing = byKey.get(l.key);
        if (!existing) {
            byKey.set(l.key, { ...l });
        } else {
            existing.quantity += l.quantity;
        }
    }

    const merged = Array.from(byKey.values());
    merged.sort((a, b) => a.label.localeCompare(b.label));
    for (const m of merged) m.quantity = round1(m.quantity);
    return merged;
}

function cableMaterialsForKring(sitplan: any, elements: any[], kring: string): {
    lines: MaterialLine[];
    unknownScaleRuns: number;
    unknownRiserCount: number;
    unknownEndpointCount: number;
} {
    const summary = computeCableLengthSummaryForKring(sitplan, elements, kring);

    const lines: MaterialLine[] = Object.entries(summary.metersBySpec)
        .map(([spec, meters]) => ({
            key: `cable:${spec}`,
            label: spec,
            unit: 'm' as const,
            quantity: Number(meters),
        }))
        .filter(l => Number.isFinite(l.quantity) && l.quantity > 0);

    lines.sort((a, b) => a.label.localeCompare(b.label));

    return { lines, unknownScaleRuns: summary.unknownScaleRuns, unknownRiserCount: summary.unknownRiserCount, unknownEndpointCount: summary.unknownEndpointCount };
}

function getKringNameForItemId(structure: any, id: number): string {
    if (structure && typeof structure.findKringName === 'function') {
        const name = String(structure.findKringName(id) ?? '').trim();
        if (name !== '') return name;
    }
    return 'Zonder naam';
}

function deviceLinesFromElectroItem(item: any): MaterialLine[] {
    const type = String(item?.getType?.() ?? '');
    if (!type) return [];

    switch (type) {
        case 'Contactdoos': {
            const count = parsePositiveInt(item?.props?.aantal, 1);
            return [{
                key: 'device:contactdoos',
                label: 'Contactdoos',
                unit: 'pcs',
                quantity: count,
            }];
        }

        case 'Schakelaars': {
            const count = parsePositiveInt(item?.props?.aantal_schakelaars, 1);
            const kind = String(item?.props?.type_schakelaar ?? '').trim();
            const kindLabel = kind ? `Schakelaar (${kind})` : 'Schakelaar';
            const key = kind ? `device:schakelaar:${kind}` : 'device:schakelaar';
            return [{
                key,
                label: kindLabel,
                unit: 'pcs',
                quantity: count,
            }];
        }

        case 'Drukknop': {
            // Model: aantal armaturen × aantal knoppen per armatuur.
            const armaturen = parsePositiveInt(item?.props?.aantal, 1);
            const perArmatuur = parsePositiveInt(item?.props?.aantal_knoppen_per_armatuur, 1);
            const count = armaturen * perArmatuur;
            const kind = String(item?.props?.type_knop ?? '').trim();
            const kindLabel = kind ? `Drukknop (${kind})` : 'Drukknop';
            const key = kind ? `device:drukknop:${kind}` : 'device:drukknop';
            return [{
                key,
                label: kindLabel,
                unit: 'pcs',
                quantity: count,
            }];
        }

        case 'Lichtpunt': {
            const count = parsePositiveInt(item?.props?.aantal, 1);
            const kind = String(item?.props?.type_lamp ?? '').trim();
            const kindLabel = kind ? `Lichtpunt (${kind})` : 'Lichtpunt';
            const key = kind ? `device:lichtpunt:${kind}` : 'device:lichtpunt';
            return [{
                key,
                label: kindLabel,
                unit: 'pcs',
                quantity: count,
            }];
        }

        case 'Aftakdoos': {
            return [{
                key: 'device:aftakdoos',
                label: 'Aftakdoos',
                unit: 'pcs',
                quantity: 1,
            }];
        }

        case 'Aansluitpunt': {
            return [{
                key: 'device:aansluitpunt',
                label: 'Aansluitpunt',
                unit: 'pcs',
                quantity: 1,
            }];
        }

        case 'Zekering/differentieel': {
            const bescherming = String(item?.props?.bescherming ?? '').trim();
            const polen = String(item?.props?.aantal_polen ?? '').trim();
            const amp = String(item?.props?.amperage ?? '').trim();
            const delta = String(item?.props?.differentieel_delta_amperage ?? '').trim();
            const curve = String(item?.props?.curve_automaat ?? '').trim();
            const diffType = String(item?.props?.type_differentieel ?? '').trim();

            let label = 'Zekering/differentieel';
            if (bescherming === 'automatisch') {
                label = `Automaat ${polen}P ${amp}A${curve ? ` curve ${curve}` : ''}`.trim();
            } else if (bescherming === 'differentieel') {
                label = `Differentieel ${polen}P ${amp}A Δ${delta}mA${diffType ? ` type ${diffType}` : ''}`.trim();
            } else if (bescherming === 'differentieelautomaat') {
                label = `Differentieelautomaat ${polen}P ${amp}A Δ${delta}mA${curve ? ` curve ${curve}` : ''}${diffType ? ` type ${diffType}` : ''}`.trim();
            } else if (bescherming === 'smelt') {
                label = `Smeltzekering ${polen}P ${amp}A`.trim();
            }

            const key = `device:zekering:${bescherming}|${polen}|${amp}|${delta}|${curve}|${diffType}`;
            return [{
                key,
                label,
                unit: 'pcs',
                quantity: 1,
            }];
        }
    }

    return [];
}

function deviceMaterialsByKring(structure: any): { totals: MaterialLine[]; byKring: Map<string, MaterialLine[]>; kringSet: Set<string> } {
    const byKringRaw = new Map<string, MaterialLine[]>();
    const totalsRaw: MaterialLine[] = [];
    const kringSet = new Set<string>();

    if (!structure || !Array.isArray(structure.data) || !Array.isArray(structure.active) || !Array.isArray(structure.id)) {
        return { totals: [], byKring: new Map(), kringSet: new Set() };
    }

    for (let i = 0; i < structure.data.length; i++) {
        if (!structure.active[i]) continue;
        const item = structure.data[i] as any;
        if (!item || typeof item.getType !== 'function') continue;

        const lines = deviceLinesFromElectroItem(item);
        if (lines.length === 0) continue;

        const id = Number(structure.id[i]);
        const kring = getKringNameForItemId(structure, id);
        kringSet.add(kring);

        const bucket = byKringRaw.get(kring) ?? [];
        for (const l of lines) {
            addLine(bucket, l);
            addLine(totalsRaw, l);
        }
        byKringRaw.set(kring, bucket);
    }

    const byKring = new Map<string, MaterialLine[]>();
    for (const [kring, lines] of byKringRaw.entries()) {
        byKring.set(kring, sumByKey(lines));
    }

    return { totals: sumByKey(totalsRaw), byKring, kringSet };
}

function renderMaterialLines(lines: MaterialLine[], unit: MaterialUnit): string {
    const filtered = lines.filter(l => l.unit === unit);
    if (filtered.length === 0) return '<i>Geen.</i>';
    filtered.sort((a, b) => a.label.localeCompare(b.label));

    return filtered
        .map(l => {
            const q = unit === 'm' ? formatMeters(l.quantity) : formatPcs(l.quantity);
            return `${htmlspecialchars(l.label)}: <b>${htmlspecialchars(q)}</b>`;
        })
        .join('<br>');
}

function toPrintLine(l: MaterialLine): string {
    const q = l.unit === 'm' ? formatMeters(l.quantity) : formatPcs(l.quantity);
    return `${l.label}: ${q}`;
}

export function computeBomPrintData(structure: any): BomPrintData {
    const sitplan = structure?.sitplan;
    const device = deviceMaterialsByKring(structure);

    const hasSitplan = !!sitplan;
    const elements: any[] = hasSitplan
        ? ((typeof sitplan.getElements === 'function')
            ? (sitplan.getElements() ?? [])
            : (Array.isArray(sitplan.elements) ? sitplan.elements : []))
        : [];

    const cableKringSet = new Set<string>();
    for (const el of elements) {
        if (el?.kind !== 'cableRun') continue;
        const k = String(el?.cableRun?.kring ?? '').trim();
        if (k !== '') cableKringSet.add(k);
    }

    const zoeker = new ElectroItemZoeker();
    const kringenFromSchema = zoeker.getUniqueKringnaamWithLabels();
    const kringLabelByValue = new Map<string, string>();
    for (const k of kringenFromSchema) {
        kringLabelByValue.set(String(k.value), String(k.label));
    }

    const allKringen = Array.from(new Set<string>([
        ...Array.from(kringLabelByValue.keys()),
        ...Array.from(cableKringSet),
        ...Array.from(device.kringSet),
    ]));
    allKringen.sort((a, b) => a.localeCompare(b));

    const cableLinesAll: MaterialLine[] = [];
    const cableByKring = new Map<string, { lines: MaterialLine[]; unknownScaleRuns: number; unknownRiserCount: number; unknownEndpointCount: number }>();

    if (hasSitplan) {
        for (const kring of allKringen) {
            const cableCount = elements.filter(e => e?.kind === 'cableRun' && (e?.cableRun?.kring ?? null) === kring).length;
            if (cableCount === 0) continue;
            const res = cableMaterialsForKring(sitplan, elements, kring);
            cableByKring.set(kring, res);
            cableLinesAll.push(...res.lines);
        }
    }

    const cableTotals = sumByKey(cableLinesAll);
    const deviceTotals = device.totals;

    const sections: BomPrintSection[] = [];
    sections.push({
        heading: 'Totaal',
        lines: [
            'Kabels:',
            ...(cableTotals.length > 0 ? cableTotals.filter(l => l.unit === 'm').map(l => `- ${toPrintLine(l)}`) : ['- Geen.']),
            '',
            'Toestellen:',
            ...(deviceTotals.length > 0 ? deviceTotals.filter(l => l.unit === 'pcs').map(l => `- ${toPrintLine(l)}`) : ['- Geen.']),
        ],
    });

    for (const kring of allKringen) {
        const label = kringLabelByValue.get(kring) ?? kring;
        const deviceLinesForKring = device.byKring.get(kring) ?? [];
        const cableRes = cableByKring.get(kring);
        const cableLinesForKring = cableRes?.lines ?? [];
        const hasAnything = deviceLinesForKring.length > 0 || cableLinesForKring.length > 0;
        if (!hasAnything) continue;

        const warnings: string[] = [];
        if (cableRes) {
            if (cableRes.unknownScaleRuns > 0) warnings.push(`schaal ontbreekt voor ${cableRes.unknownScaleRuns} run(s)`);
            if (cableRes.unknownRiserCount > 0) warnings.push(`hoogte ontbreekt voor ${cableRes.unknownRiserCount} stijgleiding(en)`);
            if (cableRes.unknownEndpointCount > 0) warnings.push(`verticale aansluiting onbekend voor ${cableRes.unknownEndpointCount} eindpunt(en)`);
        }

        const lines: string[] = [
            'Kabels:',
            ...(cableLinesForKring.length > 0 ? cableLinesForKring.filter(l => l.unit === 'm').map(l => `- ${toPrintLine(l)}`) : ['- Geen.']),
            '',
            'Toestellen:',
            ...(deviceLinesForKring.length > 0 ? deviceLinesForKring.filter(l => l.unit === 'pcs').map(l => `- ${toPrintLine(l)}`) : ['- Geen.']),
        ];

        if (warnings.length > 0) {
            lines.push('');
            lines.push(`Opgelet: ${warnings.join(', ')}`);
        }

        sections.push({ heading: label, lines });
    }

    return { title: 'Materialen (BOM)', sections };
}

export function showMaterialsPage(): void {
    const structure = (globalThis as any).structure as any;
    const sitplan = structure?.sitplan;
    const configsection = document.getElementById('configsection');
    if (configsection == null) return;

    const device = deviceMaterialsByKring(structure);

    const hasSitplan = !!sitplan;
    const elements: any[] = hasSitplan
        ? ((typeof sitplan.getElements === 'function')
            ? (sitplan.getElements() ?? [])
            : (Array.isArray(sitplan.elements) ? sitplan.elements : []))
        : [];

    const cableKringSet = new Set<string>();
    for (const el of elements) {
        if (el?.kind !== 'cableRun') continue;
        const k = String(el?.cableRun?.kring ?? '').trim();
        if (k !== '') cableKringSet.add(k);
    }

    const zoeker = new ElectroItemZoeker();
    const kringenFromSchema = zoeker.getUniqueKringnaamWithLabels();

    const kringLabelByValue = new Map<string, string>();
    for (const k of kringenFromSchema) {
        kringLabelByValue.set(String(k.value), String(k.label));
    }

    const allKringen = Array.from(new Set<string>([
        ...Array.from(kringLabelByValue.keys()),
        ...Array.from(cableKringSet),
        ...Array.from(device.kringSet)
    ]));
    allKringen.sort((a, b) => a.localeCompare(b));

    const cableLinesAll: MaterialLine[] = [];
    const perKringHtml: string[] = [];

    let anyCable = false;
    let anyDevices = device.totals.length > 0;

    const cableByKring = new Map<string, { lines: MaterialLine[]; unknownScaleRuns: number; unknownRiserCount: number; unknownEndpointCount: number }>();
    if (hasSitplan) {
        for (const kring of allKringen) {
            const cableCount = elements.filter(e => e?.kind === 'cableRun' && (e?.cableRun?.kring ?? null) === kring).length;
            if (cableCount === 0) continue;
            anyCable = true;
            const res = cableMaterialsForKring(sitplan, elements, kring);
            cableByKring.set(kring, res);
            cableLinesAll.push(...res.lines);
        }
    }

    for (const kring of allKringen) {
        const label = kringLabelByValue.get(kring) ?? kring;
        const deviceLinesForKring = device.byKring.get(kring) ?? [];

        const cableRes = cableByKring.get(kring);
        const cableLinesForKring = cableRes?.lines ?? [];

        const warnings: string[] = [];
        if (cableRes) {
            if (cableRes.unknownScaleRuns > 0) warnings.push(`schaal ontbreekt voor ${cableRes.unknownScaleRuns} run(s)`);
            if (cableRes.unknownRiserCount > 0) warnings.push(`hoogte ontbreekt voor ${cableRes.unknownRiserCount} stijgleiding(en)`);
            if (cableRes.unknownEndpointCount > 0) warnings.push(`verticale aansluiting onbekend voor ${cableRes.unknownEndpointCount} eindpunt(en)`);
        }
        const warnLabel = warnings.length > 0 ? `<br><small>Opgelet: ${htmlspecialchars(warnings.join(', '))}</small>` : '';

        const hasAnything = deviceLinesForKring.length > 0 || cableLinesForKring.length > 0;
        if (!hasAnything) continue;

        perKringHtml.push(
            `<br><b>${htmlspecialchars(label)}</b>${warnLabel}<br>` +
            `<u>Kabels</u><br>${renderMaterialLines(cableLinesForKring, 'm')}<br><br>` +
            `<u>Toestellen</u><br>${renderMaterialLines(deviceLinesForKring, 'pcs')}<br>`
        );
    }

    const cableTotals = sumByKey(cableLinesAll);

    const helpLine = !hasSitplan
        ? '<span class="highlight-warning">Geen situatieschema geladen. Ga naar Situatieschema om kabels te tellen.</span>'
        : (!anyCable ? '<span class="highlight-warning">Nog geen kabels getekend. Gebruik de kabel-tool in het situatieschema.</span>' : '<small>Kabels zijn in meter, toestellen in stuks.</small>');

        const pageHtml = `
        <span id="materialsscreen"></span>
    <table border="1px" style="border-collapse:collapse" align="center" width="100%">
      <tr>
        <td width="100%" align="center" bgcolor="LightGrey">
          <b>Materialen (BOM)</b>
        </td>
      </tr>
      <tr>
        <td width="100%" align="left" style="padding:10px">
          ${helpLine}<br><br>
          <b>Totaal</b><br>
          <u>Kabels</u><br>
          ${renderMaterialLines(cableTotals, 'm')}<br><br>
          <u>Toestellen</u><br>
                    ${renderMaterialLines(device.totals, 'pcs')}<br>
          <br>
                    <b>Per kring</b><br>
                    ${(perKringHtml.length > 0) ? perKringHtml.join('') : (anyCable || anyDevices ? '<i>Geen.</i>' : '<i>Geen materialen gevonden.</i>')}
        </td>
      </tr>
    </table>`;

    configsection.innerHTML = pageHtml;
    globalThis.toggleAppView('config');
}
