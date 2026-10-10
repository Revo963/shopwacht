import { greenClimate, greenGeneric, greenLabel, guaranteeTerms, healthClaim, healthDisease, lawAsBenefit, testClaim } from './claims.js';
import { strikePrice, unitPrice } from './pricing.js';
import { impressum, odrLink, outdatedTmg, privacyPolicy, withdrawalButton, withdrawalNotice } from './shop.js';
import { textileFibre } from './textile.js';
import type { ProductRule, Rule, ShopRule } from './types.js';

export const PRODUCT_RULES: ProductRule[] = [
  greenGeneric,
  greenClimate,
  greenLabel,
  healthDisease,
  healthClaim,
  testClaim,
  lawAsBenefit,
  unitPrice,
  strikePrice,
  textileFibre,
];

export const SHOP_RULES: ShopRule[] = [impressum, withdrawalNotice, withdrawalButton, privacyPolicy, odrLink, outdatedTmg];

export const ALL_RULES: Rule[] = [...PRODUCT_RULES, ...SHOP_RULES];

/**
 * Rules that no longer run but may appear in saved reports. guarantee-terms found 0 real
 * cases in nine labelled samples (7 false alarms, 4 at "Risiko", 7 unclear): it flagged money-back banners, which need no terms in
 * the advert itself (BGH, Urt. v. 14.04.2011 – I ZR 133/09 "Werbung mit Garantie").
 */
const RETIRED_RULES: Rule[] = [guaranteeTerms];

const byId = new Map([...ALL_RULES, ...RETIRED_RULES].map((r) => [r.id, r]));

export function ruleById(id: string): Rule | undefined {
  return byId.get(id);
}
