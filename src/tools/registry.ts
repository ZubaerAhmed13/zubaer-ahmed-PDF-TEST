export type ToolCategory = 'organize' | 'edit' | 'convert' | 'review' | 'forms' | 'optimize';

export interface ToolDefinition {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  keywords: string[];
  icon: string;
  quality: 'Lossless' | 'Potentially lossy' | 'Inspection';
  status: 'Migrated' | 'Limited' | 'Preview';
  multipleFiles: boolean;
  load: () => Promise<typeof import('./workspace')>;
}

export const toolCategories = [
  { id: 'organize', label: 'Organize' },
  { id: 'edit', label: 'Edit' },
  { id: 'convert', label: 'Convert' },
  { id: 'review', label: 'Review' },
  { id: 'forms', label: 'Forms' },
  { id: 'optimize', label: 'Optimize' }
] as const;

function tool(definition: Omit<ToolDefinition, 'load'>): ToolDefinition {
  return { ...definition, load: () => import('./workspace') };
}

export const tools: ToolDefinition[] = [
  tool({ id: 'preview', name: 'View PDF', category: 'review', description: 'Inspect pages with worker-backed PDF.js rendering.', keywords: ['preview','view','inspect'], icon: '⌕', quality: 'Inspection', status: 'Migrated', multipleFiles: false }),
  tool({ id: 'merge', name: 'Merge PDF', category: 'organize', description: 'Combine PDFs without intentionally rasterizing page content.', keywords: ['combine','join'], icon: '⊕', quality: 'Lossless', status: 'Migrated', multipleFiles: true }),
  tool({ id: 'split', name: 'Split PDF', category: 'organize', description: 'Extract ranges, individual pages, or chunks into new PDFs.', keywords: ['extract','range','pages'], icon: '✂', quality: 'Lossless', status: 'Migrated', multipleFiles: false }),
  tool({ id: 'organize', name: 'Organize pages', category: 'organize', description: 'Reorder, remove, duplicate, and rotate pages using an operation plan.', keywords: ['reorder','remove','rotate','duplicate'], icon: '▦', quality: 'Lossless', status: 'Preview', multipleFiles: false }),
  tool({ id: 'rotate', name: 'Rotate pages', category: 'organize', description: 'Rotate all, odd, even, or selected pages structurally.', keywords: ['orientation'], icon: '↻', quality: 'Lossless', status: 'Migrated', multipleFiles: false }),
  tool({ id: 'page-numbers', name: 'Add page numbers', category: 'edit', description: 'Add configurable numbering to selected page ranges.', keywords: ['number','footer'], icon: '#', quality: 'Lossless', status: 'Migrated', multipleFiles: false }),
  tool({ id: 'watermark', name: 'Add watermark', category: 'edit', description: 'Add a text watermark while preserving existing page content.', keywords: ['stamp','text'], icon: 'W', quality: 'Lossless', status: 'Migrated', multipleFiles: false }),
  tool({ id: 'images-to-pdf', name: 'Images to PDF', category: 'convert', description: 'Create a PDF from JPEG or PNG images.', keywords: ['jpg','jpeg','png'], icon: '▣', quality: 'Potentially lossy', status: 'Migrated', multipleFiles: true }),
  tool({ id: 'pdf-to-images', name: 'PDF to images', category: 'convert', description: 'Render selected PDF pages to PNG or JPEG.', keywords: ['png','jpg','render'], icon: '▤', quality: 'Potentially lossy', status: 'Migrated', multipleFiles: false }),
  tool({ id: 'forms', name: 'Fill PDF forms', category: 'forms', description: 'Edit supported AcroForm fields; XFA is detected and reported as unsupported.', keywords: ['acroform','xfa','fields'], icon: '☑', quality: 'Lossless', status: 'Preview', multipleFiles: false }),
  tool({ id: 'metadata', name: 'Document information', category: 'review', description: 'Inspect standard PDF metadata and encryption state.', keywords: ['metadata','author','title'], icon: 'i', quality: 'Inspection', status: 'Migrated', multipleFiles: false }),
  tool({ id: 'compress', name: 'Optimize PDF', category: 'optimize', description: 'Structural re-save only. Image recompression is not yet release-certified.', keywords: ['compress','size','optimize'], icon: '⇲', quality: 'Potentially lossy', status: 'Limited', multipleFiles: false })
];
