# tradesmyran

A clean, fast dashboard for recent insider trades, built from public Form 4
filings. U.S. public-company insiders must report their trades on Form 4, and
those filings are public data. tradesmyran turns them into a readable feed:
latest buys and sales, cluster buys, penny stock buys, big sales, and ranked
top trades — with a search that can pull any listed company's filings on
demand.

No database, no build step, no paid services. A static frontend plus a few
small serverless functions. Every trade shown comes from the live filing data;
there is no demo or sample content anywhere in the app.

## Features

- **Latest** — cluster buys (2+ insiders buying the same stock within 14
  days), latest insider buys, latest insider sales, penny stock buys (under
  $5), and insider sales over $100,000.
- **Insider Trading** — the full recent feed, paged as you load more filings.
- **Top** — top buys by value, top sales by value, and top ownership
  increases by percent change.
- **Search** — search a ticker, company, or insider. Exchange prefixes are
  stripped ("NYSE: SNOW" and "NASDAQ: NVDA" both work) and matching is
  case-insensitive. If a ticker has no trades in the recent list, its filings
  are fetched on demand in batches with a live progress line, and repeat
  searches are fast.
- **Filters** — buys/sales, minimum trade value, and insider role, working in
  every view.
- **Trade detail** — click any trade for the transactions in that filing, the
  insider's other trades, and a "View filing" link to the original filing.
- **Themes** — clean light theme by default, with a Dark/Light toggle that
  restyles the whole app, remembers your choice, and follows your system
  setting on first visit.
- **Refresh** — pull the newest filings at any time with the Refresh button.

## Project structure

```
index.html      Static frontend markup
styles.css      Light/dark themes and layout
app.js          Tabs, filters, sections, search, modal (no build step)
api/            Serverless functions (Node, no dependencies)
  latest.js     Newest Form 4 trades, paged in small batches
  feed.js       Full recent feed, paged
  top.js        Trades backing the Top view
  search.js     Ticker search with first-batch results
  ticker-start.js  Resolve a ticker and count its Form 4 filings
  ticker-batch.js Page through one company's Form 4 filings
lib/            Shared server code
  sec.js        Filing-archive requests, pacing, ticker lookup
  parse.js      Form 4 ownership-document parser
vercel.json     Deployment config
```

## How it works

The functions in `api/` read public Form 4 filings and parse each filing's
ownership document: insider name and role, company and ticker, trade date,
transaction code (P = purchase, S = sale, plus award, tax, gift, exercise and
other codes), shares, price, shares owned after the trade, and whether the
filing is amended. Trade value is shares × price, and the ownership change is
computed from shares held before and after the trade where possible.

Requests to the filing archive are paced to stay well under its fair-access
limit of 10 requests per second. Filings are parsed in small batches (8 at a
time) so no single request runs long, and results stream into the page as
they arrive.

## Push to GitHub

Create an empty public repository on GitHub first (for example named
`tradesmyran`), then from this project folder run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/tradesmyran.git
git push -u origin main
```

If you have the GitHub CLI installed, you can do it in one step instead:

```bash
gh repo create tradesmyran --public --source=. --remote=origin --push
```

## Deploy free on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the
   `tradesmyran` repository.
2. Leave the defaults as they are: no framework preset, no build command, no
   output directory, no environment variables. Vercel detects the `api/`
   folder and serves `index.html` automatically.
3. Click **Deploy**. That is all — the free Hobby tier covers this project,
   and no paid add-ons are needed.

## Custom domain

In your Vercel project, open **Settings → Domains** and add your domain.
Point it at Vercel with the DNS records Vercel shows you (an `A` record to
`76.76.21.21` for the root domain, or a `CNAME` to `cname.vercel-dns.com`
for a subdomain).

If you have the GitHub Student Developer Pack, it includes a free `.me`
domain for a year through Namecheap — register one there, then add it in
Vercel the same way. After the free year it renews at Namecheap's normal
price, or you can keep using the free `vercel.app` address forever.

## Set the User-Agent contact

The filing archive asks callers to identify themselves. The contact string
lives in one place, at the top of `lib/sec.js`:

```js
const USER_AGENT = 'tradesmyran/1.0 (contact: user@example.com)';
```

Before deploying, replace `user@example.com` with your own email address.
Everything else keeps working unchanged.

## Local development

Install the Vercel CLI once, then run the dev server from this folder:

```bash
npm install -g vercel
vercel dev
```

That serves the frontend and the `api/` functions together at
`http://localhost:3000`. A plain static file server will show the page but
the trade data will not load, because the page needs the `api/` functions.

## Notes and limits

- Only Form 4 filings are covered (open-market trades plus awards, tax
  withholding, gifts, and exercises). Derivative transactions are not shown.
- The recent-filings views cover the newest filings in the public feed;
  older filings for a company are reachable through ticker search.
- Serverless functions are stateless, so caches in `lib/sec.js` live only as
  long as one function instance stays warm. Repeat searches still feel fast
  because ticker results page in small batches.
- Some filings have no trading symbol or no usable price (for example
  pure awards). They are shown with the fields that exist rather than hidden.
- Nothing here is investment advice. Filings are shown as filed, with a link
  to the original filing for verification.
