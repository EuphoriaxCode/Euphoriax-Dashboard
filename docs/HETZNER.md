# Stappenplan: alles online zetten op Hetzner

Na dit stappenplan draaien op één server:
- **https://euphoriax.net**: jullie website (voorlopig een simpele pagina)
- **https://euphoriax.net/dashboard**: het dashboard
- **Discord-Bot-Buddy**: de twee founder-bots, 24/7 online
- **UEFN-Trends**: de trend-engine met zijn database

Tijd: ongeveer 30 minuten. Kosten: ± €5 per maand (+ ±€1 voor backups).

---

## Stap 1: Hetzner-account (5 min)

1. Ga naar **hetzner.com/cloud** → *Sign up*.
2. Vul je gegevens in. Hetzner vraagt soms om een ID of een kleine betaling ter controle. Dat is normaal.
3. Maak een **project** aan, bijvoorbeeld `Euphoriax`.

## Stap 2: SSH-sleutel maken op je eigen pc (2 min)

Daarmee log je veilig in op de server, zonder wachtwoord.

**Windows** (PowerShell):
```powershell
ssh-keygen -t ed25519
```
Druk 3 keer op Enter. Toon daarna je publieke sleutel:
```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

**Mac**: hetzelfde in Terminal, en `cat ~/.ssh/id_ed25519.pub`.

Kopieer de hele regel (begint met `ssh-ed25519`).

> Doen jullie dit allebei? Dan voegen jullie elk je eigen sleutel toe in stap 3.

## Stap 3: De server aanmaken (3 min)

In je project → **Add Server**:

| Keuze | Wat je kiest |
|---|---|
| Location | **Falkenstein** of **Nuremberg** (Duitsland, dicht bij ons) |
| Image | **Ubuntu 24.04** |
| Type | **Shared vCPU → x86 → de goedkoopste met 4 GB RAM** (2 vCPU / 4 GB) |
| Networking | **Public IPv4** aan laten |
| SSH keys | **Add SSH key** → plak de regel uit stap 2 |
| Backups | **Aanvinken** (kost ~20% extra, maar dan kan je altijd terug) |
| Name | `euphoriax` |

Klik op **Create & Buy now**. Na ±30 seconden zie je het **IPv4-adres** (bv. `91.98.12.34`). Kopieer dat.

## Stap 4: Domein koppelen in Porkbun (3 min)

1. Porkbun → **Account → Domain Management** → bij euphoriax.net op **DNS** klikken.
2. **Verwijder** de standaard-records die Porkbun zelf heeft gezet (type `ALIAS` en `CNAME` die naar een `…porkbun.com`-adres wijzen, voor de "parked"-pagina).
3. Voeg toe:

| Type | Host | Answer | TTL |
|---|---|---|---|
| `A` | *(leeg laten)* | jouw IPv4-adres | 600 |
| `A` | `www` | jouw IPv4-adres | 600 |

Het duurt 5 tot 30 minuten voor dit overal werkt. Ondertussen kan je verder.

## Stap 5: Wat je klaar moet hebben

Het script vraagt hierom. Heb je iets nog niet? Druk dan op Enter en vul het later in.

- **OpenAI API-key**: platform.openai.com → *API keys* → *Create*. Laad $5 tegoed op bij *Billing*.
- **Discord-bots** (discord.com/developers/applications → jullie bot-apps):
  - per bot het **Application ID** (*General Information*)
  - per bot de **Token** (*Bot → Reset Token*)
- **Discord server-ID en jouw user-ID**: Discord → *Instellingen → Geavanceerd → Ontwikkelaarsmodus* aan. Dan rechtsklik op de server of op jezelf → *ID kopiëren*.
- *(optioneel)* een **Discord-webhook** voor het dagelijkse trend-rapport: kanaal → *Bewerken → Integraties → Webhooks*.

## Stap 6: Alles installeren met één commando (10–15 min)

Open PowerShell/Terminal en log in op de server (vervang het IP):
```bash
ssh root@91.98.12.34
```
Typ `yes` als het de eerste keer vraagt of je de server vertrouwt.

Plak dan dit:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/EuphoriaxCode/Euphoriax-Dashboard/HEAD/scripts/server-setup.sh)
```

Het script:
1. zet de server up-to-date, plus firewall, Docker en Caddy (voor https);
2. vraagt je in te loggen bij **GitHub**. Kies *Login with a web browser*, open de link op je laptop en typ de code. Dit is nodig omdat Bot Buddy en UEFN Trends privé zijn;
3. stelt je de vragen uit stap 5;
4. downloadt de drie apps, koppelt ze met automatisch gemaakte sleutels en start alles;
5. toont op het einde wat draait (● = ok).

## Stap 7: Het dashboard openen (2 min)

1. Ga naar **https://euphoriax.net/dashboard**.
   *Geeft de browser een certificaatfout? Dan is stap 4 nog niet overal bekend. Wacht 10 minuten en probeer opnieuw.*
2. Maak de **logins voor jullie twee** aan.
3. Bovenaan zie je *Finish setup*. Discord-bots en UEFN Trends staan al op ✓.

## Stap 8: De build-PC (5 min)

Op de pc met UEFN:
1. Installeer **Node.js** (nodejs.org, de LTS-versie).
2. Open PowerShell, typ `npm install -g @anthropic-ai/claude-code` en daarna `claude`. Log in met jullie Claude-account en sluit het af.
3. Dashboard → **Build queue → Download start file** → zet het bestand in je UEFN-projectmap → dubbelklik.
4. *Tip:* `Win+R` → `shell:startup` → zet er een snelkoppeling naar het bestand in. Dan start het mee met Windows.

---

## Later

**Alles updaten** (als er nieuwe code is):
```bash
ssh root@91.98.12.34
/opt/euphoriax/update.sh
```

**Meer Discord-instellingen voor Bot Buddy** (support-kanalen, ticket-categorie, …):
```bash
nano /opt/euphoriax/bot-buddy/.env       # aanpassen, Ctrl+O, Enter, Ctrl+X
cd /opt/euphoriax/bot-buddy && docker compose up -d
```

**Je echte website zetten**: zet de bestanden in `/var/www/euphoriax/` op de server (de pagina met `index.html` vooraan). Je kan dat bv. doen met [WinSCP](https://winscp.net) of `scp`.

**Kijken wat er mis is** als iets niet draait:
```bash
cd /opt/euphoriax/bot-buddy && docker compose logs --tail 50     # of uefn-trends / dashboard
```

**Waar staat wat:**

| Map op de server | Wat |
|---|---|
| `/opt/euphoriax/dashboard` | dashboard (+ `data/` met uploads en database) |
| `/opt/euphoriax/bot-buddy` | Discord-bots (+ `.env` met tokens, `data/`) |
| `/opt/euphoriax/uefn-trends` | trend-engine (+ `.env`) |
| `/var/www/euphoriax` | de website |
| `/etc/caddy/Caddyfile` | welk adres naar welke app gaat |

## Veiligheid in het kort
- Inloggen op de server kan alleen met jullie SSH-sleutel.
- De firewall laat alleen SSH (22) en web (80/443) door. Bot Buddy, UEFN Trends en het dashboard zijn enkel via Caddy bereikbaar.
- Alle sleutels tussen de apps zijn automatisch gemaakt en staan in `.env`-bestanden die alleen root kan lezen.
- Hetzner-backups maken elke dag een kopie van de hele server.
