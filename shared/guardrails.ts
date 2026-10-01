import type { Caution, Requirements } from './schema';

/**
 * Topics this assistant must not answer confidently. When the user's own
 * words raise one of them, the response carries an explicit caution instead
 * of an answer. These run before (and regardless of) any provider.
 */

interface Rule {
  topic: string;
  pattern: RegExp;
  message: string;
  sourceIds: string[];
}

const RULES: Rule[] = [
  {
    topic: 'Exact cost',
    pattern: /\b(how much|exact (cost|price)|monthly (cost|bill)|cost estimate|price quote|per month)\b|\$\s?\d/i,
    message:
      'This assistant does not produce cost figures. It describes cost drivers and relative tradeoffs only. Build an estimate from your own usage assumptions in AWS Pricing Calculator and track spend with AWS Budgets.',
    sourceIds: ['tool-pricing-calculator', 'tool-budgets', 'wa-cost'],
  },
  {
    topic: 'Compliance',
    pattern: /\b(hipaa|pci(-dss)?|gdpr|soc ?2|fedramp|iso ?27001|compliant|compliance|certif(y|ied|ication))\b/i,
    message:
      'This assistant cannot determine whether a design is compliant with any regulation or certification. Treat the security notes as a starting point for review with your compliance and security owners.',
    sourceIds: ['wa-security'],
  },
  {
    topic: 'Production readiness',
    pattern: /\b(production[- ]ready|guarantee[sd]?|100% uptime|zero downtime|never (go|goes) down|bulletproof)\b/i,
    message:
      'Plans from this assistant are reviewable starting points, not production-ready designs, and no availability level can be guaranteed. Validate the design with a Well-Architected review and load testing before relying on it.',
    sourceIds: ['wa-framework', 'wa-reliability'],
  },
  {
    topic: 'Other clouds',
    pattern: /\b(azure|gcp|google cloud|oracle cloud|alibaba cloud|digitalocean|multi-cloud)\b/i,
    message:
      'This MVP designs on AWS only. It does not compare or design for other cloud providers.',
    sourceIds: [],
  },
];

function userText(req: Requirements): string {
  return [req.description, req.existingSystems, req.usageNotes, req.recoveryNotes, req.operationsNotes].join('\n');
}

export function detectCautions(req: Requirements): Caution[] {
  const text = userText(req);
  const cautions: Caution[] = RULES.filter((r) => r.pattern.test(text)).map((r) => ({
    topic: r.topic,
    message: r.message,
    sourceIds: r.sourceIds,
  }));

  if (req.dataSensitivity === 'regulated' && !cautions.some((c) => c.topic === 'Compliance')) {
    cautions.push({
      topic: 'Regulated data',
      message:
        'Regulated data was selected. This plan does not establish compliance. Confirm data-residency, retention, and audit obligations with your compliance owner before choosing a design.',
      sourceIds: ['wa-security'],
    });
  }

  if (req.availability === 'mission_critical') {
    cautions.push({
      topic: 'Mission-critical availability',
      message:
        'Mission-critical workloads usually need an explicit disaster-recovery strategy (possibly multi-Region) chosen from agreed recovery objectives. This MVP outlines single-Region Multi-AZ designs and flags the decision; it does not design the DR strategy for you.',
      sourceIds: ['wp-disaster-recovery', 'wp-fault-isolation'],
    });
  }

  return cautions;
}

/** Merge cautions by topic, keeping the first occurrence. */
export function mergeCautions(...lists: Caution[][]): Caution[] {
  const out = new Map<string, Caution>();
  for (const list of lists) for (const c of list) if (!out.has(c.topic)) out.set(c.topic, c);
  return [...out.values()];
}
