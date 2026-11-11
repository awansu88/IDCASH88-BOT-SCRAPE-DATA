import fs from 'fs';
import type { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import { PlaywrightService } from '../services/playwright-service';
import { initializeLogger } from '../services/logger-service';
import { diagnosticError } from '../../utils/safe-diagnostics';
import { FilterProfile } from '../../types/filter-profile';
import { SourceMode } from '../../types/source-mode';
import { ReadOnlyRequestPolicy, runReadOnlyValidation, ValidationError } from './read-only-validation';

export async function main(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: npm run validate:read-only -- --read-only --deposit-url https://panel.example/deposit/transactions --profile-file validation-profile.json --max-pages 1 --mode LEGACY [--report NEW-summary.json]');
    return;
  }
  const values = new Map<string, string>();
  const keys = new Set(['--deposit-url', '--profile-file', '--max-pages', '--mode', '--report']);
  let optIn = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--read-only') { optIn = true; continue; }
    if (!keys.has(args[i]) || values.has(args[i]) || !args[i + 1]) throw new ValidationError('INVALID_VALIDATION_OPTIONS');
    values.set(args[i], args[++i]);
  }
  const maxPages = Number(values.get('--max-pages') || 1);
  const mode = (values.get('--mode') || 'LEGACY') as SourceMode;
  if (!optIn || !values.get('--deposit-url') || !values.get('--profile-file') || !Number.isInteger(maxPages)
    || maxPages < 1 || maxPages > 3 || !['LEGACY','FAST','AUTO'].includes(mode)) throw new ValidationError('INVALID_VALIDATION_OPTIONS');
  const policy = new ReadOnlyRequestPolicy(values.get('--deposit-url')!);
  const raw = JSON.parse(fs.readFileSync(values.get('--profile-file')!, 'utf8').replace(/^\uFEFF/, '')) as FilterProfile;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.name !== 'string'
    || Object.keys(raw).some(key => !['name','agent','depositType'].includes(key))
    || ['agent','depositType'].some(key => (raw as any)[key] !== undefined && typeof (raw as any)[key] !== 'string'))
    throw new ValidationError('INVALID_VALIDATION_OPTIONS');
  const profile = { ...raw, id: 'read-only-validation', enabled: true, priority: 1 };
  const reportPath = values.get('--report');
  // Reject an existing destination before login; creation is exclusive again at write time.
  if (reportPath && fs.existsSync(reportPath)) throw new ValidationError('INVALID_VALIDATION_OPTIONS');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'idcash-read-only-'));
  const logs = path.join(temp, 'logs'); fs.mkdirSync(logs);
  const logger = initializeLogger(logs); logger.setDiagEnabled(true);
  const service = new PlaywrightService({ getBrowserProfileDir: () => path.join(temp, 'browser'), getScreenshotsDir: () => path.join(temp, 'screenshots'), getLogsDir: () => logs });
  let stopped = false;
  let scanning = false;
  const loginAbort = new AbortController();
  const stop = () => { stopped = true; if (!scanning) loginAbort.abort(); };
  process.on('SIGINT', stop);
  let rl: readline.Interface | undefined;
  try {
    const page = await service.launch(undefined, { serviceWorkers: 'block' });
    await policy.install(page.context());
    await page.goto(policy.target.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('VALIDATION ONLY: no Sheets client, database, dedup state, or export queue. Temporary browser profile.');
    await rl.question('Log in manually, select both dates, wait for the deposit table to finish loading, then press Enter. Do not use transaction action buttons. ', { signal: loginAbort.signal });
    if (stopped) { process.exitCode = 130; return; }
    scanning = true;
    const report = await runReadOnlyValidation(service, policy, { profile, maxPages, mode, shouldStop: () => stopped });
    console.log(JSON.stringify(report, null, 2));
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    if (report.failed || report.blockedRequests > 0 || report.createdAt.unrecognizedNonempty > 0 || report.processDate.unrecognizedNonempty > 0) process.exitCode = 1;
    if (stopped) process.exitCode = 130;
  } catch (error) {
    if (stopped) { console.log('Validation stopped; no export attempted.'); process.exitCode = 130; }
    else { logger.error('Read-only validation failed', diagnosticError(error)); process.exitCode = 1; }
  } finally {
    (process as EventEmitter).off('SIGINT', stop); rl?.close();
    try { await service.close(); }
    finally {
      await logger.close();
      // Keep no login/session state and never touch production directories.
      await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}
