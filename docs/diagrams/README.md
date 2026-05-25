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

**Swap rectangles for official SAP BTP icons:**
The current file uses styled rectangles with SAP-brand colours. To replace with the official SAP BTP icon set:
1. Open [https://sap.github.io/btp-solution-diagrams/](https://sap.github.io/btp-solution-diagrams/) and download the stencil library
2. In diagrams.net: *Extras → Edit Diagram → Edit Shape Library → Add new library from URL*
3. Right-click each box → *Edit Style* → replace the `rounded=1;...` block with `shape=mxgraph.sap_btp.<icon_name>`

## File naming convention

- `.mmd` — Mermaid source (text)
- `.drawio` — draw.io XML (text)
- `.svg` / `.png` — rendered exports (generated, gitignore by default)

## Updating diagrams

When the schema or architecture changes:

1. Update the matching `.mmd` / `.drawio` source file
2. The `architecture.md` master document embeds Mermaid sources verbatim — keep both in sync (or refactor to use file-includes via a build step)
3. Re-render exports if used outside of GitHub/VS Code
