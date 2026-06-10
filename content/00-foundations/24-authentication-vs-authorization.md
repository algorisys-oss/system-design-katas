---
title: "Authentication vs Authorization"
slug: authentication-vs-authorization
level: foundations
module: apis-and-the-web
order: 24
reading_time_min: 16
concepts: [authentication, authorization, sessions, tokens, jwt, oauth, rbac]
use_cases: []
prerequisites: [http-fundamentals, http-status-codes]
status: published
---

# Authentication vs Authorization

## Hook — a motivating scenario

A user logs in successfully and then opens `/admin/users/delete?id=99` — and it works, even though
they're a regular user. The app correctly checked *who they are* but never checked *what they're
allowed to do*. That single gap is one of the most common (and damaging) security bugs in real
systems, and it comes from blurring two distinct steps: **authentication** and **authorization**.

## Mental model — the ID check vs the guest list

- **Authentication (authn) = "who are you?"** Proving identity — like showing your passport at the
  airport. (Recall **401 Unauthorized** = not authenticated.)
- **Authorization (authz) = "what are you allowed to do?"** Checking permissions — like whether your
  boarding pass lets you into the first-class lounge. (Recall **403 Forbidden** = authenticated but
  not allowed.)

You always do authn **then** authz: first establish identity, then decide what that identity may do.
Being logged in is *not* permission to do everything.

```compare
{
  "options": [
    { "label": "Authentication", "points": ["'Who are you?'", "Verifies identity (password, token, key)", "Failure → 401 Unauthorized", "Happens first"] },
    { "label": "Authorization", "points": ["'What can you do?'", "Checks permissions/roles per action", "Failure → 403 Forbidden", "Happens after identity is known"] }
  ]
}
```

## Build it up — how identity travels (sessions vs tokens)

Because HTTP is stateless, the client must prove identity on **every** request. Two common schemes:

- **Sessions (server-side):** on login the server creates a session, stores it (DB/cache), and gives
  the client a **session ID** in a cookie. Each request sends the cookie; the server looks it up.
  Easy to revoke (delete the session), but requires shared session storage across servers.
- **Tokens (e.g. JWT):** on login the server returns a signed **token** the client stores and sends
  (usually `Authorization: Bearer <token>`). The token *contains* identity/claims and is verified by
  signature — **no server lookup needed** (stateless, scales well), but harder to revoke before it
  expires.

```sequence
{
  "title": "Token-based auth (login → authenticated request)",
  "actors": ["Client", "Auth", "API"],
  "steps": [
    { "from": "Client", "to": "Auth", "label": "POST /login (credentials)" },
    { "from": "Auth", "to": "Client", "label": "signed token (identity + claims)" },
    { "from": "Client", "to": "API", "label": "GET /orders  Authorization: Bearer <token>" },
    { "from": "API", "to": "API", "label": "verify signature (authn) + check permissions (authz)" },
    { "from": "API", "to": "Client", "label": "200 OK (or 403 if not allowed)" }
  ]
}
```

**Authorization models** you'll meet: **RBAC** (role-based — user has roles like `admin`, each role
grants permissions) and **ABAC** (attribute-based — rules over attributes, e.g. "owner can edit own
doc"). **OAuth 2.0** is the standard for *delegated* access (letting an app act on your behalf
without sharing your password) — it issues tokens, not your credentials. **OpenID Connect (OIDC)**
builds on OAuth 2.0 to add login/identity, which is what powers "Sign in with Google".

```reveal
{
  "prompt": "JWTs are stateless and scale well, but what's the catch when you need to immediately revoke access (e.g. a fired employee)?",
  "answer": "A signed JWT is valid until it expires — the API verifies the signature without checking a server store, so there's nothing central to 'turn off'. To revoke before expiry you need extra machinery: short token lifetimes + refresh tokens, a revocation/blocklist (which reintroduces a lookup), or rotating signing keys. Sessions revoke trivially (delete the row); JWTs trade easy revocation for statelessness."
}
```

## In the wild

- **Sessions+cookies** suit classic web apps (and offer easy logout/revocation); **JWTs/bearer
  tokens** suit APIs, mobile, and service-to-service (stateless, scalable).
- **OAuth 2.0 / OpenID Connect** power "Sign in with…" and third-party access without sharing
  passwords. Real tokens are deliberately short-lived: **Google OAuth access tokens default to
  ~1 hour (3600s)**, paired with longer-lived refresh tokens — short lifetimes are how stateless
  bearer tokens limit the revocation gap.
- **The deny-by-default rule:** check authorization on **every** protected action, server-side —
  never rely on the UI hiding a button. The opening bug was a missing server-side authz check.
- **Least privilege:** grant the minimum permissions needed; combine with RBAC for manageable access.

## Common misconception — "if a user is logged in, they're authorized"

Authentication is necessary but not sufficient.

```reveal
{
  "prompt": "An app hides the 'Delete user' button for non-admins in the UI, so it doesn't check permissions on the server. Why is that exploitable?",
  "answer": "The UI is just one client; anyone can call the API directly (curl, devtools, a script) regardless of what buttons are shown. Hiding the button is cosmetic — without a server-side authorization check, a logged-in non-admin can simply send the delete request and it succeeds. Authorization must be enforced on the server for every action; the UI is not a security boundary."
}
```

Being authenticated only proves identity. Every sensitive action needs a separate, **server-side
authorization check** — UI hiding is convenience, not security.

## Self-test

```quiz
{
  "question": "A logged-in user tries an admin-only action. Authentication passes; the user lacks the admin role. Correct response?",
  "options": ["401 Unauthorized", "403 Forbidden", "200 OK", "404 Not Found"],
  "answer": 1,
  "explanation": "Identity is known (authenticated) but the action isn't permitted → authorization fails → 403 Forbidden."
}
```

```quiz
{
  "question": "A key trade-off of stateless JWTs vs server-side sessions is:",
  "options": [
    "JWTs can't carry user identity",
    "JWTs scale without a session store but are harder to revoke before expiry",
    "Sessions can't be used in browsers",
    "JWTs are always more secure"
  ],
  "answer": 1,
  "explanation": "JWTs verify by signature (no lookup → scalable) but remain valid until expiry, making instant revocation harder."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Authentication vs authorization — key terms", "cards": [
  { "front": "Authentication (authn)", "back": "Proving who you are — verifying identity via password, token, or key. Happens first; failure returns 401 Unauthorized." },
  { "front": "Authorization (authz)", "back": "Checking what you are allowed to do — permissions/roles per action. Happens after identity is known; failure returns 403 Forbidden." },
  { "front": "Session (server-side)", "back": "Server stores session state and gives the client a session ID in a cookie. Easy to revoke (delete it), but needs shared session storage across servers." },
  { "front": "JWT / bearer token", "back": "A signed token containing identity/claims, verified by signature with no server lookup. Stateless and scalable, but hard to revoke before it expires." },
  { "front": "RBAC vs ABAC", "back": "RBAC: permissions granted via roles like admin. ABAC: rules over attributes, e.g. owner can edit own doc." },
  { "front": "OAuth 2.0", "back": "Standard for delegated access (e.g. 'Sign in with Google'), issuing tokens that let an app act on your behalf without sharing your password." }
] }
```

## Key takeaways

- **Authn = who you are (401); authz = what you may do (403).** Always authenticate first, then
  authorize — and they're distinct checks.
- Identity travels per request via **sessions (server-side, easy to revoke)** or **tokens/JWT
  (stateless, scalable, harder to revoke)**.
- Use **RBAC/ABAC** for permissions, **OAuth2/OIDC** for delegated/third-party access, and follow
  **least privilege**.
- Enforce authorization **server-side on every action** — hiding UI is not security.

## Up next

Some requests get retried (timeouts, flaky networks). Whether that's safe depends on **Idempotency &
Safe Methods** — next.
