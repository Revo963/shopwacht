// Coverage counts observed operations, not legal completeness.
import type { RuleCheck, ScanCoverage, ShopSnapshot } from '../types.js';

export function summarizeCoverage(shop: ShopSnapshot, checks: RuleCheck[], extra: Pick<ScanCoverage, 'recoveredDescriptions' | 'pageLoads' | 'browserLoads'>, incompleteShopRules: Set<string>): ScanCoverage {
  const products = checks.filter((c) => c.subjectType === 'product');
  const outcomes: ScanCoverage['outcomes'] = { 'not-triggered': 0, 'below-threshold': 0, 'preparation-error': 0, 'decision-error': 0, 'page-dismissed': 0, 'page-inconclusive': 0, finding: 0 };
  for (const check of products) outcomes[check.outcome]++;
  const findings = products.filter((c) => c.outcome === 'finding');
  const riskFindings = findings.filter((c) => c.level === 'risiko').length;
  return {
    products: shop.products.length,
    productRuleChecks: products.length,
    outcomes,
    incompleteProducts: new Set(products.filter((c) => c.incomplete).map((c) => c.subjectId)).size,
    incompleteRuleIds: [...new Set([...checks.filter((c) => c.incomplete).map((c) => c.ruleId), ...incompleteShopRules])].sort(),
    missingDescriptions: shop.products.filter((p) => !p.text.trim()).length,
    ...extra,
    unreachableShopPages: shop.unreachable.length,
    productFindings: findings.length,
    riskFindings,
    riskShare: findings.length ? riskFindings / findings.length : null,
  };
}
