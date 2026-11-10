# Suzi Master ⇄ Nexeo: Charter

**AGREED by Suzi Master and Nexeo, 2026-11-10 19:53:07 PKT** (round 1 with Nexeo's changes C1–C4). Still waiting on:
the **founder** for M4, M5 and M6c (privacy and the stop switch, in one joint summary), and **Suzi's (Mac) builder**
for the client's part (M1 client column, M5, link topic T30). **Nothing is built before those.**

Process: [Functional_Charter.md](Functional_Charter.md) section 7: numbered proposals, both reply AGREE, recorded
here with the date, messages carry date and time with seconds (PKT). The founder approves anything on cost,
privacy, sends or a new way of reaching the user. Founder, 2026-11-10: the builders may give each other's agents
instructions; neither changes the other's things (rule 1).

Records: Suzi Master `/var/www/suzi/SERVER.md`; Nexeo `/var/www/tmcai/server/docs/NEXEO_SUZI_AGREEMENT.md` ("T30"),
mirror `server/docs/Master_Charter.md`; the Mac's part in the link `/root/suzi-nexeo-link` (STATE row T30).

## 1. The three parts

Each kind of information has exactly one owner; the other two only ask it.

| Owner | Owns (single source of truth) | Never holds |
|---|---|---|
| **Nexeo** (tai.tmcltd.com, with Suzi's server jarvis-gateway while Functional Charter item 1 is open) | Users and sign-in; each user's knowledge, memory, mail, calendar, WhatsApp; the thinking (AI); **device approval** (the 6-digit code or connect key, one sign-up for both); the installer download page | Code, builds, releases, installer files, gap reports |
| **Suzi Master** (this Ubuntu box, `/var/www/suzi`) | Suzi's code (its Git repo) and every release; the release key; the stop switch; which device runs which version and how each build went; the gap list; skills, later the operator model | Any user information: no mail, chats, memory, recordings, names |
| **Suzi Client** (each Mac / Windows PC) | That person's voice and face (never leave it), settings, the running code | Other users' data, the release key, the master copy of the code |

## 2. Responsibilities

| # | Area | Nexeo | Suzi Master | Suzi Client |
|---|---|---|---|---|
| M1 | Device approval (C1) | The only sign-up. An approved device (paired or connect key) calls `/v1/token`, signed with its device key, and gets the access JWT: EdDSA, `scope: jarvis`, `sub` user, `tid` tenant, `did` device, `iat`, `exp`, 900 s (`ACCESS_TOKEN_TTL_S`). A revoked device gets 401 at `/v1/token`; reusing an old refresh token revokes it. | Keeps **no sign-up of its own** (drops `master.admin approve`). Serves a request only with a valid token, checked **offline** as the gateway does (`auth/jwt.ts`): alg EdDSA, scope jarvis, not expired, required claims `sub tid did iat exp`. **Bound to the device:** the first valid token for a `did` records the request's public key for that `did`; after that every request's signature must verify with that key and the token's `did` must match. A different key for a known `did` is refused until the founder clears it by hand. Keeps only `did → key`. The token is read for this check only, never stored or logged. A revoked device is refused within ≤ 900 s. | Sends its current access token with each master request, signed with the same device key it uses with Nexeo. |
| M2 | Token key (Q4) | Today's key stays; no rotation planned. After AGREE, the gateway adds the public route `GET /v1/token-key` → `{kid, alg:"EdDSA", public_key_pem}`. On a rotation the new key is published there ≥ 24 h before use, and tokens carry `kid`. | Fetches it **once by hand** (not a runtime call, so rule 2 holds) into `/var/lib/suzi-master/nexeo-token.pub`. Never holds a private key or a secret of Nexeo's. | — |
| M3 | Lead client (C2) | `primary` stays Nexeo's "device in charge right now" (Functional Charter row 15); it is **not** the lead. | The founder marks the lead by hand, `master.admin lead <did>`; it stays until he changes it. The lead gets a release first; its go-ahead releases it to everyone. | The lead runs the build, checks it, asks its user to restart, and gives the go-ahead after 30 minutes of running well. |
| M4 | What the master keeps **(founder)** | — | Per `did` only: its key, version, base, each build's steps (staged, failed, trying, healthy, rolled back), last seen. **Not** the user id, tenant, user's name or computer's name. | Sends nothing else: no computer name. |
| M5 | Gap reports (C3) **(founder)** | Holds **no** gap reports once the master's list is live; until then the Mac keeps sending `gap.report` to Nexeo as today. After the switch Nexeo answers `gap.report` / `gap.approve` with `{error:{code:"moved"}}` and its T28 table is read-only. | Holds the one gap list. Takes over G-1 to G-9 as they stand (link inbox `20261106-204727-nexeo-gap-G*`: 8 sorted to Suzi, G-8 to the 3dAI factory, G-9 waiting on a design). An approval counts **only from the lead device**, with `confirmed_by_user` and his voice score, as T28 does today; a gap from any other device stays `new`. Builds and tests the fix, then publishes it. | Sends a short written gap ("can't do X yet") only after its user approves it, with no personal data: never the user's own words, names, addresses, numbers or content. |
| M6 | Code, releases, stop switch (C4) | Never sees or serves code. T28 item 4 ("Releases, later") and "Nexeo holds the release list and stop switch" are withdrawn. | **a.** Owns the repo, the release key, the builds and both channels (lead, all). **b.** Every release is signed; every client checks it itself. **c. (founder)** Holds the stop switch for a bad release already spreading: the founder triggers it by voice on the lead device or with `master.admin stop <v>`. It halts the "all" channel, and clients that took that release go back to their last good build. | Runs only signed code; keeps the last good build and goes back to it by itself, or when the master says the release is stopped. |
| M7 | Skills | — | Built once here and shipped by the same release route as a fix. | Takes them as it takes code. |
| M8 | Installer (Q3) | The portal page, behind sign-in, links to the master's file. Nexeo holds no installer file; it builds the page after AGREE. | Publishes each signed installer and its sha256 at a fixed URL on `master.tmcltd.com`. | First install (stage 1) from the portal; after that takes code from the master (stage 2). |
| M9 | Cost | — | Makes no AI calls; adds nothing to the Costing Charter. | — |

## 3. Rules between the two

1. **Neither side changes the other**: no edits to the other's code, config, web server or tunnel files, services,
   database or secrets (founder, 2026-11-10). Each uses only what this charter lists. Reading the other's published
   docs is fine; either may give the other's agent instructions (founder, 2026-11-10).
2. Suzi Master makes **no runtime calls to Nexeo**: approval is checked from the token alone (M1). The one-time
   manual fetch of the token key (M2) is not a runtime call.
3. Suzi Master's public address is its own (`https://master.tmcltd.com`, its own vhost), never a path on Nexeo's host.
4. Changes follow section 7 of the Functional Charter, as above.

## 4. Round history

- **Round 1.** Suzi Master proposed, 19:50:24. Nexeo replied (stamped 19:53:05 and 19:56): AGREE to section 1, M4,
  M6, M7, M9 and rules 1–4; changes C1 (bind the token to the device key; check the claims as the gateway does),
  C2 (the lead is set by hand, not `primary`), C3 (gap hand-over: Nexeo stops at the switch, G-1..G-9 carry over,
  approval only from the lead device), C4 (stop switch on the master); answers Q1 (connect-key devices get the same
  JWT via `/v1/token`), Q2 (no claim; see C2), Q3 (installer at a fixed master URL, the portal links to it),
  Q4 (public route `GET /v1/token-key`). Suzi Master: AGREE to C1–C4, 19:53:07 (this box's clock).

## 5. Sign-off

| Side | Reply | When (PKT) |
|---|---|---|
| Suzi Master | AGREE (round 1 with C1–C4) | 2026-11-10 19:53:07 |
| Nexeo | AGREE with C1–C4 | 2026-11-10 19:53:05 / 19:56 (its stamps) |
| Suzi's (Mac) builder | — (client part: M1 client column, M5, T30 in the link) | — |
| Founder (M4, M5, M6c) | — | — |
