import { CheerioAPI } from 'cheerio';
import { createHash } from 'crypto';
import { RawTransaction } from '../../types/transaction';
import { DEPOSIT_TABLE_LAYOUTS, DepositColumnKey, REQUIRED_DEPOSIT_FIELDS } from './deposit-table-layouts';
import { DepositCell, normalizeText, resolveDepositColumns, safeColumnLabel,
  semanticHeaderSignature, validatedHeaderLayout, ResolverStrategy, SemanticField } from './deposit-column-resolver';

export enum RawHttpResponseClassification {
  DEPOSIT_TABLE = 'DEPOSIT_TABLE', EMPTY_DEPOSIT_TABLE = 'EMPTY_DEPOSIT_TABLE',
  LOGIN_PAGE = 'LOGIN_PAGE', PERMISSION_OR_ERROR_PAGE = 'PERMISSION_OR_ERROR_PAGE',
  UNKNOWN_LAYOUT = 'UNKNOWN_LAYOUT', MALFORMED_DEPOSIT_TABLE = 'MALFORMED_DEPOSIT_TABLE',
  INVALID_HTML = 'INVALID_HTML'
}
export enum RawHttpParseErrorCode {
  TABLE_NOT_FOUND = 'TABLE_NOT_FOUND', LOGIN_RESPONSE = 'LOGIN_RESPONSE',
  PERMISSION_RESPONSE = 'PERMISSION_RESPONSE', UNKNOWN_LAYOUT = 'UNKNOWN_LAYOUT',
  INVALID_AMOUNT = 'INVALID_AMOUNT', INVALID_PROCESS_DATE = 'INVALID_PROCESS_DATE',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD', SCHEMA_CONFLICT = 'SCHEMA_CONFLICT',
  FOOTER_ROW = 'FOOTER_ROW', PAGINATION_AMBIGUOUS = 'PAGINATION_AMBIGUOUS', SNAPSHOT_FAILED = 'SNAPSHOT_FAILED'
}
export interface RawHttpRowRejection {
  rowIndex: number;
  code: RawHttpParseErrorCode;
  bodyCount: number;
  missingFields?: DepositColumnKey[];
  conflicts?: SemanticField[];
  strategy?: ResolverStrategy;
}
export interface DepositPageResult {
  /** Diagnostic rows only until trusted is true; never hand off an untrusted page. */
  transactions: RawTransaction[];
  rejections: RawHttpRowRejection[];
  rowsDetected: number;
  trusted: boolean;
  layout: { headerCount: number; bodyCounts: number[]; recognized: boolean; layoutNames: string[];
    headerLabels: string[]; strategies: ResolverStrategy[]; signature: string };
  classification: RawHttpResponseClassification;
  pageErrorCode?: RawHttpParseErrorCode;
}
export function isTrustedDepositPage(result: Pick<DepositPageResult, 'classification'>): boolean {
  return result.classification === RawHttpResponseClassification.DEPOSIT_TABLE
    || result.classification === RawHttpResponseClassification.EMPTY_DEPOSIT_TABLE;
}
function amount(value: string): number {
  // Keep verified decimal/thousands/currency forms and integer rounding. Unlike
  // parseFloat after character stripping, malformed numbers must never become money.
  const numeric = value.replace(/^(?:[A-Za-z]{2,3}|[$€£¥])\s*/, '')
    .replace(/\s*(?:[A-Za-z]{2,3}|[$€£¥])$/, '').trim();
  if (!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(numeric)) return NaN;
  const parsed = Number(numeric.replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : NaN;
}
function validProcessDate(value: string): boolean {
  // Verified panel format. Reject an account/username accidentally used as a date.
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return false;
  const [, y, m, d, h, min, sec] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, h, min, sec));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    && date.getUTCHours() === h && date.getUTCMinutes() === min && date.getUTCSeconds() === sec;
}
export function parseDepositDocument($: CheerioAPI): DepositPageResult {
  const result: DepositPageResult = { transactions: [], rejections: [], rowsDetected: 0, trusted: false,
    layout: { headerCount: 0, bodyCounts: [], recognized: false, layoutNames: [], headerLabels: [], strategies: [], signature: '0H/0B' },
    classification: RawHttpResponseClassification.INVALID_HTML, pageErrorCode: RawHttpParseErrorCode.TABLE_NOT_FOUND };
  // Login/permission markers take precedence over a stale or decoy table.
  const login = $('form#login-form').length > 0 || $('form').toArray().some(form =>
    $(form).find('input[type="password"]').length > 0 && $(form).find('input[name*="user"],input[type="email"]').length > 0);
  const permission = /\b(permission denied|unauthorized|forbidden|access denied|application error)\b/i.test($('title').text())
    || $('[role="alert"].error,.error-page,.access-denied').length > 0;
  const table = $('table.table.table-striped.b-t');
  if (login || permission || !table.length) {
    const permissionWithoutTable = !table.length && /\b(permission denied|unauthorized|forbidden|access denied|application error)\b/i.test($('body').text());
    if (login) { result.classification = RawHttpResponseClassification.LOGIN_PAGE; result.pageErrorCode = RawHttpParseErrorCode.LOGIN_RESPONSE; }
    else if (permission || permissionWithoutTable) { result.classification = RawHttpResponseClassification.PERMISSION_OR_ERROR_PAGE; result.pageErrorCode = RawHttpParseErrorCode.PERMISSION_RESPONSE; }
    return result;
  }
  const headers = table.first().children('thead').children('tr').first().children('th').toArray().map(cell => normalizeText($(cell).text()));
  const bodies = table.first().children('tbody');
  const rows = bodies.children('tr').toArray();
  result.rowsDetected = rows.length;
  result.layout.headerCount = headers.length;
  // Only approved identities enter diagnostic metadata; arbitrary DOM strings never do.
  result.layout.headerLabels = headers.map(safeColumnLabel);
  let unknown = table.length !== 1 || !headers.length || !bodies.length;
  let malformed = false;
  let resolvedRows = 0;
  rows.forEach((row, offset) => {
    const elements = $(row).children('td').toArray();
    result.layout.bodyCounts.push(elements.length);
    if (normalizeText($(row).text()) === '') return;
    // Only known summary rows without transaction identities may be excluded.
    // A small/colspan transaction or a nonempty <th> row is a schema error.
    const summary = elements.length <= 6 && elements.some(cell =>
      /^(?:sanitized summary|summary|subtotal(?: reject)?|total(?: reject| first deposit| unique depositor)?|dicanceled)$/i.test(normalizeText($(cell).text())))
      && !elements.some(cell => $(cell).is('[data-label],[data-bank-number],.cell-amount')
        || $(cell).find('a.player-link,[data-bank-number]').length);
    if (summary) {
      result.rejections.push({ rowIndex: offset + 1, code: RawHttpParseErrorCode.FOOTER_ROW, bodyCount: elements.length });
      return;
    }
    const cells: DepositCell[] = elements.map(element => {
      const cell = $(element);
      // Plain text cells need no descendant selector traversal. Cache the
      // canonical nodes once for cells that actually contain nested elements.
      const nested = element.children.some(node => node.type === 'tag');
      const canonicalNodes = nested ? cell.find('[data-bank-number]').toArray() : [];
      const canonicalAccounts = [element.attribs['data-bank-number'], ...canonicalNodes
        .map(node => $(node).attr('data-bank-number'))].filter((v): v is string => Boolean(v?.trim())).map(v => v.trim());
      const hints: SemanticField[] = [];
      if (nested && cell.find('a.player-link').length) hints.push('USER_NAME');
      if (/(?:^|\s)cell-amount(?:\s|$)/.test(element.attribs.class || '')) hints.push('AMOUNT');
      if ('data-bank-number' in element.attribs || canonicalNodes.length) hints.push('ACCOUNT_NUMBER');
      return { text: normalizeText(cell.text()), label: element.attribs['data-label'] || '', hints,
        canonicalAccounts, colspan: Number(element.attribs.colspan || 1) };
    });
    const resolution = resolveDepositColumns(headers, cells);
    if (!result.layout.strategies.includes(resolution.strategy)) result.layout.strategies.push(resolution.strategy);
    if (resolution.layout && !result.layout.layoutNames.includes(resolution.layout.name)) result.layout.layoutNames.push(resolution.layout.name);
    if (!resolution.valid) {
      unknown = true;
      result.rejections.push({ rowIndex: offset + 1, code: resolution.conflicts.length ? RawHttpParseErrorCode.SCHEMA_CONFLICT : RawHttpParseErrorCode.UNKNOWN_LAYOUT,
        bodyCount: cells.length, missingFields: resolution.missing, conflicts: resolution.conflicts, strategy: resolution.strategy });
      return;
    }
    resolvedRows++;
    const read = (key: SemanticField): string => {
      const index = resolution.indices[key];
      if (index === undefined) return '';
      const cell = cells[index];
      if (key === 'ACCOUNT_NUMBER') {
        const unique = [...new Set(cell.canonicalAccounts)];
        if (unique.length > 1) return '';
        if (unique.length === 1) return unique[0];
      }
      return cell.text;
    };
    const values = Object.fromEntries(Object.keys(resolution.indices).map(key => [key, read(key as SemanticField)])) as Record<SemanticField, string>;
    const missing = REQUIRED_DEPOSIT_FIELDS.filter(key => !values[key as SemanticField]);
    let code: RawHttpParseErrorCode | undefined;
    if (missing.length) code = RawHttpParseErrorCode.MISSING_REQUIRED_FIELD;
    else if (Number.isNaN(amount(values.AMOUNT))) code = RawHttpParseErrorCode.INVALID_AMOUNT;
    else if (!validProcessDate(values.PROCESS_DATE)) code = RawHttpParseErrorCode.INVALID_PROCESS_DATE;
    if (code) {
      malformed = true;
      result.rejections.push({ rowIndex: offset + 1, code, bodyCount: cells.length,
        ...(missing.length ? { missingFields: [...missing] } : {}), strategy: resolution.strategy });
      return;
    }
    result.transactions.push({ userName: values.USER_NAME, bank: values.BANK || '', accountName: values.ACCOUNT_NAME || '',
      accountNumber: values.ACCOUNT_NUMBER, amount: amount(values.AMOUNT), status: values.STATUS || '', done: values.DONE || '',
      depositType: values.DEPOSIT_TYPE || '', agent: values.AGENT || '', processDate: values.PROCESS_DATE, createdAt: values.CREATED_AT || '' });
  });
  // Empty pages need independently recognizable structure; row counts cannot authenticate them.
  if (!resolvedRows && !DEPOSIT_TABLE_LAYOUTS.some(layout => validatedHeaderLayout(headers, layout))
    && !semanticHeaderSignature(headers)) unknown = true;
  result.layout.signature = `${headers.length}H/${[...new Set(result.layout.bodyCounts)].sort((a,b) => a-b).join(',') || '0'}B`;
  result.layout.recognized = !unknown;
  result.classification = unknown ? RawHttpResponseClassification.UNKNOWN_LAYOUT : malformed ? RawHttpResponseClassification.MALFORMED_DEPOSIT_TABLE
    : result.transactions.length ? RawHttpResponseClassification.DEPOSIT_TABLE : RawHttpResponseClassification.EMPTY_DEPOSIT_TABLE;
  result.trusted = isTrustedDepositPage(result);
  result.pageErrorCode = unknown ? RawHttpParseErrorCode.UNKNOWN_LAYOUT : malformed ? result.rejections.find(r => r.code !== RawHttpParseErrorCode.FOOTER_ROW)?.code : undefined;
  return result;
}
/** Allowlisted structural diagnostics only; never serialize the transaction payload. */
export function depositDiagnostics(result: DepositPageResult, context?: { pageNumber: number; profileId: string }): object {
  return { classification: result.classification, code: result.pageErrorCode,
    ...(context ? { pageNumber: context.pageNumber,
      profileTag: createHash('sha256').update(context.profileId).digest('hex').slice(0, 12) } : {}),
    headerCount: result.layout.headerCount, headerLabels: result.layout.headerLabels.slice(0, 64),
    bodyCounts: [...new Set(result.layout.bodyCounts)].slice(0, 64),
    strategies: result.layout.strategies, signature: result.layout.signature,
    rowsDetected: result.rowsDetected, rowsParsed: result.transactions.length,
    rejectionCount: result.rejections.length,
    rejections: result.rejections.slice(0, 20).map(({ rowIndex, code, bodyCount, missingFields, conflicts, strategy }) =>
      ({ rowIndex, code, bodyCount, missingFields, conflicts, strategy })) };
}
