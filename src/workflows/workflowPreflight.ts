import { PDFDocument, StandardFonts } from 'pdf-lib';
import { inspectDocument } from '../pdf/documentInspection';
import { parsePageSelection } from '../pdf/pageRanges';
import { preservationConsequences } from '../pdf/preservationPolicy';
import { validateRecipe, type WorkflowStep } from './workflowEngine';
import { PdfOperationError } from '../pdf/errors';
export interface WorkflowPreflight { inputPages: number; outputPages: number; steps: { operation: string; affectedPages: number; warnings: string[] }[] }
export async function preflightWorkflow(buffer: ArrayBuffer, steps: readonly WorkflowStep[]): Promise<WorkflowPreflight> {
  const recipe = validateRecipe({ id: 'preflight', name: 'Preflight', steps });
  const inspection = await inspectDocument(buffer);
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  let pages = doc.getPages().map(page => ({ ...page.getCropBox() }));
  const report: WorkflowPreflight = { inputPages: pages.length, outputPages: pages.length, steps: [] };
  for (const [index, step] of recipe.steps.entries()) {
    try {
      const options = step.options;
      const selection = new Set(parsePageSelection(step.operation === 'rotate' && options.target !== 'selected' ? '' : String(options.pages ?? ''), pages.length));
      let affected = selection.size;
      if (step.operation === 'remove-pages') {
        pages = pages.filter((_, i) => !selection.has(i));
        if (!pages.length) throw Error('At least one page must remain.');
      } else if (step.operation === 'extract-pages') pages = pages.filter((_, i) => selection.has(i));
      else if (step.operation === 'rotate') affected = pages.filter((_, i) => options.target === 'all' || (options.target === 'odd' && i % 2 === 0) || (options.target === 'even' && i % 2 === 1) || (options.target === 'selected' && selection.has(i))).length;
      else if (step.operation === 'crop') {
        pages = pages.map((page, i) => {
          if (!selection.has(i)) return page;
          const width = page.width - Number(options.left) - Number(options.right);
          const height = page.height - Number(options.top) - Number(options.bottom);
          if (width < 18 || height < 18) throw Error('Crop must leave at least 18 points in each dimension.');
          return { ...page, width, height };
        });
      } else if (step.operation === 'watermark') {
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        font.encodeText(String(options.text));
      }
      const warnings = preservationConsequences(step.operation, inspection);
      if (step.operation === 'crop') warnings.push('Crop only hides content; it does not redact or remove it.');
      if (step.operation === 'metadata-edit') warnings.push('Standard properties only; other metadata and document contents may remain.');
      if (step.operation === 'optimize') warnings.push('Supported image recompression can be lossy; file size may increase.');
      report.steps.push({ operation: step.operation, affectedPages: affected, warnings });
    } catch (error) { throw new PdfOperationError(error instanceof PdfOperationError ? error.code : 'WORKFLOW_PREFLIGHT_FAILED', 'Step ' + (index + 1) + ' (' + step.operation + '): ' + (error instanceof Error ? error.message : 'Preflight failed.')); }
  }
  report.outputPages = pages.length;
  return report;
}
