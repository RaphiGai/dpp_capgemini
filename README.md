# DPP Capgemini — Digital Product Passport Backend (Fashion)

Backend for an EU-ESPR–oriented Digital Product Passport (DPP) for the fashion industry, built as a TUM × Capgemini student project.

**Stack**

- SAP Cloud Application Programming Model (CAP), Node.js, `@sap/cds` ^9
- CDS data model, OData V4 services, auto-generated OpenAPI/Swagger
- SQLite (development) / SAP HANA Cloud (production on BTP)
- XSUAA authentication (4 roles: `admin`, `editor`, `viewer`, `authority`)
- Public consumer endpoint (`/public/dpp/:token`, no login)
- Polygon Amoy blockchain anchoring via `ethers.js` v6 + Hardhat smart contract
- Jest unit + `cds.test` integration tests

## Quick start (local development)

```bash
git clone https://github.com/RaphiGai/dpp_capgemini.git
cd dpp_capgemini

npm install
cp .env.example .env          # edit secrets / blockchain keys

npm run watch                 # CAP server on http://localhost:4004
```

Mock users (Basic-Auth, password `x`):

| User              | Role        | Tenant |
| ----------------- | ----------- | ------ |
| `alice.admin`     | admin       | ORG-A  |
| `bob.editor`      | editor      | ORG-A  |
| `carol.viewer`    | viewer      | ORG-A  |
| `dan.editor.b`    | editor      | ORG-B  |
| `eve.authority`   | authority   | —      |

## Endpoints

- `GET /odata/v4/dpp/$metadata` — tenant-scoped DPP CRUD (XSUAA required)
- `GET /odata/v4/authority/$metadata` — read-only cross-tenant view (role `authority`)
- `GET /public/dpp/:token` — public consumer view (no auth)
- `GET /swagger` — Swagger UI

## Project layout

```
.
├── app/router/            # approuter (Cloud Foundry)
├── blockchain/            # Hardhat sub-project (Solidity contract)
├── db/                    # CDS data model
├── srv/                   # CAP services + handlers + libs
├── test/                  # Unit & integration tests
└── …
```

See [`docs/`](docs/) (TBD) for architecture diagrams.

## License

MIT (placeholder — to be confirmed with project owners).
