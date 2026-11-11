/**
 * Centralized selector repository for DOM elements.
 * 
 * CRITICAL: All Playwright selectors MUST be defined here.
 * No selector may be hardcoded in any other module.
 */

export const SELECTORS = {
  TABLE: {
    MAIN: 'table.table.table-striped.b-t',
    HEADER: 'table.table.table-striped.b-t thead',
    BODY: 'table.table.table-striped.b-t tbody',
    ROWS: 'table.table.table-striped.b-t tbody tr',
  },
  
  ACCOUNT_NUMBER: {
    ATTRIBUTE: 'data-bank-number',
    CANONICAL: '[data-bank-number]',
  },

  COLUMNS: {
    SEQUENCE: 1,
    USER_NAME: 2,
    BANK: 3,
    ACCOUNT_NAME: 4,
    ACCOUNT_NUMBER: 5,
    PAYMENT_ID: 6,
    CURRENCY: 7,
    AMOUNT: 8,
    STATUS: 9,
    EXTERNAL_ID: 10,
    DONE: 11,
    DEPOSIT_TYPE: 12,
    PAYMENT_TYPE: 13,
    AGENT: 14,
    PROCESS_DATE: 15,
    CREATED_AT: 16,
  },
  
  FILTER: {
    AGENT_INPUT: '#deposit-agent-name',
    DEPOSIT_STATUS: '#deposit-status',
    DEPOSIT_TYPE: '#payment',
    DATE_FROM: 'input[name="deposit_process_date_from"]',
    DATE_TO: 'input[name="deposit_process_date_to"]',
    SEARCH_BUTTON: 'input[type="submit"][value=" Filter"]',
  },
  
  PAGINATION: {
    // Container that wraps the pagination widget. Used to SCOPE the Next
    // click so we never accidentally click a `rel="next"` from an unrelated
    // component (tabs, carousels, chat widgets, canonical <link>, etc).
    CONTAINER: 'ul.pagination, nav.pagination, .pagination',
    // Active (currently rendered) page indicator inside the pagination widget.
    // The panel is authoritative — this is the DOM source-of-truth for the
    // current page, checked alongside the URL after every navigation.
    ACTIVE: 'ul.pagination li.active, ul.pagination li.page-item.active, .pagination .active',
    NEXT: 'a[rel="next"]',
    PREVIOUS: 'a[rel="prev"]',
  },
  
  SESSION: {
    // LOGIN_FORM is used as a secondary "still on login page" indicator.
    // The primary login indicator is now the monitoring page itself
    // (TABLE.MAIN existence) — validated in PlaywrightService.validateSession().
    LOGIN_FORM: 'form#login-form',
  },
};

export function getCellSelector(columnIndex: number): string {
  return `td:nth-child(${columnIndex})`;
}

export function updateSelectors(customSelectors: Partial<typeof SELECTORS>): void {
  Object.assign(SELECTORS, customSelectors);
}
