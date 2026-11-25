/** Document numbers. (N1 on the flow maps moves these to the UOS numbering service later.) */
export function voucherNumber(college: string, type: string, id: number, year = new Date().getFullYear()): string {
  const prefix = ({ debit: 'DV', onaccount: 'OA', credit: 'CV' } as Record<string, string>)[type] ?? 'VO';
  return `${(college || 'smgg').toUpperCase()}-${prefix}-${year}-${String(id).padStart(5, '0')}`;
}

export function advanceNumber(college: string, id: number, year = new Date().getFullYear()): string {
  return `${(college || 'smgg').toUpperCase()}-ADV-${year}-${String(id).padStart(5, '0')}`;
}
