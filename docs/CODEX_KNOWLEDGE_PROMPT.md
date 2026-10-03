# Prompt: Codex vult de kennisbank van de Discord-bots

Gebruik: start Codex in een map met de repo's/bestanden over jullie producten (alleen lezen), plak de prompt hieronder,
controleer de uitvoer en plak het resultaat in het dashboard bij **Knowledge → Meerdere tegelijk toevoegen**.

````text
You are helping the two founders of Euphoriax build the knowledge base of our Discord support bots.

ABOUT US
Euphoriax: two students building UEFN (Unreal Editor for Fortnite) systems, maps and tools with AI. We sell them on Patreon, run a Discord community, post short videos on TikTok, YouTube, X and Instagram. Website: euphoriax.net.

GOAL
Produce a ready-to-paste list of question/answer entries that our Discord bots use to answer community questions on their own. The bots may ONLY state company facts that appear in these entries. Accuracy matters more than volume: a wrong answer is worse than a missing one.

WHERE TO LOOK
1. Everything in the current working directory. Read broadly before writing: README files, docs, changelogs, example projects (for example examples/*/README.md), pricing/Patreon/marketing text, website content, license files, issue templates, config descriptions.
2. If you have web access: public pages only (euphoriax.net, our Patreon page, our YouTube/TikTok/X profiles). Never log in anywhere.
3. Anything under "EXTRA FACTS" at the end of this message. It comes straight from the founders and beats every other source.
NEVER use or output: .env files, tokens, API keys, passwords, server addresses, private member or customer data, internal engineering details (bots, dashboards, servers, deployment). Customer-facing information only.
Do NOT modify files and do not run anything that changes the repository. This is a read-only task.

WHAT TO COVER (only where you found real facts)
- What Euphoriax is, who we are, what we make
- Every product/system/tool: what it does, what is included, how to get it, price, requirements (UEFN version), how to install and use it, known limitations
- Patreon: tiers, prices, what each tier includes, how to join, how to get the Discord role/access, how to download purchases, cancel/pause, refund and billing policy
- Setup and troubleshooting: common problems members hit and the fix
- Discord: rules, how to get support, how to open a ticket, how to report a bug, how to request a new system or feature
- Where to find us (links), contact for business/collabs, update/release rhythm if stated
- Anything else members would plausibly ask

CONTENT RULES
- Never invent or assume facts (prices, dates, features, links, policies, compatibility). If you cannot find it, do NOT write an entry; put it in the TODO list instead.
- One topic per entry. Answers are 1 to 3 sentences, hard limit 500 characters. Short entries match better.
- Answers are exactly what the bot sends in Discord chat: casual and direct, no greeting, no "great question", no marketing speak, minimal formatting (plain text, links allowed, no headings, avoid bullet lists). Lowercase-casual is fine.
- Write the answers in English. The bot translates to the member's language automatically.
- The question (V:) is phrased like a member would ask it.
- Give 4 to 8 other phrasings per entry in the O: line. They are the most important part for matching: short and slangy versions, keyword-only versions ("pet system price"), different wording, and Dutch variants when likely. No duplicates between entries.
- Aim for 25 to 60 entries, most important first. Fewer is fine when the sources are thin.

OUTPUT FORMAT (exact, a parser reads it)
Return ONE code block (```text) with only entries, separated by exactly one blank line. Fields in this order, each starting at the beginning of a line:
V: the question
O: other phrasing | other phrasing | other phrasing
C: category, one of: general, products, patreon, setup, troubleshooting, community, links
A: the answer (always last; it may continue on following lines)

Example (made-up content, only for the format):
V: how much does the pet system cost
O: pet system price | is the pet system free | how much is pets | pet system kosten
C: patreon
A: it's included in the Creator tier on Patreon, $10/month. link: patreon.com/example

After the code block add three short sections:
TODO FOR THE FOUNDERS: questions members will probably ask that you could not answer from the sources, each with exactly what you need from us.
SOURCES USED: file paths or URLs you relied on.
CONFLICTS: facts that differ between sources.

PUSHING THE RESULT (optional; only if you can run shell commands with internet access)
Save only the entries (no code fence, no TODO text) to a file answers.txt, then run:
curl -sS -X POST https://euphoriax.net/dashboard/api/ingest/knowledge -H "x-api-key: [PASTE-KEY-HERE]" -H "content-type: text/plain" --data-binary @answers.txt
The entries land in a review inbox; nothing goes live until the founders approve. Print the command's response. If you cannot run it, just return the code block as described above.

EXTRA FACTS (written by the founders; may be empty)
[PASTE HERE: Patreon tier names, prices and what they include, refund policy, links, rules, anything you want the bots to know]
````

## Direct laten sturen (optioneel)
Codex kan het resultaat zelf naar het dashboard sturen. Het komt dan bij **Knowledge → Te controleren** (en bij Needs you op het overzicht)
en gaat pas live nadat jij op **Goedkeuren** klikt. Daarvoor heeft Codex internet en een sleutel nodig:
- Dashboard → **Setup** → "Keys for other tools" → **Bot / script key** → Copy, en plak hem in de prompt op de plek van `[PASTE-KEY-HERE]`.
- Codex in de cloud heeft standaard geen internet; Codex op je eigen pc (CLI) wel. Lukt het sturen niet, dan geeft Codex gewoon het codeblok terug en plak je dat zoals hieronder.
- Die sleutel laat iemand alleen concepten, heartbeats en berichten naar het dashboard sturen. Niets daarvan gaat live zonder jouw goedkeuring. Verander de sleutel achteraf als je hem wilt intrekken (Setup).

## Daarna
1. Controleer prijzen, links en beloftes in de uitvoer. De bots zeggen dit als feit.
2. Beantwoord de TODO-lijst door Codex de ontbrekende feiten te geven en te vragen: "geef nu alleen de nieuwe entries".
3. Dashboard → **Knowledge** → **Meerdere tegelijk toevoegen** → plak alleen de inhoud van het codeblok → **Toevoegen**.
4. Test met het testvak op dezelfde pagina. Importeer elke batch maar één keer, anders staan er dubbele antwoorden in.
## Founder-confirmed knowledge base — 3 October 2026

This section supersedes conflicting claims in earlier drafts. Import only the entries inside the following text block. Product and membership prices are deliberately linked rather than hard-coded. Publishing this document does not itself import or activate the entries.

```text
V: how do I get the free files
O: where are the free downloads | unlock free systems | get regular for downloads | hoe krijg ik de gratis bestanden
C: community
A: Invite three people to our Discord to automatically get the Regular role. You can then download the free files in <#1269978798212775987>.

V: why haven't I received Regular after three invites
O: invited three but no role | regular role delayed | still newbie after inviting friends | drie invites maar geen regular
C: troubleshooting
A: Invite tracking and role updates can take up to 30 minutes, though it's usually quicker. If you've invited three people and they're all still in the server, give it that time to update.

V: can I get Regular without inviting people
O: skip the three invites | other ways to unlock regular | free files without invites | regular krijgen zonder invites
C: community
A: Yes, you can get Regular through our Member subscription on Patreon or by becoming a booster of our Discord server.

V: how do I get Regular after subscribing on Patreon
O: paid on patreon but no regular | connect patreon to discord | claim member subscription role | patreon betaald maar geen rol
C: setup
A: After subscribing to Member, link your Patreon account to your Discord account to receive Regular automatically. Linking is required to get the role through your subscription.

V: does the Member subscription include paid systems
O: paid products included in membership | does member unlock everything | exclusive member systems | krijg ik betaalde systemen bij member
C: patreon
A: No, Member only unlocks the same free files available through three invites or server boosting. Paid systems aren't included.

V: why subscribe if I can unlock the same files for free
O: why pay for member | benefit of subscribing instead of invites | support euphoriax | waarom betalen voor gratis bestanden
C: patreon
A: Member is an optional way to support Euphoriax and unlock the free files without inviting people or boosting. You also get a role that places you higher in the Discord member list.

V: where can I check membership prices and join
O: member subscription price | patreon membership fee | sign up for member | hoeveel kost het member abonnement
C: patreon
A: Check our Patreon membership page for current pricing and to join: https://www.patreon.com/EuphoriaxPremium/membership

V: where can I buy your products
O: official euphoriax store | where do you sell systems | buy your products elsewhere | waar koop ik jullie producten
C: patreon
A: We only sell our products on Patreon. Browse the shop and current prices here: https://www.patreon.com/c/EuphoriaxPremium/shop

V: are premium systems a one-time purchase
O: do I pay monthly for a system | recurring payment for shop products | buy a system once | zijn premium systemen een eenmalige aankoop
C: patreon
A: Yes, premium systems in our Patreon shop are one-time purchases. Later updates to the system are included.

V: do I need to pay again for an updated version
O: are system updates included | update an old purchase | latest version after buying years ago | moet ik opnieuw betalen voor updates
C: patreon
A: No, when we release an update to a system you've bought, you can download the latest version without buying it again, even if your purchase was years ago.

V: how do I download a purchased system or its latest version
O: find my patreon purchase | redownload latest files | get an update from purchases | nieuwste versie van mijn aankoop downloaden
C: setup
A: Sign in to the Patreon account you used to buy the system, open your purchases and download it there. Downloading it again gives you the latest version; there may not be a separate label saying an update is available.

V: where do you announce system updates
O: system update announcements | how will I know an update is out | product update news | waar kondigen jullie updates aan
C: general
A: We announce system updates on our social channels. We sometimes also post an announcement on Patreon.

V: what products do you currently sell
O: current product catalog | which systems are for sale | available paid systems | welke systemen verkopen jullie
C: products
A: Our Patreon shop sells the Pillars System, Custom Battle Pass, Piece Control / Speed Realistics System, Box PVP Template with Superpowers, Color Switch, Infinity Zone Wars, Ranked System and Stretched Resolution.

V: where can I see how a system works before buying
O: preview a system before purchase | system demonstration videos | watch product gameplay | systeem bekijken voor aankoop
C: products
A: Each system we publish has a YouTube video showing it. Watching that video is the best place to start: https://www.youtube.com/@euphoriax_official

V: what does the Pillars System do
O: pillars system features | make a custom pillars map | pillar template gameplay | wat kan het pillars systeem
C: products
A: It lets you build a custom Pillars map in Fortnite with configurable rounds, events and a win cinematic. You can customize the Pillar System Device to fit your map.

V: what comes with the Pillars System purchase
O: pillars pack contents | files included with pillars | pillars documentation and support | wat krijg ik bij aankoop van pillars
C: products
A: You get the Verse code, a private explanation video and support access.

V: which events can I use in the Pillars System
O: pillars custom events | rising lava and double damage | pillars random items | welke events kan ik toevoegen
C: products
A: It supports custom events such as Rising Lava and Double Damage, plus built-in On Game Start Item and Random Item events. The modular setup lets you add as many events as you want.

V: what storm options does the Pillars System have
O: pillars square storm | classic storm option | change storm type in pillars | welke storm kan ik gebruiken bij pillars
C: products
A: You can use a custom square storm or a classic storm system.

V: does the Pillars System include event UI
O: pillars event interface | item timer display | pillars ui included | heeft pillars een event interface
C: products
A: It includes custom UI for every event and timers when players receive items.

V: where can I watch the full Pillars System showcase
O: pillars showcase video | see the pillar system in action | full pillars demo | pillars demonstratie bekijken
C: links
A: Watch the full system showcase here: https://youtu.be/ToIDKCCiMQk

V: how much does the Pillars System cost
O: pillars price | pillar template cost | buy pillars system | hoeveel kost het pillars systeem
C: patreon
A: You can find the current Pillars System price in our Patreon shop: https://www.patreon.com/c/EuphoriaxPremium/shop

V: can I modify a purchased system
O: edit purchased verse code | customize your systems | change a system I bought | mag ik gekochte systemen aanpassen
C: products
A: Yes, you can modify the systems you buy from us to suit your own maps.

V: can I use a purchased system in multiple monetized maps
O: reuse a system across my maps | commercial use allowed | earn money with your systems | gebruiken in meerdere eigen maps
C: products
A: Yes, you can use a purchased system in multiple maps of your own, including maps you earn money from.

V: can I resell your systems as templates
O: resell a purchased system | sell your code as a template | template resale allowed | mag ik jullie systemen doorverkopen
C: products
A: No, you can't resell our systems as templates. You can modify them and use them in your own Fortnite maps, including maps you earn money from.

V: can I send the purchased files to friends
O: share system files with friends | give a friend my download | forward purchased files | mag ik bestanden doorsturen naar vrienden
C: products
A: No, you can't pass the purchased system files on to friends.

V: where can I request a refund
O: request money back | submit a refund request | refund through patreon | waar vraag ik een terugbetaling aan
C: patreon
A: You can submit a refund request through Patreon. Submitting a request doesn't guarantee it will be approved.

V: what language should I use in the server
O: english only server | can I speak Dutch here | allowed chat language | mag ik nederlands praten
C: community
A: Please use English when communicating in our Discord server.

V: can I advertise my services in your Discord
O: self promo allowed | advertise commissions | promote my project here | mag ik reclame maken
C: community
A: Spam and self-promotion are not allowed and will be removed. That includes messages advertising services and asking members to DM you for work.

V: why do I need to invite people for free files
O: why three invites | reason for invite requirement | why are downloads invite locked | waarom moet ik mensen uitnodigen
C: community
A: The invite requirement helps our Discord community grow and encourages people to take part instead of only grabbing files.

V: who is Euphoriax
O: who are you guys | about euphoriax | who makes these systems | wie zijn jullie
C: general
A: We're two students building UEFN systems, Fortnite maps and tools with AI. We sell our products on Patreon and run a Discord community.

V: do you work with engines other than UEFN
O: what platform do you build for | other game engines | euphoriax development focus | werken jullie alleen met uefn
C: general
A: We currently focus entirely on UEFN, Unreal Editor for Fortnite.

V: what do your YouTube videos cover
O: what are your tutorials about | euphoriax video topics | do you explain system settings | wat leggen jullie uit op youtube
C: general
A: Our YouTube videos mainly cover UEFN systems. We explain how systems work and their configuration options, with tutorials for free systems and showcases of paid ones.

V: what are your systems designed to help with
O: purpose of your systems | why add your systems to my map | player engagement systems | waarom jullie systemen gebruiken
C: products
A: We design our systems to help creators keep players engaged and encourage longer play sessions. For example, our Ranked System adds competition to give players a reason to keep playing.

V: which social platforms do you post on
O: where do you post shorts | euphoriax social platforms | which socials do you use | op welke socials zitten jullie
C: general
A: We post on YouTube, TikTok, X and Instagram.

V: what is your website
O: euphoriax website link | official site | homepage address | wat is jullie website
C: links
A: Our website is https://euphoriax.net

V: how do I compile my Verse code
O: build verse code | compile my script in uefn | check verse compilation | hoe compileer ik verse
C: setup
A: In UEFN, open the Verse menu and select Build Verse Code to compile your scripts.

V: why does my Verse code compile but fail during gameplay
O: verse builds but breaks in game | runtime error after successful build | script compiles but stops | verse compileert maar werkt niet
C: troubleshooting
A: A successful build doesn't rule out runtime errors that happen while the game is running. Share the exact error and what you were doing when it happened so we can narrow down the cause.
```

### Open questions — do not import as answers

- Final refund eligibility, including change-of-mind requests after download.
- Sharing within a development team; sharing purchased files with friends and template resale are not allowed.
- The planned ticket channel and exact support steps, plus missing-role escalation after 30 minutes.
- Remaining product details, installation instructions, supported UEFN versions and known limitations.
- Official Discord invite, remaining social links, business contact and feature-request route.

### Sources and corrections

Company facts come from the founders' conversation on 3 October 2026 and their supplied Pillars description. Founder corrections take precedence over older public listings. The weekly Patreon help-session claim and role-loss answer were removed. Member unlocks the same free files as invites or boosting, plus a higher Discord member-list role; it does not include paid systems. No fixed payout rate or guaranteed Discover placement is claimed.

- Shop: https://www.patreon.com/c/EuphoriaxPremium/shop
- Membership: https://www.patreon.com/EuphoriaxPremium/membership
- YouTube: https://www.youtube.com/@euphoriax_official
- Pillars showcase: https://youtu.be/ToIDKCCiMQk
- Verse compilation: https://dev.epicgames.com/documentation/fortnite/modify-and-run-your-first-verse-program-in-unreal-editor-for-fortnite?lang=en-US
- Verse troubleshooting: https://dev.epicgames.com/documentation/en-us/fortnite/debugging-and-troubleshooting-in-verse
