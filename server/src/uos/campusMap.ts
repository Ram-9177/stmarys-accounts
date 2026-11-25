/**
 * Which St. Mary's colleges (the books this app keeps) belong to which UOS campus.
 *
 * A UOS module pass is scoped to ONE campus. The Accounts app keeps books per
 * college (smgg, smwec, smhyd), so we need a fixed map from the platform's
 * campus to the colleges a pass for that campus may open.
 *
 * Configured with UOS_CAMPUS_MAP as JSON, keyed by the UOS campus id
 * (as it appears in the module pass). Each value is either a list of college
 * codes or an object with a code/name for display:
 *
 *   {"<campus-uuid>": ["smgg", "smwec"], "<campus-uuid-2>": ["smhyd"]}
 *   {"<campus-uuid>": {"code": "AP", "name": "Andhra Pradesh", "colleges": ["smgg", "smwec"]}}
 *
 * A pass matches an entry by campus id, or by campus code when the pass carries one.
 */

export interface CampusRule {
  /** UOS campus id: sent back to the shell as campusId when re-entering. */
  campusId: string;
  /** Short campus code/tag (e.g. AP, HYD) if known. */
  code: string;
  name: string;
  colleges: string[];
}

function collegeList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out = raw.map((c) => String(c).trim().toLowerCase()).map((c) => (c === 'smg' ? 'smgg' : c)).filter(Boolean);
  return Array.from(new Set(out));
}

/** Parses UOS_CAMPUS_MAP. Throws a readable error for bad JSON or a college listed under two campuses. */
export function parseCampusMap(raw: string): CampusRule[] {
  const text = raw.trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('UOS_CAMPUS_MAP must be JSON, e.g. {"<campus id>": ["smgg", "smwec"]}');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('UOS_CAMPUS_MAP must be a JSON object keyed by UOS campus id');
  }
  const rules: CampusRule[] = [];
  const owner = new Map<string, string>();
  for (const [campusId, value] of Object.entries(parsed as Record<string, unknown>)) {
    const id = campusId.trim();
    if (!id) continue;
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    const colleges = collegeList(obj ? obj.colleges : value);
    if (!colleges.length) throw new Error(`UOS_CAMPUS_MAP: campus ${id} lists no colleges`);
    for (const c of colleges) {
      const prev = owner.get(c);
      if (prev && prev !== id) throw new Error(`UOS_CAMPUS_MAP: college ${c} is listed under two campuses (${prev}, ${id})`);
      owner.set(c, id);
    }
    rules.push({
      campusId: id,
      code: obj && typeof obj.code === 'string' ? obj.code.trim() : '',
      name: obj && typeof obj.name === 'string' ? obj.name.trim() : '',
      colleges,
    });
  }
  return rules;
}

/** Finds the rule for a pass's campus (by id first, then by code), case-insensitively. */
export function findCampus(rules: CampusRule[], campusId: string, campusCode = ''): CampusRule | null {
  const id = campusId.trim().toLowerCase();
  const code = campusCode.trim().toLowerCase();
  if (id) {
    const byId = rules.find((r) => r.campusId.toLowerCase() === id);
    if (byId) return byId;
  }
  const keys = [code, id].filter(Boolean);
  for (const k of keys) {
    const byCode = rules.find((r) => (r.code && r.code.toLowerCase() === k) || r.campusId.toLowerCase() === k);
    if (byCode) return byCode;
  }
  return null;
}

/** The campus a college belongs to, if it is mapped. */
export function campusOfCollege(rules: CampusRule[], college: string): CampusRule | null {
  const c = college.trim().toLowerCase();
  return rules.find((r) => r.colleges.includes(c)) ?? null;
}
