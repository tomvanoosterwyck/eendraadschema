# Research: how reusable is the existing `.eds` model and renderer outside the browser?

Ticket: [#10](https://github.com/tomvanoosterwyck/eendraadschema/issues/10) · Researched 2026-11-07

## Question

How much of the existing `.eds` domain code can run outside the browser, and what is the cheapest reliable way to support decode, encode, structural validation, BOM, cable-length calculation, and SVG rendering in a Node-based MCP service?

## Method

- Read the format code, the domain model, the renderer, BOM and cable-length code, and the print path.
- Grepped for browser-only APIs (`document`, `window`, `DOMParser`, `XMLSerializer`, `pako`, `atob`/`btoa`, `FileReader`, `Blob`).
- Ran a Node 24 round-trip experiment against `examples/example000.eds` using `node:zlib`.
- Checked the TypeScript build configuration and module style.

## Findings

### The `.eds` envelope is trivially portable

`EDStoJson` recognises three cases (`src/importExport/importExport.ts:676-724`):

- `EDS` + 3-digit version + `0000`, then base64 of a zlib-deflated UTF-8 JSON document.
- `TXT` + 3-digit version + `0000`, then JSON text.
- No header: treated as a version-1 `TXT` file.

Browser dependencies are only the primitives: `atob` (`:705`) and the global `pako` object (`:712`, `:273`). Encoding uses `pako.deflate` + `btoa` (`:272-274`). All of these have direct Node equivalents:

| Browser primitive | Node equivalent |
| --- | --- |
| `atob` / `btoa` | `Buffer.from(s, "base64")` / `buf.toString("base64")` |
| `pako.inflate` / `pako.deflate` | `zlib.inflateSync` / `zlib.deflateSync` |
| `TextEncoder` / `TextDecoder` | global in Node |

**Verified round-trip** (`node --input-type=module`, Node v24.12.0):

```
examples/example000.eds
header EDS0010000 len 3402
keys [length, data, active, id, print_table, properties, curid, mode]
items 19, curid 45
JSON equal after EDS004 re-encode: true
```

The re-encoded bytes differ only because zlib parameters/headers differ; the decoded JSON is identical. A shared codec should preserve the input version on read and write the current version (`EDS0040000`) on save, matching `buildShareSchemaText` (`:295-316`).

### The domain model is mostly data + SVG strings

- `List_Item` is a plain data object: `id`, `parent`, `indent`, `collapsed`, `props`, `sourcelist` (`src/List_Item/List_Item.ts:4-25`).
- `Electro_Item` adds type lookup, parent/child logic, cloning, numbering helpers, and `toSVG` (`src/List_Item/Electro_Item.ts:9-430`). Its `toSVG` returns an `SVGelement`, a plain holder for `data: string`, geometry (`xleft`, `xright`, `yup`, `ydown`, `xrightmin`), and connector positions (`src/SVGelement.ts:1-23`).
- Concrete items build SVG by string concatenation. Example: `Contactdoos.toSVG` (`src/List_Item/Contactdoos.ts:62+`) appends `<line>`, `<use>`, and `<text>` strings to `mySVG.data`.
- `SVGSymbols` is a static string dictionary with `addSymbol`, `clearSymbols`, and `getNeededSymbols` (`src/SVGSymbols.ts:1-50`). No DOM.
- `Hierarchical_List.toSVG` walks the tree and concatenates child `SVGelement`s (`src/Hierarchical_List.ts:1437+`).

The one-line diagram renderer is therefore **pure string generation** and does not need a DOM.

### The browser boundary is narrow and identifiable

The model itself only touches browser globals in a few places:

- `Hierarchical_List.toHTML` / `updateHTMLinner` / ribbon and input helpers read `document` (`src/Hierarchical_List.ts:962`, `:1089`, `:1207`, `:1266`, `:1378`).
- `Hierarchical_List.insertChildAfterId` calls `alert()` on a child-count violation (`src/Hierarchical_List.ts:466-490`).
- `bom/materials.ts` mixes pure computation with DOM rendering: `computeBomPrintData` (`:264`) is pure; `refreshMaterialsPageIfOpen` (`:24`) and `showMaterialsPage` (`:358`) touch `document` and `globalThis.toggleAppView`.
- `SituationPlan` and `SituationPlanElement` reference `globalThis.structure` and `globalThis.SITPLANVIEW_DEFAULT_SCALE` (`src/sitplan/SituationPlan.ts:15,37,55,151,...`; `src/sitplan/SituationPlanElement.ts:11-12,79,124,...`). The class comment says the model was "built for the browser but is reasonably browser-agnostic" (`src/sitplan/SituationPlan.ts:14`).
- `SituationPlanElement.getSizeFromString` uses `DOMParser` only to read `width`/`height` attributes from its own SVG string (`src/sitplan/SituationPlanElement.ts:438`). That is replaceable with a small attribute parser or a DOM shim.
- `SituationPlan.toSitPlanPrint` builds SVG strings and reads `globalThis.structure` for the page count (`src/sitplan/SituationPlan.ts:427-476`).
- `general.flattenSVG` / `flattenSVGfromString` use `DOMParser` and `XMLSerializer` for pagination (`src/general.ts:210,327`).
- `print/print.ts` and `print/printToJsPDF.ts` are DOM/jsPDF/canvas-heavy (`src/print/print.ts:8+`; `src/print/printToJsPDF.ts:248,291,602`).

### BOM and cable lengths are portable

- `src/sitplan/CableLengthCalculator.ts` is pure TypeScript: types plus pure functions, no DOM. Public entry points: `computeCableComponentsForKring` (`:103`), `computeCableRunDetailsForKring` (`:380`), `computeCableLengthSummaryForKring` (`:578`).
- `src/bom/materials.ts` computation (`computeBomPrintData`, `:264`) depends on `ElectroItemZoeker` and `CableLengthCalculator`, both portable. Only the rendering functions touch the DOM.
- `ElectroItemZoeker.ts` should be checked when extracting, but it is a lookup helper, not a UI module.

### Structural validation is implicit, not centralised

There is no `validate.ts`. Constraints are spread across:

- `getMaxNumChilds` / `allowedChilds` per item (`src/List_Item/Electro_Item.ts:42,149`; overrides in `Aansluiting`, `Bord`, `Kring`, `Splitsing`, `Domotica*`, etc.).
- `reSort` enforcing parent-before-child order and removing inactive items (`src/Hierarchical_List.ts:184-240`).
- `voegAttributenToeAlsNodigEnReSort` normalising/removing `isAttribuut` children (`src/Hierarchical_List.ts:1093-1167`).
- `overrideKeys` per class normalising legacy values (e.g. `Kring.ts:102-140`, `Schakelaars.ts:60-82`).
- UI-level warnings such as "more than one Kring behind a Kring" and "more than one element behind an Aansluiting" (`src/Hierarchical_List.ts:1195-1235`). These are not returned as data.

A shared validator can call the existing invariants, but it must add its own error reporting; today the app communicates some problems only visually.

### TypeScript/Node packaging is the real friction

The code is ESM (`package.json:5`), but `tsconfig.json` uses `"moduleResolution": "bundler"` and extensionless relative imports, which Node ESM does not resolve. Options:

1. Build the shared core with `tsc`/`esbuild`/`tsup` into JS + declarations. Most predictable.
2. Use `tsx` in development and a bundler in production.
3. Node 24 type stripping works for syntax but does not fix extensionless imports; do not rely on it alone.

## Capability × portability matrix

| Capability | Direct import in Node | DOM shim | Headless browser | Extraction / duplication | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `.eds` decode/encode | Partly (replace `atob`/`pako`) | No | No | Small adapter | Extract `eds/codec.ts` with injected base64/zlib |
| JSON → runtime model (`json_to_structure`) | Partly (`globalThis` shims) | No | No | Move to core | Extract with explicit `structure` argument |
| Structural tree operations (`add/move/delete/reSort`) | Mostly (guard `alert`, `globalThis`) | No | No | Small edits | Extract `model/` and replace UI calls with typed errors |
| `allowedChilds` / `getMaxNumChilds` / `overrideKeys` | Yes | No | No | Move to core | Extract unchanged |
| One-line SVG (`Hierarchical_List.toSVG`) | Yes | No | No | Move to core | Extract unchanged |
| Situation-plan SVG (`SituationPlan.toSitPlanPrint`) | Mostly (`globalThis.structure`, `SITPLANVIEW_DEFAULT_SCALE`) | Tiny shim for `DOMParser` in `getSizeFromString` | No | Small adapter | Extract with a `SituationPlanContext` |
| Print pagination (`flattenSVG`) | No | `linkedom`/`jsdom` possible | Possible | Rewrite or skip | Out of scope for v1 |
| PDF/print export | No | No | Yes | Keep in browser | Out of scope |
| BOM (`computeBomPrintData`) | Yes | No | No | Move to core | Extract unchanged |
| Cable lengths | Yes | No | No | Move to core | Extract unchanged |

## Recommended shared-core boundary

Create a `core` package (source folder or workspace package) that owns:

- `eds/codec.ts` — decode/encode, version constants, `TXT` fallback.
- `model/` — `Hierarchical_List`, `List_Item`, `Electro_Item`, all 49 concrete item classes, `Properties`, `SVGelement`, `SVGSymbols`.
- `operations/` — create/add/insert/move/delete, validation, auto-numbering, attribute normalisation.
- `stats/` — BOM and cable-length computation.
- `render/svg.ts` — one-line SVG; situation-plan SVG behind a context object.
- `catalog/` — machine-readable item catalog generated from the classes (see #13).

Keep in `src/` (browser app): HTML tree editor, dialogs, DOM event handling, print/PDF, theme, file pickers, auth UI, storage UI.

Add a `SituationPlanContext` (structure lookup, default scale, page count) instead of `globalThis`; this is the only non-trivial refactor in the render path.

## Cheapest rendering path

- **One-line diagram:** direct reuse of `Hierarchical_List.toSVG` + `SVGSymbols`, no browser. This is the high-value path.
- **Situation plan:** reuse `SituationPlan.toSitPlanPrint` with a `SituationPlanContext` and a small `getSizeFromString` replacement. If fidelity issues appear, add `linkedom` (small, fast) rather than a headless browser.
- **PDF/print:** do not attempt server-side in v1. Share links and SVG cover the human view.

## Risks

- `globalThis` initialisation order: `SITPLANVIEW_DEFAULT_SCALE` must be set before constructing `SituationPlan`/`SituationPlanElement` (`src/sitplan/SituationPlan.ts:37,55`; `SituationPlanElement.ts:79`).
- `alert()` in `Hierarchical_List.insertChildAfterId` must become a typed error before running headless.
- `Object.setPrototypeOf` in `voegAttributenToeAlsNodigEnReSort` is fine in Node but easy to break when bundling.
- Legacy version upgrades (`upgrade_version`, `src/importExport/importExport.ts:171-236`) are essential for reading real-world files; port them with tests.
- No existing unit tests for the model; add golden-file tests before moving code.
- The 49 item classes import `general.ts`, which contains both pure helpers and DOM-dependent `flattenSVG`; split `general.ts` so core imports do not pull in DOM code.

## Recommendation

Extract a TypeScript core and run it in Node. The `.eds` codec, model, validation, BOM, cable lengths, and one-line SVG are all portable with small, well-defined adapters. A headless browser is not needed for the v1 rendering target; a DOM shim is only a fallback for situation-plan size parsing. This makes the TypeScript MCP route cheaper than a Go rewrite of the domain model.
