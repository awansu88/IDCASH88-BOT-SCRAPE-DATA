import { RawTransaction, ValidationResult } from '../../types/transaction';
import { getLogger } from './logger-service';

/**
 * TransactionValidator — Essential Field Check only.
 *
 * The browser is the single source of truth for business filtering
 * (Status, Done, Agent, Deposit Type, Include/Exclude Keywords). Every
 * row visible in the deposit table has already passed the panel's own
 * filter, so the backend does not re-evaluate those rules.
 *
 * This validator answers exactly one question: did the parser succeed in
 * extracting the minimum set of fields required to generate a fingerprint
 * and export the row?
 *
 * Hard-required fields:
 *   • userName       — dedup fingerprint input
 *   • accountNumber  — dedup fingerprint input
 *   • amount         — export payload
 *   • processDate    — export payload + adaptive scanning key
 */
export class TransactionValidator {
  validate(transaction: RawTransaction): ValidationResult {
    const errors: string[] = [];

    if (!transaction.userName || transaction.userName.trim() === '') {
      errors.push('Missing User Name');
    }
    if (!transaction.accountNumber || transaction.accountNumber.trim() === '') {
      errors.push('Missing Account Number');
    }
    if (typeof transaction.amount !== 'number' || isNaN(transaction.amount)) {
      errors.push('Invalid Amount');
    }
    if (!transaction.processDate || transaction.processDate.trim() === '') {
      errors.push('Invalid Process Date');
    }

    if (errors.length > 0) {
      getLogger().debug(
        `Essential-field check failed: ${errors.join(', ')}`
      );
    }

    return { valid: errors.length === 0, errors };
  }
}
