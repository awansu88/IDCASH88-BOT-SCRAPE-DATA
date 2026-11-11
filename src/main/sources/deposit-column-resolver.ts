import { DepositColumnKey, DepositTableLayout, REQUIRED_DEPOSIT_FIELDS, findDepositTableLayout } from './deposit-table-layouts';

export const SEMANTIC_FIELDS = ['USER_NAME', 'BANK', 'ACCOUNT_NAME', 'ACCOUNT_NUMBER', 'CURRENCY',
  'AMOUNT', 'STATUS', 'DONE', 'DEPOSIT_TYPE', 'AGENT', 'PROCESS_DATE', 'CREATED_AT'] as const;
export type SemanticField = typeof SEMANTIC_FIELDS[number];
export type ResolverStrategy = 'SEMANTIC' | 'MIXED' | 'VALIDATED_LAYOUT' | 'NONE';
export interface DepositCell {
  text: string;
  label: string;
  hints: SemanticField[];
  canonicalAccounts: string[];
  colspan: number;
}
const LABELS: Readonly<Record<string, DepositColumnKey | 'DESTINATION'>> = {
  '#': 'SEQUENCE', 'user name': 'USER_NAME', username: 'USER_NAME', bank: 'BANK',
  'account name': 'ACCOUNT_NAME', 'account number': 'ACCOUNT_NUMBER',
  'payment id': 'PAYMENT_ID', currency: 'CURRENCY', amount: 'AMOUNT', status: 'STATUS',
  'external id': 'EXTERNAL_ID', done: 'DONE', 'deposit type': 'DEPOSIT_TYPE',
  'payment type': 'PAYMENT_TYPE', agent: 'AGENT', 'process date': 'PROCESS_DATE',
  'created at': 'CREATED_AT', destination: 'DESTINATION',
};
export const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ');
export function columnIdentity(label: string): DepositColumnKey | 'DESTINATION' | undefined {
  // Only harmless trailing label punctuation is ignored; no fuzzy matching.
  return LABELS[normalizeText(label).toLowerCase().replace(/[?:.]$/, '').trim()];
}
export function safeColumnLabel(label: string): string { return columnIdentity(label) || 'UNKNOWN'; }
const HEADER_ORDER: readonly DepositColumnKey[] = ['SEQUENCE', 'USER_NAME', 'BANK', 'ACCOUNT_NAME',
  'ACCOUNT_NUMBER', 'PAYMENT_ID', 'CURRENCY', 'AMOUNT', 'STATUS', 'EXTERNAL_ID', 'DONE',
  'DEPOSIT_TYPE', 'PAYMENT_TYPE', 'AGENT', 'PROCESS_DATE', 'CREATED_AT'];
export function validatedHeaderLayout(headers: string[], layout: DepositTableLayout): boolean {
  const order: readonly string[] = layout.headerCount === 18
    ? [...HEADER_ORDER.slice(0, 5), 'DESTINATION', ...HEADER_ORDER.slice(5)] : HEADER_ORDER;
  return headers.length === layout.headerCount && order.every((key, index) => {
    const identity = columnIdentity(headers[index]);
    // Historical panels have unlabeled audit/Done headers. Known contradictory
    // identities are never ignored; essential header identities must be exact.
    return identity === key || (identity === undefined && !REQUIRED_DEPOSIT_FIELDS.includes(key as DepositColumnKey));
  });
}
export function semanticHeaderSignature(headers: string[]): boolean {
  const keys = headers.map(columnIdentity);
  return REQUIRED_DEPOSIT_FIELDS.every(key => keys.filter(value => value === key).length === 1)
    && ['STATUS', 'CREATED_AT'].every(key => keys.includes(key as DepositColumnKey));
}
export interface ColumnResolution {
  indices: Partial<Record<SemanticField, number>>;
  conflicts: SemanticField[];
  missing: SemanticField[];
  strategy: ResolverStrategy;
  layout?: DepositTableLayout;
  valid: boolean;
}
export function resolveDepositColumns(headers: string[], cells: DepositCell[]): ColumnResolution {
  const candidate = findDepositTableLayout(headers.length, cells.length);
  const layout = candidate && validatedHeaderLayout(headers, candidate) ? candidate : undefined;
  const indices: ColumnResolution['indices'] = {};
  const conflicts = new Set<SemanticField>();
  let semanticCount = 0;
  cells.forEach((cell, index) => {
    const labelKey = columnIdentity(cell.label);
    const claims = new Set<SemanticField>(cell.hints);
    if (SEMANTIC_FIELDS.includes(labelKey as SemanticField)) claims.add(labelKey as SemanticField);
    // A labeled cell and a verified class/attribute must agree on its identity.
    if (claims.size > 1 || (cell.label && claims.size && labelKey !== [...claims][0])) {
      claims.forEach(key => conflicts.add(key));
    }
    claims.forEach(key => {
      semanticCount++;
      if (indices[key] !== undefined && indices[key] !== index) conflicts.add(key);
      else indices[key] = index;
    });
  });
  if (layout) {
    for (const field of REQUIRED_DEPOSIT_FIELDS as readonly SemanticField[]) {
      const index = layout.map[field];
      const label = cells[index]?.label;
      if ((indices[field] !== undefined && indices[field] !== index)
        || (label && columnIdentity(label) !== field)) conflicts.add(field);
    }
  }
  let fallbackCount = 0;
  for (const key of SEMANTIC_FIELDS) {
    if (indices[key] !== undefined || !layout) continue;
    const index = layout.map[key];
    if (index < 0 || !cells[index]) continue;
    // Never interpret a cell claiming another identity as an unlabeled fallback.
    const cell = cells[index];
    if ((cell.label && columnIdentity(cell.label) !== key)
      || cell.hints.some(hint => hint !== key)) {
      conflicts.add(key);
      continue;
    }
    indices[key] = index;
    fallbackCount++;
  }
  const missing = (REQUIRED_DEPOSIT_FIELDS as readonly SemanticField[]).filter(key => indices[key] === undefined);
  return { indices, conflicts: [...conflicts], missing, layout,
    strategy: fallbackCount ? semanticCount ? 'MIXED' : 'VALIDATED_LAYOUT' : semanticCount ? 'SEMANTIC' : 'NONE',
    valid: !conflicts.size && !missing.length };
}
