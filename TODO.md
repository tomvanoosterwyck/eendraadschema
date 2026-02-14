# TODO – Cable length per run + Materials (BOM)

This file tracks implementation progress for:
- Cable-run drawing + length calculation (incl. multi-floor traversal)
- Materials list per circuit + overall totals (BOM)

> When a task is finished, tick it here.

## 1) Data model + existing structure audit
- [ ] Audit current page/circuit/session models (where pages, circuits, and drawing primitives are stored)
- [ ] Audit `.eds` import/export format and where schema changes belong
- [ ] Identify where to hook rendering + selection + undo/redo for new drawable entities

## 2) Floors + assigning floor to a page
- [x] Add `floors` collection to document/session (id, name, optional elevation/height)
- [x] Add `page.floorId` (nullable) to assign a floor to each page
- [x] UI: Floor dropdown (situatieplan ribbon)
- [x] UI: Manage floors minimal flow (add)

## 2b) Per-component height (mounting height)
- [x] Add `heightCm` to situation plan elements + persist/load
- [x] UI: edit `heightCm` in element properties popup

## 3) Scale (drawing units → meters)
- [x] Decide scale scope (global vs per-floor vs per-page)
- [x] Add scale field(s) in model (e.g. `metersPerUnit`)
- [x] UI: edit scale value in appropriate properties screen
- [x] Validation: warn/indicate when scale is missing (length can’t be computed)

## 4) Cable-run drawable entity (polyline)
- [x] Add `CableRun` entity type (polyline points)
- [ ] Attach to `circuitId`
- [ ] Attach to `pageId` and/or `floorId`
- [x] Add cable specification for BOM (e.g. `cableSpec` like `XVB 3G2.5`) or `cableTypeId`

## 5) Draw/edit cable runs (UX)
- [x] Add tool/mode: draw cable run (click to add vertices, finish to commit)
- [x] Edit: move vertex, insert/remove vertex
- [x] Delete cable run
- [ ] Add selection/hover behavior consistent with existing drawables
- [x] Integrate all actions with undo/redo

## 6) Show/hide cable runs per circuit
- [x] Add per-circuit toggle: show/hide cable runs
- [x] Rendering respects toggle without deleting data

## 7) Connection points for multi-floor traversal
- [x] Add `ConnectionPoint` entity type (placed on page/floor)
- [x] Add `connectionId` (same id used across floors to represent same vertical riser)
- [x] UI: tool to place connection point and select/create `connectionId`

## 8) Length computation (per run + per circuit)
- [x] Compute horizontal polyline length (sum of segments) × scale
- [ ] Decide vertical length model:
  - [ ] Option A: explicit user-entered vertical length per connection link
  - [x] Option B: derive from floor elevations/heights
- [x] Traverse runs across floors using connection points
- [x] Aggregate totals: per run and per circuit (and optionally per floor breakdown)

## 9) Surface results in UI + printing
- [ ] UI: show cable lengths in circuit properties (totals + list of runs)
- [ ] UI: show run-level details (cableSpec + meters)
- [ ] Print: include cable length summary in existing print tables

## 10) Persistence, migration, examples
- [ ] Extend `.eds` schema to include floors, cable runs, connection points, scale
- [ ] Backward compatibility: migrate older files (defaults when fields missing)
- [ ] Update/add example `.eds` covering multi-floor + runs

---

# TODO – Materials / BOM page

## 11) Material mapping + BOM schema
- [x] Define `MaterialLine` structure (key, label, unit, quantity)
- [ ] Implement “material resolver” mapping:
  - [ ] Diagram symbols/items → material lines (e.g. dual socket → `dual socket (pcs) +1`)
  - [x] Cable runs → material lines (e.g. `XVB 3G2.5 (m) +<meters>`)
- [ ] Decide whether BOM is strictly derived or allows manual overrides

## 12) Materials summary page (BOM view)
- [x] Add a page/view that lists required materials per circuit
- [x] Add overall totals across all circuits
- [x] Keep grouping/sorting simple (group by material key)
- [x] Live updates as diagram changes

## 13) BOM in print/export
- [x] Print: include BOM per circuit + totals
- [ ] Export: decide whether to store computed BOM (usually recompute; store only source-of-truth inputs)
