import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { LogEntry } from '../../types/monitoring';

type LogSubscriber = (entry: LogEntry) => void;

/**
 * Centralised logger.
 *
 * Every log call is written to:
 *   1. Winston (console + rotating file transports)
 *   2. An in-memory ring buffer (last 500 entries, for renderer catch-up on mount)
 *   3. Any subscribers registered via `subscribe()` — used by the IPC bridge to
 *      stream live log entries to the renderer's Live Log panel.
 */
export class LoggerService {
  private logger: winston.Logger;
  private subscribers: Set<LogSubscriber> = new Set();
  private ringBuffer: LogEntry[] = [];
  private static readonly RING_MAX = 500;
  private diagEnabled: boolean = false;
  
  constructor(logsDir: string) {
    this.logger = winston.createLogger({
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, module }: any) => {
              return `${timestamp} [${level}] ${module ? `[${module}]` : ''} ${message}`;
            })
          )
        }),
        new DailyRotateFile({
          dirname: logsDir,
          filename: 'app-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          zippedArchive: true
        }),
        new DailyRotateFile({
          dirname: logsDir,
          filename: 'error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          maxSize: '20m',
          maxFiles: '30d',
          zippedArchive: true
        })
      ]
    });
  }
  
  /** Explicit cleanup for short-lived isolated validation; production lifetime is unchanged. */
  async close(): Promise<void> {
    await new Promise<void>(resolve => { this.logger.once('finish', resolve); this.logger.end(); });
    this.logger.close();
  }

  info(message: string, meta?: any): void {
    const sanitized = this.sanitize(meta);
    this.logger.info(message, sanitized);
    this.broadcast('INFO', message, sanitized);
  }
  
  success(message: string, meta?: any): void {
    const sanitized = this.sanitize(meta);
    this.logger.info(`✓ ${message}`, sanitized);
    this.broadcast('SUCCESS', message, sanitized);
  }
  
  warn(message: string, meta?: any): void {
    const sanitized = this.sanitize(meta);
    this.logger.warn(message, sanitized);
    this.broadcast('WARNING', message, sanitized);
  }
  
  error(message: string, error?: Error | any): void {
    const sanitized = this.sanitize(error);
    this.logger.error(message, {
      error: error?.message,
      stack: error?.stack,
      ...sanitized
    });
    this.broadcast('ERROR', message, {
      error: error?.message,
      ...(error?.stack ? { stack: error.stack } : {}),
      ...(sanitized && typeof sanitized === 'object' ? sanitized : {})
    });
  }
  
  debug(message: string, meta?: any): void {
    const sanitized = this.sanitize(meta);
    this.logger.debug(message, sanitized);
    this.broadcast('DEBUG', message, sanitized);
  }
  
  /**
   * Diagnostic log. Written to Winston + Live Log ONLY when diagnostic
   * logging is enabled (Settings → "Enable Diagnostic Logging").
   * Use for verbose per-row / per-page / per-navigation blocks that would
   * otherwise flood production logs.
   */
  diag(message: string, meta?: any): void {
    if (!this.diagEnabled) return;
    const sanitized = this.sanitize(meta);
    this.logger.info(`[DIAG] ${message}`, sanitized);
    this.broadcast('INFO', `[DIAG] ${message}`, sanitized);
  }
  
  setDiagEnabled(enabled: boolean): void {
    this.diagEnabled = !!enabled;
  }
  
  isDiagEnabled(): boolean {
    return this.diagEnabled;
  }
  
  /**
   * Subscribe to every subsequent log entry. Returns an unsubscribe fn.
   * Callback errors are swallowed so a broken subscriber cannot kill logging.
   */
  subscribe(fn: LogSubscriber): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }
  
  /**
   * Return the last N buffered log entries (default: full ring buffer).
   * Used by the renderer on mount to backfill logs emitted before the window
   * was ready to receive IPC messages.
   */
  getRecent(limit: number = LoggerService.RING_MAX): LogEntry[] {
    if (limit >= this.ringBuffer.length) return [...this.ringBuffer];
    return this.ringBuffer.slice(-limit);
  }
  
  private broadcast(level: LogEntry['level'], message: string, meta: any): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      module: (meta && typeof meta === 'object' && typeof meta.module === 'string') ? meta.module : 'main',
      message,
      meta: (meta && typeof meta === 'object' && Object.keys(meta).length > 0) ? meta : undefined
    };
    
    // Ring buffer
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > LoggerService.RING_MAX) {
      this.ringBuffer.splice(0, this.ringBuffer.length - LoggerService.RING_MAX);
    }
    
    // Fan out to live subscribers
    for (const fn of this.subscribers) {
      try { fn(entry); } catch { /* subscriber isolation */ }
    }
  }
  
  private sanitize(obj: any): any {
    if (!obj) return obj;
    if (typeof obj !== 'object') return obj;
    
    const sensitiveKeys = ['password', 'credential', 'token', 'cookie', 'authorization', 'api_key', 'secret', 'private_key'];
    const sanitized: any = Array.isArray(obj) ? [...obj] : { ...obj };
    
    for (const key of Object.keys(sanitized)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this.sanitize(sanitized[key]);
      }
    }
    
    return sanitized;
  }
}

let loggerInstance: LoggerService | null = null;

export function initializeLogger(logsDir: string): LoggerService {
  if (!loggerInstance) {
    loggerInstance = new LoggerService(logsDir);
  }
  return loggerInstance;
}

export function getLogger(): LoggerService {
  if (!loggerInstance) {
    throw new Error('Logger not initialized');
  }
  return loggerInstance;
}
