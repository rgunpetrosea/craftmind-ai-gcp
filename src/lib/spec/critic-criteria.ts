import type { CriticKey, CriticScores } from '@/lib/types';

/**
 * Design critic rubric (Design Intelligence Layer v2, sections 10-11). Client-safe: the dashboard renders the same list.
 * Thresholds are starting points to tune after testing (env-configurable), not claims of model performance.
 */

export const CRITIC_CRITERIA: Array<{ key: CriticKey; label: string; gated: boolean }> = [
  { key: 'premium_perception', label: 'Premium Perception', gated: true },
  { key: 'originality', label: 'Originality', gated: true },
  { key: 'visual_identity', label: 'Visual Identity', gated: true },
  { key: 'proportion_balance', label: 'Proportion and Balance', gated: true },
  { key: 'material_harmony', label: 'Material Harmony', gated: false },
  { key: 'craftsmanship_value', label: 'Craftsmanship Value', gated: false },
  { key: 'functional_credibility', label: 'Functional Credibility', gated: false },
  { key: 'view_consistency', label: 'View Consistency', gated: true },
  { key: 'commercial_appeal', label: 'Commercial Appeal', gated: false },
  { key: 'production_feasibility', label: 'Production Feasibility', gated: false },
];

export const CRITIC_KEYS = CRITIC_CRITERIA.map((c) => c.key);

/** A concept is never shown to the client while any gated criterion scores below this. */
export const CRITIC_THRESHOLD = Number(process.env.NEXT_PUBLIC_CRITIC_THRESHOLD ?? process.env.CRITIC_THRESHOLD ?? 80);

/** Automatic revision cycles before the concept is escalated to the crafter. */
export const MAX_CRITIC_REVISIONS = Number(process.env.MAX_CRITIC_REVISIONS ?? 2);

/** Gated criteria below the threshold. */
export function failedCriteria(scores: CriticScores): CriticKey[] {
  return CRITIC_CRITERIA.filter((c) => c.gated && (scores[c.key] ?? 0) < CRITIC_THRESHOLD).map((c) => c.key);
}

export const criterionLabel = (key: CriticKey) => CRITIC_CRITERIA.find((c) => c.key === key)?.label ?? key;
