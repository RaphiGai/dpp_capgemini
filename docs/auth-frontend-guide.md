# Authentication and Frontend Integration Guide

How the DPP Capgemini backend authenticates callers, and how a frontend must access the endpoints to use them correctly.

---

## 1. How authentication works (backend perspective)

The backend distinguishes **three kinds of callers**:

| Caller | Authentication | Resolution |
|---|---|---|
| Internal company user (advanced or standard) | OAuth2 / JWT via XSUAA in production · Basic Auth via mock users in local development | Identity from token → lookup in the `Users` table → role and tenant attached to the request |
| End consumer | None | Anonymous public route, no identity needed |
| Market surveillance authority | None | Uses the same anonymous public route as the consumer |

### 1.1 Production flow (deployed on SAP BTP)

```
   Browser ─────► Approuter ─────► Authorization Service (XSUAA)
      ▲              │
      │  session     │ JWT verified
      │  cookie      ▼
      └─────────► Approuter ─────► Backend Service
                                    │
                                    ▼
                          Look up user in the Users table
                          Attach role and tenant to the request
                                    │
                                    ▼
                          Tenant filter applied to every read
                          Role check applied to every write
```

Step by step:

1. The browser opens the Application Router URL
2. The Approuter checks the route in `xs-app.json`:
   - `/healthz` and `/public/*` → no login required, passed through to the backend
   - `/odata/*` and `/$api-docs/*` → authentication required
   - Root `/` redirects to the Swagger UI
3. For a protected route with no active session, the Approuter redirects the browser to the SAP Authorization Service to log in (Capgemini identity provider)
4. After successful login, the Authorization Service issues a signed token; the Approuter stores it in a server-side session and sets a session cookie on the browser
5. Subsequent calls from the browser carry the session cookie. The Approuter resolves the cookie to the stored token and forwards the request to the backend with an `Authorization` header
6. The backend's service gate accepts the call as "authenticated user"
7. Before any handler runs, the backend looks up the caller in the `Users` table (by `external_user_id`, falling back to `email`):
   - If a matching active user record is found, the user's role and tenant are attached to the request context (one of `company_advanced` or `company_user`)
   - If no record is found or the user is inactive, the request is rejected with **HTTP 403 — "No active user record"**
8. A tenant filter is added to every read query — the caller sees only data owned by their organisation
9. Write operations (CRUD, lifecycle actions) require role `company_advanced`; standard users get **HTTP 403 — "Insufficient role"**

### 1.2 Local development flow (mocked authentication)

There is no Approuter in local dev. The backend listens directly on `http://localhost:4004` and uses CAP's mocked auth provider, configured in `.cdsrc.json`.

The mocked auth provider accepts **HTTP Basic Authentication**:

| User | Password | Role | Tenant |
|---|---|---|---|
| `alice.advanced` | `x` | company_advanced | ORG-A |
| `carol.user` | `x` | company_user | ORG-A |
| `dan.advanced.b` | `x` | company_advanced | ORG-B |
| `kka_learn_235` | `x` | company_advanced | ORG-A |

The same backend logic runs (user table lookup, tenant filter, role gates) — only the way the identity is presented changes.

### 1.3 Public route (no authentication at all)

Three endpoints bypass authentication entirely:

- `GET /healthz` — liveness probe
- `GET /public/dpp/:token` — consumer view of a published passport (JSON)
- `GET /public/dpp/:token/qr.png` — printable QR image for a published passport

These are mounted directly on the Express bootstrap, before the CAP authentication middleware. The Approuter has them on `authenticationType: "none"` and passes them through.

The `:token` parameter is the signed QR token. The backend verifies its signature before returning data — a forged token is rejected with **HTTP 404 — "Not found"** (constant-time comparison, so timing-based attacks fail).

---

## 2. How the frontend must access the endpoints

### 2.1 Hosting recommendation

**Host the frontend in the Approuter** as static assets (`app/router` module). This is the simplest and most secure setup:

- The user lands on the Approuter URL
- The Approuter handles the login redirect
- The frontend code is served as static files from the same origin
- Every backend call from the frontend uses the same session cookie — no token handling in JavaScript
- No CORS, no cross-origin headaches

A standalone frontend hosted elsewhere (separate React app on a CDN, for example) is possible but requires custom handling of the OAuth2 redirect dance and is generally not recommended for the MVP.

### 2.2 Calling authenticated endpoints

From inside the Approuter-hosted frontend, every authenticated endpoint is a normal `fetch` (or OData V4 client) call to a relative path. The session cookie travels along automatically:

```javascript
// OData metadata
const meta = await fetch('/odata/v4/dpp/$metadata', {
  headers: { Accept: 'application/xml' }
});

// Read products (tenant filter is applied by the backend automatically)
const products = await fetch('/odata/v4/dpp/Products', {
  headers: { Accept: 'application/json' }
}).then(r => r.json());

// Create a product (advanced company user only)
const created = await fetch('/odata/v4/dpp/Products', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  },
  body: JSON.stringify({
    name: 'Classic T-Shirt',
    product_type: 'finished',
    brand: 'Greenline'
  })
}).then(r => r.json());

// Trigger a lifecycle action
const approved = await fetch(`/odata/v4/dpp/DPPs(${passportId})/DPPService.approveDPP`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
}).then(r => r.json());
```

The Approuter session cookie is HttpOnly — the frontend never has to read or set it.

### 2.3 Resolving the caller's identity

The frontend should call the identity endpoint as the first action after login, to populate the UI with the user's name, organisation and to enable or disable controls based on role:

```javascript
const me = await fetch('/odata/v4/dpp/me()', {
  headers: { Accept: 'application/json' }
}).then(r => r.json());

// me = {
//   id:             'alice.advanced',
//   displayName:    'Alice (Advanced)',
//   email:          'alice@example.com',
//   role:           'company_advanced',
//   organizationId: '...',
//   tenantId:       'ORG-A'
// }

if (me.role === 'company_advanced') {
  showCreateAndPublishButtons();
} else {
  hideWriteControls();
}
```

### 2.4 Public passport view (the consumer scan)

The QR code on the printed label points to `https://<approuter-host>/public/dpp/<signed-token>`. When a consumer scans it:

```javascript
// No login. No cookie. No CORS.
fetch(`/public/dpp/${token}`, {
  headers: { Accept: 'application/json' }
})
  .then(r => {
    if (r.status === 404) throw new Error('Passport not found or invalid token');
    return r.json();
  })
  .then(passport => renderConsumerView(passport));
```

The response is a visibility-filtered consumer payload (Product, Variant, Batch, Item, BOM tree, QR history). Internal tenant fields and audit columns are excluded.

The QR image itself is reachable at `/public/dpp/<token>/qr.png` and can be used directly in an `<img src="...">` tag.

### 2.5 Logging out

The Approuter exposes a logout endpoint at `/do/logout` (configured in `xs-app.json`). Calling it terminates the session and redirects to a configured landing page:

```javascript
window.location.href = '/do/logout';
```

### 2.6 Handling errors

| HTTP status | Meaning | What the frontend should do |
|---|---|---|
| 401 | No valid session | Redirect to `/` (Approuter will trigger a fresh login) |
| 403 — "No active user record" | User logged in via the platform but is not in the DPP user table | Show a "your account has not been activated" page; contact the organisation admin |
| 403 — "Insufficient role" | Standard user tried a write operation | Show "you do not have permission for this action" |
| 403 — "belongs to a different organisation" | User tried to access data in another tenant | Same as above, treat as "not found" |
| 404 (public route) | Forged or expired QR token | Show "passport not found" |

### 2.7 No need to handle CSRF

The OData routes in `xs-app.json` are configured with `csrfProtection: false`. The frontend does not need to fetch or send CSRF tokens — POST, PATCH and DELETE work without extra headers.

---

## 3. Endpoint summary for the frontend

| Path | Method | Authentication | What it does |
|---|---|---|---|
| `/odata/v4/dpp/$metadata` | GET | yes | OData service metadata |
| `/odata/v4/dpp/<Entity>` | GET / POST / PATCH / DELETE | yes (tenant-scoped) | CRUD on the catalogue entities |
| `/odata/v4/dpp/DPPs(id)/DPPService.approveDPP` | POST | yes (advanced) | Approve the passport |
| `/odata/v4/dpp/DPPs(id)/DPPService.publishDPP` | POST | yes (advanced) | Publish the passport |
| `/odata/v4/dpp/DPPs(id)/DPPService.archiveDPP` | POST | yes (advanced) | Archive the passport |
| `/odata/v4/dpp/DPPs(id)/DPPService.regenerateQRToken` | POST | yes (advanced) | Rotate the signed QR token |
| `/odata/v4/dpp/DPPs(id)/DPPService.generateQRCode` | GET | yes (advanced) | Get the QR PNG as Base64 |
| `/odata/v4/dpp/me()` | GET | yes | Caller identity, role and organisation |
| `/public/dpp/:token` | GET | no | Public consumer view of a published passport |
| `/public/dpp/:token/qr.png` | GET | no | Printable QR image |
| `/healthz` | GET | no | Liveness probe |
| `/$api-docs/odata/v4/dpp` | GET | yes | Swagger UI (development convenience) |
| `/do/logout` | GET | — | Approuter logout |

---

## 4. Quick-start checklist for a new frontend developer

1. Build the UI as static assets under `app/router/resources/` (or whichever directory the Approuter is configured to serve)
2. Use **relative paths** for every backend call — never hard-code the Approuter hostname
3. On the first page after login, call `/odata/v4/dpp/me()` to get the caller's role; gate UI controls accordingly
4. For lifecycle actions, use `POST` with an empty or small JSON body to the bound action URL
5. For the consumer-facing passport view, use the **public** route with the token from the QR — no login involved
6. On `401`, redirect to `/` to trigger a new login
7. On `403`, show the user a meaningful message (their account, their role, or their tenant scope is the issue)
8. No CSRF token handling needed — POST, PATCH and DELETE work directly
9. Logout via `window.location.href = '/do/logout'`
10. In local development, run the backend with `npm run watch` and use Basic Auth (`alice.advanced` / `x`) directly against `http://localhost:4004` — there is no Approuter locally
