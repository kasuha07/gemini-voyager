import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { TableCopyService } from './TableCopyService';

const { storageGetMock, addListenerMock, removeListenerMock, getMessageMock } = vi.hoisted(() => ({
  storageGetMock: vi.fn(),
  addListenerMock: vi.fn(),
  removeListenerMock: vi.fn(),
  getMessageMock: vi.fn((key: string) => key),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      sync: {
        get: storageGetMock,
      },
      onChanged: {
        addListener: addListenerMock,
        removeListener: removeListenerMock,
      },
    },
    i18n: {
      getMessage: getMessageMock,
    },
  },
}));

function resetSingleton(): void {
  (TableCopyService as unknown as { instance: TableCopyService | null }).instance = null;
}

function createTableHtml(markup: string): HTMLButtonElement {
  document.body.innerHTML = `
    <table-block>
      <div class="table-block">
        <div class="table-content">
          ${markup}
        </div>
        <div class="table-footer">
          <button data-test-id="copy-table-button" type="button">
            <span>Copy table</span>
          </button>
        </div>
      </div>
    </table-block>
  `;

  const button = document.querySelector('button[data-test-id="copy-table-button"]');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected copy table button to exist');
  }
  return button;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('TableCopyService', () => {
  let service: TableCopyService;
  const writeTextMock = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    storageGetMock.mockResolvedValue({ [StorageKeys.TABLE_COPY_AS_MARKDOWN]: false });
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    resetSingleton();
    service = TableCopyService.getInstance({ allowUntrustedEvents: true });
    await flushPromises();
  });

  afterEach(() => {
    service.destroy();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('does not override native table copy when setting is disabled', async () => {
    const button = createTableHtml(`
      <table>
        <thead><tr><td>Name</td><td>Class</td></tr></thead>
        <tbody><tr><td>Thistle</td><td>Alchemist</td></tr></tbody>
      </table>
    `);

    service.initialize();
    await flushPromises();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it('copies table as markdown when setting is enabled', async () => {
    storageGetMock.mockResolvedValue({ [StorageKeys.TABLE_COPY_AS_MARKDOWN]: true });
    resetSingleton();
    service = TableCopyService.getInstance({ allowUntrustedEvents: true });
    await flushPromises();

    const button = createTableHtml(`
      <table>
        <thead><tr><td>Character Name</td><td>Class</td></tr></thead>
        <tbody><tr><td>Thistle Wick</td><td>Alchemist</td></tr></tbody>
      </table>
    `);

    service.initialize();
    await flushPromises();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(
      ['| Character Name | Class |', '| --- | --- |', '| Thistle Wick | Alchemist |'].join('\n'),
    );
  });

  it('escapes pipe characters and converts line breaks in markdown cells', async () => {
    storageGetMock.mockResolvedValue({ [StorageKeys.TABLE_COPY_AS_MARKDOWN]: true });
    resetSingleton();
    service = TableCopyService.getInstance({ allowUntrustedEvents: true });
    await flushPromises();

    const button = createTableHtml(`
      <table>
        <thead><tr><td>Header A</td><td>Header B</td></tr></thead>
        <tbody><tr><td>A|B</td><td>Line 1<br/>Line 2</td></tr></tbody>
      </table>
    `);

    service.initialize();
    await flushPromises();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0]?.[0]).toContain('A\\|B');
    expect(writeTextMock.mock.calls[0]?.[0]).toContain('Line 1<br>Line 2');
  });

  it('reacts to storage onChanged updates for runtime toggle', async () => {
    const button = createTableHtml(`
      <table>
        <thead><tr><td>Name</td><td>Status</td></tr></thead>
        <tbody><tr><td>Grog</td><td>Confused</td></tr></tbody>
      </table>
    `);

    service.initialize();
    await flushPromises();

    const listener = addListenerMock.mock.calls[0]?.[0] as
      | ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void)
      | undefined;
    expect(typeof listener).toBe('function');
    if (!listener) return;

    listener({ [StorageKeys.TABLE_COPY_AS_MARKDOWN]: { newValue: true } }, 'sync');

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(service.isMarkdownCopyEnabled()).toBe(true);
  });

  it('ignores untrusted click events by default', async () => {
    storageGetMock.mockResolvedValue({ [StorageKeys.TABLE_COPY_AS_MARKDOWN]: true });
    resetSingleton();
    service = TableCopyService.getInstance();
    await flushPromises();

    const button = createTableHtml(`
      <table>
        <thead><tr><td>Name</td><td>Status</td></tr></thead>
        <tbody><tr><td>Kaelen</td><td>Traveling</td></tr></tbody>
      </table>
    `);

    service.initialize();
    await flushPromises();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it('reattaches storage listener after destroy and reinitialize', async () => {
    storageGetMock.mockResolvedValue({ [StorageKeys.TABLE_COPY_AS_MARKDOWN]: false });
    resetSingleton();
    service = TableCopyService.getInstance({ allowUntrustedEvents: true });
    await flushPromises();

    const button = createTableHtml(`
      <table>
        <thead><tr><td>Name</td><td>Status</td></tr></thead>
        <tbody><tr><td>Serafina</td><td>Traveling</td></tr></tbody>
      </table>
    `);

    service.initialize();
    await flushPromises();
    expect(addListenerMock).toHaveBeenCalledTimes(1);

    service.destroy();
    service.initialize();
    await flushPromises();
    expect(addListenerMock).toHaveBeenCalledTimes(2);

    const secondListener = addListenerMock.mock.calls[1]?.[0] as
      | ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void)
      | undefined;
    expect(typeof secondListener).toBe('function');
    if (!secondListener) return;

    secondListener({ [StorageKeys.TABLE_COPY_AS_MARKDOWN]: { newValue: true } }, 'sync');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(writeTextMock).toHaveBeenCalledTimes(1);
  });
});
