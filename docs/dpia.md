# Millennium Arena: data protection impact assessment (DPIA)

| | |
|---|---|
| Controller | Daniyal Zia, an individual in the UK. He has no DPO and doesn't need one. |
| Date | 20 October 2026 (version 1, draft for sign-off) |
| Build assessed | Commit `e5360b6` (20 October 2026), which adds reports, suspensions, the Terms check, the Unranked contact filter and self-hosted card pictures. It is not deployed yet. |
| Format | Follows the ICO's seven DPIA steps ([ICO guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/how-do-we-do-a-dpia/)). Read it alongside `online-safety.md`, the Arena Privacy page, and the site [Privacy Policy](https://daniyalzia.co.uk/privacy), whose transfers, rights and complaints route are not repeated here. |

This is careful research, not legal advice.

## 1. Why a DPIA

The ICO's list of [processing likely to result in high risk](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/examples-of-processing-likely-to-result-in-high-risk) includes offering online services directly to children. Arena accounts are open to anyone aged 13 or over, and the children's access assessment concludes Arena is likely to be accessed by children (`online-safety.md` 3.1). That also brings in the ICO Children's code, whose standard 2 requires a DPIA ([template](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/annex-d-dpia-template/)). Since 5 February 2026, UK GDPR Art 25(1A) has also required data protection by design, for information society services likely to be accessed by children, to take account of "children's higher protection matters" ([DUAA 2025 s.81](https://www.legislation.gov.uk/ukpga/2025/18/section/81), commenced by [SI 2026/82](https://www.legislation.gov.uk/uksi/2026/82/made)).

## 2. The processing

Millennium Arena is a free browser game for Yu-Gi-Oh! duels. It has no ads, no payments, no analytics and no profiling, and it shares its accounts with DeckForge.

**Whose data:** players aged 13 and over (some may be younger despite the rules), players who are reported, other players whose messages appear in a reported chat, and people who email reports or complaints (who may not be players).

**Where it goes:**

- The app and its PostgreSQL database run on Daniyal's own server in the UK. The app reaches the database over a local socket with no password.
- Cloudflare carries the site's traffic.
- Resend, a US company, sends the emails from its EU region (Ireland).
- Mail to `mail@daniyalzia.co.uk`, including report notifications, passes through Cloudflare Email Routing to a personal inbox hosted by Microsoft, as the site Privacy Policy says.
- Google Fonts serves the fonts, so it sees players' IP addresses.
- Card pictures: from `e5360b6`, the server fetches each picture from YGOPRODeck once and serves its own copy, so players' browsers no longer contact YGOPRODeck. The live site still loads them from YGOPRODeck until `e5360b6` is deployed.
- Backups are encrypted, taken nightly and kept for 14 days. The web server's logs, which include IP addresses, are kept for 14 days (site Privacy Policy).

| Data | Purpose | Lawful basis | Kept |
|---|---|---|---|
| Email, bcrypt password hash, username, verified flag, join date, settings (including the chosen card picture) | Account and sign-in (shared with DeckForge) | Contract. Legitimate interests where a 13 to 17-year-old's capacity to contract is doubtful; the processing is the same. | Until the account is deleted |
| Hashed login and trusted-device tokens, with the browser user-agent and a device label; hashed email codes; IP address held in the app's memory for rate limits | Security | Legitimate interests (keeping accounts safe) | Logins: 30 days after last use. Trusted devices: 30 days. Codes: 10 minutes (cleared within a day). IPs: under 1 hour in the app, never written to its database. |
| Decks, settings, match history (including the opponent's username), card-use counts | Playing the game, and showing a player their own stats | Contract | Until the account is deleted. The player's name is then replaced with "A deleted account" in other players' histories. |
| Chat lines | Chat during a duel | Contract | In memory only, up to the last 200 lines per room. Gone when the room closes. A spectator who joins later sees the earlier lines. |
| Terms acceptance (time and version); suspension (time and reason) | Enforcing the Terms and keeping players safe | Legitimate interests (the Online Safety Act requires these duties, but not this exact record) | While the account exists |
| Reports: reporter and reported account and username, chat or profile, room, the reason given (up to 500 characters), and the room's last 20 chat lines from the server's copy | Reviewing reports (OSA ss.20, 21) | Legal obligation; legitimate interests. In CSEA cases, also the recognised legitimate interests for crime and for safeguarding vulnerable individuals (Art 6(1)(ea), Annex 1). | 90 days, then deleted automatically, even if either account is deleted sooner. The notification email holds the same data and must be deleted by hand by day 90 (the email prints the date). CSEA reports sent to the NCA: 1 year, and the reference number for 5 years ([SI 2026/268 reg 8](https://www.legislation.gov.uk/uksi/2026/268/made)). |
| Report forwarded to the NCA | OSA s.66 | Legal obligation | As above |
| Decision log: date, kind, action, appeal outcome. No usernames or chat. | Tracking harm over time (Ofcom Codes A5) | Legitimate interests | Kept privately, outside the public repo. Once the report it refers to is deleted, it no longer identifies anyone. |

Reports may contain allegations of crimes (criminal offence data, Art 10). Occasionally they may contain special category data, such as a slur that reveals a person's religion (Art 9). The relevant conditions are DPA 2018 Sch 1 para 10 (preventing or detecting unlawful acts) and para 18 (safeguarding of children and individuals at risk). Both need a short **appropriate policy document**, which is still to be written. Disclosures to the NCA or the police don't wait for it (para 10(2)).

## 3. Necessity and proportionality

- **Data minimisation.** The data collected is the minimum needed to run accounts and duels. There is no real name, date of birth, phone number, location or photo. Chat isn't stored. Reports keep only 20 lines, for a limited time.
- **Default settings.** Other logged-in players see only a username, record, join date and card picture. The email, decks and history are private, and opponents don't see deck names. There are no friends, DMs, profiling, nudges or notifications.
- **Age checks.** Age is self-declared and not verified. Highly effective age checks would mean collecting ID or face scans from every player, which is more intrusive than the risk justifies. The Online Safety Act doesn't require them as long as the Terms ban all primary priority content (`online-safety.md` 3.2). This is reviewed if the online safety levels rise.
- **Rights.** Players can delete their account themselves in Settings, which removes it from both sites. Other rights requests go by email to `mail@daniyalzia.co.uk`, as set out on the Privacy page.
- **Processors and transfers.** Cloudflare and Resend act as processors under their own terms. US transfers rely on the UK Extension to the Data Privacy Framework, or approved clauses. The report inbox is a personal mailbox hosted by Microsoft. If it is a consumer Outlook.com account, Microsoft is bound by its consumer terms, not a processor contract. That is one more reason to keep report details out of email (risk 2).
- **Children's code, briefly.** Best interests: the design keeps strangers from finding or following each other. High-privacy defaults: profiles are seen only by logged-in players, and there is no location sharing and no profiling. Transparency: the Privacy and Terms pages are in plain English, and a "Staying safe" page for children and parents is planned (`online-safety.md` R5). There are no nudges and no sharing beyond the processors, and the NCA or police where the law requires it.

## 4. Consultation

Players were not consulted before launch, and that is recorded here as a decision. It is a free hobby service run by one person, it launched on 18 October 2026, and there is no organisation or user group to ask, so a formal consultation would be disproportionate. Instead:

- the Privacy page and the planned Staying safe page invite comments by email;
- comments from players, and from any parent who writes in, are noted and considered at each review;
- if Arena grows past a hobby audience (`online-safety.md` 4.7), a few regular players, and a parent if possible, are asked to comment before the next review.

## 5. Risks to individuals

Likelihood: remote, possible or probable. Severity: minimal, significant or severe.

| # | Risk | Likelihood | Severity | Before measures |
|---|---|---|---|---|
| 1 | A child is contacted, abused or groomed by a stranger through chat | Possible | Severe | **High** |
| 2 | Report data (children's chat, allegations, other players' lines) is kept too long or spreads, for example copies sitting in the inbox | Possible | Significant | Medium |
| 3 | A player is wrongly suspended over a false or edited report | Possible | Significant | Medium |
| 4 | Account takeover or a database breach exposes email addresses | Remote | Significant | Low |
| 5 | A child reveals their identity or age through their username or profile | Possible | Significant | Medium |
| 6 | Under-13s use the service despite the rules | Possible | Significant | Medium |
| 7 | Third parties (Google Fonts, Cloudflare, and YGOPRODeck until `e5360b6` is live) see players' IP addresses; US transfers | Probable | Minimal | Low |
| 8 | Data is kept indefinitely for inactive accounts | Probable | Minimal | Low |

## 6. Measures and residual risk

| # | Measures | After measures |
|---|---|---|
| 1 | Ephemeral, text-only chat with rate limits; mute; no DMs, friends, images or clickable links; links and contact details refused in Unranked; Report flag with review by a person; suspension; 13+ Terms acceptance. Planned: refuse room codes in Unranked, and don't pair two players again after a report (`online-safety.md` R6, R8). Unranked keeps free text (decided 20 October 2026). | **Medium, accepted.** This matches the online safety assessment, which rates grooming Medium. |
| 2 | Automatic deletion after 90 days; only 20 lines kept; the NCA exception written down; reports listed on the Arena Privacy page. Planned: **send the notification email without chat lines** (`online-safety.md` R7). | Low once the email carries no chat lines. Until then Low to Medium, because the inbox copy relies on deleting it by hand. |
| 3 | Chat lines are taken from the server's copy, not the reporter's browser; review by a person; appeals answered within 14 days | Low |
| 4 | bcrypt (cost 12); only hashes of tokens and codes are stored; codes for new devices; rate limits; HttpOnly, Secure, SameSite=Strict cookies; strict CSP; encrypted backups; the database is reached over a local socket with no password | Low |
| 5 | The profile shows no age and is visible only to logged-in players. **Add a hint on the username step: "Don't use your real name or age."** | Low |
| 6 | 13+ acceptance; accounts reported as under-13 are deleted; no data that would profile children | Low to Medium, accepted |
| 7 | Processor terms and transfer basis; card pictures self-hosted (`e5360b6`); **self-host the fonts too** | Low |
| 8 | **Recommended:** delete accounts unused for 2 years, after an email warning | Low |

**Residual risk:** low to medium overall, with risks 1 and 6 accepted at that level. No high risk remains, so prior consultation with the ICO isn't needed.

Still to do before sign-off:

- Write the appropriate policy document (one page: which Sch 1 conditions, how the principles are met, how long report data is kept).
- Add the NCA exception (1 year, reference number 5 years) to the Arena Privacy page's retention list.
- The site-wide Privacy Policy doesn't mention reports yet, and it calls Resend both a US company and "an email delivery service in Ireland". It should say: a US company that sends from Ireland (for the Portfolio chat).

Already decided: no ICO data protection fee is due (Daniyal, 20 October 2026).

## 7. Sign-off

| | |
|---|---|
| Measures approved by | Daniyal Zia (controller) |
| Residual risks approved | ☐ Yes, with risks 1 and 6 accepted |
| Signed | ______________ Date: ______ (by 17 January 2027, with the online safety assessment) |
| Next review | By **20 October 2027**, or before any change listed in `online-safety.md` 4.7 (for example DMs, friends, images or ranked play) |
