import { validatePlan } from '../shared/validate';
import { validRawPlan } from './helpers';

describe('validatePlan', () => {
  it('accepts a well-formed plan without warnings', () => {
    const res = validatePlan(validRawPlan());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warnings).toEqual([]);
  });

  describe('unsupported service suggestions', () => {
    it('removes AWS components outside the catalog, drops their connections, and flags them', () => {
      const raw = validRawPlan();
      raw.nodes.push({ id: 'legacy', kind: 'aws', serviceId: 'aws-simpledb', label: 'SimpleDB', role: 'Old database.', tier: 'data', sourceIds: [] });
      raw.connections.push({ from: 'fn', to: 'legacy', label: 'reads' });
      const res = validatePlan(raw);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.plan.nodes.map((n) => n.id)).not.toContain('legacy');
      expect(res.plan.connections.some((c) => c.to === 'legacy')).toBe(false);
      expect(res.warnings.map((w) => w.code)).toContain('unsupported_service');
      expect(res.plan.cautions.some((c) => c.topic === 'Unsupported component')).toBe(true);
    });

    it('treats an AWS node with no catalog id as unsupported', () => {
      const raw = validRawPlan();
      raw.nodes.push({ id: 'mystery', kind: 'aws', label: 'Some AWS thing', role: 'Unknown.', tier: 'app' });
      const res = validatePlan(raw);
      expect(res.ok && res.warnings.some((w) => w.code === 'missing_service_id')).toBe(true);
    });

    it('rejects a plan whose only AWS components are unsupported', () => {
      const raw = validRawPlan();
      raw.nodes = [{ id: 'x', kind: 'aws', serviceId: 'not-a-service', label: 'X', role: 'X', tier: 'app' }];
      raw.connections = [];
      const res = validatePlan(raw);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('empty_diagram');
    });
  });

  describe('invalid diagram data', () => {
    it('rejects connections to nodes that do not exist', () => {
      const raw = validRawPlan();
      raw.connections.push({ from: 'fn', to: 'ghost', label: '' });
      const res = validatePlan(raw);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues[0].code).toBe('dangling_connection');
    });

    it('rejects duplicate node ids', () => {
      const raw = validRawPlan();
      raw.nodes.push({ ...raw.nodes[1] });
      const res = validatePlan(raw);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('duplicate_node');
    });

    it('rejects self-loops', () => {
      const raw = validRawPlan();
      raw.connections.push({ from: 'fn', to: 'fn', label: '' });
      const res = validatePlan(raw);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('self_connection');
    });

    it('rejects node ids that could inject Mermaid syntax', () => {
      for (const id of ['a b', 'x-->y', 'A1', '1abc', 'n"]', 'click']) {
        const raw = validRawPlan();
        raw.nodes[0].id = id;
        raw.connections[0].from = id;
        const res = validatePlan(raw);
        if (id === 'click') {
          // syntactically safe; Mermaid ids are prefixed so keywords cannot collide
          expect(res.ok).toBe(true);
        } else {
          expect(res.ok, id).toBe(false);
          if (!res.ok) expect(res.issues[0].code).toBe('schema');
        }
      }
    });

    it('rejects missing required sections (for example no alternatives)', () => {
      const raw = validRawPlan();
      raw.alternatives = [];
      const res = validatePlan(raw);
      expect(res.ok).toBe(false);
    });

    it('rejects non-object input', () => {
      expect(validatePlan('flowchart TB; a-->b').ok).toBe(false);
      expect(validatePlan(null).ok).toBe(false);
    });
  });

  describe('citations', () => {
    it('strips fabricated source ids and relabels the claim as an assumption', () => {
      const raw = validRawPlan();
      raw.considerations.security = [{ text: 'Made-up claim.', basis: 'source', sourceIds: ['aws-blog-2031'] }];
      raw.alternatives[0].sourceIds = ['svc-ecs', 'https://example.com/fake'];
      const res = validatePlan(raw);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.plan.considerations.security[0]).toMatchObject({ basis: 'assumption', sourceIds: [] });
      expect(res.plan.alternatives[0].sourceIds).toEqual(['svc-ecs']);
      expect(res.warnings.filter((w) => w.code === 'unknown_source')).toHaveLength(2);
    });

    it('keeps a claim sourced when at least one real citation survives', () => {
      const raw = validRawPlan();
      raw.considerations.security = [{ text: 'Claim.', basis: 'source', sourceIds: ['svc-iam', 'fake-id'] }];
      const res = validatePlan(raw);
      expect(res.ok && res.plan.considerations.security[0]).toMatchObject({ basis: 'source', sourceIds: ['svc-iam'] });
    });

    it('rejects a claim marked as sourced with no citations at all', () => {
      const raw = validRawPlan();
      raw.considerations.cost = [{ text: 'Trust me.', basis: 'source', sourceIds: [] }];
      expect(validatePlan(raw).ok).toBe(false);
    });
  });
});
