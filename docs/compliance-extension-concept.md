# Konzept: ESPR-/Compliance-Erweiterung des DPP-Stacks

> **Status:** Entwurf · **Erstellt:** 2026-06-04 · **Scope:** Fashion-DPP
>
> **Rechtlicher Hinweis:** Dieses Dokument ist eine technische Konzeptskizze, **keine
> Rechtsberatung**. Der delegierte ESPR-Rechtsakt für Textilien ist noch nicht final;
> die konkreten Pflichtfelder werden sich ändern. Die verbindliche Bewertung des
> tatsächlich geforderten Umfangs muss mit der zuständigen Fachberatung/Compliance
> erfolgen.

## 1. Ziel und Ausgangslage

Der bestehende Stack (SAP CAP Backend `dpp_capgemini`, React Frontend `dpp_frontend`)
deckt die **Identifikations- und Lieferkettenstruktur** vollständig ab (Product →
Variant → Batch → Item → BOM → DPP → QR), ist aber auf der **rechtlich tragenden
Compliance-/Nachweis-Schicht** zu dünn. Dieses Konzept schließt genau diese Lücke —
**additiv**, ohne das vorhandene Fundament (Tenancy, RBAC, Lifecycle, QR, Approuter)
zu verändern.

Die hier ergänzten Objekte sind großteils bereits im
`Fashion_DPP_Object_Field_Catalogue.xlsm` definiert, aber noch nicht implementiert.

### Abzudeckende Lücken (priorisiert nach rechtlichem Gewicht)

| # | Lücke | Rechtlicher Treiber |
|---|---|---|
| 1 | Strukturierte Konformitätsnachweise (Zertifikate, Dokumente) | ESPR-Konformität, Belegpflicht |
| 2 | Strukturierte Stoffdaten statt Freitext | REACH / SCIP |
| 3 | Dreistufige Zugriffsrechte (Verbraucher / Behörde / intern) | ESPR-Zugriffsrechte |
| 4 | Umweltindikatoren als Metrik mit Methode (PEF) | ESPR-Umweltanforderungen |
| 5 | Persistente, unveränderliche DPP-Version (Snapshot + Hash) | Auditierbarkeit, Datenpersistenz |
| 6 | Konfigurierbare DPP-Granularität (Modell/Batch/Item) | Verhältnismäßigkeit |

## 2. Designprinzipien

1. **Additiv & rückwärtskompatibel.** Neue Entities, keine Umbenennung bestehender
   Felder. Bestehende Flachfelder (`Batches.co2_footprint_kg` etc.) bleiben zunächst
   erhalten und werden in Phase 3 migriert.
2. **Konventionstreu.** Alle neuen Entities nutzen die Aspekte `identified` und
   `audited` aus [db/common.cds](../db/common.cds) / [db/org.cds](../db/org.cds) und
   werden in `TENANT_ANCHORS` ([srv/dpp-service.js](../srv/dpp-service.js)) eingehängt.
3. **Explizite Assoziationen statt Polymorphie.** CAP/OData kommt mit polymorphen
   Links schlecht zurecht — Dokument-/Nachweis-Verknüpfungen werden als optionale
   benannte Associations modelliert.
4. **Visibility datengetrieben.** Sichtbarkeit pro Feld/Tier über eine Regel-Entity,
   nicht hartkodiert im DTO.
5. **Erweiterbarkeit beibehalten.** Enums zentral in `common.cds`; Metrik-Namen und
   Regulierungen als kontrollierte Wertelisten, nicht als Spalten.

## 3. Datenmodell-Erweiterung (CDS)

### 3.1 Neue Enums — Ergänzung in [db/common.cds](../db/common.cds)

```cds
type RegulationType : String(20) enum {
  ESPR; REACH; SCIP; textile_labelling; waste_framework; other;
}

type ComplianceRecordStatus : String(16) enum {
  compliant; non_compliant; pending;
}

type CertificateType : String(40) enum {
  material_safety; environmental; social; quality; chemical; other;
}

type DocumentType : String(20) enum {
  certificate; declaration; report; care_guide; test_report; other;
}

// Dreistufiger Zugriff (ersetzt mittelfristig die binäre Visibility)
type VisibilityTier : String(10) enum {
  internal; public; authority;
}

type MetricLevel : String(12) enum {
  product; variant; batch; component; dpp;
}

type CalculationMethod : String(20) enum {
  pef; iso_14067; internal; supplier_declared; other;
}

// DPP-Granularität (Verhältnismäßigkeit)
type DPPLevel : String(8) enum {
  model; batch; item;
}
```

Zusätzlich wird die bestehende `UserRole` um eine Behörden-Rolle erweitert (für den
gestaffelten Zugriff, vgl. §5):

```cds
type UserRole : String(20) enum {
  company_advanced; company_user; authority_viewer;
}
```

### 3.2 Neue Entities — neue Datei `db/compliance.cds`

```cds
using { dpp.identified, dpp.audited } from './org';
using {
  dpp.RegulationType, dpp.ComplianceRecordStatus, dpp.CertificateType,
  dpp.DocumentType, dpp.MetricLevel, dpp.CalculationMethod, dpp.URL
} from './common';
using { dpp.Organizations, dpp.BusinessPartners } from './org';
using { dpp.Products, dpp.ProductVariants, dpp.Batches } from './product';
using { dpp.DPPs } from './dpp';

namespace dpp;

// ----- Zertifikate (Katalog: Certificate) -----
entity Certificates : identified, audited {
  owning_organization : Association to Organizations not null;  // Tenant-Anker
  name                : String(120) not null;
  certificate_type    : CertificateType default 'other';
  issuing_body        : Association to BusinessPartners;        // Rolle certification_body
  valid_from          : Date;
  valid_to            : Date;
  product             : Association to Products;                // optionaler Bezug
  dpp                 : Association to DPPs;                     // optionaler Bezug
  documents           : Association to many Documents on documents.certificate = $self;
}

// ----- Dokument-/Nachweis-Links (Katalog: Document Link) -----
// MVP: externe URL (vorhandenes Muster). Datei-Upload -> Phase 4 via Object Store.
entity Documents : identified, audited {
  owning_organization : Association to Organizations not null;
  name                : String(120) not null;
  document_type       : DocumentType default 'other';
  url                 : URL;
  // explizite, optionale Bezüge statt Polymorphie
  product             : Association to Products;
  dpp                 : Association to DPPs;
  certificate         : Association to Certificates;
  partner             : Association to BusinessPartners;
  batch               : Association to Batches;
}

// ----- Compliance-Datensatz (Katalog: Compliance Record) -----
entity ComplianceRecords : identified, audited {
  owning_organization : Association to Organizations not null;
  product             : Association to Products;
  dpp                 : Association to DPPs;
  regulation          : RegulationType not null;
  status              : ComplianceRecordStatus default 'pending';
  evidence_document   : Association to Documents;
  substances          : Composition of many SubstancesOfConcern
                          on substances.compliance_record = $self;
}

// ----- Strukturierte Stoffdaten (REACH/SCIP) statt Freitext -----
entity SubstancesOfConcern : identified {
  compliance_record  : Association to ComplianceRecords not null;
  substance_name     : String(200) not null;
  cas_number         : String(20);
  scip_number        : String(40);
  concentration_pct  : Decimal(5, 2);
  location_in_product: String(120);   // z.B. "Reißverschluss", "Druckfarbe"
}

// ----- Nachhaltigkeitsmetriken (Katalog: Sustainability Metric) -----
// Ersetzt mittelfristig die Flachfelder co2_footprint_kg / recycled_content_pct.
entity SustainabilityMetrics : identified, audited {
  owning_organization : Association to Organizations not null;
  level               : MetricLevel not null;
  product             : Association to Products;
  variant             : Association to ProductVariants;
  batch               : Association to Batches;
  dpp                 : Association to DPPs;
  metric_name         : String(40) not null;   // co2_footprint, recycled_content, repairability, microfibre_release, water_use
  metric_value        : Decimal(14, 4);
  unit                : String(12);
  calculation_method  : CalculationMethod default 'internal';
  comparison_value    : Decimal(8, 2);          // z.B. -12 (% vs. Baseline)
  comparison_baseline : String(60);             // z.B. "category average"
  measured_at         : Date;
}

// ----- Feldgenaue Sichtbarkeitsregeln (Katalog: Visibility Rule) -----
// Profil je DPPType/Kategorie; null owning_organization = Plattform-Default.
entity FieldVisibilityRules : identified {
  owning_organization : Association to Organizations;   // null = global default
  profile_name        : String(40) not null;            // z.B. "textile_default"
  section             : String(40);                     // z.B. "Batch Data"
  field_name          : String(60) not null;            // z.B. "factory"
  internal_visible    : Boolean default true;
  public_visible      : Boolean default false;
  authority_visible   : Boolean default true;
}

// ----- Persistente, unveränderliche DPP-Version (Katalog: DPP Version Archive) -----
entity DPPVersions : identified {
  dpp           : Association to DPPs not null;
  version_number: Integer not null;
  snapshot_date : Timestamp;
  change_reason : String(500);
  changed_by    : Association to Users;
  snapshot_data : LargeString;   // VOLL aufgelöster Zustand (inkl. aggregierter Materialdaten)
  content_hash  : String(64);    // sha256(snapshot_data) — Tamper-Evidence / Blockchain-Anker
}
```

### 3.3 Ergänzung an bestehenden Entities

```cds
// db/product.cds — DPP-Granularität konfigurierbar machen
extend entity Products with {
  dpp_level : DPPLevel default 'batch';   // model | batch | item
}

// db/dpp.cds — von binär auf dreistufig migrieren (visibility bleibt, tier kommt dazu)
extend entity DPPs with {
  visibility_tier   : VisibilityTier default 'internal';
  visibility_profile: String(40);          // FK-frei auf FieldVisibilityRules.profile_name
}
```

`db/schema.cds` wird um `using from './compliance';` erweitert.

## 4. Service-Schicht ([srv/dpp-service.cds](../srv/dpp-service.cds))

Neue Projektionen ergänzen:

```cds
entity Certificates          as projection on db.Certificates;
entity Documents             as projection on db.Documents;
entity ComplianceRecords     as projection on db.ComplianceRecords;
entity SubstancesOfConcern   as projection on db.SubstancesOfConcern;
entity SustainabilityMetrics as projection on db.SustainabilityMetrics;
entity FieldVisibilityRules  as projection on db.FieldVisibilityRules;
entity DPPVersions           as projection on db.DPPVersions;   // read-only (siehe §5.3)

// Behörden-Zugriff: liefert die Audit-Tier-Sicht zu einem Token
function authorityView(token : String) returns LargeString;
```

In [srv/dpp-service.js](../srv/dpp-service.js):

- **`TENANT_ANCHORS` erweitern** (jede neue Entity bekommt ihren Org-Pfad):
  ```js
  Certificates:          'owning_organization_ID',
  Documents:             'owning_organization_ID',
  ComplianceRecords:     'owning_organization_ID',
  SubstancesOfConcern:   'compliance_record.owning_organization_ID',
  SustainabilityMetrics: 'owning_organization_ID',
  FieldVisibilityRules:  'owning_organization_ID',
  DPPVersions:           'dpp.product.owning_organization_ID',
  ```
- **`AUDITED`-Liste erweitern** um `Certificates`, `Documents`, `ComplianceRecords`,
  `SustainabilityMetrics`.
- Schreib-Events bleiben automatisch auf `company_advanced` beschränkt (vorhandenes
  `before('*')`-Gate).

## 5. Logik-Schicht (Handler)

### 5.1 Neuer Handler `srv/handlers/compliance-handlers.js`
- Validierung beim `CREATE`/`UPDATE` von `Certificates`: `valid_to >= valid_from`;
  Warnung bei ablaufender Gültigkeit.
- Format-Checks für `SubstancesOfConcern` (CAS-/SCIP-Schema).
- `requireOwningOrg`-Schutz für Bezüge (Wiederverwendung aus
  [srv/handlers/auth-helpers.js](../srv/handlers/auth-helpers.js)).

### 5.2 Erweiterung [srv/handlers/dpp-handlers.js](../srv/handlers/dpp-handlers.js) — `publishDPP`
- **Vollständig aufgelösten Snapshot** erzeugen (nicht nur Referenzen): Aggregator-
  Ergebnis ([srv/lib/aggregator.js](../srv/lib/aggregator.js)) in den Snapshot
  einbetten, damit der DPP unabhängig von Sub-Lieferanten bestehen bleibt
  (Datenpersistenz).
- `content_hash = sha256(snapshot_data)` berechnen.
- Eine **`DPPVersions`-Zeile** je Publish persistieren (Versionshistorie).
- *Hook-Punkt:* `content_hash` optional auf Polygon verankern (Phase 4) — eine Zeile,
  kein Architekturbruch.

### 5.3 Erweiterung [srv/handlers/public-handler.js](../srv/handlers/public-handler.js)
- DTO-Felder **datengetrieben** über `FieldVisibilityRules` (Tier `public`) filtern,
  statt fester Feldliste in `toConsumerDTO`.
- Compliance-/Zertifikatsdaten nur, wenn `public_visible = true`.

### 5.4 Behörden-Sicht — `authorityView(token)`
- Neuer Handler, gegated auf Rolle `authority_viewer`.
- Liefert `public`- **plus** `authority`-sichtbare Felder inkl. `ComplianceRecords`,
  `Certificates`, `Documents`, ungefilterte `SubstancesOfConcern`.
- Wahlweise als OData-Function (oben) oder REST-Endpoint analog zum Public-Endpoint in
  [srv/server.js](../srv/server.js) (`app.get('/authority/dpp/:token', …)`, hinter
  Approuter-XSUAA + Rollencheck).

### 5.5 Erweiterung [srv/handlers/product-item-handlers.js](../srv/handlers/product-item-handlers.js)
- Auto-DPP nur erzeugen, wenn `product.dpp_level === 'item'`. Bei `batch`/`model`
  entfällt die Pro-Stück-Erzeugung → Verhältnismäßigkeit, geringere Datenmenge.

### 5.6 Erweiterung [srv/lib/aggregator.js](../srv/lib/aggregator.js)
- `selfValue` der Aggregatoren liest primär aus `SustainabilityMetrics`
  (Fallback: Flachfelder), damit PEF-Methode und mehrere Indikatoren abgebildet werden.

## 6. Frontend ([dpp_frontend](../../dpp_frontend))

- **Produkt-/DPP-Detail:** neue Tabs „Compliance", „Zertifikate", „Dokumente",
  „Metriken" (lesend/schreibend je nach Rolle via vorhandenem
  `<RequireRole>`-Muster).
- **Wizard:** zusätzlicher Schritt „Compliance & Nachweise" zwischen Batch und DPP.
- **API-Client** ([app/src/api/client.js](../../dpp_frontend/app/src/api/client.js)):
  keine strukturelle Änderung — neue Entities laufen über `odataList/Create/Update`.
- **Behörden-Portal:** neue Route hinter `authority_viewer`, ruft `authorityView`.
- **Consumer-View** (`consumer.html`): unverändert öffentlich; zeigt zusätzlich die
  als `public_visible` markierten Compliance-Badges.

## 7. Deployment & Migration

- **Schema:** rein additiv → `cds build` + `cf deploy` über `dpp-db-deployer`
  ([mta.yaml](../mta.yaml)). HDI behandelt neue Tabellen/Spalten als non-breaking.
- **Rolle `authority_viewer`:** Da Rollen programmatisch aus der `Users`-Tabelle
  aufgelöst werden (siehe [srv/handlers/auth-helpers.js](../srv/handlers/auth-helpers.js)),
  genügt die Enum-Erweiterung + Seed-Zeilen — **keine** Änderung an
  [xs-security.json](../xs-security.json) nötig.
- **Datei-Uploads (Phase 4):** falls echte Dateiablage statt URL gewünscht →
  SAP Object Store / Document Management Service als Ressource in `mta.yaml` ergänzen.
- **Seed-Daten:** neue CSVs unter `db/data/` (z.B. `dpp-FieldVisibilityRules.csv` mit
  einem `textile_default`-Profil).

## 8. Umsetzung in Phasen

| Phase | Inhalt | Rechtlicher Nutzen |
|---|---|---|
| **1** | Certificates, Documents, ComplianceRecords, SubstancesOfConcern + DPPVersions-Persistenz + content_hash | Behörden-Nachweis, REACH/SCIP, Auditierbarkeit |
| **2** | FieldVisibilityRules + `authorityView` + Rolle `authority_viewer` | ESPR-Zugriffsrechte (3-stufig) |
| **3** | SustainabilityMetrics + PEF + Aggregator-Migration; `dpp_level` konfigurierbar | Umweltindikatoren, Verhältnismäßigkeit |
| **4** | Datei-Upload, Polygon-Anker des content_hash, Mehrsprachigkeit, Mikrofaser-/Reparierbarkeits-Felder | Datenpersistenz, Tamper-Evidence, Textil-Spezifika |

## 9. Traceability (Anforderung → neues Artefakt)

| ESPR-/Katalog-Anforderung | Neues Artefakt |
|---|---|
| Konformitätsnachweise, Zertifikate | `Certificates`, `Documents` |
| Stoffe (REACH/SCIP) strukturiert | `ComplianceRecords`, `SubstancesOfConcern` |
| Gestaffelte Zugriffsrechte | `FieldVisibilityRules`, `authorityView`, `authority_viewer` |
| Umweltindikatoren (PEF) | `SustainabilityMetrics` |
| Auditierbarkeit / Datenpersistenz | `DPPVersions` + `content_hash` + aufgelöster Snapshot |
| Verhältnismäßige Granularität | `Products.dpp_level` |

## 10. Offene Punkte für die Fachberatung

- Genaue Pflichtfelder & DPP-Ebene aus dem finalen Textil-Rechtsakt.
- Aufbewahrungsfrist / Backup-Pflicht (DPP-Service-Provider-Modell).
- Anforderungen an die EU-DPP-Registry-Anbindung und Datenträger-Standards (QR/NFC/RFID).
- Sprachpflichten je Zielmarkt.
