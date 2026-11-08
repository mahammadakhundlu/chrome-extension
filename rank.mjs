export function compare(offers, prefs) {
  return offers.map(offer => {
    const total = offer.price + offer.extra;
    const reasons = [];
    if (total > prefs.budget) reasons.push('over budget');
    if (offer.days > prefs.days) reasons.push('too late');
    if (offer.minutes > prefs.minutes) reasons.push('pickup takes too long');
    if (prefs.rule === 'warranty' && !offer.warranty) reasons.push('warranty unconfirmed');
    if (prefs.rule === 'test' && offer.minutes && !offer.test) reasons.push('pickup test unconfirmed');
    if (prefs.rule === 'sealed' && !offer.sealed) reasons.push('not factory sealed');
    return { ...offer, total, reasons };
  }).sort((a, b) => a.total - b.total);
}