# ShopWacht

Website (in German): https://shopwacht.de

ShopWacht checks a German online shop for the mistakes that most often lead to an *Abmahnung* (a paid cease-and-desist
letter from a competitor or an association) and explains every finding: where it is, why it is a risk, the legal basis and
how to fix it.

You run it on your own computer with your own [OpenRouter](https://openrouter.ai) key. Plan on a sixth of a cent per
product: two measured runs cost 3 cents for a shop with 22 products and 21 cents for one with 150. The larger run took 20
minutes, 13 of them for opening the product pages in a browser. That step has since become about four times faster (45
pages of the same shop in 74 seconds), so expect around ten minutes for such a shop. The slowest part is now waiting for
the second opinion's model answers.

**Not legal advice.** ShopWacht is an automated first check of what a shop shows in public. It does not replace a lawyer
and does not guarantee that a shop is safe from an Abmahnung.

## Quick start

You need [Node.js](https://nodejs.org) 22 or newer. Chrome, Chromium or Edge is optional but recommended: with it, product
pages are checked the way a customer's browser shows them.

```bash
git clone https://github.com/Revo963/shopwacht.git
cd shopwacht
npm install
npm start                   # open http://localhost:3000
```

On the start page, paste your OpenRouter key into the field under the form and save it. The app checks the key with
OpenRouter, keeps it on your computer (in the file `.env`) and uses it from the next scan on. Then type a shop address
into the form and wait for the report. Without a key the app runs in a clearly labelled demo mode that only matches
keywords; its results are rough.

Every other setting is optional; `.env.example` lists them. Copy it to `.env` to change one.

Set a spending limit on your OpenRouter key. The app also limits itself: the second opinion stops at $0.30 per scan
(`SECOND_JUDGE_MAX_USD`).

| Command | What it does |
|---|---|
| `npm start` | The web app: form, live progress, report, CSV export |
| `npm run scan -- shop.de other-shop.de export.csv --max 500` | Scan from the terminal, several shops or product export files in a row. Reports are saved to `data/reports/` and open in the web app. |
| `npm test`, `npm run typecheck` | Tests and type check |

## What a scan reads

- **A shop address.** Shopify shops (public `/products.json` feed) and WooCommerce shops (public Store API), plus the
  home page and the legal pages: Impressum, Widerrufsbelehrung, Datenschutzerklärung, AGB.
- **A product export file** (terminal only): Shopify or WooCommerce CSV export, or any sheet with a title and a
  description column.

Up to 250 products per scan by default (`MAX_PRODUCTS`, or `--max` in the terminal).

## What gets checked

Product texts and product pages:

- vague environmental claims ("umweltfreundlich", "nachhaltig") and "klimaneutral" by offsetting – the UWG rules in force
  since 27 September 2026
- sustainability labels without a recognised certification scheme
- disease claims and health claims on food that the EU register does not allow
- advertising with tests, awards or studies without a source
- legal rights advertised as a special benefit, guarantees without terms
- missing *Grundpreis* (price per unit)
- crossed-out prices without the lowest price of the last 30 days
- missing fibre composition on textiles

Shop-wide: Impressum completeness, outdated legal references, Widerrufsbelehrung and withdrawal form, the withdrawal
button required since 19 June 2026, privacy policy, a dead link to the EU dispute-resolution platform.

The rules, their legal basis and the fix texts are in `src/rules/`. A finding is either **Risiko** (confident) or
**Prüfen** (borderline, or not verifiable from outside the shop).

## How a scan works

1. **Trigger.** Keyword patterns decide which questions apply to a product and supply the quoted passage.
2. **Decide.** The questions go to *Jev*, a small, cheap decision model, through OpenRouter – three times each, averaged.
3. **Verify.** "Something is missing" findings (Grundpreis, fibre composition, 30-day price) are checked against the live
   product page before they are reported, rendered in a headless browser if one is installed.
4. **Shop checks** on the legal pages.
5. **Second opinion.** Two further cheap models read each product independently. A finding both reject is removed, a
   "Risiko" stays one only if both agree, and a claim both object to is added. Removed findings remain in the CSV export.

Model names and limits can be changed in `.env`; `.env.example` lists every setting.

## How good is it?

Measured on shops the scanner had never seen, with the code frozen beforehand. Each product was labelled without looking
at the scanner's output, following a written guide. The labels were not reviewed by a lawyer and every sample is small, so
read these as rough indications.

| Sample | Findings that are real problems | … of those at "Risiko" | Real problems found |
|---|---|---|---|
| 8 Shopify shops, 100 products | 84 % | 100 % | 82 % |
| 3 WooCommerce shops | 96 % | 100 % | 96 % |
| 3 further WooCommerce shops | 64 % | 100 % | 85 % |

The weakest check is the vague environmental claim: it produced most of the false alarms in the last sample. On the 1,400
products the rules were developed on, the same figures are 88 %, 97 % and 93 %; those are tuned numbers, not a
prediction for a new shop.

## Safety

A scan loads pages that the scanned shop controls, in a browser on your machine. ShopWacht therefore only connects to
public internet addresses on ports 80 and 443: page requests are checked, and the headless browser can only reach the
network through a built-in local proxy that refuses addresses on your computer or home network.

The web app is for the machine it runs on: it listens on `127.0.0.1` only, answers to a localhost address only and accepts
no form posted from another website.

What leaves your computer: requests to the scanned shop, and the product and legal texts it reads, which go to OpenRouter
and the model providers behind it under your key. Nothing is sent to the author of ShopWacht.

## What it does not do

- It reads only what is public. It cannot see the checkout, prices shown after login, or the price history of the last 30
  days, so some findings can only be "Prüfen".
- It knows German law and German shop texts.
- Shops on other platforms can be scanned through a product export file, not by address.
- It makes mistakes in both directions. Treat a report as a list of things to look at.

## Licence

ShopWacht is free to use, also for companies, under the [PolyForm Shield License 1.0.0](LICENSE). In short: use it, change
it, run it on as many shops as you like. What needs the author's agreement is offering it, or something built on it, as a
product or service that competes with it – for example selling it or selling scans made with it.

For such an agreement, or with questions, write to revo.contact@yahoo.com or open an issue on GitHub.

Bundled with it: the Barlow typefaces (SIL Open Font License, `src/server/static/fonts/OFL.txt`) and the EU list of
permitted health claims from EUR-Lex (Regulation (EU) No 432/2012, © European Union), in `src/rules/data/`.
