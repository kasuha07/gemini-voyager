import { getTableCopyService } from './TableCopyService';

export { TableCopyService, getTableCopyService } from './TableCopyService';
export type { TableCopyConfig } from './TableCopyService';

export function startTableCopy(): void {
  const service = getTableCopyService();
  service.initialize();
}

export function stopTableCopy(): void {
  const service = getTableCopyService();
  service.destroy();
}
