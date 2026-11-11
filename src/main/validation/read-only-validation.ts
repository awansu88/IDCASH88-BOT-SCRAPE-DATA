import { load } from 'cheerio';
import { parseDepositDocument, depositDiagnostics, RawHttpResponseClassification } from '../sources/deposit-page-parser';
import type { SourceScanResult } from '../sources/source-adapter';
import type { BrowserContext } from 'playwright';
import type { FilterProfile } from '../../types/filter-profile';
import type { SourceMode } from '../../types/source-mode';
import { PlaywrightService } from '../services/playwright-service';
import { LegacyBrowserSourceAdapter } from '../sources/legacy-browser-source-adapter';
import { FastHttpSourceAdapter, FastHttpRequestContext } from '../sources/fast-http-source-adapter';
import { SourceModeSelector } from '../sources/source-mode-selector';
import { DepositRequestRuntimeProvider } from '../sources/deposit-request-runtime-provider';
import { profileTag } from '../../utils/safe-diagnostics';

export class ValidationError extends Error {
  constructor(public readonly code: 'INVALID_VALIDATION_OPTIONS' | 'VALIDATION_REQUEST_BLOCKED') {
    super(code); this.name = 'ValidationError';
  }
}
/** Conservative network boundary for this standalone harness, never installed by production. */
export class ReadOnlyRequestPolicy {
  readonly target: URL;
  private names = new Set(['page', 'status', 'agent', 'payment', 'deposit_process_date_from', 'deposit_process_date_to']);
  blockedRequests = 0;
  constructor(url: string) {
    try { this.target = new URL(url); } catch { throw new ValidationError('INVALID_VALIDATION_OPTIONS'); }
    if ((this.target.protocol !== 'https:' && !(this.target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(this.target.hostname)))
      || this.target.username || this.target.password || this.target.search || this.target.hash
      || this.target.pathname !== '/deposit/transactions') throw new ValidationError('INVALID_VALIDATION_OPTIONS');
  }
  addFilterNames(names: string[]): void { names.filter(Boolean).forEach(name => this.names.add(name)); }
  allows(url: string, method: string, body?: string | Record<string, string>, browser = false): boolean {
    let candidate: URL;
    try { candidate = new URL(url); } catch { return false; }
    if (candidate.origin !== this.target.origin || candidate.username || candidate.password) return false;
    const read = method === 'GET' || method === 'HEAD';
    const auth = /\/(?:login|signin|log-in|sign-in|auth|users\/sign_in)\/?$/i.test(candidate.pathname);
    if (browser && auth) return read || method === 'POST'; // normal manual authentication only
    if (browser && read && ((candidate.pathname === '/' && !candidate.search) || candidate.pathname === '/favicon.ico'
      || (/^\/(assets|css|js|fonts|images)\//.test(candidate.pathname) && /\.(js|css|png|jpg|svg|ico|woff2?|ttf)$/i.test(candidate.pathname)))) return true;
    if (candidate.pathname !== this.target.pathname || (!read && method !== 'POST')) return false;
    const allowedName = (name: string): boolean => this.names.has(name) || /^(?:_token|_csrf(?:-[\w]+)?|csrf_token|_csrf_token|YII_CSRF_TOKEN)$/i.test(name);
    if ([...candidate.searchParams.keys()].some(name => !allowedName(name))) return false;
    if (body !== undefined) {
      const entries = typeof body === 'string' ? [...new URLSearchParams(body).entries()] : Object.entries(body);
      if (entries.some(([name]) => !allowedName(name))) return false;
    }
    return true;
  }
  private check(url: string, method: string, body?: Record<string, string>): void {
    if (!this.allows(url, method, body)) { this.blockedRequests++; throw new ValidationError('VALIDATION_REQUEST_BLOCKED'); }
  }
  async install(context: BrowserContext): Promise<void> {
    await context.route('**/*', async route => {
      const request = route.request();
      const contentType = request.headers()['content-type'] || '';
      const body = request.postData() ?? undefined;
      if ((body !== undefined && new URL(request.url()).pathname === this.target.pathname && !contentType.includes('application/x-www-form-urlencoded'))
        || !this.allows(request.url(), request.method(), body, true)) {
        this.blockedRequests++; await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await context.addInitScript(() => {
      // HTTP routing does not intercept WebSocket messages. This harness needs none.
      Object.defineProperty(window, 'WebSocket', { value: class { constructor() { throw new Error('Validation transport disabled'); } } });
    });
  }
  wrap(context: BrowserContext['request']): FastHttpRequestContext {
    return {
      get: async url => { this.check(url, 'GET'); return context.get(url, { maxRedirects: 0, timeout: 30000 }); },
      post: async (url, options) => { this.check(url, 'POST', options.form); return context.post(url, { ...options, maxRedirects: 0, timeout: 30000 }); },
    };
  }
}

export interface ValidationOptions {
  profile: FilterProfile;
  maxPages: number;
  mode: SourceMode;
  shouldStop: () => boolean;
}
/** No MonitoringEngine, SQLite, fingerprint, queue, or Sheets dependency is constructed. */
export async function runReadOnlyValidation(session: PlaywrightService, policy: ReadOnlyRequestPolicy, options: ValidationOptions) {
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 3
    || !['LEGACY', 'FAST', 'AUTO'].includes(options.mode)) throw new ValidationError('INVALID_VALIDATION_OPTIONS');
  const page = session.getPage();
  if (!page) throw new ValidationError('INVALID_VALIDATION_OPTIONS');
  const owner = { getPage: () => page, getRequestContext: () => policy.wrap(page.context().request) };
  const selector = new SourceModeSelector(new LegacyBrowserSourceAdapter(session), new FastHttpSourceAdapter(owner), owner);
  const selection = selector.selectForCycle(options.mode);
  const preflight = parseDepositDocument(load(await page.content()));
  let result: SourceScanResult;
  if (options.shouldStop() || !preflight.trusted) {
    result = { transactions: [], perPage: [], navigationFailure: !options.shouldStop(),
      terminationReason: options.shouldStop() ? 'STOP_REQUESTED'
        : preflight.classification === RawHttpResponseClassification.LOGIN_PAGE ? 'SESSION_EXPIRED' : 'UNSAFE_RESPONSE',
      lastPageScanned: 0, configuredMaxPage: options.maxPages };
  } else {
    const descriptor = await new DepositRequestRuntimeProvider(page).readDescriptor({ requirePayment: false, requireAgent: false });
    policy.addFilterNames(Object.values(descriptor.names));
    result = await selection.source.scan({ filter: options.profile, manualDateMode: true, maxPages: options.maxPages,
      initialSyncMode: true, shouldStop: options.shouldStop, duplicateCheck: () => false });
  }
  const range = (field: 'processDate' | 'createdAt') => {
    const nonempty = result.transactions.map(row => row[field]).filter(Boolean);
    const values = nonempty.filter(value => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)).sort();
    return { first: values[0] || null, last: values[values.length - 1] || null,
      unrecognizedNonempty: nonempty.length - values.length };
  };
  return {
    validationOnly: true, recordedAtUtc: new Date().toISOString(), profileTag: profileTag(options.profile.name),
    requestedMode: selection.requestedMode, effectiveMode: selection.effectiveMode,
    preflight: depositDiagnostics(preflight),
    maxPages: options.maxPages, terminationReason: result.terminationReason, failed: result.navigationFailure,
    blockedRequests: policy.blockedRequests, trustedPages: result.perPage, rowsParsed: result.transactions.length,
    amountTotal: result.transactions.reduce((sum, row) => sum + row.amount, 0),
    amountUnits: 'Parser integer units; verify currency against panel', processDate: range('processDate'), createdAt: range('createdAt'),
    sheetsWrites: 0, databaseOpened: false, exportStatus: 'NOT_ATTEMPTED', resumeMarkerAdvanced: false,
  };
}
