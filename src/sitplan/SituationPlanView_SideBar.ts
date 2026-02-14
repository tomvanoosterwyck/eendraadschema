import { ElectroItemZoeker } from "./ElectroItemZoeker";
import type { AdresLocation, AdresType } from "./SituationPlanElement";

export class SituationPlanView_SideBar {

    private container: HTMLElement | null;
    private zoeker: ElectroItemZoeker | null = null;
    private selectedKring: string | null = null;
    
    constructor(div: HTMLElement | null) {
        this.container = div;
    }

    public renderSymbols() {
    }

    public render() {
        if (!this.container) return;

        if (!globalThis.structure) {
            this.container.innerHTML = '';
            return;
        }

        if (this.zoeker == null) this.zoeker = new ElectroItemZoeker();
        else this.zoeker.reCalculate();


        const sitplan = (globalThis.structure as any).sitplan;
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
            // External/background drawings loaded from file
            if (typeof el?.svg === 'string' && el.svg.includes('<image ')) {
                return 'Achtergrond/tekening';
            }
            return 'Niet-elektrisch element';
        }

        const kringenWithLabels = this.zoeker.getUniqueKringnaamWithLabels();
        const kringValues = kringenWithLabels.map(k => k.value);
        if (this.selectedKring == null || !kringValues.includes(this.selectedKring)) {
            this.selectedKring = kringValues.length > 0 ? kringValues[0] : null;
        }

        const kringTree = kringenWithLabels.map(k => {
            const safeValue = k.value.replace(/"/g, '&quot;');
            const open = (k.value === this.selectedKring) ? 'open' : '';

            const electroIdsInKring = this.zoeker.getElectroItemsByKring(k.value).map(it => it.id);
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

            return `
                <details class="sitplan-sidebar-kring" data-kring="${safeValue}" ${open}>
                    <summary class="sitplan-sidebar-kring-summary">
                        <button type="button" class="sitplan-sidebar-visbtn" data-kring-toggle="${safeValue}" data-state="${state}" title="Zichtbaarheid kring" ${disabled}>${icon}</button>
                        <span>${k.label}</span>
                    </summary>
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

        const renderItemsForKring = (kring: string, itemsDiv: HTMLElement) => {
            if (!this.zoeker) return;
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

                const electro = globalThis.structure.getElectroItemById?.(it.id);
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

                    const view = (globalThis.structure as any).sitplanview;
                    if (!view) return;

                    const pos = view.getVisibleCenterPaperPos
                        ? view.getVisibleCenterPaperPos()
                        : view.canvasPosToPaperPos(view.canvas?.clientWidth / 2, view.canvas?.clientHeight / 2);

                    const sitplan = (globalThis.structure as any).sitplan;
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

            // Wire per-item visibility icon buttons
            const visButtons = itemsDiv.querySelectorAll('button[data-electro-visible]') as NodeListOf<HTMLButtonElement>;
            visButtons.forEach(btn => {
                btn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    if (btn.disabled) return;

                    const id = Number(btn.getAttribute('data-electro-visible'));
                    if (!Number.isFinite(id)) return;

                    const view = (globalThis.structure as any).sitplanview;
                    if (!view) return;

                    const elements = getAllElements().filter((e: any) => e?.getElectroItemId?.() === id);
                    const total = elements.length;
                    const visibleCount = elements.filter((e: any) => e?.visible !== false).length;

                    const makeVisible = !(total > 0 && visibleCount === total);
                    for (let el of elements) {
                        el.visible = makeVisible;
                    }
                    view.redraw();
                    globalThis.undostruct.store();
                });
            });
        };

        const kringDetails = Array.from(tree.querySelectorAll('details[data-kring]')) as HTMLDetailsElement[];
        kringDetails.forEach(details => {
            const kring = details.getAttribute('data-kring')?.replace(/&quot;/g, '"') ?? '';
            const itemsDiv = details.querySelector('div[data-kring-items]') as HTMLElement | null;
            if (!itemsDiv) return;

            const onToggle = () => {
                if (details.open) {
                    this.selectedKring = kring;
                    renderItemsForKring(kring, itemsDiv);
                } else {
                    itemsDiv.innerHTML = '';
                }
            };

            details.addEventListener('toggle', onToggle);
            // Initial lazy render for the default open kring
            if (details.open) onToggle();
        });

        // Wire kring-level visibility icon buttons
        const kringButtons = tree.querySelectorAll('button[data-kring-toggle]') as NodeListOf<HTMLButtonElement>;
        kringButtons.forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (btn.disabled) return;

                const kring = btn.getAttribute('data-kring-toggle')?.replace(/&quot;/g, '"') ?? '';
                if (!kring) return;

                const view = (globalThis.structure as any).sitplanview;
                if (!view) return;

                const items = this.zoeker.getElectroItemsByKring(kring);
                const ids = new Set(items.map(it => it.id));
                const elements = getAllElements().filter((e: any) => {
                    const id = e?.getElectroItemId?.();
                    return id != null && ids.has(id);
                });

                const total = elements.length;
                const visibleCount = elements.filter((e: any) => e?.visible !== false).length;
                const makeVisible = !(total > 0 && visibleCount === total);
                for (let el of elements) {
                    el.visible = makeVisible;
                }

                view.redraw();
                globalThis.undostruct.store();
            });
        });

        // Wire header hide/show-all buttons
        const actionButtons = this.container.querySelectorAll('button[data-action]') as NodeListOf<HTMLButtonElement>;
        actionButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-action');
                const view = (globalThis.structure as any).sitplanview;
                if (!view) return;
                if (action === 'hideAll') view.hideAllElements();
                if (action === 'showAll') view.showAllElements();
            });
        });

        // Wire non-electrical visibility toggles
        const nonElToggle = this.container.querySelector('button[data-non-electrical-toggle]') as HTMLButtonElement | null;
        if (nonElToggle) {
            nonElToggle.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (nonElToggle.disabled) return;
                const view = (globalThis.structure as any).sitplanview;
                if (!view) return;
                const elements = getAllElements().filter((e: any) => e?.getElectroItemId?.() == null);
                const total = elements.length;
                const visibleCount = elements.filter((e: any) => e?.visible !== false).length;
                const makeVisible = !(total > 0 && visibleCount === total);
                for (let el of elements) el.visible = makeVisible;
                view.redraw();
                globalThis.undostruct.store();
            });
        }

        const nonElButtons = this.container.querySelectorAll('button[data-non-electrical-id]') as NodeListOf<HTMLButtonElement>;
        nonElButtons.forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const id = btn.getAttribute('data-non-electrical-id');
                if (!id) return;
                const view = (globalThis.structure as any).sitplanview;
                if (!view) return;
                const el = getAllElements().find((e: any) => e?.id === id);
                if (!el) return;
                el.visible = (el.visible === false);
                view.redraw();
                globalThis.undostruct.store();
            });
        });
    }

}

globalThis.HLInsertAndEditSymbol = (event: MouseEvent, id: number) => {}

globalThis.HLExpandSitPlan = (my_id: number) => {}