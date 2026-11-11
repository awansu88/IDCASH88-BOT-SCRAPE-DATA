import { load, CheerioAPI } from 'cheerio';
import { parseDepositDocument, DepositPageResult, RawHttpParseErrorCode } from './deposit-page-parser';
export type { RawHttpRowRejection } from './deposit-page-parser';
export { RawHttpResponseClassification, RawHttpParseErrorCode } from './deposit-page-parser';

export interface RawPaginationInfo {
  currentPage: number | null;
  nextPageNumber: number | null;
  nextHref: string | null;
  hasNext: boolean;
  valid: boolean;
  errorCode?: RawHttpParseErrorCode.PAGINATION_AMBIGUOUS;
}
export interface RawHttpParseResult extends DepositPageResult { pagination: RawPaginationInfo; }

export class RawHttpHtmlParser {
  parse(html: string, options: { expectedPageNumber?: number } = {}): RawHttpParseResult {
    const $ = load(typeof html === 'string' ? html : '');
    return { ...parseDepositDocument($), pagination: this.pagination($, options.expectedPageNumber) };
  }

  private pagination($: CheerioAPI, expectedPageNumber?: number): RawPaginationInfo {
    const container = $('ul.pagination,nav.pagination,.pagination').first();
    const base: RawPaginationInfo = { currentPage: null, nextPageNumber: null, nextHref: null, hasNext: false, valid: true };
    if (!container.length) return base;
    const active = container.find('.active').first();
    const domCurrentPage = active.length
      ? this.pageNumber(active.attr('data-page') || active.find('a').attr('data-page') || active.text() || active.find('a').attr('href'))
      : null;
    if (active.length && domCurrentPage === null)
      return { ...base, valid: false, errorCode: RawHttpParseErrorCode.PAGINATION_AMBIGUOUS };
    if (domCurrentPage !== null && expectedPageNumber !== undefined && domCurrentPage !== expectedPageNumber)
      return { ...base, currentPage: domCurrentPage, valid: false, errorCode: RawHttpParseErrorCode.PAGINATION_AMBIGUOUS };
    const currentPage = domCurrentPage ?? expectedPageNumber ?? null;
    base.currentPage = currentPage;
    if (currentPage === null) return { ...base, valid: false, errorCode: RawHttpParseErrorCode.PAGINATION_AMBIGUOUS };
    const expected = currentPage + 1;
    const enabled = container.find('a').toArray().filter(link =>
      !$(link).closest('.disabled').length && $(link).attr('aria-disabled') !== 'true');
    const numbered = enabled.map(link => ({ link,
      page: this.pageNumber($(link).attr('data-page') || $(link).attr('href') || $(link).text()) }))
      .filter((item): item is { link: typeof enabled[number]; page: number } => item.page !== null);
    const usable = numbered.filter(item => item.page === expected).map(item => item.link);
    if (usable.length > 1)
      return { ...base, valid: false, errorCode: RawHttpParseErrorCode.PAGINATION_AMBIGUOUS };
    if (usable.length === 0) {
      const hasFuture = numbered.some(item => item.page > currentPage);
      return hasFuture ? { ...base, valid: false, errorCode: RawHttpParseErrorCode.PAGINATION_AMBIGUOUS } : base;
    }
    const href = $(usable[0]).attr('href');
    if (!href || href === '#') return base;
    return { currentPage, nextPageNumber: expected, nextHref: href, hasNext: true, valid: true };
  }

  private pageNumber(value?: string): number | null {
    if (!value) return null;
    const plain = value.trim().match(/^\d+$/);
    const query = value.match(/[?&]page=(\d+)(?:&|#|$)/i);
    const numeric = Number(plain?.[0] || query?.[1]);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  }

}
