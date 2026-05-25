# Architecture Diagrams

All diagrams are version-controlled source files (no PNG/SVG checked in by default — render on demand).

## Inventory

| File | Type | Rendered by | Description |
|---|---|---|---|
| [erd.mmd](erd.mmd) | Mermaid ERD | GitHub / VS Code / `mmdc` | All 11 entities with attributes + FK relationships |
| [software-architecture.mmd](software-architecture.mmd) | Mermaid Flowchart | GitHub / VS Code / `mmdc` | Component diagram: Client → BTP → Handlers → Libs → DB |
| [dpp-lifecycle.mmd](dpp-lifecycle.mmd) | Mermaid State | GitHub / VS Code / `mmdc` | DPP status transitions draft → in_review → approved → published → archived |
| [sprint1-demo-sequence.mmd](sprint1-demo-sequence.mmd) | Mermaid Sequence | GitHub / VS Code / `mmdc` | End-to-end Sprint-1 demo workflow |
| [btp-architecture.drawio](btp-architecture.drawio) | draw.io XML | diagrams.net / VS Code Draw.io Extension | BTP deployment topology |

## How to render

### Mermaid (`.mmd`)

**Inline (zero install):**
- **GitHub / GitLab** — render natively when embedded in `.md` via ```` ```mermaid ```` fences (already done in [../architecture.md](../architecture.md)).
- **VS Code** — install extension *Markdown Preview Mermaid Support* (`bierner.markdown-mermaid`), then `Ctrl+Shift+V` on the `.md` file.
- **JetBrains IDEs** — built-in since 2023.
- **Web** — paste source into <https://mermaid.live> for a live editor + PNG/SVG export.

**Batch-export to SVG/PNG via CLI:**
```bash
# No global install needed:
npx -p @mermaid-js/mermaid-cli mmdc -i docs/diagrams/erd.mmd -o docs/diagrams/erd.svg
npx -p @mermaid-js/mermaid-cli mmdc -i docs/diagrams/software-architecture.mmd -o docs/diagrams/software-architecture.svg
npx -p @mermaid-js/mermaid-cli mmdc -i docs/diagrams/dpp-lifecycle.mmd -o docs/diagrams/dpp-lifecycle.svg
npx -p @mermaid-js/mermaid-cli mmdc -i docs/diagrams/sprint1-demo-sequence.mmd -o docs/diagrams/sprint1-demo-sequence.svg
```

Output format follows the file extension (`.svg`, `.png`, `.pdf`).

### draw.io (`.drawio`)

**Open / edit:**
- **diagrams.net** (web) — <https://app.diagrams.net> → *File → Open from…* → pick the local file.
- **draw.io Desktop** — <https://github.com/jgraph/drawio-desktop/releases>
- **VS Code** — install extension *Draw.io Integration* (`hediet.vscode-drawio`), then open the `.drawio` file directly.

**Export to PNG/SVG/PDF:**
1. Open the file in any editor above
2. *File → Export as → SVG / PNG / PDF*

**Official SAP BTP icons (already embedded):**

The drawio file references the **official SAP BTP Solution Diagrams stencil set** by URL — when you open the file, the icons stream directly from <https://github.com/SAP/btp-solution-diagrams> (Apache-2.0 licensed):

| BTP service | Icon file |
|---|---|
| Cloud Foundry Runtime | `10017-sap-btp_cloud-foundry-runtime_sd.svg` |
| HANA Cloud | `20083-sap-hana-cloud_sd.svg` |
| Authorization & Trust (XSUAA) | `31015-sap-authorization-and-trust-management-service_sd.svg` |
| Destination Service (OOS) | `20080-sap-destination-service_sd.svg` |
| Document Management (OOS) | `31027-sap-document-management-service_sd.svg` |
| Alert Notification (OOS) | `31060-sap-alert-notification-service-for-sap-btp_sd.svg` |
| Application Logging (OOS) | `20062-sap-application-logging-service-for-sap-btp_sd.svg` |

To **edit the diagram with the full stencil library** (drag-and-drop new icons), load the official drawio library in diagrams.net:

1. *Extras → Edit Diagram → Edit Shape Library*
2. Add by URL — paste the raw URL of either:
   - `https://raw.githubusercontent.com/SAP/btp-solution-diagrams/main/assets/shape-libraries-and-editable-presets/draw.io/20-02-99-sap-btp-service-icons-all/` (all BTP service icons)
   - `https://raw.githubusercontent.com/SAP/btp-solution-diagrams/main/assets/shape-libraries-and-editable-presets/draw.io/20-03-generic-icons/sap-generic-icons-size-M-200302.xml` (generic users / devices / personas)

The Application Router has no dedicated icon in the SAP catalogue (it is a Cloud Foundry sub-component) and is rendered as a coloured rectangle following SAP brand colours.

## File naming convention

- `.mmd` — Mermaid source (text)
- `.drawio` — draw.io XML (text)
- `.svg` / `.png` — rendered exports (generated, gitignore by default)

## Updating diagrams

When the schema or architecture changes:

1. Update the matching `.mmd` / `.drawio` source file
2. The `architecture.md` master document embeds Mermaid sources verbatim — keep both in sync (or refactor to use file-includes via a build step)
3. Re-render exports if used outside of GitHub/VS Code
