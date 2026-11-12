import { PdfOperationError } from './errors';
import { MAX_PAGES } from './resourceBudget';

export function parsePageSelection(value: string, totalPages: number): number[] {
  const source = value.trim();
  if (!source) return Array.from({ length: totalPages }, (_, index) => index);
  const selected = new Set<number>();
  for (const token of source.split(',').map((part) => part.trim()).filter(Boolean)) {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > totalPages) {
        throw new PdfOperationError('INVALID_PAGE_RANGE', `Invalid page range: ${token}`);
      }
      for (let page = start; page <= end; page += 1) selected.add(page - 1);
      continue;
    }
    const page = Number(token);
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      throw new PdfOperationError('INVALID_PAGE_RANGE', `Invalid page number: ${token}`);
    }
    selected.add(page - 1);
  }
  return [...selected].sort((a, b) => a - b);
}

export function parseRequiredPageSelection(
  value: string, totalPages: number, emptyMessage = 'Select at least one page before continuing.'
): number[] {
  const pages = value.trim() ? parsePageSelection(value, totalPages) : [];
  if (!pages.length) throw new PdfOperationError('INVALID_PAGE_RANGE', emptyMessage);
  return pages;
}

export function parsePageOrder(value: string, totalPages: number): number[] {
  if (totalPages > MAX_PAGES) {
    throw new PdfOperationError('RESOURCE_LIMIT', 'Organized PDFs support at most 1,000 output pages.');
  }
  const source = value.trim();
  if (!source) return Array.from({ length: totalPages }, (_, index) => index);
  const order: number[] = [];
  for (const token of source.split(',').map((part) => part.trim()).filter(Boolean)) {
    const page = Number(token);
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      throw new PdfOperationError('INVALID_PAGE_ORDER', `Invalid page in order: ${token}`);
    }
    order.push(page - 1);
    if (order.length > MAX_PAGES) {
      throw new PdfOperationError('RESOURCE_LIMIT', 'Organized PDFs support at most 1,000 output pages. Remove pages or duplicate fewer pages.');
    }
  }
  if (!order.length) throw new PdfOperationError('INVALID_PAGE_ORDER', 'Page order cannot be empty.');
  return order;
}

export function parseSplitRanges(value: string, totalPages: number): number[][] {
  const source = value.trim();
  if (!source) throw new PdfOperationError('INVALID_PAGE_RANGE', 'Enter at least one page range.');
  return source.split(/[;\n]+/).map((group) =>
    parseRequiredPageSelection(group, totalPages, 'Each split range needs at least one page.'));
}
