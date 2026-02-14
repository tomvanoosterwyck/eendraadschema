export type CableLengthSummary = {
    metersBySpec: Record<string, number>;
    unknownScaleRuns: number;
    unknownRiserCount: number;
    unknownEndpointCount: number;
};

export type CableComponentSummary = {
    /** Stable-ish id (not persisted) */
    id: string;
    /** SituationPlanElement ids of cableRun elements included in this component */
    runIds: string[];
    /** Connection ids used by this component (endpoints snapped to a connectionPoint) */
    connectionIds: string[];
    metersBySpec: Record<string, number>;
    unknownScaleRuns: number;
    unknownRiserCount: number;
    unknownEndpointCount: number;
};

export type CableRunDetail = {
    runId: string;
    page: number;
    cableSpec: string;
    metersHorizontal: number | null;
    metersEndpointDrops: number | null;
    metersTotal: number | null;
    connectionIdsTouched: string[];
    unknownScale: boolean;
    unknownEndpointCount: number;
};

type Point = { x: number; y: number };

type CableRunEndpoints = { a: Point | null; b: Point | null };

const num = (v: any): number => Number(v);

const round1 = (v: number): number => Math.round(v * 10) / 10;

type EndpointAttachment =
    | { kind: 'connection'; key: string; connectionId: string; page: number }
    | { kind: 'device'; key: string; deviceElementId: string; page: number }
    | { kind: 'free'; key: string; page: number };

type CableRunEdge = {
    el: any;
    page: number;
    spec: string;
    a: EndpointAttachment;
    b: EndpointAttachment;
};

function normalizeSpec(spec: any): string {
    const s = String(spec ?? '').trim();
    return s !== '' ? s : 'Onbekend';
}

function clampPositiveFinite(v: any): number | null {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

function unionFind<T extends string>() {
    const parent = new Map<T, T>();
    const find = (x: T): T => {
        const p = parent.get(x);
        if (!p) {
            parent.set(x, x);
            return x;
        }
        if (p === x) return x;
        const root = find(p);
        parent.set(x, root);
        return root;
    };
    const union = (a: T, b: T) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    };
    return { find, union, parent };
}

function addMeters(metersBySpec: Record<string, number>, spec: string, meters: number) {
    if (!Number.isFinite(meters) || meters <= 0) return;
    metersBySpec[spec] = (metersBySpec[spec] ?? 0) + meters;
}

function normalizeMetersBySpec(metersBySpec: Record<string, number>): Record<string, number> {
    for (const k of Object.keys(metersBySpec)) {
        const v = metersBySpec[k];
        if (!Number.isFinite(v) || v <= 0) {
            delete metersBySpec[k];
        } else {
            metersBySpec[k] = round1(v);
        }
    }
    return metersBySpec;
}

export function computeCableComponentsForKring(sitplan: any, allElements: any[], kring: string): CableComponentSummary[] {
    const elements = Array.isArray(allElements) ? allElements : [];

    const cableElements = elements.filter(e => e?.kind === 'cableRun' && (e?.cableRun?.kring ?? null) === kring);
    if (cableElements.length === 0) return [];

    const getMetersPerUnit = (page: number): number | null => {
        return clampPositiveFinite(sitplan?.getMetersPerUnitForPage?.(page));
    };

    const getDefaultDeviceHeightCm = (): number => {
        const v = num(sitplan?.defaults?.defaultDeviceHeightCm);
        return (Number.isFinite(v) && v >= 0) ? v : 30;
    };

    const getFloorForPage = (page: number): any | null => {
        const floorId = sitplan?.getFloorIdForPage?.(page) ?? null;
        if (floorId == null) return null;
        const floors = Array.isArray(sitplan?.floors) ? sitplan.floors : [];
        return floors.find((f: any) => f?.id === floorId) ?? null;
    };

    const getCablePlaneOffsetCmForPage = (page: number): number => {
        const floor = getFloorForPage(page);
        const v = num(floor?.cablePlaneOffsetCm);
        return (Number.isFinite(v)) ? v : -10;
    };

    const getCablePlaneElevationCmForPage = (page: number): number | null => {
        const floor = getFloorForPage(page);
        const elev = num(floor?.elevationCm);
        if (!Number.isFinite(elev)) return null;
        const offset = getCablePlaneOffsetCmForPage(page);
        return elev + offset;
    };

    const lengthUnits = (el: any): number => {
        const pts = Array.isArray(el?.cableRun?.points) ? el.cableRun.points : [];
        if (pts.length < 2) return 0;
        const minx = num(el.posx) - num(el.sizex) / 2;
        const miny = num(el.posy) - num(el.sizey) / 2;
        let sum = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const ax = num(pts[i].x) + minx;
            const ay = num(pts[i].y) + miny;
            const bx = num(pts[i + 1].x) + minx;
            const by = num(pts[i + 1].y) + miny;
            const dx = bx - ax;
            const dy = by - ay;
            sum += Math.sqrt(dx * dx + dy * dy);
        }
        return sum;
    };

    const getEndpoints = (el: any): CableRunEndpoints => {
        const pts = Array.isArray(el?.cableRun?.points) ? el.cableRun.points : [];
        if (pts.length < 2) return { a: null, b: null };
        const minx = num(el.posx) - num(el.sizex) / 2;
        const miny = num(el.posy) - num(el.sizey) / 2;
        const first = pts[0];
        const last = pts[pts.length - 1];
        return {
            a: { x: num(first.x) + minx, y: num(first.y) + miny },
            b: { x: num(last.x) + minx, y: num(last.y) + miny },
        };
    };

    const connectionPoints = elements.filter(e => e?.kind === 'connectionPoint' && e?.connectionPoint?.connectionId != null);
    const connectionPointsByPage = new Map<number, any[]>();
    for (const cp of connectionPoints) {
        const pageNum = num(cp.page);
        if (!Number.isFinite(pageNum)) continue;
        const arr = connectionPointsByPage.get(pageNum) ?? [];
        arr.push(cp);
        connectionPointsByPage.set(pageNum, arr);
    }

    const findConnectionPointNear = (page: number, p: Point | null): any | null => {
        if (!p) return null;
        const list = connectionPointsByPage.get(page);
        if (!list || list.length === 0) return null;

        const threshold = 14;
        const thresh2 = threshold * threshold;
        let best: any | null = null;
        let bestD2 = Infinity;
        for (const cp of list) {
            const dx = num(cp.posx) - p.x;
            const dy = num(cp.posy) - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= thresh2 && d2 < bestD2) {
                bestD2 = d2;
                best = cp;
            }
        }
        return best;
    };

    const electricalElementsByPage = new Map<number, any[]>();
    for (const el of elements) {
        if (el?.getElectroItemId?.() == null) continue;
        const pageNum = num(el.page);
        if (!Number.isFinite(pageNum)) continue;
        const arr = electricalElementsByPage.get(pageNum) ?? [];
        arr.push(el);
        electricalElementsByPage.set(pageNum, arr);
    }

    const findElectricalElementNear = (page: number, p: Point | null): any | null => {
        if (!p) return null;
        const list = electricalElementsByPage.get(page);
        if (!list || list.length === 0) return null;

        const threshold = 18;
        const thresh2 = threshold * threshold;
        let best: any | null = null;
        let bestD2 = Infinity;
        for (const el of list) {
            const dx = num(el.posx) - p.x;
            const dy = num(el.posy) - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= thresh2 && d2 < bestD2) {
                bestD2 = d2;
                best = el;
            }
        }
        return best;
    };

    const attachEndpoint = (runId: string, page: number, endpoint: Point | null, side: 'a' | 'b'): EndpointAttachment => {
        const cp = findConnectionPointNear(page, endpoint);
        if (cp) {
            const cid = String(cp?.connectionPoint?.connectionId ?? '').trim();
            if (cid) return { kind: 'connection', key: `cid:${cid}`, connectionId: cid, page };
        }
        const nearEl = findElectricalElementNear(page, endpoint);
        if (nearEl?.id) {
            const did = String(nearEl.id);
            return { kind: 'device', key: `dev:${did}`, deviceElementId: did, page };
        }
        return { kind: 'free', key: `free:${runId}:${side}`, page };
    };

    const edges: CableRunEdge[] = [];
    const uf = unionFind<string>();

    for (const el of cableElements) {
        const pageNum = num(el.page);
        if (!Number.isFinite(pageNum)) continue;
        const spec = normalizeSpec(el?.cableRun?.cableSpec);
        const runId = String(el?.id ?? '');
        const endpoints = getEndpoints(el);

        const a = attachEndpoint(runId, pageNum, endpoints.a, 'a');
        const b = attachEndpoint(runId, pageNum, endpoints.b, 'b');

        // Ensure nodes are registered.
        uf.find(a.key);
        uf.find(b.key);
        uf.union(a.key, b.key);

        edges.push({ el, page: pageNum, spec, a, b });
    }

    const edgesByRoot = new Map<string, CableRunEdge[]>();
    for (const e of edges) {
        const root = uf.find(e.a.key);
        const arr = edgesByRoot.get(root) ?? [];
        arr.push(e);
        edgesByRoot.set(root, arr);
    }

    const defaultDeviceHeightCm = getDefaultDeviceHeightCm();
    const components: CableComponentSummary[] = [];
    let idx = 1;

    for (const [root, compEdges] of edgesByRoot.entries()) {
        const runIds = Array.from(new Set(compEdges.map(e => String(e.el?.id ?? '')).filter(s => s !== '')));

        const connectionIdPages = new Map<string, Set<number>>();
        const connectionIdSpecs = new Map<string, Set<string>>();

        // Collect which pages/specs touch which connectionId inside this component.
        for (const e of compEdges) {
            for (const att of [e.a, e.b]) {
                if (att.kind !== 'connection') continue;
                const pages = connectionIdPages.get(att.connectionId) ?? new Set<number>();
                pages.add(att.page);
                connectionIdPages.set(att.connectionId, pages);

                const specs = connectionIdSpecs.get(att.connectionId) ?? new Set<string>();
                specs.add(e.spec);
                connectionIdSpecs.set(att.connectionId, specs);
            }
        }

        const metersBySpec: Record<string, number> = {};
        let unknownScaleRuns = 0;
        let unknownEndpointCount = 0;
        let unknownRiserCount = 0;

        // Horizontal + endpoint drops.
        for (const e of compEdges) {
            const metersPerUnit = getMetersPerUnit(e.page);
            if (metersPerUnit == null) {
                unknownScaleRuns++;
                // Still allow the component graph/riser collection to exist.
                continue;
            }

            const horizontalMeters = lengthUnits(e.el) * metersPerUnit;
            addMeters(metersBySpec, e.spec, horizontalMeters);

            const endpoints = getEndpoints(e.el);
            const cablePlaneOffsetCm = getCablePlaneOffsetCmForPage(e.page);

            const endpointPoints: Array<{ p: Point | null; att: EndpointAttachment }> = [
                { p: endpoints.a, att: e.a },
                { p: endpoints.b, att: e.b },
            ];

            for (const ep of endpointPoints) {
                if (ep.att.kind === 'connection') continue;

                const nearEl = findElectricalElementNear(e.page, ep.p);
                if (!nearEl) {
                    unknownEndpointCount++;
                    continue;
                }

                const hRaw = (nearEl?.heightCm != null && Number.isFinite(num(nearEl.heightCm))) ? num(nearEl.heightCm) : defaultDeviceHeightCm;
                const verticalMeters = Math.abs(hRaw - cablePlaneOffsetCm) / 100;
                addMeters(metersBySpec, e.spec, verticalMeters);
            }
        }

        // Risers per connectionId within this component.
        for (const [cid, pages] of connectionIdPages.entries()) {
            const elevations = Array.from(pages)
                .map(p => getCablePlaneElevationCmForPage(p))
                .filter((v: number | null): v is number => v != null);

            if (elevations.length < 2 || elevations.length !== pages.size) {
                unknownRiserCount++;
                continue;
            }

            const verticalMeters = Math.max(0, (Math.max(...elevations) - Math.min(...elevations)) / 100);
            const specs = connectionIdSpecs.get(cid) ?? new Set<string>();
            const specKey = (specs.size === 1) ? Array.from(specs)[0] : 'Onbekend';
            addMeters(metersBySpec, specKey, verticalMeters);
        }

        const connectionIds = Array.from(connectionIdPages.keys()).sort((a, b) => a.localeCompare(b));
        components.push({
            id: `comp_${idx++}_${root.slice(0, 8)}`,
            runIds,
            connectionIds,
            metersBySpec: normalizeMetersBySpec(metersBySpec),
            unknownScaleRuns,
            unknownRiserCount,
            unknownEndpointCount,
        });
    }

    // Stable-ish output: sort by total meters desc, then id.
    const totalMeters = (c: CableComponentSummary) => Object.values(c.metersBySpec).reduce((a, b) => a + b, 0);
    components.sort((a, b) => {
        const da = totalMeters(a);
        const db = totalMeters(b);
        if (db !== da) return db - da;
        return a.id.localeCompare(b.id);
    });

    return components;
}

export function computeCableRunDetailsForKring(sitplan: any, allElements: any[], kring: string): CableRunDetail[] {
    const elements = Array.isArray(allElements) ? allElements : [];

    const cableElements = elements.filter(e => e?.kind === 'cableRun' && (e?.cableRun?.kring ?? null) === kring);
    if (cableElements.length === 0) return [];

    const getMetersPerUnit = (page: number): number | null => {
        return clampPositiveFinite(sitplan?.getMetersPerUnitForPage?.(page));
    };

    const getDefaultDeviceHeightCm = (): number => {
        const v = num(sitplan?.defaults?.defaultDeviceHeightCm);
        return (Number.isFinite(v) && v >= 0) ? v : 30;
    };

    const getFloorForPage = (page: number): any | null => {
        const floorId = sitplan?.getFloorIdForPage?.(page) ?? null;
        if (floorId == null) return null;
        const floors = Array.isArray(sitplan?.floors) ? sitplan.floors : [];
        return floors.find((f: any) => f?.id === floorId) ?? null;
    };

    const getCablePlaneOffsetCmForPage = (page: number): number => {
        const floor = getFloorForPage(page);
        const v = num(floor?.cablePlaneOffsetCm);
        return (Number.isFinite(v)) ? v : -10;
    };

    const lengthUnits = (el: any): number => {
        const pts = Array.isArray(el?.cableRun?.points) ? el.cableRun.points : [];
        if (pts.length < 2) return 0;
        const minx = num(el.posx) - num(el.sizex) / 2;
        const miny = num(el.posy) - num(el.sizey) / 2;
        let sum = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const ax = num(pts[i].x) + minx;
            const ay = num(pts[i].y) + miny;
            const bx = num(pts[i + 1].x) + minx;
            const by = num(pts[i + 1].y) + miny;
            const dx = bx - ax;
            const dy = by - ay;
            sum += Math.sqrt(dx * dx + dy * dy);
        }
        return sum;
    };

    const getEndpoints = (el: any): CableRunEndpoints => {
        const pts = Array.isArray(el?.cableRun?.points) ? el.cableRun.points : [];
        if (pts.length < 2) return { a: null, b: null };
        const minx = num(el.posx) - num(el.sizex) / 2;
        const miny = num(el.posy) - num(el.sizey) / 2;
        const first = pts[0];
        const last = pts[pts.length - 1];
        return {
            a: { x: num(first.x) + minx, y: num(first.y) + miny },
            b: { x: num(last.x) + minx, y: num(last.y) + miny },
        };
    };

    const connectionPoints = elements.filter(e => e?.kind === 'connectionPoint' && e?.connectionPoint?.connectionId != null);
    const connectionPointsByPage = new Map<number, any[]>();
    for (const cp of connectionPoints) {
        const pageNum = num(cp.page);
        if (!Number.isFinite(pageNum)) continue;
        const arr = connectionPointsByPage.get(pageNum) ?? [];
        arr.push(cp);
        connectionPointsByPage.set(pageNum, arr);
    }

    const findConnectionPointNear = (page: number, p: Point | null): any | null => {
        if (!p) return null;
        const list = connectionPointsByPage.get(page);
        if (!list || list.length === 0) return null;

        const threshold = 14;
        const thresh2 = threshold * threshold;
        let best: any | null = null;
        let bestD2 = Infinity;
        for (const cp of list) {
            const dx = num(cp.posx) - p.x;
            const dy = num(cp.posy) - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= thresh2 && d2 < bestD2) {
                bestD2 = d2;
                best = cp;
            }
        }
        return best;
    };

    const electricalElementsByPage = new Map<number, any[]>();
    for (const el of elements) {
        if (el?.getElectroItemId?.() == null) continue;
        const pageNum = num(el.page);
        if (!Number.isFinite(pageNum)) continue;
        const arr = electricalElementsByPage.get(pageNum) ?? [];
        arr.push(el);
        electricalElementsByPage.set(pageNum, arr);
    }

    const findElectricalElementNear = (page: number, p: Point | null): any | null => {
        if (!p) return null;
        const list = electricalElementsByPage.get(page);
        if (!list || list.length === 0) return null;

        const threshold = 18;
        const thresh2 = threshold * threshold;
        let best: any | null = null;
        let bestD2 = Infinity;
        for (const el of list) {
            const dx = num(el.posx) - p.x;
            const dy = num(el.posy) - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= thresh2 && d2 < bestD2) {
                bestD2 = d2;
                best = el;
            }
        }
        return best;
    };

    const defaultDeviceHeightCm = getDefaultDeviceHeightCm();
    const details: CableRunDetail[] = [];

    for (const el of cableElements) {
        const pageNum = num(el.page);
        if (!Number.isFinite(pageNum)) continue;
        const spec = normalizeSpec(el?.cableRun?.cableSpec);
        const runId = String(el?.id ?? '').trim();
        const endpoints = getEndpoints(el);

        const metersPerUnit = getMetersPerUnit(pageNum);
        const unknownScale = metersPerUnit == null;

        const connectionIdsTouched = new Set<string>();
        const cpA = findConnectionPointNear(pageNum, endpoints.a);
        const cpB = findConnectionPointNear(pageNum, endpoints.b);
        for (const cp of [cpA, cpB]) {
            const cid = String(cp?.connectionPoint?.connectionId ?? '').trim();
            if (cid) connectionIdsTouched.add(cid);
        }

        let metersHorizontal: number | null = null;
        let metersEndpointDrops: number | null = 0;
        let unknownEndpointCount = 0;

        if (!unknownScale) {
            metersHorizontal = lengthUnits(el) * (metersPerUnit as number);

            const cablePlaneOffsetCm = getCablePlaneOffsetCmForPage(pageNum);
            for (const endpoint of [endpoints.a, endpoints.b]) {
                const cp = findConnectionPointNear(pageNum, endpoint);
                if (cp) continue;

                const nearEl = findElectricalElementNear(pageNum, endpoint);
                if (!nearEl) {
                    unknownEndpointCount++;
                    continue;
                }
                const hRaw = (nearEl?.heightCm != null && Number.isFinite(num(nearEl.heightCm))) ? num(nearEl.heightCm) : defaultDeviceHeightCm;
                const verticalMeters = Math.abs(hRaw - cablePlaneOffsetCm) / 100;
                if (Number.isFinite(verticalMeters) && verticalMeters >= 0) {
                    metersEndpointDrops = (metersEndpointDrops ?? 0) + verticalMeters;
                }
            }
        } else {
            metersEndpointDrops = null;
        }

        const total = (metersHorizontal != null && metersEndpointDrops != null)
            ? metersHorizontal + metersEndpointDrops
            : null;

        details.push({
            runId: runId || String(details.length + 1),
            page: pageNum,
            cableSpec: spec,
            metersHorizontal: (metersHorizontal == null) ? null : round1(metersHorizontal),
            metersEndpointDrops: (metersEndpointDrops == null) ? null : round1(metersEndpointDrops),
            metersTotal: (total == null) ? null : round1(total),
            connectionIdsTouched: Array.from(connectionIdsTouched).sort((a, b) => a.localeCompare(b)),
            unknownScale,
            unknownEndpointCount,
        });
    }

    // Sort by total meters desc, then page, then id.
    details.sort((a, b) => {
        const ta = a.metersTotal ?? -1;
        const tb = b.metersTotal ?? -1;
        if (tb !== ta) return tb - ta;
        if (a.page !== b.page) return a.page - b.page;
        return a.runId.localeCompare(b.runId);
    });

    return details;
}

export function computeCableLengthSummaryForKring(sitplan: any, allElements: any[], kring: string): CableLengthSummary {
    const components = computeCableComponentsForKring(sitplan, allElements, kring);
    if (components.length === 0) return { metersBySpec: {}, unknownScaleRuns: 0, unknownRiserCount: 0, unknownEndpointCount: 0 };

    const metersBySpec: Record<string, number> = {};
    let unknownScaleRuns = 0;
    let unknownRiserCount = 0;
    let unknownEndpointCount = 0;

    for (const c of components) {
        unknownScaleRuns += c.unknownScaleRuns;
        unknownRiserCount += c.unknownRiserCount;
        unknownEndpointCount += c.unknownEndpointCount;
        for (const [spec, meters] of Object.entries(c.metersBySpec)) {
            addMeters(metersBySpec, spec, meters);
        }
    }

    return { metersBySpec: normalizeMetersBySpec(metersBySpec), unknownScaleRuns, unknownRiserCount, unknownEndpointCount };
}
