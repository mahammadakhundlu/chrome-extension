import { compare } from './rank.mjs';

const get = id => document.getElementById(id);
const money = pence => new Intl.NumberFormat('en-GB', { style:'currency', currency:'GBP' }).format(pence / 100);
const trace = get('trace');
const button = document.querySelector('button');
let detected;

function readProduct() {
  const products = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if ([value['@type']].flat().includes('Product') && typeof value.name === 'string') {
      products.push(value);
    }
    Object.values(value).forEach(visit);
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visit(JSON.parse(script.textContent)); } catch { /* Ignore invalid metadata. */ }
  }
  const modelPattern = /\bWH[-\s]?1000XM5\b/i;
  const heading = document.querySelector('h1')?.textContent?.trim();
  const product = products.find(item => item.name.trim() === heading) ||
    (products.length === 1 ? products[0] : null);
  const name = product?.name || (modelPattern.test(heading || '') ? heading : '');
  const model = modelPattern.test([name, product?.model, product?.mpn].join(' ')) ? 'WH-1000XM5' : '';
  return { name, model, site: location.hostname };
}

function updateAvailability() {
  button.disabled = !get('sample').checked && detected?.model !== 'WH-1000XM5';
  get('results').replaceChildren();
  trace.replaceChildren();
  get('status').textContent = '';
}

get('sample').addEventListener('change', updateAvailability);
button.disabled = true;
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: readProduct
    });
    detected = result;
    get('product').textContent = detected?.name
      ? 'Detected on ' + detected.site + ': ' + detected.name +
        (detected.model ? ' · ' + detected.model : ' · Sample comparisons unavailable for this product.')
      : 'No product detected on ' + (detected?.site || 'this tab') + '.';
  } catch {
    get('product').textContent = 'Open a retailer product page, then reopen the extension to detect it.';
  } finally {
    updateAvailability();
  }
})();

function addLink(container, label, url) {
  const link = document.createElement('a');
  link.textContent = label;
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  container.append(link);
}

async function read(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not open ' + label);
  const page = new DOMParser().parseFromString(await response.text(), 'text/html');
  const row = document.createElement('li');
  addLink(row, label, url);
  trace.append(row);
  return page;
}

async function collect() {
  const start = new URL('demo/new.html', location.href);
  const initial = await read(start, 'Opened new listing');
  const model = initial.querySelector('[data-model]').dataset.model;
  const search = new URL(initial.querySelector('[data-search]').getAttribute('href'), start);
  const matches = await read(search, 'Searched sample catalogue for ' + model);
  const offers = [];
  const listings = [[start, initial]];
  for (const link of matches.querySelectorAll('[data-model]')) {
    if (link.dataset.model !== model) {
      const row = document.createElement('li');
      row.textContent = 'Skipped ' + link.dataset.model + ' because the model differs';
      trace.append(row);
      continue;
    }
    const url = new URL(link.getAttribute('href'), search);
    listings.push([url, await read(url, 'Opened ' + link.textContent)]);
  }
  for (const [url, page] of listings) {
    const listing = page.querySelector('[data-model]').dataset;
    if (listing.model !== model) continue;
    const evidence = page.querySelector('[data-evidence]');
    const evidenceUrl = evidence && new URL(evidence.getAttribute('href'), url);
    const details = evidence && await read(evidenceUrl, 'Checked ' + evidence.textContent);
    offers.push({
      label: listing.label, price: Number(listing.price), extra: Number(listing.extra),
      days: Number(listing.days), minutes: Number(listing.minutes),
      warranty: listing.warranty || details?.querySelector('[data-warranty]')?.textContent,
      returns: listing.returns || details?.querySelector('[data-returns]')?.textContent,
      seller: details?.querySelector('[data-seller]')?.textContent,
      condition: listing.condition, test: listing.test === 'yes', sealed: listing.sealed === 'yes',
      url, evidenceUrl, evidenceLabel: evidence?.textContent
    });
  }
  return offers;
}

document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  get('sample').disabled = true;
  trace.replaceChildren();
  get('results').replaceChildren();
  get('status').textContent = 'Checking sample pages…';
  try {
    const prefs = { budget: Math.round(get('budget').valueAsNumber * 100), minutes: get('minutes').valueAsNumber,
      days: get('days').valueAsNumber, rule: get('rule').value };
    const offers = compare(await collect(), prefs);
    const winner = offers.find(offer => !offer.reasons.length);
    get('status').textContent = winner ? winner.label + ' is the lowest-cost option that fits (' + money(winner.total) + ').'
      : 'None of these options meet all your requirements.';
    for (const offer of offers) {
      const card = document.createElement('article');
      const heading = document.createElement('strong');
      heading.textContent = offer.label + ' · ' + money(offer.total) + (offer === winner ? ' · Recommended' : '');
      card.append(heading);
      const lines = [
        money(offer.price) + ' item + ' + money(offer.extra) + (offer.minutes ? ' travel' : ' delivery'),
        offer.minutes ? offer.minutes + ' min round trip · Pickup test ' + (offer.test ? 'confirmed' : 'not stated') : 'Delivery in ' + offer.days + ' day(s)',
        'Listed condition: ' + offer.condition,
        'Warranty: ' + (offer.warranty || 'Not stated') + ' · Returns: ' + (offer.returns || 'Not stated'),
        offer.seller, offer.reasons.length ? 'Doesn’t fit: ' + offer.reasons.join(', ') : 'Fits your requirements',
        offer.minutes && !offer.test ? 'Ask the seller: Can I test the headphones before paying?' : null
      ];
      for (const line of lines.filter(Boolean)) {
        const p = document.createElement('p');
        p.textContent = line;
        card.append(p);
      }
      addLink(card, 'View listing', offer.url);
      if (offer.evidenceUrl) {
        card.append(' · ');
        addLink(card, offer.evidenceLabel, offer.evidenceUrl);
      }
      get('results').append(card);
    }
  } catch (error) {
    get('status').textContent = error.message;
  } finally {
    get('sample').disabled = false;
    button.disabled = !get('sample').checked && detected?.model !== 'WH-1000XM5';
  }
});