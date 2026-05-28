# DPP Capgemini — Architecture Appendix

Supplementary material that supports the four core deliverables in [architecture.md](architecture.md) but is not part of the requirements presentation:

- [A. Solution Context](#a-solution-context) — high-level actors and external systems
- [B. Deployment Topology](#b-deployment-topology) — build pipeline, MTA modules and bindings
- [C. Product Passport Lifecycle](#c-product-passport-lifecycle) — status transitions and side effects
- [D. Sprint-1 Demo Sequence](#d-sprint-1-demo-sequence) — end-to-end happy path
- [E. Access Control](#e-access-control) — role and tenant isolation in detail

---

## A. Solution Context

High-level view: actors (brand or manufacturer, consumer, market surveillance authority) → SAP BTP system → external and future systems.

![Solution Context](diagrams/solution-context.png)

Editable source: [diagrams/solution-context.drawio](diagrams/solution-context.drawio)

### A.1 Actors and permissions

| Actor | Permission | Entry point |
|---|---|---|
| Brand or manufacturer (advanced company user) | Authenticated login, full create / read / update / delete and lifecycle actions | Application router → authenticated service |
| Internal employee (standard company user) | Authenticated login, read-only on own tenant data | Application router → authenticated service |
| Consumer | None | QR scan → public consumer view |
| Market surveillance authority | None — uses the same public token URL as the consumer | Public consumer view |

### A.2 EU compliance context

- **ESPR regulation (EU 2024/1781)** — mandatory passport fields for textiles
- **Market surveillance regulation (EU 2019/1020)** — public authority access without login
- The MVP covers finished-product DPPs (optionally narrowed to a batch), signed QR tokens, the public token endpoint and recursive hierarchical aggregation over linked sub-DPPs

---

## B. Deployment Topology

Multi-Target Application view: build pipeline, three deployment modules and three resources, with bindings. This is a more operational view than the BTP architecture diagram in the main document.

![Deployment Topology](diagrams/deployment-topology.png)

Editable source: [diagrams/deployment-topology.drawio](diagrams/deployment-topology.drawio)

### B.1 Modules

| Module | Type | What it does |
|---|---|---|
| Backend Service | Node.js application | Hosts the OData service, the public REST endpoints and the business logic |
| Database Deployer | One-shot HDI deployer | Translates the data model into HANA tables and views, runs once after each deploy, then exits |
| Application Router | Approuter runtime | Serves static UI, terminates the user session and forwards requests to the backend |

### B.2 Resources

| Resource | Type | Contents |
|---|---|---|
| Database Container | HANA Cloud HDI container | Stores the 11 catalogue tables |
| Authorization Service | Managed Authorization and Trust service | Configured by the security profile (single application scope, default role collection) |
| Runtime Secrets | User-provided service | Holds the QR signing key and the public base URL |

### B.3 One-time setup per space

The operator creates the runtime secrets service once per Cloud Foundry space before the first deploy. It contains a random signing key (32 characters or more) used to sign QR tokens, and the public base URL of the application router. The backend reads both values into its environment when it starts.

Both values can be rotated later without redeploying the backend — the operator updates the user-provided service and restarts the backend, which picks up the new values on the next boot.

### B.4 Standard deploy flow

```bash
mbt build
cf login -a https://api.cf.eu10-004.hana.ondemand.com --sso
cf deploy mta_archives/dpp-capgemini_0.1.0.mtar
```

Cloud Foundry creates the three modules as separate apps and binds them to the managed services declared by the MTA descriptor.

---

## C. Product Passport Lifecycle

Status transitions: Draft → In Review → Approved → Published → Archived, plus the side effects on entering Published (snapshot creation, QR code rotation).

![Product Passport Lifecycle](diagrams/dpp-lifecycle.png)

Editable source: [diagrams/dpp-lifecycle.drawio](diagrams/dpp-lifecycle.drawio)

### C.1 Readiness check

Both the Approve and the Publish actions run the same readiness check before they accept the transition:

- The product reference must exist
- The product must have a name, brand, category and fibre composition
- For item-level passports, a linked product item must be present
- The unique product identifier on the item must be set

### C.2 Side effects on entering Published

When a passport moves into Published, the system performs all of the following in one transaction:

- Sets the publication timestamp
- Creates a signed QR token (HMAC-SHA256)
- Sets the QR payload URL and the public consumer URL
- Stores an aggregated data snapshot (frozen JSON) that represents the passport contents at publication time
- Marks the previous active QR code as replaced
- Inserts a new active QR code record

When a published passport is published again, the version number increases and both the signed token and the snapshot are regenerated.

---

## D. Sprint-1 Demo Sequence

End-to-end happy path used as the MVP acceptance test (see [Epics and user stories.pdf](../../Epics%20and%20user%20stories.pdf), Sprint-1 demo scenario).

![Sprint-1 Demo Sequence](diagrams/sprint1-demo-sequence.png)

Editable source: [diagrams/sprint1-demo-sequence.drawio](diagrams/sprint1-demo-sequence.drawio)

The sequence has three phases:

1. **Create master data** (steps 2 to 7) — create a business partner, two products (one finished good, one material), a bill of materials, a product variant, a batch and a product item
2. **Passport workflow** (steps 8 and 9) — create the passport, approve it, then publish it (which builds the snapshot and rotates the QR code)
3. **Consumer path** (steps 10 to 12) — generate the QR code, print and attach the label, then have a consumer scan it and view the public passport

---

## E. Access Control

The application enforces a two-role model (advanced company user, standard company user) plus per-entity tenant isolation. Consumers and market surveillance authorities use the unauthenticated public passport endpoint and are not part of the role model.

### E.1 Why this is enforced inside the application

The development tenant blocks the assignment of role collections in the platform cockpit, and three different framework hook variants failed to inject database-resolved roles into the request context in time for the declarative authorisation to evaluate. Rather than fight the timing, the entire access-control layer was moved into the service handlers. This is timing-independent and fully under our control.

### E.2 Request flow

1. The framework's authentication middleware records the caller's identity (issued by the authorisation service in production, or by a local mock in development)
2. A middleware looks up the user in the user table by external user identifier (falling back to email) and writes the resolved role and tenant onto the request context
3. The service-level gate checks that the user is authenticated
4. A global hook rejects the request with an authorisation error if no active user record was resolved, and rejects any write event for standard company users
5. Per-entity read hooks add a tenant filter to every read for every entity in the tenant-scoped set; reads for an unknown identifier silently return "not found", list reads are scoped to the caller's tenant
6. Create and update hooks for Products, Business Partners, Users and Organisations enforce that the owning organisation matches the caller's organisation
7. Action hooks for the passport lifecycle and the product archiving check ownership before mutation

### E.3 Capability matrix

| Capability | Advanced company user | Standard company user | Public consumer |
|---|---|---|---|
| Authentication required | Yes | Yes | No |
| Read tenant-scoped entities | Yes | Yes | — |
| Create, update or delete master data | Yes | No (authorisation error) | — |
| Trigger lifecycle actions (Approve, Publish, Archive, Regenerate Token, Archive Product) | Yes | No (authorisation error) | — |
| Read-only functions (QR code generation) | Yes | Yes | — |
| Manage users (within own organisation) | Yes | No | — |
| Read a published, public passport via the QR token | — | — | Yes |

### E.4 Cross-organisation exception for Bill of Materials components

The parent reference is tenant-filtered, but the component reference is not. Bills of materials may legitimately point to upstream supplier materials that live in a different organisation — for example, a spinner supplying cotton yarn to a clothing brand.

### E.5 Operational implications

No role collection setup in the platform cockpit is required. Adding or removing a user is a row in the user table; deactivating a user sets their active flag to false. The authorisation service keeps a single application scope — all role refinement lives in the application.
