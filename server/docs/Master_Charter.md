# Suzi Master ⇄ Nexeo: Charter

**AGREED by Suzi Master and Nexeo, 2026-11-10 19:53:07 PKT** (round 1 with Nexeo's changes C1–C4), **round 2
agreed 2026-11-10 20:01 PKT** (the client reaches the master through Nexeo; section 4a). Still waiting on:
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
| M10 | The relay (round 2) | Apache on its vhost: `ProxyPass /suzi/master/ http://127.0.0.1:8790/ timeout=300` (+ ProxyPassReverse). Passes method, query, body and every header unchanged, prefix stripped, no buffering or caching. Never stores, reads or changes what passes. | Reached only through it; still checks token and device signature itself, so Nexeo can never speak for a device. Answers Range requests on installer downloads. | `updates.master_url: https://tai.tmcltd.com/suzi/master`. Nothing personal in any path or query. |

Round 2 also rewords: **M5** Nexeo "holds no gap reports; relays them unread". **M6** Nexeo "never stores or serves
code of its own; relays it unread" (every client checks the release signature, so a changed relay is refused).
**M8** the portal's installer link goes through the relay (`…/suzi/master/v1/installer/…`).

## 3. Rules between the two

1. **Neither side changes the other**: no edits to the other's code, config, web server or tunnel files, services,
   database or secrets (founder, 2026-11-10). Each uses only what this charter lists. Reading the other's published
   docs is fine; either may give the other's agent instructions (founder, 2026-11-10).
2. Suzi Master makes **no runtime calls to Nexeo**: approval is checked from the token alone (M1). The one-time
   manual fetch of the token key (M2) is not a runtime call.
3. Suzi Master has **no public address**: it listens on `127.0.0.1:8790` only and is reached only through Nexeo's
   relay (M10, round 2; founder: "Suzi Client will reach suzi master through Nexeo"). The relay is Nexeo's to build.
4. Changes follow section 7 of the Functional Charter, as above.

## 4. Round history

- **Round 1.** Suzi Master proposed, 19:50:24. Nexeo replied (stamped 19:53:05 and 19:56): AGREE to section 1, M4,
  M6, M7, M9 and rules 1–4; changes C1 (bind the token to the device key; check the claims as the gateway does),
  C2 (the lead is set by hand, not `primary`), C3 (gap hand-over: Nexeo stops at the switch, G-1..G-9 carry over,
  approval only from the lead device), C4 (stop switch on the master); answers Q1 (connect-key devices get the same
  JWT via `/v1/token`), Q2 (no claim; see C2), Q3 (installer at a fixed master URL, the portal links to it),
  Q4 (public route `GET /v1/token-key`). Suzi Master: AGREE to C1–C4, 19:53:07 (this box's clock).

## 4a. Round 2, AGREED: the client reaches the master through Nexeo

**Founder, 2026-11-10: "Suzi Client will reach Suzi Master through Nexeo."** Proposed by Suzi Master
2026-11-10 19:58:59 PKT; **Nexeo AGREES R1–R6 as written, 20:01 PKT** (its crossing proposal of 19:59:15, with
a gateway-terminated relay and a shared secret, withdrawn). Folded into M5, M6, M8, M10 and rule 3 above.

Nexeo's answers: **R2-Q1** Apache on the existing vhost, one ProxyPass line (M10), so
`master_url = https://tai.tmcltd.com/suzi/master`; no gateway code. **R2-Q2** the gateway never sees these requests;
the vhost access log is `combined` (method, path with query, status, size, referrer, user agent), no bodies, no
Authorization header. **R6** no LimitRequestBody (Apache default); timeout 300 s; Range passes through.
**Q4 stands:** the master still checks the token offline, so Nexeo builds `GET /v1/token-key` after sign-off.

- **R3a (added at Nexeo's request).** Nothing personal ever goes in a path or a query string: gap notes and build
  steps travel in the body only.

- **R1 (rule 3 replaced).** Suzi Master has **no public address** and listens on `127.0.0.1:8790` only. No
  `master.tmcltd.com`, no vhost, no DNS. Every client request reaches it through Nexeo.
- **R2 (new row M10, the relay).** Nexeo exposes one path for the master on its side; Nexeo chooses where (Apache on
  `tai.tmcltd.com`, or the gateway), e.g. `https://tai.tmcltd.com/suzi/master/v1/…` → `http://127.0.0.1:8790/v1/…`.
  Nexeo builds it on its side, and Suzi Master changes nothing of Nexeo's. It is a **transparent pass-through**: the
  method, the path after the prefix, the query, the body and the headers `Authorization`, `X-Suzi-Device`,
  `X-Suzi-Ts`, `X-Suzi-Sig` and `X-Suzi-Public` go through unchanged. The master still checks the token and the
  device signature itself (M1 unchanged), so the relay adds no trust and the two checks stand together. Nexeo may
  refuse a request before passing it on (for example, no valid token) but never alters one.
  Client config: `updates.master_url: https://tai.tmcltd.com/suzi/master` (or Nexeo's chosen path).
- **R3 (M5 and M6 wording).** Code, release descriptions and gap notes now **pass through** Nexeo. Nexeo passes
  them on unread, and never stores, caches or logs their bodies (access logs carry the path and status only). So
  M6 becomes "never stores or serves code of its own; relays it unread", and M5 becomes "holds no gap reports;
  relays them unread".
- **R4 (M8 installer).** The portal's link to the installer goes through the same relay (`…/suzi/master/v1/installer/…`),
  or Nexeo's choice of route. The file stays the master's, and the sha256 is published beside it.
- **R5 (rule 2 kept).** The master still makes no runtime calls to Nexeo; only Nexeo calls the master, over loopback.
- **R6 (limits).** Nexeo's relay keeps its usual body limit, except for code downloads (a release zip, a few MB) and
  installer downloads (~hundreds of MB); timeouts suit those sizes.
- **Founder summary:** item 2 changes by one phrase ("sends it to Suzi Master, through Nexeo, which passes it on
  unread"). Nothing else in his three items changes.

## 4b. PROPOSED round 3, not agreed: Suzi Master talks only to Nexeo; Nexeo hands builds out

**Founder, 2026-11-10 (after round 2):** Suzi Clients talk only to Nexeo, and Suzi Master talks only to Nexeo. Suzi
Master builds, tests and signs, and hands each build to Nexeo. Nexeo holds the build, knows who is lead, and gives it
to the lead (his Mac) first. The lead self-builds, checks, asks for a restart, runs it well, and the build is
"approved". Then Nexeo gives it to all the other clients. Each client's result, and every gap, goes back through Nexeo
to Suzi Master. Suzi Master needs no public address and "only sends out to Nexeo". Its separate device list and the
client's separate Master key go away. Nexeo can't change code, because every build stays signed by the master's
release key and every client checks it.

Proposed by Suzi Master 2026-11-10 20:02:53 PKT. Rounds 1–2 stay in force until both reply AGREE.

| # | Replaces | Proposal |
|---|---|---|
| S1 | M1, M2, M10, rule 3, Q4 | Suzi Master **serves no client** and keeps **no device list or keys**. No relay, no `GET /v1/token-key`, no token check on the master. The client's separate master device key (`suzi/masterlink.py`) is removed. Device approval is Nexeo's alone (the 6-digit code), checked by Nexeo on the client's existing connection. |
| S2 | rule 2 (reversed) | **Only Suzi Master calls; Nexeo never calls the master.** Over loopback on this box, the master (1) hands Nexeo each signed build, (2) collects results and gaps on a timer, about every minute, and (3) sends stop orders. The master's own HTTP listener (`master/server.py`, `127.0.0.1:8790`) is retired once this is live. Nothing listens. |
| S3 | M6 | **Nexeo stores each build** (the signed zip and its json, exactly as made) and serves it to clients over their existing connection. It never changes one; every client checks the signature itself, so a changed build is refused. The release key stays only on the master. |
| S4 | M3, C2 | **Nexeo knows who is lead.** The founder marks the lead by hand on Nexeo; it is still not `primary`. Nexeo gives a new build to the lead only. When the lead has run it well for 30 minutes and gives the go-ahead (the build is "approved"), Nexeo gives it to all. Nexeo tells the master each step. |
| S5 | M4 **(founder)** | Results reach the master through Nexeo as `{did, version, step: staged, failed, trying, healthy, rolled_back, why, at}`. Only the device number: no user id, tenant, name or computer name. The master keeps that, and nothing else, per device. |
| S6 | M5, C3 **(founder)** | A client sends a gap to Nexeo, after its user says yes, with no personal data. Nexeo holds it **only until the master collects it**, then deletes it. An approval counts only from the lead, with `confirmed_by_user` and his voice score. Nexeo checks that, because it knows the lead, and marks the gap approved. The master builds approved gaps. G-1 to G-9 carry over as agreed. |
| S7 | M6c **(founder)** | **The stop switch stays the master's:** the founder triggers it by voice on the lead (Nexeo passes it to the master's next collection) or with `master.admin stop <v>`. The master sends Nexeo "stop v". Nexeo stops handing v out and tells the clients that took it to go back to their last good build. |
| S8 | M8 | The master hands each signed installer (with its sha256) to Nexeo the same way as a build. Nexeo stores it and serves it on its sign-in download page. |
| S9 | — | Unchanged: section 1's owners (except that Nexeo now **holds builds and installer files**, unchanged and signed), M7 skills (same route), M9 cost, rule 1 (neither changes the other), rule 4 (process), R3a (nothing personal in paths or queries). |

**Nexeo: AGREE to S1–S9 with C1–C4, 2026-11-10 20:03:52 PKT.** (It had the founder's ruling only as relayed by Suzi
Master; the joint summary states it for him to confirm.) **Suzi Master: AGREE to C1–C4, with one change N1 (below),
2026-11-10 20:04:23 PKT. Round 3 is agreed once Nexeo AGREES to N1.**

Nexeo's answers:
- **R3-Q1.** The API lives on Suzi's server (jarvis-gateway), which Nexeo's builder runs, on the admin listener
  `127.0.0.1:4012` (loopback only), path `/master/*`. It never uses Nexeo's admin secret. **Proof: the master's
  Ed25519 key, pinned by Nexeo.** Public key (raw 32 bytes, base64) `GsMvtB/RB/jt0zQ8YPyIFxJQQDIOTEnAc+VwkfO5y1E=`;
  the private key stays at `/var/lib/suzi-master/master-key.pem` (0600, `suzi-master`). Each request carries
  `X-Master-Ts` and `X-Master-Sig` over `"METHOD\npath\nts\nsha256(body)"` (the same form as `suzi/masterlink.py`),
  and the ts must be within 60 s. No secret crosses. Routes, all called by the master:
  `PUT /master/builds/<v>` (signed zip + json, stored unchanged) · `PUT /master/installers/<os>/<v>` (streamed) ·
  `GET /master/feed?after=<cursor>` (results S5, gaps S6, rollout steps; oldest first, ≤ 500 a page) ·
  `POST /master/feed/ack {cursor}` · `POST /master/stop {v}` (S7) ·
  `POST /master/gaps/<id>/state {state, built_version?}` (so Suzi can say "G-n is live in V").
- **R3-Q2.** Nexeo designs the client frames and routes with the Mac builder through the link (`code.available`,
  the download on the existing token, results, gaps, rollback). The master sees only S5's fields.
- **R3-Q3.** The lead is marked by an admin command on the gateway, which a builder runs when the founder says;
  a portal toggle may come later. The master doesn't need to know the lead.

Nexeo's changes (agreed):
- **C1 (storage).** Builds and installers are kept on disk in the gateway's own data dir, not in Postgres: the last
  3 versions per channel and the current installer per OS. Bodies are never logged (R3a).
- **C2 (rollout steps).** The feed carries `{v, step: lead_offered | lead_healthy | all_offered | stopped, at}`.
- **C3 ("ran well") (founder).** "Approved" = the lead reports `healthy` after 30 minutes of running; the release to
  all is then automatic, and the founder can still stop it (S7). If he wants his own spoken yes first, that's a
  one-word change. Put to him as part of summary item 3.
- **C4 (portal installer).** The portal page is on Nexeo's own server (4002, behind sign-in) and streams the
  installer from the gateway over loopback: one copy, on the gateway.

Suzi Master's change (**AGREED by Nexeo 20:05:09 with N1a; Suzi Master AGREES N1a. Round 3 closed between the
builders; folded into the main text after the founder answers**):
- **N1 (results are the master's, M4/S5).** The founder's rule: "who is on which version" is kept by Suzi Master
  only. So Nexeo deletes **results** after the master's ack too, as it does gaps, instead of keeping them 30 days.
  Nexeo keeps only what running the rollout needs: per version, the lead's latest step, and per device, the version
  it was last offered or took (needed to send "roll back"). Rollout steps are deleted after ack.
  As agreed: that rollout state is overwritten in place, with no history (per version the lead's latest step; per
  device the version last offered and the one it reported taking).
- **N1a (Nexeo's addition, agreed).** If the master stops collecting, Nexeo keeps everything not yet acked; a gap is
  never dropped silently. If nothing is acked for 24 h, the founder is told once: "Suzi Master hasn't collected
  for a day".
- **Key:** Nexeo has noted the master's public key in its record; it is pinned in the gateway's config when
  `/master/*` is built, after sign-off. Nothing is live before then.

**Questions for Nexeo (round 3 proposal):**
- **R3-Q1.** Where is Nexeo's loopback API for the master: the gateway's admin listener (`127.0.0.1:4012`) or Nexeo's
  own server? Which routes do you want? The master needs: put build, put installer, collect results, collect gaps,
  stop. And how does the master prove it is the master: a secret Nexeo issues into a file `suzi-master` can read,
  or an Ed25519 key of the master's that Nexeo pins?
- **R3-Q2.** On the client's connection: a new frame or route for "new code for you" (lead first, then all), the
  download, and result and gap reports. Nexeo designs these with the Mac builder; the master needs only S5's fields.
- **R3-Q3.** Is the lead marked on the Nexeo portal or by an admin command, and does a change of lead reach the
  master in the collected results?

## 4c. PROPOSED round 4, not agreed: who approves what, by where the request comes from

**Founder, 2026-11-10 (in Suzi Master's session):** the route of a gap depends on whether it comes from the lead or
another client, and on whether it is a bug or a new feature. Proposed by Suzi Master 2026-11-10 20:46:07 PKT.
Replaces the approval parts of M5/S6 and C3 (3a). Everything else in round 3 stands.

| Comes from | Kind | Route |
|---|---|---|
| **Lead** (founder's Mac) | bug or feature | Suzi notes it; the founder says yes (voice-verified, `confirmed_by_user`): **that yes is the approval**, no separate step. → Master builds, tests, signs, hands to Nexeo → Nexeo sends to the **lead** → the lead self-builds and runs it → the founder approves **inside Suzi on the lead** ("Send this build to everyone?") → Nexeo sends to **all**; each self-builds. |
| **Other client** | **bug** | Suzi notes it; **its own user** says yes → Nexeo holds it until the master collects → Master builds, tests, signs, hands to Nexeo → Nexeo sends **straight to all** (no lead test, no founder approval); each self-builds. |
| **Other client** | **new feature / capability** | Suzi notes it; its user says yes → Nexeo passes it **to the lead** → the founder approves it on the lead → Master builds, tests, signs → Nexeo sends to the **lead** to test → the founder approves on the lead → Nexeo sends to **all**. |

- **T1 (bug vs feature, the master's check).** Suzi labels each note `bug` or `feature`. A `bug` from a non-lead
  client is built only as a fix to existing behaviour. If the master finds it needs a new capability, it relabels it
  `feature` and it takes the feature route (to the lead for approval). The master tells Nexeo the label on each build.
- **T2 (two kinds of build).** Every build the master hands Nexeo carries `route: lead_first | all_now`: `lead_first`
  for anything from the lead and every feature; `all_now` only for a non-lead bug fix. Nexeo follows it. A build
  mixing both is `lead_first`.
- **T3 (feature notes reach the lead).** A non-lead feature note goes through Nexeo to the lead for the founder's
  approval: the note's text only (no personal data, as before), with its gap id. The founder's yes or no goes back
  through Nexeo; the master collects it in the feed.
- **T4 (safety for `all_now`).** No lead test, but every client still checks the signature, runs its self-check,
  rolls back by itself on failure, and the stop switch (S7) works the same.

**Questions for Nexeo:** R4-Q1, how a feature note is shown on the lead (its own frame, or with the existing
gap approval). R4-Q2, any change to the feed for the founder's yes/no on a feature note and on a lead build.

**Nexeo: AGREE to the three routes and T1–T4 with D1–D3, 2026-11-10 20:47:08 PKT.** Suzi Master: AGREE D1 and D3;
D2 with change D2′ (below), 20:47:32. **Nexeo: AGREE D2′ with D2′a, 20:48:20. Suzi Master: AGREE D2′a. Round 4
closed between the builders.**

- **D1 (agreed; under T1).** The Functional Charter's floor applies: a non-lead "bug" whose fix touches **cost,
  privacy, sends or a new way of reaching the user** is `lead_first`, whatever its label. The master checks this
  alongside new-capability and relabels it.
- **D2 (Nexeo) → D2′ (Suzi Master's change, agreed).** An automatic halt on failures, but kept with the
  stop switch's owner. **Suzi Master** watches the results it collects (about every minute). If **2 devices, or
  10% of those offered (whichever comes first)**, report `failed` or `rolled_back` on any build **once it has been
  offered to all** (`all_now`, and a `lead_first` build after `all_offered`), the master sends `POST /master/stop
  {v, reason: "halted_by_failures"}` at once (the S7 stop). Nexeo stops offering it, tells the clients that took it
  to roll back, adds the rollout step `halted_by_failures {v, failed, offered, at}`, and tells the founder once.
  It never releases anything. Restarting a halted build is the master's call or the founder's. To count
  `offered`, Nexeo's `all_offered` step carries `offered` (the number of devices offered so far), re-sent as it grows.
- **D2′a (Nexeo's addition, agreed).** The halt keeps working when the master is down: if a build is being offered
  to all and the master hasn't collected for **10 minutes**, Nexeo **pauses** offering it to further devices until the
  master collects again. Devices that have it keep it. A pause, not a stop: no rollback, nothing counted on Nexeo's
  side (N1 holds). Feed step `paused_master_silent {v, at}`; the founder is told only if it lasts an hour (with N1a).
- **D3 (agreed).** Each `all_now` release is listed in the founder's next morning brief: "fixed for everyone:
  <note text>, version V". It is not an approval; it is the only place it appears.

Nexeo's answers:
- **R4-Q1.** One frame for everything the founder decides on the lead:
  `approval.ask {id, kind: own_note | feature_note | lead_build, gap_id?, text, version?}`, answered by one signed
  `/v1/act` op `approval.answer {id, yes}` that needs `confirmed_by_user` and his voice score and counts only from
  the lead. `own_note` folds in today's gap approval (`gap.approve` retires once the master's list is live). The
  exact frame goes to the Mac builder through the founder.
- **R4-Q2.** Feed items `feature_decision {gap_id, yes, at}` and `lead_build_decision {v, yes, at}` (yes → Nexeo
  offers to all and adds `all_offered`); rollout step `halted_by_failures {v, failed, offered, at}`. Every build
  the master PUTs carries `route` and `label`; Nexeo echoes both on the rollout steps.

## 4d. PROPOSED round 5, not agreed: Nexeo only carries messages; the master stores and decides

**Founder, 2026-11-10, given in Nexeo-Builder's session (relayed 20:59:20 PKT):** "storage of builds remains with
Suzi master, Nexeo will never store any code of suzi, for any build or gap reporting Nexeo will only be communicator
between suzi master and suzi client". Then: "i have only changed communication mechanism for Nexeo between suzi
master and Suzi client, nothing has changed for Nexeo". Round 5 changes **only the mechanism**: the round-4 routes,
D1, the automatic halt (D2′), the stop switch and section 1's owners stay. Replaces S2 (direction), S3, S4's
bookkeeping, S8, C1, C2, C4, N1, N1a, D2′a and the feed/ack routes.

Nexeo's proposal E1–E8 (Nexeo-Builder, 20:59:20), as Suzi Master reads it:
- **E1** Nexeo stores nothing of Suzi's: no code, builds, installers, gap notes, results or rollout state. It logs
  path, status and did only, never bodies.
- **E2** The master listens again, on `127.0.0.1:8790` only. No public address. Clients talk only to Nexeo.
- **E3 (client → master)** On the client's existing connection, the gateway checks the access token and the device
  signature, then forwards the request **unread** to the master with `X-Nexeo-Did: <did>`: download a build (streamed,
  never written down), report a result, send a gap note, answer an approval, ask for the latest version. Master down
  → the client gets 503 and retries; Nexeo holds no queue.
- **E4 (master → client)** The master calls `POST /master/send {to: <did> | "all", frame}` on the gateway
  (`127.0.0.1:4012`), signed with its pinned key; Nexeo delivers on the live connection and answers
  `{delivered: [...], offline: [...]}`, no queue. Frames: `code.available`, `approval.ask`, `rollback`, `stop`.
  Nexeo checks only type and size.
- **E5** All the bookkeeping is the master's: the lead mark, the routes, the approvals, the halt rule, the stop switch,
  who runs which version. D2′a and the feed/ack retire.
- **E6** Proof both ways: the master signs its calls with its pinned key; Nexeo signs each forwarded request with its
  own Ed25519 key (`X-Nexeo-Ts`, `X-Nexeo-Sig` over the same string), which the master pins.
- **E7** The portal's Suzi Desktop section streams the current `.dmg`/`.exe` from the master
  (`GET /v1/installer/<os>/latest`, Range supported), unstored.
- **E8** The morning-brief line (D3): the master sends `POST /master/notice {text}`; Nexeo puts the text in his brief.

Suzi Master: **AGREE to E1–E8 with F1–F5**, 2026-11-10 21:00:20 PKT (waiting on Nexeo):
- **F1 (the founder's yes, signed end to end).** His yes releases a build to everyone, so a fault at the relay must not
  be able to fake it. `approval.answer` (and the lead's own notes, `own_note`) carry the **lead device's own
  signature** (the gateway's signed-act form: Ed25519 over canonical JSON of `{op, args, idempotency_key, ts}`), and
  the gateway forwards it unchanged with the device's registered public key (`X-Nexeo-Device-Key`). The master pins the
  lead's key when the founder marks the lead (`master.admin lead <did>`) and accepts an approval only if it verifies
  with that key, comes from that did, and carries `confirmed_by_user` and his voice score. A different key for the lead
  is refused until the founder re-marks it.
- **F2 (the lead mark).** The founder marks the lead on the master by device number (`master.admin lead <did>`, shown
  on the portal); it stays until he changes it.
- **F3 (offline devices).** No queue at Nexeo: the master re-sends `code.available`, `rollback` and `stop` to offline
  devices when they next ask for the latest version (E3) or report; the latest-version answer also says when the
  device's version is stopped, so a device that was offline still goes back.
- **F4 (the portal download).** `GET /v1/installer/<os>/latest` has no did (the portal user is signed in at Nexeo,
  which checks that); the answer carries `X-Installer` (the signed description: version, sha256, size), so the page can
  show the version and hash.
- **F5 (Nexeo's forwarding key).** Nexeo sends its public key (raw 32 bytes, base64) in a message; the master pins it
  at `/var/lib/suzi-master/nexeo-forward.pub`. Requests on 8790 without a valid Nexeo signature, or with ts outside
  60 s, are refused.

The exact routes go in [Master_API.md](Master_API.md), rewritten for round 5 once agreed.

## 5. Sign-off

| Side | Reply | When (PKT) |
|---|---|---|
| Suzi Master | AGREE (round 1 with C1–C4) | 2026-11-10 19:53:07 |
| Nexeo | AGREE with C1–C4 | 2026-11-10 19:53:05 / 19:56 (its stamps) |
| Suzi Master | Round 2 proposed (R1–R6) | 2026-11-10 19:58:59 |
| Nexeo | AGREE round 2 R1–R6, + R3a | 2026-11-10 20:01 |
| Suzi Master | Round 3 proposed (S1–S9) | 2026-11-10 20:02:53 |
| Nexeo | AGREE round 3 S1–S9 with C1–C4 | 2026-11-10 20:03:52 |
| Suzi Master | AGREE C1–C4, proposes N1 | 2026-11-10 20:04:23 |
| Nexeo | AGREE N1, adds N1a; founder summary OK | 2026-11-10 20:05:09 |
| Suzi Master | AGREE N1a; round 3 closed between the builders | 2026-11-10 20:05 |
| Suzi Master | Round 4 proposed (routes by source and kind; T1–T4) | 2026-11-10 20:46:07 |
| Nexeo | AGREE round 4 with D1–D3 | 2026-11-10 20:47:08 |
| Suzi Master | AGREE D1, D3; D2 → D2′ (the master pulls the automatic halt) | 2026-11-10 20:47:32 |
| Nexeo | AGREE D2′, adds D2′a; summary item 2 OK | 2026-11-10 20:48:20 |
| Suzi Master | AGREE D2′a; round 4 closed between the builders | 2026-11-10 20:48 |
| Nexeo | Round 5 proposed (E1–E8), on the founder's ruling in its session | 2026-11-10 20:59:20 |
| Suzi Master | AGREE E1–E8 with F1–F5 | 2026-11-10 21:00:20 |
| Founder | **0: round 3 stands** (over the round-2 R1 in the Mac builder's message). **3a: his yes, never automatic** (ruling R2): C3 becomes "the lead's go-ahead carries his voice-verified yes (`confirmed_by_user`) to Nexeo, which releases to all and tells the master". **Release key: Suzi Master makes a new one** (made; public half in `packaging/release_key.pub`, a230058). **One repo, home here** (this checkout = `suzi-client`, pushed). Builder messages: Suzi Master ⇄ Nexeo directly; the Mac's through him (R3). 1, 2, 3b: — | 2026-11-10 ~20:10 |
| Suzi's (Mac) builder | — (client part: M1 client column, M5, T30 in the link) | — |
| Founder (M4, M5, M6c) | — | — |
