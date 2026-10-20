# Millennium Arena: online safety assessment

| | |
|---|---|
| Service | Millennium Arena, `daniyalzia.co.uk/millenniumarena` (live since 18 October 2026; Unranked matchmaking live since 20 October 2026) |
| Provider and accountable person | Daniyal Zia, an individual in the UK |
| Date | 20 October 2026 (version 1, draft for sign-off) |
| What it covers | Illegal content risk assessment (Online Safety Act 2023, s.9), children's access assessment (s.35), children's risk assessment (s.11), and the record of Code measures (s.23) |
| Build assessed | Commits `e5360b6` and `114a6ff` (the safety basics, 20 October 2026) and `9221b1b` (the follow-ups T1 to T4, R1 to R6, R10 and the NCA hold, 21 October 2026). All are live since 21 October 2026 (the site's footer links the exact commit it's running). |
| Next review | By 20 October 2027 at the latest, and before any significant change (section 4.7) |

This is careful research, not legal advice. It follows Ofcom's four-step method and the documents listed under Sources, checked on 20 October 2026. Site-wide rules are not repeated here. They are in the [Terms](https://daniyalzia.co.uk/terms) (including how to report) and the [Privacy Policy](https://daniyalzia.co.uk/privacy).

DeckForge shares Arena's accounts but is a separate service. It needs its own check.

**In short**

- Arena is a user-to-user service that children are likely to use. All three assessments are due by **17 January 2027**.
- Decided on 20 October 2026: **Unranked chat keeps free text**, with links and contact details blocked.
- With free text between strangers, the honest levels are **Medium** for grooming, harassment and hate (illegal content), and for abuse and hate, bullying, and suicide and self-harm content (children). Everything else is Low or Negligible.
- That makes Arena **"multi-risk" under both Ofcom Codes**. For a one-person service most of the extra measures are written policies, and section 4 now contains them. A few small changes to the site are still needed (section 2.4, items T1 to T4 and R1 to R6).
- **Live since 21 October 2026:** the Report button, suspensions, the 13+ step, the contact and room-code filter, and T1 to T4 and R1 to R6.
- **Left to do:** sign (4.8) by 17 January 2027. The NCA portal is registered only if a report is ever needed (Daniyal's decision, 21 October 2026; see 4.5).

## 1. Why the Act applies

- **It is a user-to-user service ([s.3](https://www.legislation.gov.uk/ukpga/2023/50/section/3)).** Players' chat messages, usernames and profiles can be seen by other players.
- **No exemption in [Schedule 1](https://www.legislation.gov.uk/ukpga/2023/50/schedule/1) fits.** Its user content is not only email, SMS/MMS or one-to-one voice calls. It is not a "limited functionality" service, because users talk to each other freely rather than only commenting on the provider's own content. It is not an internal business tool, a public body or an education provider.
- **It has UK links ([s.4](https://www.legislation.gov.uk/ukpga/2023/50/section/4)).** It is run from the UK by a UK resident on a .co.uk domain, and UK players are its main audience.
- **It is far too small to be categorised**, so only the duties that apply to every regulated service apply: risk assessments ([s.9](https://www.legislation.gov.uk/ukpga/2023/50/section/9), [s.11](https://www.legislation.gov.uk/ukpga/2023/50/section/11)), illegal content safety ([s.10](https://www.legislation.gov.uk/ukpga/2023/50/section/10)), children's safety ([s.12](https://www.legislation.gov.uk/ukpga/2023/50/section/12)), content reporting ([s.20](https://www.legislation.gov.uk/ukpga/2023/50/section/20)), complaints ([s.21](https://www.legislation.gov.uk/ukpga/2023/50/section/21)), records and review ([s.23](https://www.legislation.gov.uk/ukpga/2023/50/section/23)), the children's access assessment ([s.35](https://www.legislation.gov.uk/ukpga/2023/50/section/35)), and reporting CSEA to the National Crime Agency ([s.66](https://www.legislation.gov.uk/ukpga/2023/50/section/66), whose reporting regulations have applied to user-to-user services since 7 April 2026).

**Deadlines.** [Schedule 3](https://www.legislation.gov.uk/ukpga/2023/50/schedule/3) para 3 covers a new service that starts when Ofcom's guidance already exists. "The first day" is the first day it is a Part 3 service, here 18 October 2026. The first illegal content risk assessment and the first children's access assessment must both be completed within three months beginning with that day. **That makes the deadline 17 January 2027.**

The children's risk assessment has its own clock. A service is treated as likely to be accessed by children from the date its children's access assessment is completed ([s.37(3)](https://www.legislation.gov.uk/ukpga/2023/50/section/37)), and the children's risk assessment is due within three months of that day (Sch 3 para 5). This document does all three, so signing it completes all three.

> **Check the first day.** The deploy history shows the first public release with accounts, private rooms and chat on 18 October 2026. If the public could reach them earlier (they were committed on 12 October), the clock started then. Finishing by **11 January 2027** is safe either way.

## 2. Illegal content risk assessment

### 2.1 The service as it is

| What users can do with each other | What they can't do |
|---|---|
| **Unranked:** strangers are paired for one best-of-1 duel, with a chat panel. Chat offers quick replies (GG / Good luck! / Nice play / Thinking…) or free text of up to 200 characters. There are no spectators and no rematch. From `e5360b6`, messages that look like a link, email address, phone number or social-media handle are refused. | Share images, video, files or voice. Links in chat are plain text and can't be clicked. |
| **Private rooms:** joined with a 6-character code or invite link, optionally with a password. Room chat includes up to 12 spectators, and every duelist must accept each spectator. Either duelist can remove a spectator. A new spectator sees the room's earlier chat. Room chat is not filtered. | Send direct messages outside a match, add friends or followers, join groups, or use a global or lobby chat. |
| **Usernames** are seen by opponents and spectators. Other logged-in players can open a profile that shows the player's record (wins, losses, streaks), when they joined, and a card picture they chose. | Search for other users' content. There is no recommender feed, livestreaming, location sharing, marketplace, payments or ads. |
| **Chat is not stored.** It lives in the room's memory (the last 200 lines) and disappears when the room closes. It is limited to 8 lines per 10 s with at least 0.4 s between lines, and 60 per minute per account. Mute hides what others say, in that browser only, until the page is reloaded. | See anyone's email, decks or match history. Opponents don't see each other's deck name. |

Accounts require a verified email and are for people aged 13 or over. Age is self-declared and not checked. Usernames are 3 to 16 letters, numbers or underscores, starting with a letter. A list of names (admin, mod, support, staff, official, konami and others) is reserved, as exact matches only. A name can be changed once every 30 days.

**Added by `e5360b6`:** a Report flag in the duel chat and on profiles (at most 10 reports an hour per account); suspensions that log the account out and block login, chat and matchmaking within 30 seconds; and a one-time "I'm 13 or older and agree to the Terms" step that every account must complete before chatting or playing other people.

### 2.2 Ofcom's risk factors

These are the answers to the questions in the U2U Risk Profile (Risk Assessment Guidance v2.0, Figure 1 and Table 9).

| Risk factor | Arena | Notes |
|---|---|---|
| 1c Gaming service | **Yes** | Ofcom links this to terrorism, grooming, hate and harassment. |
| 1b Messaging service; 1e Chat room or forum | No | Chat exists only inside a match or room. It is not open to the public or an open group. |
| 2 Child users | **Yes** | 13 to 17-year-olds are allowed, and under-13s may ignore the rule. |
| 3a User profiles | **Yes** | The profile shows a record, join date and card picture, never an age or photo. |
| 3b Anonymous or pseudonymous users | **Yes** | Usernames are aliases, although an account and verified email are required. |
| 4a User connections | No | No friends or follows. |
| 4b User groups or group messaging | **Yes** | A private room is a closed group chat of up to 14 people that ends when the room closes. |
| 5b Direct messaging | **Treated as yes** | Unranked chat is one-to-one with a stranger. It is ephemeral. |
| 5a, 5c to 5g (livestream, encryption, comments, images or video, location, reposting); 6 sales; 7a search; 7b hyperlinks; 8 recommenders | No | URLs typed in chat are plain text and can't be clicked. |
| General: user base, business model, capacity | Small, free, no growth targets | Ofcom notes that low-capacity services have less moderation resource. Here one person does everything. |

**Evidence used** (Ofcom's "core inputs"): these risk factors; Ofcom's Register of Risks (25 June 2026); the code itself (`server/src/match.ts`, `server/src/index.ts`, `server/src/safety.ts`, `client/src/duel/DuelScreen.tsx`, `server/src/db/index.ts`); and the reports received so far, of which there are none. The service has been live for two days, has very few players, and holds no age data. The lack of evidence is a reason for caution, not for comfort, so where the evidence was unclear the higher level was chosen.

### 2.3 Risk of each kind of priority illegal content

**Live now** is the deployed site (Mark 1 plus Unranked, no Report button, no contact filter). **After `e5360b6`** is the same site with everything in 2.4 marked "Built", and with free text kept in Unranked.

| Kind (Ofcom's 18) | Why this level | Live now | After `e5360b6` |
|---|---|---|---|
| **CSEA: grooming** | The main way a duel chat could be abused: an adult paired with a 13 to 17-year-old in Unranked builds rapport in free text and asks to move to another app. Ofcom's Grooming Risk Level Table (13.3) alone would allow Low, since Arena has only one of its six listed factors (gaming). But the wider Risk Profile lists five grooming factors Arena has (gaming, child users, profiles, group messaging, one-to-one chat), and there is no evidence yet either way. The conditions for High don't apply: profiles show no age. Limits: no DMs, friends or rematches, chat ends with the room, and links and contact details are refused in Unranked. Weak spots: pattern filters are easy to get around, a room code isn't blocked, so strangers can move to an unfiltered private room (R6), and with few players online the same two can be paired again (R8). | **Medium** | **Medium** |
| CSEA: image-based CSAM | Nothing visual can be uploaded or shared. Profile pictures come from the fixed card database. | Negligible | Negligible |
| CSEA: CSAM URLs | A URL can be typed into chat but can't be clicked. The audience is 1 to 13 people. The Risk Profile's specific factor for CSAM URLs is hyperlinks, and Arena's links aren't clickable. After `e5360b6` they are refused in Unranked; they can still be typed in private rooms. | Low | Low |
| **Harassment, stalking, threats, abuse** | Ofcom's harassment kind includes threats to kill and Public Order Act ss.4A and 5 (threatening or abusive words that cause harassment, alarm or distress). So abuse from a sore loser can be illegal content, not just rudeness. Arena has four of the profile's factors (gaming, profiles, pseudonyms, one-to-one chat). Mute, one-session chat and no way to follow someone keep the impact down. Reports and suspensions deal with repeat offenders, but they are new and unproven. | **Medium** | **Medium** |
| **Hate** | Racially or religiously aggravated public order offences (Crime and Disorder Act 1998 s.31) are in Ofcom's hate kind, so a slur aimed at an opponent can be priority illegal content. Chat and usernames have no word filter. Arena has four or five of the profile's factors. The audience is one opponent or a small room and nothing spreads, which keeps the impact moderate, not high. | **Medium** | **Medium** |
| Terrorism | Gaming is a risk factor because of recruitment, but there is no reach, no media, no clickable links and no groups beyond a single room. | Low | Low |
| Fraud and financial services | Scams such as "free gems" offers or "I'm an admin, send your password" are possible. The site has no payments and never asks for passwords in chat. Staff names are reserved, but only as exact matches, so "Arena_Admin" is allowed (R9). | Low | Low |
| Encouraging or assisting suicide or serious self-harm | Insults like "kys" are possible. The offence needs intent, which makes it unlikely here. The same content is assessed for children in 3.2, where it is Medium. | Low | Low |
| Controlling or coercive behaviour | This needs an existing relationship. Location, DMs and persistent contact are all absent. | Low | Low |
| Drugs; firearms, knives and other weapons; sexual exploitation of adults; human trafficking; unlawful immigration; proceeds of crime | Text could carry an offer, but there is no marketplace, listings, search or payments, and each message reaches one opponent or one small room. | Low | Low |
| Intimate image abuse; extreme pornography; cyberflashing; animal cruelty | These need images or video, which Arena doesn't support. The 48-hour takedown rule for intimate image reports (s.10(3A), in force since 29 June 2026) cannot arise. | Negligible | Negligible |
| Foreign interference | There is no audience or reach. | Negligible | Negligible |
| Other (non-priority) illegal content | For example, threatening or false communications (ss.179 and 181 of the Act). Handled through the harassment measures and the report route. | Low | Low |

**What the levels mean for the Codes.** Arena is Medium for three kinds: CSEA (because of grooming), harassment and hate. A service at medium or high risk of two or more kinds is a **multi-risk service** (Illegal content Codes, para 5.6; grooming isn't counted on its own, but CSEA, which includes it, is). That is true now and stays true after `e5360b6`. It adds ICU A3, A5 to A7, C3 to C7 and D8 (written policies, in section 4), and, because Arena is at medium risk and likely to be accessed by children, ICU D3 to D6 (information around reports: R1, R2). ICU F1 and F2 (safety defaults for child users) don't apply: Arena has no existing way to tell a user's age, isn't at high risk of grooming and isn't large. The full list is in 2.6.

### 2.4 Measures

| # | Measure | Status |
|---|---|---|
| E1 | Chat is ephemeral, text-only and limited to 200 characters. Control characters are stripped and the rate limits apply. There are no images, files, clickable links, DMs, friends or groups. | Live |
| E2 | Mute (hides the opponent and spectators). Spectators need every duelist's approval and can be removed, and Unranked has none. Private rooms use a code or link, with an optional password. | Live |
| E3 | Minimal profiles: the record, join date and card picture only, visible only to logged-in players. Emails, decks and histories are private. Staff and brand usernames are reserved. Name changes are limited to one every 30 days. | Live |
| M1 | **Report flag** in the duel chat and on profiles. It stores the reporter, the reported player, the reason, and the room's last 20 chat lines taken from the **server's** copy of the room (so the reporter can't edit them) in `arena.reports`, deletes them after 90 days, and emails Daniyal. The email includes the chat lines (see R7). | Built (`e5360b6`) |
| M2 | **Every report is reviewed by a person** (Daniyal), as described in 4.2. | Ready |
| M3 | **Suspension**: logs the account out and blocks login, chat, matchmaking and joining rooms within 30 seconds. Set by hand in the database for now. | Built (`e5360b6`) |
| M4 | **Arena Terms**: what's banned (illegal content, harassment, bullying, threats, hate, sexual content, contacting children or asking for personal details, spam and scams), how to report, what happens, and appeals within 14 days. Gaps are T1 to T4. | Built (`e5360b6`), gaps open |
| M5 | **"I'm 13 or older and agree to the Terms"**, stored with the time and the Terms version. Chat, matchmaking and rooms wait for it, and older accounts and accounts made on DeckForge are asked once. | Built (`e5360b6`) |
| M6 | **Arena Privacy page** updated: who is responsible, legal bases, retention (reports included), transfers, user agent. See `dpia.md`. | Built (`e5360b6`) |
| M7 | **Unranked contact filter**: messages that look like a link, email address, phone number or social-media handle are refused, and the sender is told why. | Built (`e5360b6`) |

**To do before sign-off (needed for the Codes that apply):**

| # | Change | Why |
|---|---|---|
| T1 | Arena Terms: also ban content that encourages or gives instructions for suicide, self-harm or eating disorders. With sexual content already banned, that covers all primary priority content. | If the Terms allow any kind of primary priority content, PCU B4 calls for highly effective age checks. |
| T2 | Arena Terms: a short "How we keep you safe" section. Say separately for terrorism content, CSEA content and other illegal content how it's removed and how quickly, and for each kind of content harmful to children how children are protected. Add that accounts run by or for proscribed organisations are removed. | ICU G1.2(a), PCU G1.2(a), ICU H1 (all services). |
| T3 | Arena Terms: describe the Unranked filter as an automatic check (keyword and pattern matching) that runs on every Unranked message before it's sent, stores nothing, and can be complained about like any decision. The site-wide Terms say "Nothing you share is scanned automatically", which is no longer true for Arena. | A keyword filter is "proactive technology" under [s.231](https://www.legislation.gov.uk/ukpga/2023/50/section/231), and the Terms must explain it (ICU and PCU G1.2(b)). The site-wide Terms belong to the Portfolio chat. |
| T4 | Arena Terms (and the site-wide Terms): say that child sexual exploitation and abuse, including grooming, is reported to the National Crime Agency, not only "child sexual abuse material". | s.66 covers all CSEA content (4.5). |
| R1 | Report dialog: before sending, say that the reported player is never told who reported them, and what an appealing player is told (suggested: the rule and the messages, never the reporter's name). | ICU and PCU D3. |
| R2 | After sending: show a rough timescale (urgent cases the same day, others within 2 days), the possible outcomes (no action, warning, name reset, suspension, account removal), and "we don't send updates on in-app reports; email us if you'd like to hear back". Email reports get a short reply with the same information. | ICU and PCU D4 to D6. |
| R3 | A link to the "Staying safe" page (R5) on the sign-up step and in the Terms. | PCU F1.7 asks for the materials during registration. |
| R4 | After a report is sent: a line pointing to support, for example Childline (0800 1111, childline.org.uk) and Samaritans (116 123). | PCU F3 (bullying and suicide content are Medium). |
| R5 | A short public **"Staying safe"** page: how to report, mute, leave a duel and remove a spectator, with a section for children (with pictures of the flag and speaker buttons) and one for parents. Link it from sign-up, the Terms and the site footer. | PCU F1 (multi-risk for children). |
| R6 | Refuse live room codes in Unranked chat, so strangers can't move to an unfiltered private room. | Closes the main way around M7 (grooming). |

**Done (21 October 2026, `9221b1b`):** T1 to T4 and R1 to R6, plus R10 (the switch: `ARENA_UNRANKED_QUICK_ONLY=1` in the server's environment makes Unranked chat quick replies only) and the NCA hold in 4.5 (`arena.reports.keep_until`). Unranked chat now also refuses the codes of open rooms (R6). R7 to R9 below aren't needed now (Daniyal's decision, 21 October 2026); look at them again at the next review, or sooner if reports grow.

**Recommended, not required by the Codes:**

- **R7** Keep chat lines out of the notification email (send the report number and reason only). At the moment the lines pass through Resend, Cloudflare Email Routing and a Microsoft-hosted inbox, and the Privacy page promises that copy is deleted by day 90, which relies on deleting it by hand.
- **R8** Don't pair two players again in Unranked when one has reported the other. This matters while few players are online.
- **R9** A way to reset an offensive username (by hand is fine), a short slur blocklist for new names, and reserved words matched inside names, not only exact names.
- **R10** A switch to turn off free text in Unranked for a while (quick replies only), for when reports pile up or Daniyal is away (see 4.4, resourcing).

### 2.5 Decision: free text stays in Unranked

Daniyal decided on 20 October 2026 that Unranked chat keeps free text, with reporting, mute, suspensions and the contact filter as the safeguards (M1, M3, M7). This assessment takes that as settled. It is the main reason six kinds stay at Medium (2.3, 3.2) and Arena is multi-risk under both Codes.

### 2.6 Code measures that apply, and where Arena stands (s.23(3) record)

ICU means the Illegal content Codes and PCU the Protection of Children Code. Both are the versions in force from 2 November 2026; the illegal content one adds crisis-response measures (C15, C16) that apply only to large or high-risk services.

| Measure | Arena |
|---|---|
| A2 (ICU, PCU): a named accountable person | Daniyal Zia (4.1, and named in the site Terms). |
| A3, A5, A6, A7 (ICU, PCU; multi-risk): responsibilities, tracking, code of conduct, training | 4.1 and 4.4. |
| C1, C2 (ICU, PCU): review suspected content and act swiftly | Daniyal reviews every report (M1, M2). Chat is usually gone by the time a report is read, so action is taken against the account (M3) or the username. Takedown is technically possible, because all chat passes through Arena's server unencrypted. |
| C3 to C7 (ICU, PCU; multi-risk): content policies, targets, priorities, resourcing, training | 4.2 to 4.4. C8 doesn't arise (no volunteers). |
| D1, D2 (ICU, PCU): complaints that are easy to find and use, with a tool next to the content | Report flag on the chat panel and on profiles (M1). Anyone, including non-users, can email `mail@daniyalzia.co.uk` with the subject "Report". |
| D3 to D6 (ICU, PCU; medium risk): information before and after a report, opt-out | To do (R1, R2). |
| D7, D8, D10 (ICU, PCU): act on reports; appeals with targets; reverse wrong decisions | 4.2. |
| ICU D11 to D13, PCU D13 and D14: other complaints, complaints about proactive technology, manifestly unfounded complaints | Handled by the same email route. A complaint that the Unranked filter blocked something wrongly is treated like an appeal. |
| G1, G3 (ICU, PCU): Terms that say how users and children are protected, clearly written | M4 plus T1 to T4. The Terms are written in plain English for a 13-year-old reader. |
| ICU H1: remove accounts of proscribed organisations | Policy in 4.3. To be added to the Terms (T2). |
| PCU F1: support materials for children and parents | To do (R3, R5). |
| PCU F3: point children to support after a report | To do (R4). |
| PCU J3: nobody joins a group chat without agreeing | Met by design. Players join a room only by entering its code or link themselves, and spectators need every duelist's approval. |
| PCU B1 to B7: age assurance | Not needed, as long as the Terms ban all primary priority content (T1) and the content in 3.2, and takedown stays technically possible. |
| Not applicable | ICU A1, A4, C8 to C10, C14 to C16, D9 (replaced by D8), D14, E1, F1, F2, G2, J1 to J3; PCU A1, A4, C8, C11, C12, D9, D11, D12, E1 to E3, F2, F4, F5, G2, J1, J2. These need a large service, high risk, Category 1, volunteers, age checks, a recommender feed, search, images or comments, none of which Arena has. |

## 3. Children

### 3.1 Children's access assessment (s.35, [Ofcom quick guide](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/quick-guide-to-childrens-access-assessments))

- **Stage 1: is it possible for children to access the service?** **Yes.** Under [s.35(2)](https://www.legislation.gov.uk/ukpga/2023/50/section/35) a provider can say no only if age verification or age estimation means children are not normally able to access it, and Ofcom says that must be highly effective age assurance. Arena relies on a self-declared 13+ statement, which does not count.
- **Stage 2: is the child user condition met?** **Yes.** One limb is enough:
  - (a) A significant number of children use it. Under s.35(4) this is judged on evidence of who actually uses the service. Arena holds no age data, so it can't rule this out. The Terms admit 13 to 17-year-olds, and Ofcom says "even a relatively small number of children could be significant".
  - (b) It is of a kind likely to attract children. This is clearly met: it is a free, browser-based duel game for a card game and anime franchise that many teenagers play, with nothing to download or pay for.
- **Conclusion: Arena is likely to be accessed by children.** The children's safety duties apply from the date this assessment is completed (s.37(3)).

### 3.2 Children's risk assessment (s.11, [Ofcom Children's Risk Assessment Guidance](https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/statement-protecting-children-from-harms-online/main-document/childrens-risk-assessment-guidance-and-childrens-risk-profiles.pdf))

Risk factors from the Children's Risk Profile: gaming service (1d), user profiles (2a), pseudonymous users (2b), group messaging (3b, private rooms) and one-to-one chat (4b, Unranked). For abuse and hate content Arena has five of the factors Ofcom lists, and for bullying four. Arena has none of the engagement features Ofcom flags (likes, notifications, infinite scroll, feeds).

**Age groups.** The 13 to 15 group matters most: Ofcom notes that mental-health difficulties more often begin at this age, which makes cruel messages hit harder. The 16 to 17 group also uses the service. Ofcom also says to consider age groups the provider has reason to believe may be using the service, so 10 to 12-year-olds ignoring the 13+ rule are included.

| Content harmful to children | Why | Live now | After `e5360b6` |
|---|---|---|---|
| Primary priority: pornographic content | Text only, 200 characters, and sexual content is banned (M4). Two of Ofcom's factors (group messaging, one-to-one chat). | Low | Low |
| Primary priority: suicide and self-harm content | "kys"-style messages from strangers in a heated game are common in gaming chat, and telling a child to kill themselves can be suicide content. Only one of Ofcom's factors applies (group messaging), but nothing filters free text. | **Medium** | **Medium** |
| Primary priority: eating disorder content | Possible in text, but there is no context for it. Two of Ofcom's factors (user profiles, group messaging). | Low | Low |
| Priority: abuse and hate | Gaming is a risk factor. Strangers can send free text, and usernames are not filtered. Reports and suspensions are new and unproven. | **Medium** | **Medium** |
| Priority: bullying | Humiliating messages in a match, and repeated pairing with the same player while few are online. | **Medium** | **Medium** |
| Priority: violent content | Three of Ofcom's twelve factors (gaming, pseudonyms, group messaging), but text only, with no media. Threats aimed at a player are covered under bullying. | Low | Low |
| Priority: harmful substances; dangerous stunts and challenges | None of Ofcom's factors apply. There is no media, reach or feed. | Negligible | Negligible |
| Non-designated (for example body-shaming or hopelessness content) | Possible as insults. Short-lived. | Low | Low |

**What the levels mean for the children's Code.** Arena is Medium for three kinds, so it is **multi-risk (children)** (PCU para 5.5). That adds PCU A3, A5 to A7, C3 to C7 and D8 (section 4), D3 to D6 (R1, R2), F1 (R3, R5) and F3 (R4). See 2.6.

**Keep pornography, and content promoting suicide, self-harm or eating disorders, banned for everyone in the Terms (T1).** Ofcom's [protection of children duties page](https://www.ofcom.org.uk/online-safety/protecting-children/protection-of-children-duties-under-the-online-safety-act) says services that don't prohibit primary priority content for all users must use highly effective age assurance. PCU B4 says the same, and it also applies where such content is banned but the provider can't technically take it down. Arena can, so T1 is what keeps it out of age checks.

## 4. Governance

These sections are the written policies that the multi-risk measures ask for. They are short because one person runs everything.

### 4.1 Accountable person and responsibilities (A2, A3)

Daniyal Zia is the provider and the only person who builds, runs and moderates Arena. He is accountable for, and decides on:

- these assessments and their reviews;
- the Terms and the Staying safe page;
- reviewing reports, complaints and appeals, and suspending or removing accounts;
- reports to the National Crime Agency;
- keeping the measures in 2.4 working.

Nobody else has access to report data.

### 4.2 Handling reports, targets and appeals (C1, C2, C4, C5, D7, D8, D10)

Reports arrive from the Report flag (M1), or by email to `mail@daniyalzia.co.uk` with the subject "Report". The email route is open to anyone, including people who aren't users (s.20). Daniyal reads every report, and checks for new ones at least once a day.

**Priority (C5)**, highest first:

1. A child at risk, a threat to someone's life, or CSEA (including grooming): suspend the account, keep the evidence, report to the NCA (4.5). Call 999 if someone is in immediate danger.
2. Hate, threats, sexual content, or attempts to get a player's contact details or move them to another app.
3. Everything else: rudeness, spam, scams, usernames.

**Targets (C4):**

- Priority 1 the same day.
- Priorities 2 and 3 within 2 days.
- Appeals answered within 14 days.
- Accuracy: every suspension is checked against the chat lines the server saved, not only the reporter's account of it. If more than 1 in 5 appeals in a year is upheld, review the content policy (4.3).

**Outcomes:** no action, a warning by email, a username reset, a temporary or permanent suspension (M3), or account removal. Chat is usually gone when a report is read. If the room is still open, a suspension stops the account chatting within 30 seconds.

**Appeals (D8, D10):** by email to the same address. Each appeal is looked at afresh against the saved chat lines, with the most serious actions (removal, long suspensions) looked at first. Wrong decisions are reversed: the suspension is lifted or the name restored, and the player is told.

Report records are deleted after 90 days, except NCA cases (4.5).

### 4.3 Content policy (C3)

What counts as each kind follows Ofcom's Illegal Content Judgements Guidance and its Guidance on Content Harmful to Children. Usual actions:

| What | Usual action |
|---|---|
| Grooming, sexual messages to or about a child, any CSEA | Suspend at once, keep the evidence, report to the NCA. Remove the account. |
| Threats to kill or of serious violence | Suspend. Consider telling the police. |
| Accounts run by or for a proscribed organisation, or terrorist content | Remove the account. Consider telling Counter Terrorism Policing. |
| Hate, slurs, harassment, bullying, sexual content | A warning the first time for milder cases. Suspend for slurs, threats or repeats. |
| Telling someone to kill or harm themselves | A warning or suspension, depending on how serious it is. The reporter is pointed to support (R4). |
| Asking for contact details, or trying to move a player to another app | A warning. Suspend if the other player may be a child or it happens again. |
| Spam, scams, impersonation, offensive usernames | Username reset or suspension. |

The policy is updated when tracking (4.4) shows something new.

### 4.4 Training, conduct, tracking and resourcing (A5, A6, A7, C6, C7)

- **Training (A7, C7):** before signing and at each review, Daniyal reads the parts of Ofcom's Illegal Content Judgements Guidance on grooming, harassment, hate and threats, the parts of its Guidance on Content Harmful to Children on bullying, abuse and hate, and suicide and self-harm, and the NCA portal guidance. The date goes in the review log.
- **Code of conduct (A6):**
  - Report data is used only to review reports.
  - It is never shared except with the NCA or the police.
  - It isn't copied anywhere beyond the database and the report email, such as personal notes or chats.
  - A reported player who may be a child is contacted only through the report process.
  - If a report involves someone Daniyal knows, he notes that in the log.
- **Tracking (A5):** a decision log records, for each report, the date, the kind, the action and any appeal. It holds no usernames or chat text, and it is kept privately, outside this public repo. Once a month, count reports by kind. The baseline is zero. The first report of a new kind (for example the first grooming report), or a clear rise, triggers a review (4.7).
- **Resourcing (C6):** one person. If Daniyal will be away for more than 2 days, or reports pile up past the targets, he pauses free text in Unranked (R10: set `ARENA_UNRANKED_QUICK_ONLY=1` and restart with `pm2 restart millennium --update-env`) or pauses Unranked, until he can keep up. There are no volunteers (C8).

### 4.5 CSEA and the NCA

Section 66 requires UK providers to report detected CSEA content to the NCA, whatever their size. The [reporting regulations](https://www.legislation.gov.uk/uksi/2026/268/made) have applied to user-to-user services since 7 April 2026. CSEA content includes grooming messages, not only images.

- **Registering on the NCA's CSEA Industry Reporting Portal.** [Ofcom](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/duty-to-report-child-sexual-exploitation-and-abuse-csea-content-know-the-rules-and-how-to-comply) says to register in advance, and reg 4 requires registration before the first report. **Decision (21 October 2026): Daniyal registers only if a report is ever needed.** Because reg 4 requires registration before the first report, registering is the first step of any NCA case, so allow time for it.
- **Timing (reg 6).** Report immediately if a child's life is at risk or they face immediate serious harm (priority level 1). Report as soon as reasonably practicable if there is a risk of serious harm in the near future (level 2). Otherwise report without undue delay (level 3).
- **Retention (reg 8).** This overrides the 90-day deletion. Keep the content, the report, the information used to judge it and the related user data Arena holds for **1 year** from the report, and the NCA reference number for **5 years**. In the database, `update arena.reports set keep_until = now() + interval '1 year' where id = ...;` keeps a report past the 90-day deletion.
- Detection is not required. Arena does no CSEA scanning, so reports are how it finds CSEA.

### 4.6 Records (s.23)

- This file is the written record of every assessment, including how it was done and what it found. Git keeps old versions.
- The Code measures that apply, and their status, are in 2.4 and 2.6.
- The decision log (4.4) is kept privately, not in this public repo.

### 4.7 Reviews

The assessments are reviewed at least every 12 months, as Ofcom recommends. They are also reviewed when Ofcom changes a relevant Risk Profile (s.9(3)), after a serious incident, or when reports show a pattern. A new assessment is needed **before** any significant change (s.9(4)).

These would be significant changes for Arena:

- Friends or follows, DMs, or a global or lobby chat
- Images, custom avatars, clickable links or voice
- Ranked play with public leaderboards, open spectating, or public or shared decks
- Notifications
- Removing or weakening the Unranked contact filter, or adding free-text chat anywhere new
- Growth well beyond a hobby audience (for example, more than about 1,000 monthly UK players), or the first upheld report of grooming

Deploying `e5360b6` is not a significant change in this sense, because it lowers risk.

**Next review: by 20 October 2027.** A check-in is due by **17 January 2027**: confirm `e5360b6`, T1 to T4 and R1 to R6 are live, and sign. A first look at the decision log three months after that is a good test of whether the Medium levels can come down.

### 4.8 Sign-off

| | |
|---|---|
| Assessed by | Daniyal Zia |
| `e5360b6` deployed | 21 October 2026 |
| T1 to T4 and R1 to R6 live | 21 October 2026 (`9221b1b`, deployed as `042103a`) |
| Registered on the NCA portal | Not in advance: only if a report is ever needed, before the first one (decision, 21 October 2026) |
| Signed | ______________ Date: ______ (by 17 January 2027) |
| Decision recorded | Unranked keeps free text, with links and contact details blocked (20 October 2026) |

## Sources

- Online Safety Act 2023: [ss. 3, 4, 9 to 12, 20, 21, 23, 35, 37, 66, 231, Sch 1, Sch 3](https://www.legislation.gov.uk/ukpga/2023/50) (legislation.gov.uk). Section 10(3A) and (3B) were inserted by the Crime and Policing Act 2026, in force 29 June 2026.
- [Online Safety (CSEA Content Reporting by Regulated User-to-User Service Providers) Regulations 2026, SI 2026/268](https://www.legislation.gov.uk/uksi/2026/268/made) (in force 7 April 2026)
- Ofcom, [Risk Assessment Guidance and Risk Profiles, v2.0, 25 June 2026](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/updates/risk-assessment-guidance-and-risk-profiles.pdf) (the 18 kinds, Figure 1, Tables 9, 13 and 13.3)
- Ofcom, [Illegal Harms Register of Risks, 25 June 2026](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/updates/register-of-risks.pdf)
- Ofcom, [Illegal content Codes of Practice for U2U services (in force 30 September 2026)](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/detecting-intimate-image-abuse/illegal-content-codes-of-practice-for-user-to-user-services-9sep2026.pdf), and the [version in force from 2 November 2026](https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/statement-protecting-children-from-harms-online/upcoming-codes-of-practice/issued-illegal-content-codes-of-practice-for-user-to-user-services.pdf) (index of measures, para 5.6 and Table C)
- Ofcom, [Protection of Children Code of Practice for U2U services (in force from 2 November 2026)](https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/statement-protecting-children-from-harms-online/upcoming-codes-of-practice/issued-protection-of-children-code-of-practice-for-user-to-user-services.pdf) (index of measures, para 5.5)
- Ofcom, [Record-Keeping and Review Guidance](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/updates/record-keeping-and-review-guidance.pdf)
- Ofcom, [Children's Access Assessments Guidance](https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/statement-protecting-children-from-harms-online/main-document/childrens-access-assessments-guidance.pdf) and [quick guide](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/quick-guide-to-childrens-access-assessments)
- Ofcom, [Children's Risk Assessment Guidance and Children's Risk Profiles (24 April 2025)](https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/statement-protecting-children-from-harms-online/main-document/childrens-risk-assessment-guidance-and-childrens-risk-profiles.pdf) (Table 6, Table 10), [Children's Register of Risks](https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/statement-protecting-children-from-harms-online/main-document/childrens-register-of-risks.pdf), and [Protection of children duties](https://www.ofcom.org.uk/online-safety/protecting-children/protection-of-children-duties-under-the-online-safety-act)
- Ofcom, [Duty to report CSEA content](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/duty-to-report-child-sexual-exploitation-and-abuse-csea-content-know-the-rules-and-how-to-comply)
