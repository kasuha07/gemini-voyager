/**
 * Table Copy Service
 * Overrides Gemini table copy button behavior to copy Markdown when enabled.
 */
import browser from 'webextension-polyfill';

import { logger } from '@/core';
import { StorageKeys } from '@/core/types/common';
import type { ILogger } from '@/core/types/common';

export interface TableCopyConfig {
  toastDuration?: number;
  toastOffsetY?: number;
  enabled?: boolean;
  allowUntrustedEvents?: boolean;
}

export class TableCopyService {
  private static instance: TableCopyService | null = null;
  private readonly logger: ILogger;
  private readonly toastDuration: number;
  private readonly toastOffsetY: number;
  private readonly allowUntrustedEvents: boolean;
  private isEnabled = false;
  private isInitialized = false;
  private isClickListenerAttached = false;
  private isStorageListenerAttached = false;
  private preferenceLoadPromise: Promise<void> | null = null;
  private copyToast: HTMLDivElement | null = null;
  private i18nMessages: Record<'copied' | 'failed', string> = {
    copied: '✓ Table copied as Markdown',
    failed: '✗ Failed to copy table',
  };

  private readonly handleStorageChange: Parameters<
    typeof browser.storage.onChanged.addListener
  >[0] = (changes, areaName) => {
    if (areaName !== 'sync') return;
    const setting = changes[StorageKeys.TABLE_COPY_AS_MARKDOWN];
    if (!setting) return;
    this.isEnabled = setting.newValue === true;
    this.logger.debug('Table markdown copy setting changed', { enabled: this.isEnabled });
  };

  private constructor(config: TableCopyConfig = {}) {
    this.logger = logger.createChild('TableCopy');
    this.toastDuration = config.toastDuration ?? 2000;
    this.toastOffsetY = config.toastOffsetY ?? 40;
    this.allowUntrustedEvents = config.allowUntrustedEvents ?? false;
    this.isEnabled = config.enabled ?? false;
    this.loadI18nMessages();
  }

  public static getInstance(config?: TableCopyConfig): TableCopyService {
    if (!TableCopyService.instance) {
      TableCopyService.instance = new TableCopyService(config);
    }
    return TableCopyService.instance;
  }

  public initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    void this.ensurePreferenceLoaded().finally(() => {
      if (!this.isInitialized || this.isClickListenerAttached) return;
      document.addEventListener('click', this.handleClick, true);
      this.isClickListenerAttached = true;
      this.logger.info('Table copy service initialized');
    });
  }

  public destroy(): void {
    this.detachStorageListener();

    if (this.isClickListenerAttached) {
      document.removeEventListener('click', this.handleClick, true);
      this.isClickListenerAttached = false;
    }
    this.preferenceLoadPromise = null;
    this.removeCopyToast();
    this.isInitialized = false;
    this.logger.info('Table copy service destroyed');
  }

  public isServiceInitialized(): boolean {
    return this.isInitialized;
  }

  public isMarkdownCopyEnabled(): boolean {
    return this.isEnabled;
  }

  private loadI18nMessages(): void {
    try {
      this.i18nMessages = {
        copied:
          browser.i18n.getMessage('table_markdown_copied') || '✓ Table copied as Markdown',
        failed: browser.i18n.getMessage('table_markdown_copy_failed') || '✗ Failed to copy table',
      };
    } catch (error) {
      this.logger.warn('Failed to load table copy i18n messages, using defaults', { error });
    }
  }

  private ensurePreferenceLoaded(): Promise<void> {
    if (!this.preferenceLoadPromise) {
      this.attachStorageListener();
      this.preferenceLoadPromise = this.loadEnabledPreference();
    }
    return this.preferenceLoadPromise;
  }

  private attachStorageListener(): void {
    if (this.isStorageListenerAttached) return;
    try {
      browser.storage.onChanged.addListener(this.handleStorageChange);
      this.isStorageListenerAttached = true;
    } catch (error) {
      this.logger.warn('Failed to attach storage change listener', { error });
    }
  }

  private detachStorageListener(): void {
    if (!this.isStorageListenerAttached) return;
    try {
      browser.storage.onChanged.removeListener(this.handleStorageChange);
    } catch (error) {
      this.logger.warn('Failed to remove storage change listener', { error });
    } finally {
      this.isStorageListenerAttached = false;
    }
  }

  private async loadEnabledPreference(): Promise<void> {
    try {
      const result = await browser.storage.sync.get({ [StorageKeys.TABLE_COPY_AS_MARKDOWN]: false });
      this.isEnabled = result[StorageKeys.TABLE_COPY_AS_MARKDOWN] === true;
      this.logger.debug('Loaded table markdown copy setting', { enabled: this.isEnabled });
    } catch (error) {
      this.logger.warn('Failed to load table markdown copy setting, using default', { error });
    }
  }

  private handleClick = (event: MouseEvent): void => {
    if (!this.allowUntrustedEvents && !event.isTrusted) return;
    if (!this.isEnabled) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const copyButton = target.closest('button[data-test-id="copy-table-button"]');
    if (!(copyButton instanceof HTMLButtonElement)) return;

    const table = this.findTableFromButton(copyButton);
    if (!table) {
      this.logger.warn('Table copy button clicked but no table found');
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const markdown = this.convertTableToMarkdown(table);
    if (!markdown.trim()) {
      this.logger.warn('Table markdown conversion produced empty content');
      return;
    }

    void this.copyMarkdown(markdown, event.clientX, event.clientY);
  };

  private findTableFromButton(copyButton: HTMLButtonElement): HTMLTableElement | null {
    const tableContainer = copyButton.closest('table-block, .table-block');
    if (tableContainer instanceof HTMLElement) {
      const table = tableContainer.querySelector('table');
      if (table instanceof HTMLTableElement) {
        return table;
      }
    }
    return null;
  }

  private convertTableToMarkdown(table: HTMLTableElement): string {
    const rows = Array.from(table.rows).map((row) =>
      Array.from(row.cells).map((cell) => this.normalizeCellText(this.extractCellText(cell))),
    );

    if (rows.length === 0) return '';

    const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
    if (maxColumns === 0) return '';

    const normalizedRows = rows.map((row) => {
      const paddedRow = [...row];
      while (paddedRow.length < maxColumns) paddedRow.push('');
      return paddedRow;
    });

    const [header, ...body] = normalizedRows;
    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${new Array(maxColumns).fill('---').join(' | ')} |`,
      ...body.map((row) => `| ${row.join(' | ')} |`),
    ];

    return lines.join('\n');
  }

  private normalizeCellText(raw: string): string {
    return raw
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n+/g, '<br>')
      .replace(/\|/g, '\\|');
  }

  private extractCellText(cell: HTMLTableCellElement): string {
    const parts: string[] = [];

    const walk = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent || '');
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as HTMLElement;
      if (element.tagName === 'BR') {
        parts.push('\n');
        return;
      }

      Array.from(element.childNodes).forEach((child) => walk(child));
    };

    Array.from(cell.childNodes).forEach((child) => walk(child));
    return parts.join('');
  }

  private async copyMarkdown(markdown: string, x: number, y: number): Promise<void> {
    try {
      const success = await this.copyToClipboard(markdown);
      if (success) {
        this.showToast(this.i18nMessages.copied, x, y, true);
      } else {
        this.showToast(this.i18nMessages.failed, x, y, false);
      }
    } catch (error) {
      this.logger.error('Failed to copy markdown table', { error });
      this.showToast(this.i18nMessages.failed, x, y, false);
    }
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        this.logger.warn('Clipboard writeText failed, falling back to execCommand', { error });
      }
    }

    return this.copyToClipboardLegacy(text);
  }

  private copyToClipboardLegacy(text: string): boolean {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (error) {
      this.logger.error('Legacy clipboard copy failed', { error });
      return false;
    }
  }

  private showToast(message: string, x: number, y: number, isSuccess: boolean): void {
    if (!this.copyToast) {
      this.copyToast = document.createElement('div');
      this.copyToast.className = 'gv-copy-toast';
      document.body.appendChild(this.copyToast);
    }

    this.copyToast.textContent = message;
    this.copyToast.style.left = `${x}px`;
    this.copyToast.style.top = `${y - this.toastOffsetY}px`;
    this.copyToast.classList.toggle('gv-copy-toast-success', isSuccess);
    this.copyToast.classList.toggle('gv-copy-toast-error', !isSuccess);
    this.copyToast.classList.add('gv-copy-toast-show');

    setTimeout(() => {
      this.copyToast?.classList.remove('gv-copy-toast-show');
    }, this.toastDuration);
  }

  private removeCopyToast(): void {
    if (this.copyToast?.parentElement) {
      this.copyToast.parentElement.removeChild(this.copyToast);
      this.copyToast = null;
    }
  }
}

export const getTableCopyService = (config?: TableCopyConfig) => TableCopyService.getInstance(config);
