# Suzi Master ⇄ Nexeo: Charter

**AGREED by Suzi Master and Nexeo, 2026-11-10 21:04:20 PKT** (drafted by Suzi Master 21:03:05; Nexeo's G1 and G2 folded in). One document in its final state (founder,
10 Nov: "build one agreed document between you both"). It replaces the round-by-round text of rounds 1–5, which
stays in git history (`git log -- protocol/Master_Charter.md`) and in Nexeo's `server/docs/NEXEO_SUZI_AGREEMENT.md`
("T30"). It also replaces `protocol/Master_API.md`. Nexeo's mirror: `/var/www/tmcai/server/docs/Master_Charter.md`.

## 1. The rule

Each kind of information has exactly one owner; the others only ask it (founder). Suzi Clients talk only to Nexeo.
Suzi Master talks only to Nexeo. **Nexeo stores nothing of Suzi's**; for builds, gaps, results and approvals it only
carries messages between the master and the clients (founder: "Nexeo will only be communicator between suzi master
and suzi client").

```
   SUZI MASTER (Ubuntu, 127.0.0.1:8790)      NEXEO (tai.tmcltd.com + Suzi's server)      SUZI CLIENTS
   stores builds, installers, gaps,  ◄──A──  checks each device, forwards unread  ◄─────  lead = founder's Mac
   versions; decides routes, halt,   ──B──►  delivers frames on live connections  ─────►  all others
   stop; signs with the release key          stores nothing of Suzi's
```

## 2. Who owns what

| Owner | Owns (single source of truth) | Never holds |
|---|---|---|
| **Nexeo** | Users and sign-in; each user's knowledge, memory, mail, calendar, WhatsApp; the thinking (AI); **device approval** (the 6-digit code or connect key, one sign-up for both); the device number shown on the portal; the portal's **Suzi Desktop** section (download and connect key); the founder's morning brief | Code, builds, installers, gap notes, results, rollout state (not on disk, not in a database) |
| **Suzi Master** (`/var/www/suzi`) | Suzi's code (the `suzi-client` repo) and every build; the **release key**; the installers; the gap list; which device runs which version; the **lead mark**; the routes, approvals, automatic halt and stop switch; skills, later the operator model | Any user information: no mail, chats, memory, recordings or names. Devices by Nexeo's device number (`did`) only |
| **Suzi Client** (each Mac / Windows PC) | That person's voice and face (never leave the machine), settings, the running code | Other users' data, the release key, the master copy of the code |

## 3. How a build reaches every Suzi

**Source and kind decide the route** (founder, round 4):

| Comes from | Kind | Route |
|---|---|---|
| **Lead** (founder's Mac) | bug or feature | Suzi notes it; his voice-verified yes is the approval → the master builds, tests, signs → **lead first** → the lead self-builds and runs it → Suzi on the lead asks "Send this build to everyone?" → his voice-verified yes → **all** |
| **Another Suzi** | **bug** | Its user's yes → the master builds, tests, signs → **straight to all** (no lead test, no founder approval) |
| **Another Suzi** | **new feature / capability** | Its user's yes → asked of the founder on the lead → his yes → the master builds → lead first → his yes → all |

- **The floor (D1).** A "bug" whose fix needs a new capability, or touches **cost, privacy, sends or a new way of
  reaching the user**, is a feature: lead first, with the founder's approval. The master checks every bug and relabels it.
- **Every client** checks the release signature, builds itself beside the old code, runs its self-check, asks its
  user before restarting, and goes back to its last good build by itself if the new one fails.
- **Automatic halt (D2′).** Once a build has been offered to all, if **2 devices, or 10% of those offered** (whichever
  comes first) report `failed` or `rolled_back`, the master stops it: no more offers, `rollback` to every device that
  took it, and the founder is told once, at once. It never releases anything; restarting is the master's call or his.
- **The stop switch.** The founder stops a release by voice on the lead, or a builder runs `master.admin stop <v>` on
  his word. Same effect as the halt.
- **Morning brief (D3).** Each straight-to-all fix is listed in his next brief: "fixed for everyone: <note>, version V".
- **Offline devices (F3).** Nexeo keeps no queue; a device that was offline gets the update, or the rollback, when it
  next asks the master for the latest version.
- **Skills** take the same route as a fix.
- **Installers.** After every build the master holds a signed `.dmg` and `.exe`. The portal's Suzi Desktop section
  offers the `.dmg` on a Mac and the `.exe` on Windows (both shown), with the version and sha256, streamed from the
  master, unstored. Before one exists, the page says "not available yet". The first install comes from there; every
  later version comes as a build.

**Gaps.** A note is short and written, labelled bug or feature, and holds **no personal data**: never anyone's words,
names, addresses, numbers or content. Nothing personal ever goes in a path or a query string (R3a). The master keeps
the one gap list, assigns the id (`G-n`), and tells the lead "G-n is live in V" through the build's `whats_new`.
G-1 to G-9 (Nexeo's T28 list) carry over as they stand; Nexeo's `gap.report` / `gap.approve` answer
`{error:{code:"moved"}}` once the master's list is live.

**The founder's yes is signed end to end (F1).** Approvals, the lead's own notes and the voice stop carry the lead
device's own signature, forwarded unchanged; the master accepts them only from the lead's did, with the lead's
pinned key, `confirmed_by_user` and his voice score. A fault at the relay cannot fake his yes.

**Every gap note is signed by its device (G1).** A non-lead bug fix goes to everyone on its user's yes, so that yes is
signed too: every note uses the signed form, checked against the did's key (`X-Nexeo-Device-Key`; paired devices use
their pairing key, connect-key devices register one through Nexeo's `/v1/device-key`). The voice score is required only
from the lead. A device with no key gets 403 "register a device key first".

**The lead mark (F2).** The founder marks the lead on the master by device number (`master.admin lead <did>`, the did
as shown on the portal). The lead's device key is pinned on its first signed request after that; a different key for
that did is refused until he marks it again. It is not Nexeo's `primary`.

## 4. The wire

### Signatures

One string form: `"METHOD\npath\nts\nsha256hex(body)"`, `path` = the raw path with its query as the receiver sees
it (forwarded requests: `/v1/<path>?<query>`; the master's calls: the path as it arrives at 4012), `ts` = unix seconds, refused if more than 60 s off; an empty body hashes `""`.

| Who signs | Headers | Key (Ed25519, raw 32 bytes, base64) |
|---|---|---|
| Nexeo, on everything it sends the master | `X-Nexeo-Ts`, `X-Nexeo-Sig` | Nexeo's forwarding key `xrl/2vnfHa3i/C2YPuwy4pwNzPz2DWlHDixRzqjrVc4=`, pinned by the master |
| The master, on everything it sends Nexeo | `X-Master-Ts`, `X-Master-Sig` | The master key `GsMvtB/RB/jt0zQ8YPyIFxJQQDIOTEnAc+VwkfO5y1E=`, pinned by Nexeo |
| The lead device (F1), inside the body | `signed` + `sig` | The device's key, forwarded by Nexeo in `X-Nexeo-Device-Key`, pinned by the master for the lead |

F1's device signature is the gateway's signed-act form: Ed25519 over canonical JSON (keys sorted, no spaces, UTF-8) of
`{op, args, idempotency_key, ts}`, `ts` accepted within 5 minutes, each `idempotency_key` used once.

### A. Client → master, through Nexeo

The client calls `GET|POST /v1/master/<path>` on Suzi's server with its Bearer access token (active device). Nexeo
forwards it **unread** to `http://127.0.0.1:8790/v1/<path>`, streamed both ways, adding `X-Nexeo-Did`,
`X-Nexeo-Device-Key`, `X-Nexeo-Ts`, `X-Nexeo-Sig`. POST bodies at most 1 MB; downloads uncapped. Master down → the
client gets `503 master_unavailable`.

| Master route | Request | Answer |
|---|---|---|
| `GET /v1/latest?version=<v>&base=<n>` | — | `200 {"action":"update","manifest":{…}}` (the lead also gets builds before his yes), or `200 {"action":"rollback","version","reason"}` (its version was stopped), or `204` |
| `GET /v1/code/<file>` | — | The signed zip, if offered to this device; else 404 |
| `POST /v1/report` | `{version, step, why}`, `step` ∈ `staged failed trying healthy rolled_back` | `200 {"ok":true}` |
| `POST /v1/gap` | Always signed (G1): `{signed: {op:"gap.note", args:{label: "bug"\|"feature", text, confirmed_by_user: true, voice_score?}, idempotency_key, ts}, sig}`; `voice_score` required from the lead | `200 {"id":"G-n","state":"approved"\|"new"}`; 403 without a valid device signature; 400 without `confirmed_by_user` |
| `POST /v1/approval` | `{signed: {op:"approval.answer", args:{id, yes, confirmed_by_user, voice_score}, idempotency_key, ts}, sig}` | `200 {"ok":true}`; 403 unless the lead (F1) |
| `POST /v1/stop` | `{signed: {op:"release.stop", args:{version, confirmed_by_user, voice_score}, idempotency_key, ts}, sig}` | `200 {"ok":true}`; 403 unless the lead (F1) |
| `GET /v1/installer/<os>/latest` | — (called by Nexeo's portal for a signed-in user; signed, no did); `os` = `macos` \| `windows` | The installer, streamed; `Accept-Ranges: bytes`, Range → 206; `X-Installer` = base64 of the signed `{os, version, file, sha256, size, made, sig}`; `404` when none yet |

### B. Master → Nexeo: `http://127.0.0.1:4012`

| Route | Body | Nexeo does |
|---|---|---|
| `POST /master/send` | `{to: "<did>" \| "all", frame}`, frame ≤ 16 KB | Delivers the server message `{type: "master", frame}` on the device's live sessions; answers `{delivered: [did…], offline: [did…]}`. No queue; checks only `frame.type` and size |
| `POST /master/notice` | `{to: "<did>", text, urgent: bool}`, text ≤ 500 characters | Maps the did to its user. `urgent: false` → a line in that user's next morning brief (D3). `urgent: true` → at once, through Nexeo's normal reach to that user at high urgency: Suzi if she's live, else WhatsApp, email only if WhatsApp fails; never folded into the brief (G2) |

Frames (`frame.type`): `code.available {version, whats_new}` (fetch `latest`) · `approval.ask {id, kind:
feature_note | lead_build, gap_id?, text, version?}` (lead only; numbered choices; answered by `/v1/approval`) ·
`rollback {version, reason}` (go back, through the usual restart question) · `stop {version, reason}` (don't take it).

The master's rollout: `lead_first` → `code.available` to the lead; when the lead reports `healthy`, `approval.ask`
kind `lead_build`; on his signed yes, `code.available` to all. `all_now` → `code.available` to all and a brief line.
A non-lead feature note → `approval.ask` kind `feature_note` to the lead.

## 5. Rules between the two

1. **Neither side changes the other**: no edits to the other's code, config, web server or tunnel files, services,
   database or secrets (founder). Each uses only what this charter lists. The builders may message each other directly
   and give each other's agents instructions (founder); the Mac builder's messages go through the founder until Suzi
   Master is established, and then the old link is not used.
2. Nexeo stores nothing of Suzi's (section 2) and logs only path, status and did, never bodies.
3. Suzi Master has no public address: it listens on `127.0.0.1:8790` only and accepts only Nexeo-signed requests.
4. Every build and installer is signed by the master's release key (private half only on the Ubuntu box), and every
   client checks it, so neither Nexeo nor anyone else can change code.
5. **Changes**: nothing here changes without both sides' AGREE, recorded with the date and time (PKT, from the
   clock), before any build that depends on it. The founder approves anything on cost, privacy, sends or a new way of
   reaching the user.

## 6. Sign-off

| Side | Reply | When (PKT) |
|---|---|---|
| Suzi Master | AGREE (draft author) | 2026-11-10 21:03:05 |
| Nexeo | AGREE with G1 (every gap note signed) and G2 (urgent notice reach) | 2026-11-10 21:04:20 |
| Suzi Master | AGREE G1, G2; the charter is agreed | 2026-11-10 21:05 |
