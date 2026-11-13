# Model Performance

Phone-first daily returns for Carolina Wealth Advisors model portfolios. Percentages only — no dollar amounts, share quantities, cost basis, or client information.

Holdings and weights come from a Morningstar snapshot (Thursday, Nov 12, 2026, 2:19 PM ET). Prices refresh about every 15 minutes during US market hours from Yahoo Finance (typically delayed about 15 minutes) via GitHub Actions, and the page reloads prices every 5 minutes while it is open.

## Open it

After the repo is published to GitHub Pages, open the site in Safari or Chrome and use Add to Home Screen for an icon on your phone. Do not open the raw HTML file in a SharePoint or GitHub preview — use the Pages address.

## Update holdings

From a machine that has a new `all_holdings.json` snapshot:

```bash
python3 /workspace/build_site.py --src /path/to/all_holdings.json --out data/models.json
```

Or, if you are on the same box as this project, the defaults already point at the current snapshot and this site folder. Commit the updated `data/models.json`. The next price job will pick up any new symbols.

## Update prices locally

```bash
# Bypass the 9:25 AM–4:20 PM ET window if needed
FORCE=1 python3 scripts/update_prices.py
```

The scheduled workflow uses `*/15 13-21 * * 1-5` (UTC) plus manual `workflow_dispatch`. The script itself will not write or commit outside 9:25 AM–4:20 PM America/New_York, so the last in-window run (about 4:15 PM ET) captures the close.
