import { Page } from 'playwright';
import { load } from 'cheerio';
import { RawTransaction } from '../../types/transaction';
import { getLogger } from './logger-service';
import { parseDepositDocument, depositDiagnostics, DepositPageResult,
  RawHttpResponseClassification, RawHttpParseErrorCode, RawHttpRowRejection } from '../sources/deposit-page-parser';

/** Backward-compatible row facts; all diagnostics contain structural data only. */
export interface RowRejection extends RawHttpRowRejection {
  reason: string;
  cellCount: number;
  headerLabels: string[];
}
export interface ParseResult extends Omit<DepositPageResult, 'rejections'> {
  transactions: RawTransaction[];
  rejections: RowRejection[];
  snapshotFailed?: boolean;
}
function rejectionReason(row: RawHttpRowRejection): string {
  switch (row.code) {
    case RawHttpParseErrorCode.MISSING_REQUIRED_FIELD:
      return `Missing required field(s): ${(row.missingFields || []).join(', ')}`;
    case RawHttpParseErrorCode.INVALID_AMOUNT: return 'Invalid Amount Format: INVALID_AMOUNT';
    case RawHttpParseErrorCode.FOOTER_ROW: return 'Footer/summary row skipped';
    case RawHttpParseErrorCode.UNKNOWN_LAYOUT: return 'Unknown production layout: UNKNOWN_LAYOUT';
    default: return row.code;
  }
}
/** One consistent DOM snapshot, then the same pure parsing core as Fast HTTP. */
export class HTMLMapper {
  constructor(private page: Page) {}

  async parseCurrentPage(): Promise<ParseResult> {
    let parsed: DepositPageResult;
    try {
      parsed = parseDepositDocument(load(await this.page.content()));
    } catch {
      // Never convert DOM acquisition failure into a legitimate empty result or log the exception/URL.
      return { transactions: [], rejections: [], rowsDetected: 0, trusted: false, snapshotFailed: true,
        classification: RawHttpResponseClassification.INVALID_HTML, pageErrorCode: RawHttpParseErrorCode.SNAPSHOT_FAILED,
        layout: { headerCount: 0, bodyCounts: [], recognized: false, layoutNames: [], headerLabels: [], strategies: [], signature: '0H/0B' } };
    }
    getLogger().diag(`Deposit schema ${JSON.stringify(depositDiagnostics(parsed))}`);
    getLogger().info(`Parsed ${parsed.transactions.length} transactions (rejected ${parsed.rejections.length})`);
    return { ...parsed, rejections: parsed.rejections.map(row => ({ ...row, reason: rejectionReason(row),
      cellCount: row.bodyCount, headerLabels: parsed.layout.headerLabels })) };
  }
}
