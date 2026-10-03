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

EXTRA FACTS (written by the founders; may be empty)
[PASTE HERE: Patreon tier names, prices and what they include, refund policy, links, rules, anything you want the bots to know]
````

## Daarna
1. Controleer prijzen, links en beloftes in de uitvoer. De bots zeggen dit als feit.
2. Beantwoord de TODO-lijst door Codex de ontbrekende feiten te geven en te vragen: "geef nu alleen de nieuwe entries".
3. Dashboard → **Knowledge** → **Meerdere tegelijk toevoegen** → plak alleen de inhoud van het codeblok → **Toevoegen**.
4. Test met het testvak op dezelfde pagina. Importeer elke batch maar één keer, anders staan er dubbele antwoorden in.
