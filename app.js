const MAG7_SLUG = "9-mag-7";
const PRICE_RELOAD_MS = 5 * 60 * 1000;

let MODELS = null;
let PRICES = null;
let loadError = null;
let current = { view: "home" };

function pct(n, alreadyPercent) {
  if (n == null || Number.isNaN(n)) return "—";
  const v = alreadyPercent ? n : n * 100;
  const abs = Math.abs(v).toFixed(2) + "%";
  if (v > 0) return "+" + abs;
  if (v < 0) return "−" + abs;
  return "0.00%";
}
function priceFmt(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const digits = Math.abs(n) >= 1 ? 2 : 4;
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}
function weightPct(w) {
  if (w == null || Number.isNaN(w)) return "";
  return (w * 100).toFixed(1) + "%";
}
function cls(n) { return n > 0 ? "up" : n < 0 ? "down" : ""; }
function includeMag7() {
  try { return localStorage.getItem("includeMag7") !== "no"; } catch (e) { return true; }
}
function setIncludeMag7(on) {
  try { localStorage.setItem("includeMag7", on ? "yes" : "no"); } catch (e) {}
}
function visibleModels() {
  const list = (MODELS && MODELS.models) || [];
  return list.filter(p => includeMag7() || p.slug !== MAG7_SLUG);
}
function quotes() {
  return (PRICES && PRICES.quotes) || {};
}
function holdingChange(h, q) {
  if (!h || h.unpriced) return null;
  if ((h.symbol || "").toUpperCase() === "CASH") return 0;
  const row = q[h.symbol];
  if (!row || row.change_pct == null || Number.isNaN(row.change_pct)) return null;
  return row.change_pct;
}
function modelDayPct(model, q) {
  let sum = 0;
  for (const h of model.holdings || []) {
    if (h.unpriced) continue;
    const chg = holdingChange(h, q);
    sum += (h.weight || 0) * (chg == null ? 0 : chg);
  }
  return sum;
}
function combinedDayPct(list, q) {
  const shareSum = list.reduce((s, p) => s + (p.model_share || 0), 0);
  if (!shareSum) return 0;
  return list.reduce((s, p) => s + ((p.model_share || 0) / shareSum) * modelDayPct(p, q), 0);
}
function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstElementChild;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function parsePath(path) {
  const parts = String(path || "").replace(/^#/, "").split("/").filter(Boolean);
  if (parts[0] === "p" && parts[1] && parts[2] === "returns") return { view: "p-returns", slug: parts[1] };
  if (parts[0] === "p" && parts[1]) return { view: "portfolio", slug: parts[1] };
  if (parts[0] === "returns") return { view: "returns" };
  return { view: "home" };
}
function pathFor(route) {
  if (route.view === "p-returns") return "/p/" + route.slug + "/returns";
  if (route.view === "portfolio") return "/p/" + route.slug;
  if (route.view === "returns") return "/returns";
  return "/";
}
function canUseHash() {
  try {
    if (window.top !== window) return false;
    const h = location.hostname || "";
    if (/sharepoint\.com|onedrive\.live\.com|office\.com|officeapps\.live\.com/i.test(h)) return false;
    return true;
  } catch (e) { return false; }
}
function go(path) {
  current = parsePath(path);
  if (canUseHash()) {
    const h = "#" + pathFor(current);
    try { if (location.hash !== h) history.pushState(current, "", h); } catch (e) {}
  }
  render();
}
function render() {
  const root = document.getElementById("app");
  if (loadError && !MODELS) {
    root.replaceChildren(el('<p class="error">' + esc(loadError) + "</p>"));
    return;
  }
  if (!MODELS) {
    root.replaceChildren(el('<p class="loading">Loading…</p>'));
    return;
  }
  const route = current;
  if (route.view === "home") root.replaceChildren(viewHome());
  else if (route.view === "returns") root.replaceChildren(viewReturns());
  else if (route.view === "portfolio") root.replaceChildren(viewPortfolio(route.slug));
  else if (route.view === "p-returns") root.replaceChildren(viewPortfolioReturns(route.slug));
  window.scrollTo(0, 0);
}
function header(title, { back, action } = {}) {
  return el(`<header class="app">
    ${back ? `<button type="button" class="back" data-go="${esc(back)}">← Back</button>` : `<span class="back"></span>`}
    <h1>${esc(title)}</h1>
    ${action ? `<button type="button" class="action" data-go="${esc(action.href)}">${esc(action.label)}</button>` : `<span></span>`}
  </header>`);
}
function backFoot(path, label) {
  return el(`<button type="button" class="back-foot" data-go="${esc(path)}">${esc(label)}</button>`);
}
function pricesAsOfLine() {
  const label = PRICES && PRICES.updated_et_label;
  if (label) return "Prices as of " + label + ", about 15 minutes delayed.";
  return "Live prices have not loaded yet.";
}
function holdingsFootnote() {
  const asOf = (MODELS && MODELS.holdings_as_of) || "Thursday, Nov 12, 2026, 2:19 PM ET";
  return "Holdings and weights are from the Morningstar snapshot on " + asOf + ".";
}

function viewHome() {
  const wrap = document.createElement("div");
  const list = visibleModels();
  const q = quotes();
  const combined = combinedDayPct(list, q);
  wrap.appendChild(header("Daily returns", { action: { href: "/returns", label: "Returns" } }));
  const main = el("<main></main>");
  main.innerHTML = `
    <p class="asof">${esc(pricesAsOfLine())}</p>
    <section class="hero">
      <div class="label">Today${includeMag7() ? "" : " · without Mag 7"}</div>
      <div class="pct ${cls(combined)}">${pct(combined, true)}</div>
    </section>
    <div class="list" id="models"></div>
    <label class="toggle"><span>Include 9 Mag 7</span>
      <input type="checkbox" id="mag" ${includeMag7() ? "checked" : ""}>
    </label>
    <p class="note">Tap a model to see holdings. Open Returns for historical figures. ${esc(holdingsFootnote())}</p>
  `;
  const box = main.querySelector("#models");
  for (const p of list) {
    const day = modelDayPct(p, q);
    box.appendChild(el(`<button type="button" class="row" data-go="/p/${esc(p.slug)}">
      <div class="meta">
        <div class="name">${esc(p.name)}</div>
      </div>
      <div class="chg">
        <div class="p ${cls(day)}">${pct(day, true)}</div>
      </div>
      <span class="chev">›</span>
    </button>`));
  }
  main.querySelector("#mag").addEventListener("change", (e) => {
    setIncludeMag7(e.target.checked);
    render();
  });
  wrap.appendChild(main);
  return wrap;
}

function findP(slug) {
  return ((MODELS && MODELS.models) || []).find(p => p.slug === slug);
}

function viewPortfolio(slug) {
  const p = findP(slug);
  const wrap = document.createElement("div");
  if (!p) {
    wrap.appendChild(header("Not found", { back: "/" }));
    wrap.appendChild(el("<main></main>")).appendChild(backFoot("/", "← Daily returns"));
    return wrap;
  }
  wrap.appendChild(header(p.name, { back: "/", action: { href: "/p/" + p.slug + "/returns", label: "Returns" } }));
  const main = el("<main></main>");
  const q = quotes();
  const day = modelDayPct(p, q);
  const holds = [...(p.holdings || [])].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  main.innerHTML = `
    <p class="asof">${esc(pricesAsOfLine())}</p>
    <section class="hero">
      <div class="label">Today</div>
      <div class="pct ${cls(day)}">${pct(day, true)}</div>
    </section>
    <div class="section">Holdings</div>
    <div class="list" id="holds"></div>
    <p class="note">${esc(holdingsFootnote())}</p>
  `;
  const box = main.querySelector("#holds");
  if (!holds.length) box.innerHTML = `<div class="empty">No holdings.</div>`;
  for (const h of holds) {
    const title = h.symbol || h.name || "—";
    const nameBit = h.symbol && h.name && h.name !== h.symbol ? h.name : "";
    const unpriced = !!h.unpriced;
    const wt = !unpriced && h.weight != null ? weightPct(h.weight) : "";
    const sub = [nameBit, wt].filter(Boolean).join(" · ");
    const chg = holdingChange(h, q);
    const quote = h.symbol ? q[h.symbol] : null;
    const isCash = (h.symbol || "").toUpperCase() === "CASH";
    let rhs;
    if (unpriced) {
      rhs = `<div class="p">—</div><div class="d flag">Unpriced</div>`;
    } else if (isCash) {
      rhs = `<div class="p">0.00%</div><div class="d">Cash</div>`;
    } else {
      rhs = `<div class="p ${cls(chg)}">${pct(chg, true)}</div><div class="d">${esc(priceFmt(quote && quote.price))}</div>`;
    }
    box.appendChild(el(`<div class="row">
      <div class="meta">
        <div class="name">${esc(title)}</div>
        <div class="sub">${esc(sub)}</div>
      </div>
      <div class="chg">${rhs}</div>
    </div>`));
  }
  main.appendChild(backFoot("/", "← Daily returns"));
  wrap.appendChild(main);
  return wrap;
}

function perfTable(perf) {
  if (!perf || !perf.periods || !perf.periods.length) {
    return `<p class="empty">No historical figures for this model yet.</p>`;
  }
  const kinds = [
    ["Personal", perf.personal],
    ["Total", perf.total],
    ["Index", perf.index]
  ].filter(([, s]) => s && s.some(v => v != null));
  const head = `<th>Series</th>` + perf.periods.map(x => `<th class="num">${esc(x)}</th>`).join("");
  const rows = kinds.map(([label, s]) => {
    return `<tr><td>${esc(label)}</td>` + perf.periods.map((_, i) => {
      const v = s[i];
      return `<td class="num ${cls(v)}">${v == null ? "—" : pct(v, true)}</td>`;
    }).join("") + `</tr>`;
  });
  const subtitle = perf.view === "Annual"
    ? "Calendar-year returns. 2026 is year-to-date (Morningstar annual view)."
    : "Trailing 12 months, monthly (Morningstar). Nov ’25 and Nov ’26 are labeled separately.";
  return `<p class="asof">${esc(subtitle)}</p><div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function latestReturn(p) {
  const s = (p.performance && p.performance.personal) || [];
  const periods = (p.performance && p.performance.periods) || [];
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] != null) return { period: periods[i], value: s[i], view: p.performance.view };
  }
  return null;
}

function viewReturns() {
  const wrap = document.createElement("div");
  wrap.appendChild(header("Historical returns", { back: "/" }));
  const main = el("<main></main>");
  main.innerHTML = `<p class="asof">Morningstar figures from the same snapshot. Annual and trailing-12-month views are not mixed.</p><div class="list" id="list"></div>`;
  const box = main.querySelector("#list");
  for (const p of (MODELS.models || [])) {
    const last = latestReturn(p);
    let sub = (p.performance && p.performance.view) || "";
    let rhs = "—";
    let c = "";
    if (last) {
      const periodLabel = (last.view === "Annual" && last.period === "2026") ? "2026 YTD" : last.period;
      const viewLabel = last.view === "Annual" ? "Annual" : "Trailing 12 months";
      sub = periodLabel + " · " + viewLabel;
      rhs = pct(last.value, true);
      c = cls(last.value);
    }
    box.appendChild(el(`<button type="button" class="row" data-go="/p/${esc(p.slug)}/returns">
      <div class="meta">
        <div class="name">${esc(p.name)}</div>
        <div class="sub">${esc(sub)}</div>
      </div>
      <div class="chg"><div class="p ${c}">${rhs}</div></div>
      <span class="chev">›</span>
    </button>`));
  }
  main.appendChild(backFoot("/", "← Daily returns"));
  wrap.appendChild(main);
  return wrap;
}

function viewPortfolioReturns(slug) {
  const p = findP(slug);
  const wrap = document.createElement("div");
  if (!p) {
    wrap.appendChild(header("Not found", { back: "/returns" }));
    return wrap;
  }
  wrap.appendChild(header(p.name, { back: "/returns", action: { href: "/p/" + p.slug, label: "Holdings" } }));
  const main = el("<main></main>");
  main.innerHTML = perfTable(p.performance);
  main.appendChild(backFoot("/returns", "← All returns"));
  wrap.appendChild(main);
  return wrap;
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go]");
  if (!t) return;
  e.preventDefault();
  e.stopPropagation();
  go(t.getAttribute("data-go"));
}, true);

window.addEventListener("popstate", (e) => {
  if (!canUseHash()) return;
  current = (e.state && e.state.view) ? e.state : parsePath(location.hash);
  render();
});
window.addEventListener("hashchange", () => {
  if (!canUseHash()) return;
  const next = parsePath(location.hash);
  if (pathFor(next) !== pathFor(current)) {
    current = next;
    render();
  }
});

function cacheBust(path) {
  return path + "?t=" + Date.now();
}
function loadJson(path) {
  return fetch(cacheBust(path), { cache: "no-store" }).then(r => {
    if (!r.ok) throw new Error("Could not load " + path);
    return r.json();
  });
}
function refreshPrices() {
  return loadJson("data/prices.json").then(data => {
    PRICES = data;
  }).catch(err => {
    console.warn("Price refresh failed", err);
  });
}

function boot() {
  if (canUseHash()) current = parsePath(location.hash);
  Promise.all([
    loadJson("data/models.json"),
    loadJson("data/prices.json").catch(() => null)
  ]).then(([models, prices]) => {
    MODELS = models;
    PRICES = prices;
    render();
  }).catch(err => {
    loadError = "Could not load the model list. Check the connection and try again.";
    console.warn(err);
    render();
  });
  setInterval(() => {
    refreshPrices().then(() => { if (MODELS) render(); });
  }, PRICE_RELOAD_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshPrices().then(() => { if (MODELS) render(); });
    }
  });
}
boot();
