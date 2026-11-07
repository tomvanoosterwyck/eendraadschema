# Research: item-type catalog, property schemas, and structural constraints

Ticket: [#13](https://github.com/tomvanoosterwyck/eendraadschema/issues/13) · Researched 2026-11-07

## Question

What complete authoring vocabulary does the domain model expose, and how should it be represented for MCP tools and resources?

## Method

- Enumerated every `src/List_Item/**/*.ts` class and the `createItem` factory switch (`src/Hierarchical_List.ts:360-410`).
- Extracted each class's `resetProps()` assignments, `allowedChilds()` return value, and `getMaxNumChilds()` return value with a small Node script.
- Read the base `List_Item` / `Electro_Item` invariants, `Hierarchical_List.reSort` and `voegAttributenToeAlsNodigEnReSort`, and per-class `overrideKeys()` normalisation.
- Read the `.eds` JSON loader (`src/importExport/importExport.ts:540-661`) and version upgrades (`:171-236`).

## Source of truth

There are **49 concrete item types** in `createItem` (`src/Hierarchical_List.ts:360-410`). The factory maps `props.type` strings to classes; an unknown type falls back to the base `Electro_Item`, which has no drawing and no specific properties. The MCP catalog should expose the 49 known types and reject unknown ones unless the raw escape hatch is used.

The type strings are Dutch and are part of the persisted format. Do not translate them on the wire; expose English aliases only as documentation, never as the stored value.

## Document envelope

`.eds` JSON (after decode) has this top-level shape (`src/importExport/importExport.ts:554-661`):

| Field | Meaning |
| --- | --- |
| `length` | Number of items (including inactive?) |
| `data[]` | Item records; each has `props`, `parent`, `id`, `indent`, `collapsed` |
| `active[]` | Per-item active flag; inactive items are removed by `reSort` |
| `id[]` | Parallel array of item IDs |
| `curid` | Next free item ID |
| `properties` | Document metadata (`filename`, `owner`, `control`, `installer`, `info`, `dpi`, `currentView`, `disableEDSCompression`, `legacySchakelaars`) |
| `print_table` | Page/print settings |
| `sitplanjson` | Situation-plan data (floors, pages, elements, scale) |
| `mode` | UI mode (not meaningful for MCP) |

The runtime `Hierarchical_List` also has `properties: Properties`, `data: List_Item[]`, `active: boolean[]`, `id: number[]`, `curid`, `length`.

## Structural invariants

These are enforced by the app and must be enforced by the MCP server before saving:

1. **Unique IDs.** Every item has a unique numeric `id`; `curid` is greater than every used ID. New items take `curid` and increment it (`src/Hierarchical_List.ts:418-440`).
2. **Valid parents.** `parent` is `0` for roots or the `id` of an existing item. `reSort` rejects parent references that appear after the child (`src/Hierarchical_List.ts:184-240`).
3. **Pre-order order.** `data[]` is ordered parent-before-child; `reSort` rebuilds the order when needed. The JSON `data[]`, `active[]`, and `id[]` arrays move together.
4. **Active flags.** Deleted items are first marked inactive; `reSort` removes them. An inactive item forces a resort (`src/Hierarchical_List.ts:184-240`).
5. **Depth/indent.** `indent` follows the tree depth; `collapsed` is presentation-only.
6. **Type.** `props.type` is one of the 49 known strings. Unknown types are tolerated on read but render nothing.
7. **Child cardinality.** `getMaxNumChilds()` is context-dependent: the base `Electro_Item` returns `0` when the parent is `Meerdere verbruikers`, otherwise `1`; many types override to `256` or `0` (`src/List_Item/Electro_Item.ts:149-156`).
8. **Allowed children.** `allowedChilds()` returns the type strings accepted under an item. The root allows `Aansluiting`, `Zekering/differentieel`, and `Kring` (`src/List_Item/Electro_Item.ts:209`). Items without an override inherit the large `Electro_Item.allowedChilds()` list (`:42-44`).
9. **Attributes are not children.** `props.isAttribuut === true` marks an external-control child of a `Domotica gestuurde verbruiker`. It is excluded from child counts and from the normal tree (`src/List_Item/Electro_Item.ts:48-85`; `src/Hierarchical_List.ts:1093-1167`).
10. **External-control attributes.** If a `Domotica gestuurde verbruiker` has `heeft_externe_sturing === true` and `type_externe_sturing` is `schakelaar` or `drukknop`, the app auto-creates a matching attribute child and removes invalid ones (`src/Hierarchical_List.ts:1093-1167`).
11. **Auto-numbering.** `autonr` is `"auto"` or `"manueel"`; `nr` is the displayed number; `autoKringNaam` controls circuit-name numbering. Only children of `Kring` or `Domotica module (verticaal)` show a number (`src/List_Item/Electro_Item.ts:235-285`).
12. **Address text.** `adres` is a string; `\n` or `|` separates lines; `adres_uitlijning` is `links`, `centreer`, or `rechts` (`src/List_Item/Electro_Item.ts:287-325`).
13. **Page breaks.** `newPage` is only valid on root children and not on the first root child (`src/List_Item/Kring.ts:120-128`; similar in `Aansluiting`).
14. **Leegacy type aliases.** On read: `Stopcontact` → `Contactdoos`, `Leeg` → `Aansluitpunt`; `bescherming` `schakelaar` → `contact`; `curve_automaat` `E` → `U`; `type_schakelaar` `schakelaar` → `contact` (`src/importExport/importExport.ts:171-236`; `src/List_Item/Kring.ts:102-140`; `src/List_Item/Schakelaars/Schakelaars.ts:60-82`).
15. **Warnings are visual only.** The app warns when a `Kring` has more than one `Kring` child, or an `Aansluiting` has more than one child, but only in HTML (`src/Hierarchical_List.ts:1195-1235`). A server-side validator must turn these into data.

## Generated type catalog

The following is generated from `src/List_Item/**/*.ts` on 2026-11-07. "Max children inherited" means the class does not override `getMaxNumChilds()`; the base `Electro_Item` behaviour applies (0 under `Meerdere verbruikers`, otherwise 1). "Allowed children inherited" means it uses the large base list from `Electro_Item.ts:42-44`. Default props are the values set by `resetProps()`; they are not a full schema (some props are set conditionally or in `overrideKeys()`).

### Aansluiting

- **File:** `src/List_Item/Aansluiting.ts`
- **Base:** `Electro_Item`
- **Type string:** `Aansluiting`
- **Max children:** `256`
- **Allowed children:** `Bord`, `Kring`, `Splitsing`
- **Default props (resetProps):** `type="Aansluiting"`, `aantal_polen="2"`, `bescherming="differentieel"`, `amperage="40"`, `type_kabel_na_teller="2x16"`, `differentieel_delta_amperage="300"`, `adres=""`, `type_differentieel=""`, `curve_automaat=""`, `differentieel_is_selectief=false`, `kortsluitvermogen=""`, `naam=""`, `type_kabel_voor_teller=""`, `huishoudelijk=true`, `fase=''`, `normaalGesloten=false`, `newPage=false`

### Aansluitpunt

- **File:** `src/List_Item/Aansluitpunt.ts`
- **Base:** `Electro_Item`
- **Type string:** `Aansluitpunt`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Aansluitpunt"`, `adres=""`

### Aardingsonderbreker

- **File:** `src/List_Item/Aardingsonderbreker.ts`
- **Base:** `Electro_Item`
- **Type string:** `Aardingsonderbreker`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Aardingsonderbreker"`, `adres=""`

### Aftakdoos

- **File:** `src/List_Item/Aftakdoos.ts`
- **Base:** `Electro_Item`
- **Type string:** `Aftakdoos`
- **Max children:** `256`
- **Allowed children:** `Aansluiting`, `Domotica`, `Domotica module (verticaal)`, `Domotica gestuurde verbruiker`, `Leiding`, `Meerdere verbruikers`, `Splitsing`, `Batterij`, `Bel`, `Boiler`, `Contactdoos`, `Diepvriezer`, `Droogkast`, `Drukknop`, `Elektriciteitsmeter`, `Elektrische oven`, `EV lader`, `Ketel`, `Koelkast`, `Kookfornuis`, `Lichtcircuit`, `Lichtpunt`, `Media`, `Microgolfoven`, `Motor`, `Omvormer`, `Overspanningsbeveiliging`, `Schakelaars`, `Stoomoven`, `Transformator`, `USB lader`, `Vaatwasmachine`, `Ventilator`, `Verlenging`, `Verwarmingstoestel`, `Verbruiker`, `Vrije tekst`, `Warmtepomp/airco`, `Wasmachine`, `Zekering/differentieel`, `Zonnepaneel`, `Aansluitpunt`, `Aftakdoos`, `Zeldzame symbolen`
- **Default props (resetProps):** `type="Aftakdoos"`, `adres=""`

### Batterij

- **File:** `src/List_Item/Batterij.ts`
- **Base:** `Electro_Item`
- **Type string:** `Batterij`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Batterij"`, `adres=""`, `symbool="standaard"`

### Bel

- **File:** `src/List_Item/Bel.ts`
- **Base:** `Electro_Item`
- **Type string:** `Bel`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Bel"`, `adres=""`

### Boiler

- **File:** `src/List_Item/Boiler.ts`
- **Base:** `Electro_Item`
- **Type string:** `Boiler`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Boiler"`, `heeft_accumulatie=false`, `adres=""`

### Bord

- **File:** `src/List_Item/Bord.ts`
- **Base:** `Electro_Item`
- **Type string:** `Bord`
- **Max children:** `256`
- **Allowed children:** `Kring`, `Vrije ruimte`
- **Default props (resetProps):** `type="Bord"`, `is_geaard=false`, `is_geaard=true`, `naam=""`, `adres=""`

### Contactdoos

- **File:** `src/List_Item/Contactdoos.ts`
- **Base:** `Electro_Item`
- **Type string:** `Contactdoos`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Contactdoos"`, `is_geaard=true`, `is_kinderveilig=true`, `aantal="1"`, `adres=""`, `aantal_fases_indien_meerfasig="3"`, `heeft_ingebouwde_schakelaar=false`, `is_halfwaterdicht=false`, `is_meerfasig=false`, `heeft_nul_indien_meerfasig=false`, `in_verdeelbord=false`

### Container

- **File:** `src/List_Item/Container.ts`
- **Base:** `Electro_Item`
- **Type string:** `Container`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Container"`

### Diepvriezer

- **File:** `src/List_Item/Diepvriezer.ts`
- **Base:** `Electro_Item`
- **Type string:** `Diepvriezer`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Diepvriezer"`, `adres=""`

### Domotica

- **File:** `src/List_Item/Domotica.ts`
- **Base:** `Electro_Item`
- **Type string:** `Domotica`
- **Max children:** `256`
- **Allowed children:** `Kring`
- **Default props (resetProps):** `type="Domotica"`, `tekst="Domotica"`, `adres=""`, `nr=""`

### Domotica_gestuurde_verbruiker

- **File:** `src/List_Item/Domotica_gestuurde_verbruiker.ts`
- **Base:** `Electro_Item`
- **Type string:** `Domotica gestuurde verbruiker`
- **Max children:** `1`
- **Allowed children:** `Batterij`, `Bel`, `Boiler`, `Contactdoos`, `Diepvriezer`, `Droogkast`, `Drukknop`, `Elektrische oven`, `EV lader`, `Ketel`, `Koelkast`, `Kookfornuis`, `Lichtcircuit`, `Lichtpunt`, `Media`, `Microgolfoven`, `Motor`, `Omvormer`, `Overspanningsbeveiliging`, `Schakelaars`, `Stoomoven`, `Transformator`, `USB lader`, `Vaatwasmachine`, `Ventilator`, `Verlenging`, `Verwarmingstoestel`, `Verbruiker`, `Vrije tekst`, `Warmtepomp/airco`, `Wasmachine`, `Zonnepaneel`, `Aansluitpunt`, `Aftakdoos`, `Zeldzame symbolen`
- **Default props (resetProps):** `type="Domotica gestuurde verbruiker"`, `type_externe_sturing="drukknop"`, `adres=""`, `is_draadloos=true`, `heeft_lokale_drukknop=true`, `is_geprogrammeerd=true`, `heeft_detectie=false`, `heeft_externe_sturing=false`

### Domotica_verticaal

- **File:** `src/List_Item/Domotica_verticaal.ts`
- **Base:** `Electro_Item`
- **Type string:** `Domotica module (verticaal)`
- **Max children:** `256`
- **Allowed children:** `Aansluiting`, `Domotica`, `Domotica module (verticaal)`, `Domotica gestuurde verbruiker`, `Leiding`, `Meerdere verbruikers`, `Splitsing`, `Batterij`, `Bel`, `Boiler`, `Contactdoos`, `Diepvriezer`, `Droogkast`, `Drukknop`, `Elektriciteitsmeter`, `Elektrische oven`, `EV lader`, `Ketel`, `Koelkast`, `Kookfornuis`, `Lichtcircuit`, `Lichtpunt`, `Media`, `Microgolfoven`, `Motor`, `Omvormer`, `Overspanningsbeveiliging`, `Schakelaars`, `Stoomoven`, `Transformator`, `USB lader`, `Vaatwasmachine`, `Ventilator`, `Verlenging`, `Verwarmingstoestel`, `Verbruiker`, `Vrije tekst`, `Warmtepomp/airco`, `Wasmachine`, `Zekering/differentieel`, `Zonnepaneel`, `Aansluitpunt`, `Aftakdoos`, `Zeldzame symbolen`
- **Default props (resetProps):** `type="Domotica module (verticaal)"`, `nr=""`, `tekst="Domotica"`

### Droogkast

- **File:** `src/List_Item/Droogkast.ts`
- **Base:** `Electro_Item`
- **Type string:** `Droogkast`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Droogkast"`, `adres=""`

### Drukknop

- **File:** `src/List_Item/Drukknop.ts`
- **Base:** `Electro_Item`
- **Type string:** `Drukknop`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Drukknop"`, `aantal="1"`, `aantal_knoppen_per_armatuur="1"`, `adres=""`, `type_knop="standaard"`, `is_afgeschermd=false`, `is_halfwaterdicht=false`, `heeft_verklikkerlampje=false`

### Elektriciteitsmeter

- **File:** `src/List_Item/Elektriciteitsmeter.ts`
- **Base:** `Electro_Item`
- **Type string:** `Elektriciteitsmeter`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Elektriciteitsmeter"`, `adres=""`

### Elektrische_oven

- **File:** `src/List_Item/Elektrische_oven.ts`
- **Base:** `Electro_Item`
- **Type string:** `Elektrische oven`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Elektrische oven"`, `adres=""`

### EV_lader

- **File:** `src/List_Item/EV_lader.ts`
- **Base:** `Electro_Item`
- **Type string:** `EV lader`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="EV lader"`, `adres=""`

### Ketel

- **File:** `src/List_Item/Ketel.ts`
- **Base:** `Electro_Item`
- **Type string:** `Ketel`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Ketel"`, `aantal="1"`, `adres=""`, `keteltype=""`, `energiebron=""`, `warmtefunctie=""`

### Koelkast

- **File:** `src/List_Item/Koelkast.ts`
- **Base:** `Electro_Item`
- **Type string:** `Koelkast`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Koelkast"`, `adres=""`

### Kookfornuis

- **File:** `src/List_Item/Kookfornuis.ts`
- **Base:** `Electro_Item`
- **Type string:** `Kookfornuis`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Kookfornuis"`, `adres=""`

### Kring

- **File:** `src/List_Item/Kring.ts`
- **Base:** `Electro_Item`
- **Type string:** `Kring`
- **Max children:** `256`
- **Allowed children:** `Aansluiting`, `Bord`, `Domotica`, `Domotica module (verticaal)`, `Domotica gestuurde verbruiker`, `Kring`, `Meerdere verbruikers`, `Splitsing`, `Batterij`, `Bel`, `Boiler`, `Contactdoos`, `Diepvriezer`, `Droogkast`, `Drukknop`, `Elektriciteitsmeter`, `Elektrische oven`, `EV lader`, `Ketel`, `Koelkast`, `Kookfornuis`, `Lichtcircuit`, `Lichtpunt`, `Media`, `Microgolfoven`, `Motor`, `Omvormer`, `Overspanningsbeveiliging`, `Schakelaars`, `Stoomoven`, `Transformator`, `USB lader`, `Vaatwasmachine`, `Ventilator`, `Verlenging`, `Verwarmingstoestel`, `Verbruiker`, `Vrije tekst`, `Warmtepomp/airco`, `Wasmachine`, `Zekering/differentieel`, `Zonnepaneel`, `Aansluitpunt`, `Aftakdoos`, `Zeldzame symbolen`
- **Default props (resetProps):** `type="Kring"`, `nr=""`, `aantal_polen="2"`, `bescherming="automatisch"`, `amperage="20"`, `type_kabel="XVB Cca 3G2,5"`, `differentieel_delta_amperage="300"`, `tekst=""`, `kabel_locatie="N/A"`, `type_differentieel=""`, `curve_automaat=""`, `kabel_is_in_buis=false`, `differentieel_is_selectief=false`, `kortsluitvermogen=""`, `huishoudelijk=true`, `fase=''`, `normaalGesloten=false`, `sturing=""`, `adres=""`, `newPage=false`, `kabel_is_aanwezig=true`, `naam=""`, `bescherming="automatisch"`, `naam="---"`, `kabel_is_aanwezig=true`, `bescherming="geen"`, `naam=""`, `kabel_is_aanwezig=false`, `type_kabel=""`, `naam=""`, `kabel_is_aanwezig=true`, `bescherming="geen"`, `naam=""`, `kabel_is_aanwezig=true`, `bescherming="automatisch"`, `naam=""`, `kabel_is_aanwezig=true`

### Leiding

- **File:** `src/List_Item/Leiding.ts`
- **Base:** `Electro_Item`
- **Type string:** `Leiding`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Leiding"`, `type_kabel="XVB Cca 3G2,5"`, `kabel_locatie="N/A"`, `kabel_is_in_buis=false`, `adres=""`

### Lichtcircuit

- **File:** `src/List_Item/Schakelaars/Lichtcircuit.ts`
- **Base:** `Schakelaars`
- **Type string:** `Lichtcircuit`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Lichtcircuit"`, `aantal_lichtpunten="1"`

### Lichtpunt

- **File:** `src/List_Item/Lichtpunt.ts`
- **Base:** `Electro_Item`
- **Type string:** `Lichtpunt`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Lichtpunt"`, `aantal="1"`, `aantal_buizen_indien_TL="1"`, `adres=""`, `type_lamp="standaard"`, `type_noodverlichting="Geen"`, `is_wandlamp=false`, `is_halfwaterdicht=false`, `heeft_ingebouwde_schakelaar=false`

### Media

- **File:** `src/List_Item/Media.ts`
- **Base:** `Electro_Item`
- **Type string:** `Media`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Media"`, `adres=""`, `aantal=1`, `symbool=""`

### Meerdere_verbruikers

- **File:** `src/List_Item/Meerdere_verbruikers.ts`
- **Base:** `Electro_Item`
- **Type string:** `Meerdere verbruikers`
- **Max children:** `256`
- **Allowed children:** `Domotica`, `Domotica gestuurde verbruiker`, `Splitsing`, `Batterij`, `Bel`, `Boiler`, `Contactdoos`, `Diepvriezer`, `Droogkast`, `Drukknop`, `Elektriciteitsmeter`, `Elektrische oven`, `EV lader`, `Ketel`, `Koelkast`, `Kookfornuis`, `Lichtcircuit`, `Lichtpunt`, `Omvormer`, `Overspanningsbeveiliging`, `Media`, `Microgolfoven`, `Motor`, `Schakelaars`, `Stoomoven`, `Transformator`, `USB lader`, `Vaatwasmachine`, `Ventilator`, `Verlenging`, `Verwarmingstoestel`, `Verbruiker`, `Vrije tekst`, `Warmtepomp/airco`, `Wasmachine`, `Zekering/differentieel`, `Zonnepaneel`, `Aansluitpunt`, `Aftakdoos`, `Zeldzame symbolen`
- **Default props (resetProps):** `type="Meerdere verbruikers"`, `adres=""`

### Microgolfoven

- **File:** `src/List_Item/Microgolfoven.ts`
- **Base:** `Electro_Item`
- **Type string:** `Microgolfoven`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Microgolfoven"`, `adres=""`

### Motor

- **File:** `src/List_Item/Motor.ts`
- **Base:** `Electro_Item`
- **Type string:** `Motor`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Motor"`, `adres=""`

### Omvormer

- **File:** `src/List_Item/Omvormer.ts`
- **Base:** `Electro_Item`
- **Type string:** `Omvormer`
- **Max children:** `256`
- **Allowed children:** `Aansluiting`, `Domotica`, `Domotica module (verticaal)`, `Domotica gestuurde verbruiker`, `Leiding`, `Meerdere verbruikers`, `Splitsing`, `Batterij`, `Bel`, `Boiler`, `Contactdoos`, `Diepvriezer`, `Droogkast`, `Drukknop`, `Elektriciteitsmeter`, `Elektrische oven`, `EV lader`, `Ketel`, `Koelkast`, `Kookfornuis`, `Lichtcircuit`, `Lichtpunt`, `Media`, `Microgolfoven`, `Motor`, `Omvormer`, `Overspanningsbeveiliging`, `Schakelaars`, `Stoomoven`, `Transformator`, `USB lader`, `Vaatwasmachine`, `Ventilator`, `Verlenging`, `Verwarmingstoestel`, `Verbruiker`, `Vrije tekst`, `Warmtepomp/airco`, `Wasmachine`, `Zekering/differentieel`, `Zonnepaneel`, `Aansluitpunt`, `Aftakdoos`, `Zeldzame symbolen`
- **Default props (resetProps):** `type="Omvormer"`, `adres=""`, `inkring=false`, `micro=false`

### Overspanningsbeveiliging

- **File:** `src/List_Item/Overspanningsbeveiliging.ts`
- **Base:** `Electro_Item`
- **Type string:** `Overspanningsbeveiliging`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Overspanningsbeveiliging"`, `adres=""`

### Schakelaars

- **File:** `src/List_Item/Schakelaars/Schakelaars.ts`
- **Base:** `Electro_Item`
- **Type string:** `Schakelaars`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Schakelaars"`, `aantal_schakelaars="1"`, `type_schakelaar="enkelpolig"`, `adres=""`, `heeft_signalisatielampje=false`, `is_halfwaterdicht=false`, `heeft_verklikkerlampje=false`, `is_trekschakelaar=false`, `normaalGesloten=false`, `sturing=""`

### Splitsing

- **File:** `src/List_Item/Splitsing.ts`
- **Base:** `Electro_Item`
- **Type string:** `Splitsing`
- **Max children:** `256`
- **Allowed children:** `Kring`
- **Default props (resetProps):** `type="Splitsing"`, `adres=""`

### Stoomoven

- **File:** `src/List_Item/Stoomoven.ts`
- **Base:** `Electro_Item`
- **Type string:** `Stoomoven`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Stoomoven"`, `adres=""`

### Transformator

- **File:** `src/List_Item/Transformator.ts`
- **Base:** `Electro_Item`
- **Type string:** `Transformator`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Transformator"`, `voltage="230V/24V"`, `adres=""`

### USB_lader

- **File:** `src/List_Item/USB_lader.ts`
- **Base:** `Electro_Item`
- **Type string:** `USB lader`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="USB lader"`, `aantal="1"`, `adres=""`

### Vaatwasmachine

- **File:** `src/List_Item/Vaatwasmachine.ts`
- **Base:** `Electro_Item`
- **Type string:** `Vaatwasmachine`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Vaatwasmachine"`, `adres=""`

### Ventilator

- **File:** `src/List_Item/Ventilator.ts`
- **Base:** `Electro_Item`
- **Type string:** `Ventilator`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Ventilator"`, `adres=""`, `ventilatortype="ventilator"`

### Verbruiker

- **File:** `src/List_Item/Verbruiker.ts`
- **Base:** `Electro_Item`
- **Type string:** `Verbruiker`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Verbruiker"`, `tekst=""`, `horizontale_uitlijning="centreer"`, `heeft_automatische_breedte="automatisch"`, `breedte=""`, `is_vet=false`, `is_cursief=false`, `adres=""`

### Verlenging

- **File:** `src/List_Item/Verlenging.ts`
- **Base:** `Electro_Item`
- **Type string:** `Verlenging`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Verlenging"`, `breedte="40"`, `adres=""`

### Verwarmingstoestel

- **File:** `src/List_Item/Verwarmingstoestel.ts`
- **Base:** `Electro_Item`
- **Type string:** `Verwarmingstoestel`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Verwarmingstoestel"`, `heeft_accumulatie=false`, `heeft_ventilator=false`, `adres=""`

### Vrije_ruimte

- **File:** `src/List_Item/Vrije_ruimte.ts`
- **Base:** `Electro_Item`
- **Type string:** `Vrije ruimte`
- **Max children:** `0`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Vrije ruimte"`, `breedte=25`

### Vrije_tekst

- **File:** `src/List_Item/Vrije_tekst.ts`
- **Base:** `Electro_Item`
- **Type string:** `Vrije tekst`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Vrije tekst"`, `tekst=""`, `vrije_tekst_type="zonder kader"`, `horizontale_uitlijning="links"`, `heeft_automatische_breedte="automatisch"`, `breedte=""`, `is_vet=false`, `is_cursief=false`, `adres=""`

### Warmtepomp

- **File:** `src/List_Item/Warmtepomp.ts`
- **Base:** `Electro_Item`
- **Type string:** `Warmtepomp/airco`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Warmtepomp/airco"`, `aantal="1"`, `adres=""`, `warmtefunctie="Koelend"`

### Wasmachine

- **File:** `src/List_Item/Wasmachine.ts`
- **Base:** `Electro_Item`
- **Type string:** `Wasmachine`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Wasmachine"`, `adres=""`

### Zekering

- **File:** `src/List_Item/Zekering.ts`
- **Base:** `Electro_Item`
- **Type string:** `Zekering/differentieel`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Zekering/differentieel"`, `nr=""`, `aantal_polen="2"`, `bescherming="automatisch"`, `amperage="20"`, `differentieel_delta_amperage="300"`, `type_differentieel=""`, `curve_automaat=""`, `differentieel_is_selectief=false`, `kortsluitvermogen=""`, `huishoudelijk=true`, `fase=''`, `newPage=false`

### Zeldzame_symbolen

- **File:** `src/List_Item/Zeldzame_symbolen.ts`
- **Base:** `Electro_Item`
- **Type string:** `Zeldzame symbolen`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Zeldzame symbolen"`, `adres=""`, `symbool=""`

### Zonnepaneel

- **File:** `src/List_Item/Zonnepaneel.ts`
- **Base:** `Electro_Item`
- **Type string:** `Zonnepaneel`
- **Max children:** `(inherited)`
- **Allowed children:** inherited from `Electro_Item` (the large base list)
- **Default props (resetProps):** `type="Zonnepaneel"`, `aantal="1"`, `adres=""`, `symbool="driehoek"`

## Property conventions

Common properties across most types (`resetProps()` in `List_Item` / `Electro_Item` and the concrete classes):

| Property | Type | Meaning |
| --- | --- | --- |
| `type` | string | One of the 49 type strings; required |
| `nr` | string | Displayed number; usually only meaningful under `Kring` / `Domotica module (verticaal)` |
| `autonr` | `"auto"` \| `"manueel"` | Auto-numbering mode |
| `autoKringNaam` | `"auto"` \| `"manueel"` | Circuit-name auto-numbering mode |
| `adres` | string | Free text / address; `\n` or `|` separated |
| `adres_uitlijning` | `"links"` \| `"centreer"` \| `"rechts"` | Address alignment |
| `newPage` | boolean | Page break before this root item |
| `isAttribuut` | boolean | External-control attribute; not a normal child |
| `tekst` | string | Free text for `Domotica` and similar |
| `kabel_is_aanwezig` | boolean | Whether a cable is drawn/required (`Kring`, `Aansluiting`) |
| `kabel_locatie` | string | Cable location (`N/A`, `Luchtleiding`, ...) |
| `kabel_is_in_buis` | boolean | Cable in conduit |
| `type_kabel` | string | Cable specification |
| `bescherming` | string | Protection type (`automatisch`, `differentieel`, `differentieelautomaat`, `smelt`, `geen`, `contact`, `zekeringscheider`, `relais`, `schemer`, `overspanningsbeveiliging`) |
| `aantal_polen` | string | Number of poles (`1`, `2`, `3`, `4`, `-`, `""`) |
| `amperage` | string | Rating in amps |
| `differentieel_delta_amperage` | string | RCD trip current in mA |
| `differentieel_is_selectief` | boolean | Selective RCD |
| `type_differentieel` | string | RCD type |
| `curve_automaat` | string | Breaker curve (`B`, `C`, `D`, `U`, ...) |
| `kortsluitvermogen` | string | Short-circuit rating |
| `fase` | string | Phase label |
| `normaalGesloten` | boolean | Normally closed contact |
| `sturing` | string | Control type (`spoel`, ...) |
| `huishoudelijk` | boolean | Domestic installation flag |

Some types add their own props; see the generated catalog above. Examples: `Contactdoos` has `is_geaard`, `is_kinderveilig`, `aantal`, `aantal_fases_indien_meerfasig`, `is_meerfasig`, `heeft_nul_indien_meerfasig`, `in_verdeelbord`; `Schakelaars` has `aantal_schakelaars`, `type_schakelaar`, `heeft_signalisatielampje`, `is_halfwaterdicht`, `heeft_verklikkerslampje`, `is_trekschakelaar`; `Zekering` has `bescherming`, `aantal_polen`, `amperage`, `differentieel_*`, `kortsluitvermogen`, `fase`.

## Validation today

There is no central validator. The closest things are:

- `overrideKeys()` normalisation per class (e.g. `Kring`, `Aansluiting`, `Zekering`, `Schakelaars`, `Contactdoos`). It clamps enum values, maps legacy values, clears dependent props, and enforces invariants such as "normally closed only for contact/zekeringscheider".
- `reSort()` for ordering and inactive removal.
- `voegAttributenToeAlsNodigEnReSort()` for external-control attributes.
- UI warnings in `Hierarchical_List.toHTML` (visual only).
- `getMaxNumChilds` / `allowedChilds` for tree shape; `insertChildAfterId` enforces the max but calls `alert()`.

A server-side validator should:

1. Decode and parse the document; if the version is old, run the same upgrade path.
2. Check the envelope (`length`, `data`, `active`, `id`, `curid`).
3. Check unique IDs, `curid > max(id)`, parent references, pre-order, active flags.
4. Check every `props.type` against the catalog.
5. Check `allowedChilds` and `getMaxNumChilds` (excluding attributes).
6. Run `overrideKeys()`-equivalent normalisation or reject invalid enum values, depending on the tool.
7. Check required properties per type (the generated defaults are a starting point).
8. Check numbering rules (`autonr`, `nr`, `autoKringNaam`) and `newPage` placement.
9. Return grouped, path-addressed errors (`items[12].props.type`, etc.).

## What belongs in an MCP resource vs a tool schema

- **Resource:** the item catalog itself (type, label, description, allowed parents/children, default props, property enums). Agents need this to choose types and values without guessing. Serve it as `eds://catalog` or similar, generated from the same source as the validator.
- **Resource:** a small set of worked examples (`eds://examples/minimal`, `eds://examples/garage`) that agents can read before authoring.
- **Tool schema:** only the fields for the operation at hand (`type`, `parent`, `props` patch). Do not inline the whole catalog into every tool description; it will dominate the context.
- **Prompt:** authoring guidance ("start at the root with Aansluiting; add a Bord; add Kringen; ..."), with the catalog as a resource link.

## Gaps / ambiguities

- The generated defaults are not a formal schema. Some props are only set conditionally (e.g. `Kring.naam` and `kabel_is_aanwezig` depend on the parent), and some are normalised in `overrideKeys()`.
- `getMaxNumChilds()` is context-dependent and calls `getParent()`, so validation must run against the full tree, not an isolated item.
- The `Container` type is a UI grouping concept and is skipped in rendering (`src/Hierarchical_List.ts:1508`); decide whether MCP exposes it.
- `Vrije ruimte` has `getMaxNumChilds() === 0` but no `allowedChilds` override; it is a layout spacer.
- `Zeldzame symbolen` is a catch-all type; its props and rendering need a separate pass.
- The `SituationPlan` element model is separate from the one-line item model; the catalog above covers only the one-line tree.

## Recommendation

Generate the catalog at build time from the TypeScript classes (or keep a hand-checked JSON alongside them) and ship it as an MCP resource. Use the same catalog to drive tool input enums and the structural validator. Keep the raw `.eds` JSON as the canonical wire format; do not invent a second schema that can drift.
