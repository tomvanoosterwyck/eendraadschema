import { ElectroItemZoeker } from "./ElectroItemZoeker";
import type { AdresLocation, AdresType } from "./SituationPlanElement";
import { computeCableComponentsForKring, computeCableRunDetailsForKring } from "./CableLengthCalculator";

export class SituationPlanView_SideBar {

    private container: HTMLElement | null;
    private zoeker: ElectroItemZoeker | null = null;
    private selectedKring: string | null = null;

    constructor(div: HTMLElement | null) {
        this.container = div;
    }

    public renderSymbols() {
    }

    public getSelectedKring(): string | null {
        return this.selectedKring;
    }

    public render() {
        if (!this.container) return;

        if (!(globalThis as any).structure) {
            this.container.innerHTML = '';
            return;
        }

        if (this.zoeker == null) this.zoeker = new ElectroItemZoeker();
        else this.zoeker.reCalculate();

        const sitplan = ((globalThis as any).structure as any).sitplan;
        const getAllElements = (): any[] => {
            if (sitplan?.getElements && typeof sitplan.getElements === 'function') {
                const els = sitplan.getElements();
                return Array.isArray(els) ? els : [];
            }
            return Array.isArray(sitplan?.elements) ? sitplan.elements : [];
        };

        const allElements = getAllElements();

        const nonElectricalElements = allElements.filter(e => e?.getElectroItemId?.() == null);
        const nonElectricalTotal = nonElectricalElements.length;
        const nonElectricalVisibleCount = nonElectricalElements.filter(e => e?.visible !== false).length;
        const nonElectricalState: 'visible' | 'hidden' | 'mixed' =
            (nonElectricalTotal === 0) ? 'hidden' :
                (nonElectricalVisibleCount === 0) ? 'hidden' :
                    (nonElectricalVisibleCount === nonElectricalTotal) ? 'visible' :
                        'mixed';
        const nonElectricalIcon = (nonElectricalState === 'visible') ? '👁' : (nonElectricalState === 'mixed') ? '◐' : '🚫';

        const getNonElectricalLabel = (el: any): string => {
            if (el?.kind === 'distanceLine') {
                const adres = (typeof el.getAdres === 'function') ? el.getAdres() : '';
                return adres ? `Afstandslijn (${adres})` : 'Afstandslijn';
            }
            if (el?.kind === 'connectionPoint') {
                const id = String(el?.connectionPoint?.connectionId ?? '').trim();
                return id ? `Verbindingspunt (${id})` : 'Verbindingspunt';
            }
            // External/background drawings loaded from file
            if (typeof el?.svg === 'string' && el.svg.includes('<image ')) {
                return 'Achtergrond/tekening';
            }
            return 'Niet-elektrisch element';
        };

        const kringenWithLabels = this.zoeker.getUniqueKringnaamWithLabels();
        const kringValues = kringenWithLabels.map(k => k.value);
        if (this.selectedKring == null || !kringValues.includes(this.selectedKring)) {
            this.selectedKring = kringValues.length > 0 ? kringValues[0] : null;
        }

        const kringTree = kringenWithLabels.map(k => {
            const safeValue = k.value.replace(/"/g, '&quot;');
            const open = (k.value === this.selectedKring) ? 'open' : '';

            const electroIdsInKring = this.zoeker!.getElectroItemsByKring(k.value).map(it => it.id);
            const elementsInKring = allElements.filter(e => e?.getElectroItemId?.() != null && electroIdsInKring.includes(e.getElectroItemId()));
            const total = elementsInKring.length;
            const visibleCount = elementsInKring.filter(e => e?.visible !== false).length;

            const state: 'visible' | 'hidden' | 'mixed' =
                (total === 0) ? 'hidden' :
                    (visibleCount === 0) ? 'hidden' :
                        (visibleCount === total) ? 'visible' :
                            'mixed';

            const icon = (state === 'visible') ? '👁' : (state === 'mixed') ? '◐' : '🚫';
            const disabled = (total === 0) ? 'disabled' : '';

            const cableRunsInKring = allElements.filter(e => e?.kind === 'cableRun' && (e?.cableRun?.kring ?? null) === k.value);
            const cableTotal = cableRunsInKring.length;
            const cableVisibleCount = cableRunsInKring.filter((e: any) => e?.visible !== false).length;
            const cableState: 'visible' | 'hidden' | 'mixed' =
                (cableTotal === 0) ? 'hidden' :
                    (cableVisibleCount === 0) ? 'hidden' :
                        (cableVisibleCount === cableTotal) ? 'visible' :
                            'mixed';
            const cableIcon = (cableState === 'visible') ? '👁' : (cableState === 'mixed') ? '◐' : '🚫';
            const cableDisabled = (cableTotal === 0) ? 'disabled' : '';

            return `
                <details class="sitplan-sidebar-kring" data-kring="${safeValue}" ${open}>
                    <summary class="sitplan-sidebar-kring-summary">
                        <button type="button" class="sitplan-sidebar-visbtn" data-kring-toggle="${safeValue}" data-state="${state}" title="Zichtbaarheid kring" ${disabled}>${icon}</button>
                        <button type="button" class="sitplan-sidebar-visbtn" data-kring-cables-toggle="${safeValue}" data-state="${cableState}" title="Zichtbaarheid kabels" ${cableDisabled}>${cableIcon}</button>
                        <span>${k.label}</span>
                    </summary>
                    <div class="sitplan-sidebar-cable-summary" data-kring-cable-summary="${safeValue}"></div>
                    <div class="sitplan-sidebar-items" data-kring-items="${safeValue}"></div>
                </details>`;
        }).join('');

        const nonElectricalTree = `
            <details class="sitplan-sidebar-kring" data-group="nonElectrical" ${nonElectricalTotal > 0 ? 'open' : ''}>
                <summary class="sitplan-sidebar-kring-summary">
                    <button type="button" class="sitplan-sidebar-visbtn" data-non-electrical-toggle="true" data-state="${nonElectricalState}" title="Zichtbaarheid niet-elektrische elementen" ${nonElectricalTotal === 0 ? 'disabled' : ''}>${nonElectricalIcon}</button>
                    <span>Niet-elektrisch</span>
                </summary>
                <div class="sitplan-sidebar-items" id="sitplan_sidebar_nonelectrical_items">
                    ${nonElectricalElements.map((el: any) => {
                const label = getNonElectricalLabel(el);
                const state: 'visible' | 'hidden' = (el?.visible !== false) ? 'visible' : 'hidden';
                const icon = (state === 'visible') ? '👁' : '🚫';
                return `<div class="sitplan-sidebar-itemrow">
                            <button type="button" class="sitplan-sidebar-visbtn" data-non-electrical-id="${el.id}" data-state="${state}" title="Zichtbaarheid" >${icon}</button>
                            <div class="sitplan-sidebar-item" style="cursor: default;">
                                <span>${label}</span>
                                <span class="sitplan-sidebar-count"></span>
                            </div>
                        </div>`;
            }).join('')}
                </div>
            </details>`;

        this.container.innerHTML = `
            <div class="sitplan-sidebar-titlebar">
                <div class="sitplan-sidebar-title">Snelle toevoeging</div>
                <div class="sitplan-sidebar-actions">
                    <button type="button" class="sitplan-sidebar-actionbtn" data-action="hideAll" title="Verberg alles">🙈</button>
                    <button type="button" class="sitplan-sidebar-actionbtn" data-action="showAll" title="Toon alles">👁</button>
                </div>
            </div>
            <div class="sitplan-sidebar-tree" id="sitplan_sidebar_tree">${kringTree}${nonElectricalTree}</div>
        `;

        const tree = this.container.querySelector('#sitplan_sidebar_tree') as HTMLElement | null;
        if (!tree) return;

        const renderCableSummaryForKring = (kring: string, summaryDiv: HTMLElement) => {
            const elements = getAllElements();
            const cableCount = elements.filter((e: any) => e?.kind === 'cableRun' && (e?.cableRun?.kring ?? null) === kring).length;
            if (cableCount === 0) {
                summaryDiv.innerHTML = '';
                return;
            }

            const sitplan = (((globalThis as any).structure as any) as any).sitplan;
            const components = computeCableComponentsForKring(sitplan, elements, kring);
            const groupCount = components.length;

            const metersBySpec: Record<string, number> = {};
            let unknownScaleRuns = 0;
            let unknownRiserCount = 0;
            let unknownEndpointCount = 0;
            for (const c of components) {
                unknownScaleRuns += c.unknownScaleRuns;
                unknownRiserCount += c.unknownRiserCount;
                unknownEndpointCount += c.unknownEndpointCount;
                for (const [spec, meters] of Object.entries(c.metersBySpec)) {
                    metersBySpec[spec] = (metersBySpec[spec] ?? 0) + meters;
                }
            }

            const totalMeters = Object.values(metersBySpec).reduce((a, b) => a + b, 0);
            const totalLabel = Number.isFinite(totalMeters) ? `${Math.round(totalMeters * 10) / 10} m` : '—';

            const unknownParts: string[] = [];
            if (unknownScaleRuns > 0) unknownParts.push(`schaal ontbreekt voor ${unknownScaleRuns} run(s)`);
            if (unknownRiserCount > 0) unknownParts.push(`hoogte ontbreekt voor ${unknownRiserCount} stijgleiding(en)`);
            if (unknownEndpointCount > 0) unknownParts.push(`verticale aansluiting onbekend voor ${unknownEndpointCount} eindpunt(en)`);
            const unknownLabel = unknownParts.length > 0 ? ` (${unknownParts.join(', ')})` : '';

            const groupLabel = (groupCount > 1) ? ` • ${groupCount} groepen` : (groupCount === 1 ? '' : '');

            const lines = Object.keys(metersBySpec)
                .sort((a, b) => a.localeCompare(b))
                .map(spec => {
                    const m = metersBySpec[spec];
                    const label = Number.isFinite(m) ? `${Math.round(m * 10) / 10} m` : '—';
                    return `<div class="sitplan-sidebar-cable-line"><span>${spec}</span><span class="sitplan-sidebar-count">${label}</span></div>`;
                })
                .join('');

            summaryDiv.innerHTML = `
                <div class="sitplan-sidebar-cable-header">
                    <span>Kabels${groupLabel}</span>
                    <span class="sitplan-sidebar-count">${totalLabel}${unknownLabel}</span>
                </div>
                ${lines}
            `;

            const runDetails = computeCableRunDetailsForKring(sitplan, elements, kring);
            if (runDetails.length > 0) {
                const runLines = runDetails.map((r, idx) => {
                    const meters = (r.metersTotal == null) ? '—' : `${Math.round(r.metersTotal * 10) / 10} m`;
                    const conn = (r.connectionIdsTouched.length > 0) ? ` ↕ ${r.connectionIdsTouched.join(', ')}` : '';
                    const unknown = r.unknownScale ? ' (schaal?)' : (r.unknownEndpointCount > 0 ? ' (endpoint?)' : '');
                    const label = `Run ${idx + 1} • p${r.page} • ${r.cableSpec}${conn}${unknown}`;
                    return `<div class="sitplan-sidebar-cable-line"><span>${label}</span><span class="sitplan-sidebar-count">${meters}</span></div>`;
                }).join('');
                summaryDiv.innerHTML += runLines;
            }
        };

        const renderItemsForKring = (kring: string, itemsDiv: HTMLElement, summaryDiv: HTMLElement | null) => {
            if (!this.zoeker) return;

            if (summaryDiv) renderCableSummaryForKring(kring, summaryDiv);

            const items = this.zoeker.getElectroItemsByKring(kring);
            const elements = getAllElements();

            itemsDiv.innerHTML = items.map(it => {
                const label = (it.adres && it.adres.trim() !== '') ? `${it.adres} | ${it.type}` : it.type;

                const placedElements = elements.filter((e: any) => e?.getElectroItemId?.() === it.id);
                const placed = placedElements.length;
                const visibleCount = placedElements.filter((e: any) => e?.visible !== false).length;
                const state: 'visible' | 'hidden' | 'mixed' =
                    (placed === 0) ? 'hidden' :
                        (visibleCount === 0) ? 'hidden' :
                            (visibleCount === placed) ? 'visible' :
                                'mixed';
                const icon = (state === 'visible') ? '👁' : (state === 'mixed') ? '◐' : '🚫';
                const visibleDisabled = (placed === 0) ? 'disabled' : '';

                const electro = ((globalThis as any).structure as any).getElectroItemById?.(it.id);
                const max = (electro && typeof electro.maxSituationPlanElements === 'function')
                    ? Number(electro.maxSituationPlanElements())
                    : 0;

                const hasMax = Number.isFinite(max) && max > 0;
                const disable = hasMax && placed >= max;
                const countLabel = hasMax ? `${placed}/${max}` : `${placed}`;

                return `<div class="sitplan-sidebar-itemrow">
                    <button type="button" class="sitplan-sidebar-visbtn" data-electro-visible="${it.id}" data-state="${state}" title="Zichtbaarheid symbool" ${visibleDisabled}>${icon}</button>
                    <button type="button" class="sitplan-sidebar-item" data-electro-id="${it.id}" ${disable ? 'disabled' : ''}>
                        <span>${label}</span>
                        <span class="sitplan-sidebar-count">${countLabel}</span>
                    </button>
                </div>`;
            }).join('');

            const buttons = itemsDiv.querySelectorAll('button[data-electro-id]');
            buttons.forEach(btn => {
                btn.addEventListener('click', () => {
                    if ((btn as HTMLButtonElement).disabled) return;
                    const idStr = (btn as HTMLElement).getAttribute('data-electro-id');
                    const id = idStr ? Number(idStr) : NaN;
                    if (!Number.isFinite(id)) return;

                    const view = ((globalThis as any).structure as any).sitplanview;
                    if (!view) return;

                    const pos = view.getVisibleCenterPaperPos
                        ? view.getVisibleCenterPaperPos()
                        : view.canvasPosToPaperPos(view.canvas?.clientWidth / 2, view.canvas?.clientHeight / 2);

                    const sitplan = ((globalThis as any).structure as any).sitplan;
                    const labelfontsize = sitplan?.defaults?.fontsize ?? 11;
                    const scale = sitplan?.defaults?.scale ?? (globalThis as any).SITPLANVIEW_DEFAULT_SCALE;
                    const rotate = sitplan?.defaults?.rotate ?? 0;

                    view.addElectroItem(
                        id,
                        'auto' as AdresType,
                        '',
                        'rechts' as AdresLocation,
                        labelfontsize,
                        scale,
                        rotate,
                        pos?.x,
                        pos?.y
                    );
                });
            });

            const visButtons = itemsDiv.querySelectorAll('button[data-electro-visible]') as NodeListOf<HTMLButtonElement>;
            visButtons.forEach(btn => {
                btn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    if (btn.disabled) return;

                    const id = Number(btn.getAttribute('data-electro-visible'));
                    if (!Number.isFinite(id)) return;

                    const view = ((globalThis as any).structure as any).sitplanview;
                    if (!view) return;

                    const elements = getAllElements().filter((e: any) => e?.getElectroItemId?.() === id);
                    const total = elements.length;
                    const visibleCount = elements.filter((e: any) => e?.visible !== false).length;

                    const makeVisible = !(total > 0 && visibleCount === total);
                    for (let el of elements) {
                        el.visible = makeVisible;
                    }
                    view.redraw();
                    (globalThis as any).undostruct.store();
                    this.render();
                });
            });
        };

        const kringDetails = Array.from(tree.querySelectorAll('details[data-kring]')) as HTMLDetailsElement[];
        kringDetails.forEach(details => {
            const kring = details.getAttribute('data-kring')?.replace(/&quot;/g, '"') ?? '';
            const itemsDiv = details.querySelector('div[data-kring-items]') as HTMLElement | null;
            const summaryDiv = details.querySelector('div[data-kring-cable-summary]') as HTMLElement | null;
            if (!itemsDiv) return;

            const onToggle = () => {
                if (details.open) {
                    this.selectedKring = kring;
                    renderItemsForKring(kring, itemsDiv, summaryDiv);
                } else {
                    itemsDiv.innerHTML = '';
                    if (summaryDiv) summaryDiv.innerHTML = '';
                }
            };

            details.addEventListener('toggle', onToggle);
            if (details.open) onToggle();
        });

        const kringButtons = tree.querySelectorAll('button[data-kring-toggle]') as NodeListOf<HTMLButtonElement>;
        kringButtons.forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (btn.disabled) return;

                const kring = btn.getAttribute('data-kring-toggle')?.replace(/&quot;/g, '"') ?? '';
                if (!kring) return;

                const view = ((globalThis as any).structure as any).sitplanview;
                if (!view) return;

                const electroIdsInKring = this.zoeker!.getElectroItemsByKring(kring).map(it => it.id);
                const elementsInKring = getAllElements().filter((e: any) => e?.getElectroItemId?.() != null && electroIdsInKring.includes(e.getElectroItemId()));
                const total = elementsInKring.length;
                const visibleCount = elementsInKring.filter((e: any) => e?.visible !== false).length;
                const makeVisible = !(total > 0 && visibleCount === total);

                for (const el of elementsInKring) {
                    el.visible = makeVisible;
                }

                view.redraw();
                (globalThis as any).undostruct.store();
                this.render();
            });
        });

        const kringCableButtons = tree.querySelectorAll('button[data-kring-cables-toggle]') as NodeListOf<HTMLButtonElement>;
        kringCableButtons.forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (btn.disabled) return;

                const kring = btn.getAttribute('data-kring-cables-toggle')?.replace(/&quot;/g, '"') ?? '';
                if (!kring) return;

                const view = ((globalThis as any).structure as any).sitplanview;
                if (!view) return;

                const cableElements = getAllElements().filter((e: any) => e?.kind === 'cableRun' && (e?.cableRun?.kring ?? null) === kring);
                const total = cableElements.length;
                const visibleCount = cableElements.filter((e: any) => e?.visible !== false).length;
                const makeVisible = !(total > 0 && visibleCount === total);

                for (const el of cableElements) {
                    el.visible = makeVisible;
                }

                view.redraw();
                (globalThis as any).undostruct.store();
                this.render();
            });
        });

        const nonElectricalToggle = tree.querySelector('button[data-non-electrical-toggle]') as HTMLButtonElement | null;
        if (nonElectricalToggle) {
            nonElectricalToggle.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (nonElectricalToggle.disabled) return;

                const view = ((globalThis as any).structure as any).sitplanview;
                if (!view) return;

                const elements = getAllElements().filter((e: any) => e?.getElectroItemId?.() == null);
                const total = elements.length;
                const visibleCount = elements.filter((e: any) => e?.visible !== false).length;
                const makeVisible = !(total > 0 && visibleCount === total);

                for (const el of elements) {
                    el.visible = makeVisible;
                }

                view.redraw();
                (globalThis as any).undostruct.store();
                this.render();
            });
        }

        const nonElButtons = tree.querySelectorAll('button[data-non-electrical-id]') as NodeListOf<HTMLButtonElement>;
        nonElButtons.forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const id = btn.getAttribute('data-non-electrical-id');
                if (!id) return;

                const view = ((globalThis as any).structure as any).sitplanview;
                if (!view) return;

                const el = getAllElements().find((e: any) => String(e?.id) === String(id));
                if (!el) return;

                el.visible = !(el?.visible !== false);
                view.redraw();
                (globalThis as any).undostruct.store();
                this.render();
            });
        });

        const actionButtons = this.container.querySelectorAll('button[data-action]') as NodeListOf<HTMLButtonElement>;
        actionButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-action');
                const view = ((globalThis as any).structure as any).sitplanview;
                if (!view) return;

                const elements = getAllElements();
                if (action === 'hideAll') {
                    for (const el of elements) el.visible = false;
                } else if (action === 'showAll') {
                    for (const el of elements) el.visible = true;
                } else {
                    return;
                }

                view.redraw();
                (globalThis as any).undostruct.store();
                this.render();
            });
        });
    }
}
