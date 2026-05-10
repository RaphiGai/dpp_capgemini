# BTP_TEST – CAP + SAPUI5 Deployment-Test

Minimaler End-to-End-Test, um den Deployment-Pfad auf SAP BTP (Cloud Foundry) zu verifizieren.

## Architektur

```
┌────────────────┐        ┌──────────────────┐        ┌─────────────┐
│  Browser       │ ─────▶ │  Approuter       │ ─────▶ │ CAP-Service │ ──▶ HANA
│  (SAPUI5 App)  │        │  (Single Entry)  │        │ (Node.js)   │
└────────────────┘        └──────────────────┘        └─────────────┘
```

* **Frontend:** SAPUI5 Freestyle-App in `app/launchpad/webapp/` mit zwei Buttons („Tabelle anzeigen“ / „Tabelle ausblenden“) und einer Produkt-Tabelle.
* **Backend:** CAP-Service `CatalogService` unter `/odata/v4/catalog/` — read-only Projektion auf die Entity `Products`.
* **Persistenz:** SQLite in-memory lokal, SAP HANA Cloud im Deployment.
* **Approuter:** leitet alle Requests an den CAP-Service weiter; serviert die UI als Welcome-File.

> Auth ist für diesen Test deaktiviert (`auth: dummy` in CAP, `authenticationMethod: none` im Approuter). Für produktive Szenarien muss XSUAA gebunden werden.

## Projektstruktur

```
BTP_TEST/
├── app/
│   ├── launchpad/webapp/        ← SAPUI5-App
│   │   ├── index.html
│   │   ├── manifest.json
│   │   ├── Component.js
│   │   ├── view/Main.view.xml
│   │   ├── controller/Main.controller.js
│   │   └── i18n/i18n.properties
│   └── router/                  ← Approuter (xs-app.json, package.json)
├── db/
│   ├── schema.cds               ← Datenmodell
│   └── data/test.demo-Products.csv
├── srv/
│   └── service.cds              ← OData-Service
├── mta.yaml                     ← Multi-Target-App-Deskriptor
└── package.json
```

## Lokal entwickeln und testen

```powershell
npm install
cds watch
```

Dann im Browser:

* UI: <http://localhost:4004/launchpad/webapp/index.html>
* OData-Service: <http://localhost:4004/odata/v4/catalog/Products>

`cds watch` nutzt SQLite in-memory und lädt die CSV-Testdaten beim Start.

## Auf SAP BTP (Cloud Foundry) deployen

### Voraussetzungen

| Tool | Installation |
|---|---|
| `@sap/cds-dk` | `npm install -g @sap/cds-dk` (bereits installiert) |
| `mbt` | `npm install -g mbt` (bereits installiert) |
| Cloud Foundry CLI | <https://github.com/cloudfoundry/cli/releases> – Windows-Installer (`cf8.exe`) |
| MultiApps-Plugin | `cf install-plugin multiapps` |

### HANA Cloud Instanz

Wird im CF-Space eine HANA-Cloud-Instanz benötigt. Falls noch nicht vorhanden, im BTP Cockpit oder per CLI:

```powershell
cf create-service hana hdi-shared BTP_TEST-db
```

Der Name `BTP_TEST-db` muss mit der Resource in `mta.yaml` übereinstimmen.

### Build und Deploy

```powershell
# 1. Build des MTA-Archivs
mbt build -p=cf

# Erzeugt: mta_archives/BTP_TEST_1.0.0.mtar

# 2. Bei Cloud Foundry anmelden
cf login -a https://api.cf.eu10-004.hana.ondemand.com -o CF_ProCode_BAS -s dev

# 3. Deployment
cf deploy mta_archives/BTP_TEST_1.0.0.mtar
```

Der Deploy erzeugt drei CF-Apps:

* `BTP_TEST-srv` — CAP-Backend
* `BTP_TEST-db-deployer` — One-shot HDI-Deployer (läuft einmal, deployt das DB-Schema in HANA)
* `BTP_TEST` — Approuter (öffentliche URL)

Die Approuter-URL wird am Ende des Deploys ausgegeben. Das ist der Einstiegspunkt für die UI.

### Häufige Stolpersteine

* **Underscore im App-Namen:** Cloud Foundry akzeptiert `_` im App-Namen, ersetzt ihn aber in Routen. Falls Routing-Probleme auftreten: in `mta.yaml` einen expliziten `host`-Parameter setzen (z. B. `host: btp-test-${space}`).
* **HANA-Quota:** Auf Trial-Accounts ist nur eine HANA-Instanz erlaubt. Falls bereits eine andere existiert, deren Name in `mta.yaml` referenzieren oder die alte freigeben.
* **Buildpack-Version:** Falls `nodejs_buildpack` Probleme macht, in `mta.yaml` eine konkrete Version pinnen.

## Was als nächstes?

* **XSUAA aktivieren:** `xs-security.json` anlegen, `xsuaa`-Resource in `mta.yaml`, `authenticationMethod` im Approuter auf `route`, in `package.json` `auth: xsuaa`.
* **UI als HTML5-Modul auslagern:** Statt das CAP-Backend statische UI-Files ausliefern zu lassen, ein eigenes `html5`-Modul mit `html5-app-deployer` aufsetzen — sauberer für CDN-Caching und Versionierung.
* **Schreib-Operationen:** Das `@readonly` aus `srv/service.cds` entfernen und CSRF-Schutz im Approuter wieder aktivieren.
