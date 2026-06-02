# Architecture Diagrams

All architecture diagrams are editable draw.io files and use the official [SAP BTP Solution Diagrams](https://sap.github.io/btp-solution-diagrams/) icon set (Apache-2.0). The draw.io sources are the authoritative version; PNG and SVG exports are generated from draw.io on demand.

## Inventory

The eight diagrams are grouped into two sets:

### Core deliverables (required for the requirements presentation)

These four diagrams correspond directly to the four required deliverables in [../architecture.md](../architecture.md).

| # | File | Maps to | Contents |
|---|---|---|---|
| 1 | [technical-data-model.drawio](technical-data-model.drawio) | Technical Data Model | Physical schema as deployed to HANA Cloud: 12 tables (incl. serialised Product Items and DPP Marketing Links) with columns, data types and constraints |
| 2 | [software-architecture.drawio](software-architecture.drawio) | Software Architecture | Component view: client → BTP platform → OData and REST → business logic → libraries → database |
| 3 | [erd.drawio](erd.drawio) | Semantic Model (Entity Relationship) | 12 entities with attributes and foreign key relations (crow's-foot notation), incl. Product Item with its 1:1 item-level DPP and DPP Marketing Links |
| 4 | [btp-architecture.drawio](btp-architecture.drawio) | BTP Architecture | Deployment topology on SAP BTP: subaccount, Cloud Foundry, MTA modules, authorization service, HANA database, runtime secrets |

### Supplementary diagrams (appendix)

These four diagrams support [../appendix.md](../appendix.md). They are useful for sprint demos, internal documentation and operational handover, but are not part of the four required deliverables.

| # | File | Maps to | Contents |
|---|---|---|---|
| 5 | [solution-context.drawio](solution-context.drawio) | Appendix A — Solution Context | High-level context: actors → SAP BTP system → external and future systems |
| 6 | [deployment-topology.drawio](deployment-topology.drawio) | Appendix B — Deployment Topology | Build pipeline, three deployment modules and three resources, bindings and public route |
| 7 | [dpp-lifecycle.drawio](dpp-lifecycle.drawio) | Appendix C — Product Passport Lifecycle | Status transitions: Draft → In Review → Approved → Published → Archived |
| 8 | [sprint1-demo-sequence.drawio](sprint1-demo-sequence.drawio) | Appendix D — Sprint-1 Demo Sequence | End-to-end Sprint-1 demo workflow (master data → lifecycle → consumer scan) |

The Mermaid sources (`.mmd` files) are kept as a text-only reference for diff-friendly reviews. For the **architecture** diagrams (software-architecture, btp-architecture, solution-context, deployment-topology, sprint1-demo-sequence) the `.drawio` file remains authoritative. For the three **data-model** diagrams (`technical-data-model`, `erd`, `dpp-lifecycle`) the `.png`/`.svg` exports are regenerated directly from the `.mmd` source with `mermaid-cli` — see [Regenerating the data-model diagrams](#regenerating-the-data-model-diagrams).

## Regenerating the data-model diagrams

The data-model diagrams are rendered from their `.mmd` source to a high-resolution PNG (4× scale) and a vector SVG (the SVG is resolution-independent and the sharpest option for embedding):

```bash
# one-off: install the renderer (pulls puppeteer + chromium)
npm i -g @mermaid-js/mermaid-cli

# from docs/diagrams/
for n in technical-data-model erd dpp-lifecycle; do
  mmdc -i "$n.mmd" -o "$n.svg" -b white          # vector, max quality
  mmdc -i "$n.mmd" -o "$n.png" -b white -s 4      # 4× high-resolution raster
done
```

Edit the `.mmd`, rerun the commands, and commit the `.mmd`, `.png` and `.svg` together.

## Editing in the user interface

Three options, all of which load the official SAP BTP icons directly from the public icon repository — no local installation needed:

### Option A — draw.io in the browser (recommended, zero installation)

1. Open <https://app.diagrams.net>
2. Choose *File → Open from… → Device*
3. Pick the desired `.drawio` file
4. Edit, then *File → Save* (overwrites the local file)

### Option B — draw.io extension for VS Code

1. Install the extension [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) (`hediet.vscode-drawio`)
2. Open the `.drawio` file directly in the editor
3. Edit visually with all stencils available

### Option C — draw.io Desktop

1. Installer: <https://github.com/jgraph/drawio-desktop/releases>
2. Open the `.drawio` file with a double click

### Loading the full BTP stencil library

To make every BTP service icon available for drag-and-drop:

1. In draw.io: *Extras → Edit Diagram → Edit Shape Library*
2. *Add by URL* — load one of the following libraries:

| Library | URL |
|---|---|
| All BTP service icons | `https://raw.githubusercontent.com/SAP/btp-solution-diagrams/main/assets/shape-libraries-and-editable-presets/draw.io/20-02-99-sap-btp-service-icons-all/` |
| Generic icons (users, devices, personas) | `https://raw.githubusercontent.com/SAP/btp-solution-diagrams/main/assets/shape-libraries-and-editable-presets/draw.io/20-03-generic-icons/sap-generic-icons-size-M-200302.xml` |

A selection of icons already referenced in the diagrams (loaded directly via URL — no local cache required):

| BTP service | SVG file |
|---|---|
| Cloud Foundry Runtime | `10017-sap-btp_cloud-foundry-runtime_sd.svg` |
| HANA Cloud | `20083-sap-hana-cloud_sd.svg` |
| Authorization and Trust Management | `31015-sap-authorization-and-trust-management-service_sd.svg` |
| Destination Service | `20080-sap-destination-service_sd.svg` |
| Document Management Service | `31027-sap-document-management-service_sd.svg` |
| Alert Notification Service | `31060-sap-alert-notification-service-for-sap-btp_sd.svg` |
| Application Logging Service | `20062-sap-application-logging-service-for-sap-btp_sd.svg` |

The Application Router has no dedicated icon (it is a Cloud Foundry sub-component) and is drawn as a mint-coloured rectangle. The Runtime Secrets (user-provided service) likewise has no official icon and is drawn as a purple rectangle with a padlock symbol.

## Exporting to PNG, SVG or PDF

From draw.io: *File → Export as → SVG / PNG / PDF*

Recommended convention for images embedded in the markdown documents:

- Format: **PNG** (width 1400 pixels or more, white background, border 10)
- Filename: `<basename>.png` (same stem as the `.drawio` file)
- Commit to the repository: yes — the markdown documents link to them

## Update workflow

1. Open the `.drawio` file in any of the three editors and edit
2. Save (overwrites the `.drawio` file)
3. *File → Export as PNG* (options: border 10, white background)
4. Save the export next to the `.drawio` file as `<basename>.png`
5. If the content is referenced in [../architecture.md](../architecture.md) or [../appendix.md](../appendix.md), keep the text in sync
6. Commit both files together: `<basename>.drawio` and `<basename>.png`

## File naming convention

- `.drawio` — authoritative editable source (XML text, version-friendly)
- `.png` — render output for embedding in markdown and PDF (regenerate when the diagram changes)
- `.svg` — optional render output for high-resolution display
- `.mmd` — legacy Mermaid sources (read-only reference)
- `icons-cache/` — locally mirrored BTP icons for offline use (optional — the `.drawio` files reference the icons via URL)
