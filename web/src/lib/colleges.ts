import type { College, CollegeCode } from '@/api/types';

const LOGOS: Record<string, string> = {
  smgg: '/assets/logo_smgg.png',
  smwec: '/assets/logo_smwec.jpg',
  smhyd: '/assets/logo_smgg.png',
};

export function collegeLogo(c: Pick<College, 'code' | 'logoUrl'> | CollegeCode): string {
  const code = typeof c === 'string' ? c : c.code;
  const url = typeof c === 'string' ? '' : c.logoUrl;
  return url || LOGOS[code] || '/assets/logo_smgg.png';
}

/** Short campus label used on pills and voucher numbers (STMW for the engineering college, as before). */
export function collegeShort(code: CollegeCode): string {
  return ({ smgg: 'SMGG', smwec: 'STMW', smhyd: 'SMHYD' } as Record<string, string>)[code] ?? code.toUpperCase();
}
