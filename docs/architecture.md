# DPP Capgemini — Architecture Documentation

This document covers the four core architecture deliverables for the requirements presentation, ordered top-down from platform to schema:

1. [BTP Architecture](#1-btp-architecture) — deployment on SAP Business Technology Platform
2. [Software Architecture](#2-software-architecture) — OData services, business logic, libraries, UI
3. [Semantic Model](#3-semantic-model-entity-relationship) — conceptual entity relationships
4. [Technical Data Model](#4-technical-data-model) — physical schema as deployed

Supplementary material (solution context, deployment topology, passport lifecycle, demo sequence, access control) lives in [appendix.md](appendix.md). Diagram sources are in [docs/diagrams/](diagrams/) as editable draw.io files using the official [SAP BTP Solution Diagrams](https://sap.github.io/btp-solution-diagrams/) icon set (Apache-2.0).

---

## 1. BTP Architecture

Deployment topology on SAP Business Technology Platform — subaccount, Cloud Foundry org and space, MTA modules and resources, bindings. Uses the official BTP solution diagram icon set.

![BTP Architecture](diagrams/btp-architecture.png)

Editable source: [diagrams/btp-architecture.drawio](diagrams/btp-architecture.drawio)

### 1.1 Platform services in use

| Service | Role | Status |
|---|---|---|
| **SAP HANA Cloud** | Stores the 10 schema tables in an isolated database container | In use |
| **Cloud Foundry Runtime** | Hosts the backend service application | In use |
| **Authorization and Trust Management (XSUAA)** | Issues and verifies authentication tokens. Single application scope; role and tenant resolved inside the application from the user table. | In use |
| **Application Router** | Terminates the user session and serves the static UI | In use |
| **Runtime Secrets** (user-provided service) | Holds the signing key for QR tokens and the public base URL | One-time setup per space |
| Destination Service | Future ERP integration | Out of scope for the MVP |
| Document Management Service | Future compliance attachments | Sprint 2+ |
| Alert Notification | Future operations monitoring | Sprint 2+ |
| Application Logging | Future centralised logs | Sprint 2+ |

### 1.2 Subaccount coordinates

| Parameter | Description |
|---|---|
| Subaccount | Dedicated subaccount in region eu10-004 |
| Cloud Foundry Org | Provisioned by the platform team |
| Cloud Foundry Space | Dev (current) — staging and production planned |
| Public route | Application router URL on the SAP Cloud domain — the same URL is written into every QR code so consumer scans resolve correctly |

### 1.3 Why the application enforces access control instead of the platform

The development tenant blocks the assignment of role collections in the platform cockpit, and the framework hook variants we tried failed to inject database-resolved roles into the request context in time for the declarative authorisation to evaluate. Rather than fight the timing, the entire access-control layer was moved into the service handlers. The platform exposes a single application scope; everything beyond that is resolved from the user table at request time.

The detailed access-control specification is in [appendix.md](appendix.md).

---

## 2. Software Architecture

Layers: client → BTP platform → API layer (authenticated OData and public REST) → business logic → supporting libraries → database. The platform also surfaces a Swagger UI and a health check endpoint.

![Software Architecture](diagrams/software-architecture.png)

Editable source: [diagrams/software-architecture.drawio](diagrams/software-architecture.drawio)

### 2.1 Component overview

**Client layer**

- A SAPUI5 or Fiori Elements UI is planned for Sprint 2+; the current MVP exposes the backend directly via OData
- Consumers reach the system from a mobile browser via QR scan
- Market surveillance authorities use any HTTP client and the same public token URL as consumers

**BTP platform layer**

- Application Router handles single sign-on and serves the static UI
- Authorization and Trust Service (XSUAA) issues and verifies tokens
- Runtime Secrets are stored in a user-provided service and injected at boot

**API layer**

- Authenticated OData V4 service exposing 10 entity projections, 4 lifecycle actions and 1 QR-image function on the passport
- Public REST endpoints for the consumer view, the QR image and the health check
- A role and tenant resolver looks up the caller in the user table and applies tenant scope before any handler runs

**Business logic layer**

- Product logic — applies defaults, runs the bill-of-materials cycle check (Variant→Component, transitive), archives products
- Passport lifecycle logic — approves, publishes, archives passports; rotates QR codes; optionally caches aggregated snapshots
- Public view logic — verifies the signed QR token, recursively traverses the DPP hierarchy and assembles the consumer payload with a live field aggregation
- Identity logic — returns the caller's identity to the UI

**Supporting libraries**

- Signed token library (creates and verifies the QR token)
- Secret loader (injects runtime secrets into the backend)
- Aggregator library (`srv/lib/aggregator.js`) — plug-in registry for hierarchical DPP aggregation (weighted sum, weighted average, string union, fibre rollup)

**Database**

- SAP HANA Cloud, single isolated database container, 10 schema tables

### 2.2 Endpoint inventory

| Path | Verb | What it does | Who can call it |
|---|---|---|---|
| `/odata/v4/dpp` | GET / POST / PATCH / DELETE | Read or write any of the 10 schema entities | Authenticated users (tenant-scoped) |
| `/odata/v4/dpp/DPPs(id)/DPPService.approveDPP` | POST | Move the passport from Draft to Approved | Advanced company user |
| `/odata/v4/dpp/DPPs(id)/DPPService.publishDPP` | POST | Publish the passport, build a snapshot and rotate the QR code | Advanced company user |
| `/odata/v4/dpp/DPPs(id)/DPPService.archiveDPP` | POST | Soft-delete the passport | Advanced company user |
| `/odata/v4/dpp/DPPs(id)/DPPService.regenerateQRToken` | POST | Create a new signed QR token (old one is invalidated) | Advanced company user |
| `/odata/v4/dpp/DPPs(id)/DPPService.generateQRCode` | GET | Generate the QR code as an inline image | Advanced company user |
| `/odata/v4/dpp/me` | GET | Return the caller's identity, role and organisation | Any authenticated user |
| `/public/dpp/:token` | GET | Public consumer view of a published passport | Public (no login) |
| `/public/dpp/:token/qr.png` | GET | Printable QR image for a published passport | Public (no login) |
| `/healthz` | GET | Liveness probe | Public (no login) |
| `/$api-docs/odata/v4/dpp` | GET | Swagger UI for the OData service | Public (no login) |

---

## 3. Semantic Model (Entity Relationship)

The conceptual data model — 10 entities with their attributes and foreign key relationships, drawn in crow's-foot notation. The semantic view omits foreign-key columns, audit timestamps and operational marker fields; the full schema detail is in section 4.

![Entity Relationship Diagram](diagrams/erd.png)

Editable source: [diagrams/erd.mmd](diagrams/erd.mmd)

### 3.1 Cardinalities

| Relationship | Cardinality | Notes |
|---|---|---|
| Organisation → Users | one to many | tenant-scoped |
| Organisation → Products | one to many | tenant-scoped |
| Organisation → Business Partners | one to many | tenant-scoped |
| Business Partner → Business Partner Roles | one to many | a partner can hold several roles |
| Product → Product Variants | one to many | colour / size / SKU |
| Product Variant → Batches | one to many | production runs |
| Product Variant → Bill of Materials (as parent) | one to many | BOM anchored at variant |
| Bill of Materials → Product (as component) | many to one | component is itself a Product |
| Bill of Materials → Product Passport (internal sub-DPP) | many to optional one | mutually informative with external link |
| Product → Product Passport | one to many | DPP describes a finished-product view |
| Batch → Product Passport | one to many (optional) | optional narrowing of the DPP to a concrete batch |
| Product Passport → QR Codes | one active plus history | rotation keeps a single active row |

### 3.2 Traceability chain

The semantic core is the traceability chain from a published finished-product DPP back through the supply chain via the BOM hierarchy:

```
Organisation
   owns → Product → has variants → Batch
                            └── Bill of Materials ─► component Product
                                          ├─ sub_dpp ─► upstream Product Passport (internal)
                                          └─ external_dpp_url ─► supplier-hosted passport

Product → Product Passport → QR Code history
Batch  → Product Passport (optional narrowing)
```

A scanned QR code resolves to a finished-product DPP. From there the consumer view recursively walks the BOM hierarchy: each component is either inlined, linked to an internal sub-DPP (further traversed) or pointed at an external supplier-DPP URL. CO₂, recycled-content, substances of concern and fibre composition are aggregated over the entire reachable hierarchy on every public read.

### 3.3 Key invariants

- Organisations own users, business partners and products by tenant
- A passport describes a finished product from its producer's view; an optional `batch` link narrows it further
- Only one QR code is active per passport at any time; older ones are kept as history
- A BOM line has a parent Variant and a component Product. The component may live in a different organisation (cross-tenant supplier reference) and may carry its own passport
- Aggregated fields (CO₂, recycled content, substances of concern, fibre composition) are not stored on the parent DPP; they are computed live from the hierarchy on each public read

---

## 4. Technical Data Model

The physical schema as deployed to SAP HANA Cloud — 10 tables with columns, data types and constraints.

![Technical Data Model](diagrams/technical-data-model.png)

Editable source: [diagrams/technical-data-model.mmd](diagrams/technical-data-model.mmd)

Schema tables in detail follow in sections 4.1 to 4.4. For per-field business semantics see [technical_documentation.md](technical_documentation.md).

### 4.1 Organisation layer

#### Organizations
| Column | Type | Database type | Constraints |
|---|---|---|---|
| ID | String (36) | NVARCHAR(36) | Primary key |
| legal_name | String (120) | NVARCHAR(120) | Required |
| trade_name | String (120) | NVARCHAR(120) | |
| country_iso2 | String (2) | NVARCHAR(2) | |
| city | String (80) | NVARCHAR(80) | |
| gln | String (13) | NVARCHAR(13) | Global Location Number |
| website_url | String (500) | NVARCHAR(500) | |
| contact_email | String (254) | NVARCHAR(254) | |
| tenant_id | String (64) | NVARCHAR(64) | Required, unique |
| is_platform_tenant | Boolean | BOOLEAN | Defaults to false |

#### Users
| Column | Type | Database type | Constraints |
|---|---|---|---|
| ID | String (36) | NVARCHAR(36) | Primary key |
| email | String (254) | NVARCHAR(254) | Required, unique per organisation |
| display_name | String (120) | NVARCHAR(120) | |
| organization_ID | String (36) | NVARCHAR(36) | Required, foreign key to Organizations |
| role | String (20) | NVARCHAR(20) | Required, enum of advanced or standard company user |
| external_user_id | String (120) | NVARCHAR(120) | Identity provider mapping |
| active | Boolean | BOOLEAN | Defaults to true |

#### Business Partners
| Column | Type | Database type | Constraints |
|---|---|---|---|
| ID | String (36) | NVARCHAR(36) | Primary key |
| owning_organization_ID | String (36) | NVARCHAR(36) | Required, foreign key |
| name | String (120) | NVARCHAR(120) | Required |
| country_iso2 | String (2) | NVARCHAR(2) | |
| city | String (80) | NVARCHAR(80) | |
| address | String (200) | NVARCHAR(200) | |
| contact_person | String (120) | NVARCHAR(120) | |
| contact_email | String (254) | NVARCHAR(254) | |
| identifier | String (40) | NVARCHAR(40) | GLN, VAT or DUNS |
| archived | Boolean | BOOLEAN | Defaults to false |

#### Business Partner Roles
| Column | Type | Database type | Constraints |
|---|---|---|---|
| ID | String (36) | NVARCHAR(36) | Primary key |
| partner_ID | String (36) | NVARCHAR(36) | Required, foreign key |
| role | String (24) | NVARCHAR(24) | Required, enum |

Constraint: unique on partner_ID and role together.

### 4.2 Product layer

#### Products
| Column | Type | Database type | Constraints |
|---|---|---|---|
| ID | String (36) | NVARCHAR(36) | Primary key |
| owning_organization_ID | String (36) | NVARCHAR(36) | Required, foreign key |
| product_type | String (12) | NVARCHAR(12) | Required, defaults to finished good |
| name | String (120) | NVARCHAR(120) | Required |
| brand | String (120) | NVARCHAR(120) | |
| category | String (60) | NVARCHAR(60) | |
| model | String (120) | NVARCHAR(120) | |
| description | String (500) | NVARCHAR(500) | |
| gtin | String (14) | NVARCHAR(14) | Global Trade Item Number, unique per organisation |
| fibre_composition | String (500) | NVARCHAR(500) | |
| care_instructions | String (500) | NVARCHAR(500) | |
| repair_instructions | String (500) | NVARCHAR(500) | |
| disposal_instructions | String (500) | NVARCHAR(500) | |
| country_of_origin | String (2) | NVARCHAR(2) | |
| substances_of_concern | String (500) | NVARCHAR(500) | REACH or SCIP text |
| espr_compliance | String (16) | NVARCHAR(16) | Enum |
| status | String (12) | NVARCHAR(12) | Defaults to draft |

#### Product Variants
| Column | Type | Database type | Constraints |
|---|---|---|---|
| ID | String (36) | NVARCHAR(36) | Primary key |
| product_ID | String (36) | NVARCHAR(36) | Required, foreign key |
| color | String (40) | NVARCHAR(40) | |
| size | String (20) | NVARCHAR(20) | |
| sku | String (40) | NVARCHAR(40) | Stock Keeping Unit, unique per product |
| gtin | String (14) | NVARCHAR(14) | |
| weight_g | Integer | INTEGER | |
| status | String (10) | NVARCHAR(10) | Defaults to active |

#### Batches
| Column | Type | Database type | Constraints |
|---|---|---|---|
| ID | String (36) | NVARCHAR(36) | Primary key |
| variant_ID | String (36) | NVARCHAR(36) | Required, foreign key |
| batch_number | String (40) | NVARCHAR(40) | Unique per variant |
| production_date | Date | DATE | |
| factory_ID | String (36) | NVARCHAR(36) | Foreign key to Business Partners |
| supplier_ID | String (36) | NVARCHAR(36) | Foreign key to Business Partners |
| country_of_origin | String (2) | NVARCHAR(2) | |
| production_stage | String (60) | NVARCHAR(60) | |
| co2_footprint_kg | Decimal (10, 3) | DECIMAL(10, 3) | |
| recycled_content_pct | Decimal (5, 2) | DECIMAL(5, 2) | |
| status | String (12) | NVARCHAR(12) | Defaults to draft |

#### Product BOMs
| Column | Type | Database type | Constraints |
|---|---|---|---|
| ID | String (36) | NVARCHAR(36) | Primary key |
| parent_ID | String (36) | NVARCHAR(36) | Required, foreign key to Product Variants |
| component_ID | String (36) | NVARCHAR(36) | Required, foreign key to Products |
| quantity | Decimal (10, 3) | DECIMAL(10, 3) | |
| unit | String (8) | NVARCHAR(8) | Percent, kg, m or pieces |
| component_role | String (60) | NVARCHAR(60) | |
| is_mandatory | Boolean | BOOLEAN | Defaults to true |
| sub_dpp_ID | String (36) | NVARCHAR(36) | Foreign key to DPPs, optional — internal sub-passport |
| external_dpp_url | String (500) | NVARCHAR(500) | External supplier-hosted DPP link, optional |
| status | String (12) | NVARCHAR(12) | Defaults to active |

Constraint: unique on parent_ID and component_ID together — prevents duplicate BOM edges. Self-loops (`parent.product == component`) and transitive cycles are rejected by the handler.

### 4.3 Product Passport layer

#### DPPs
| Column | Type | Database type | Constraints |
|---|---|---|---|
| ID | String (36) | NVARCHAR(36) | Primary key |
| product_ID | String (36) | NVARCHAR(36) | Required, foreign key — finished product the DPP describes |
| batch_ID | String (36) | NVARCHAR(36) | Optional foreign key — narrows the DPP to a specific batch |
| dpp_type | String (12) | NVARCHAR(12) | Defaults to product |
| status | String (12) | NVARCHAR(12) | Defaults to draft |
| visibility | String (8) | NVARCHAR(8) | Defaults to internal |
| current_version | Integer | INTEGER | Defaults to 1 |
| qr_token | String (128) | NVARCHAR(128) | Unique, signed |
| qr_payload_url | String (500) | NVARCHAR(500) | |
| public_url | String (500) | NVARCHAR(500) | |
| approved_at | Timestamp | TIMESTAMP | |
| published_at | Timestamp | TIMESTAMP | |
| archived_at | Timestamp | TIMESTAMP | |
| valid_from | Date | DATE | |
| last_updated | Timestamp | TIMESTAMP | |
| aggregated_snapshot | Large string | NCLOB | Optional cache; the public read computes the hierarchical aggregation live |
| storytelling | Large string | NCLOB | JSON array |

#### QR Codes
| Column | Type | Database type | Constraints |
|---|---|---|---|
| ID | String (36) | NVARCHAR(36) | Primary key |
| dpp_ID | String (36) | NVARCHAR(36) | Required, foreign key |
| qr_value | String (500) | NVARCHAR(500) | Encoded URL |
| qr_image_url | String (500) | NVARCHAR(500) | |
| status | String (10) | NVARCHAR(10) | Defaults to active |
| created_at | Timestamp | TIMESTAMP | |
| replaced_at | Timestamp | TIMESTAMP | |

### 4.4 Type mapping reference

For documentation templates that require an ABAP equivalent:

| Modelling type | HANA SQL | ABAP equivalent | Notes |
|---|---|---|---|
| String of length n | NVARCHAR(n) | CHAR(n) or SSTRING | UTF-16 in HANA |
| Large string | NCLOB | STRING | Up to 2 GB |
| Boolean | BOOLEAN | BOOLE_D or ABAP_BOOL | |
| Integer | INTEGER | INT4 | 32-bit signed |
| Long integer | BIGINT | INT8 | 64-bit signed |
| Decimal of precision p and scale s | DECIMAL(p, s) | DEC(p, s) | |
| Date | DATE | DATS | YYYYMMDD |
| Time | TIME | TIMS | HHMMSS |
| Timestamp | TIMESTAMP | TIMESTAMPL | 100 ns precision |
| Unique identifier | NVARCHAR(36) | SYSUUID_C32 or SYSUUID_X16 | |

---

## References

- Field catalogue: [Fashion_DPP_Object_Field_Catalogue.xlsm](../../Fashion_DPP_Object_Field_Catalogue.xlsm)
- Requirements: [SS26_Capgemini_requirements_presentation.docx.pdf](../../SS26_Capgemini_requirements_presentation.docx.pdf)
- User stories: [Epics and user stories.pdf](../../Epics%20and%20user%20stories.pdf)
- BTP Solution Diagrams icon set: <https://sap.github.io/btp-solution-diagrams/>
- Diagram editing workflow: [diagrams/README.md](diagrams/README.md)
- Per-field business semantics and lifecycle details: [technical_documentation.md](technical_documentation.md)
- Supplementary material (solution context, deployment topology, lifecycle, demo sequence, access control): [appendix.md](appendix.md)
