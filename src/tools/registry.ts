export type ToolCategory = 'organize' | 'edit' | 'convert' | 'review' | 'forms' | 'security' | 'optimize' | 'batch';

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
  load: () => Promise<{ mountWorkspace: typeof import('./workspace').mountWorkspace }>;
}

export const toolCategories = [
  { id: 'organize', label: 'Organize' },
  { id: 'edit', label: 'Edit' },
  { id: 'convert', label: 'Convert' },
  { id: 'review', label: 'Review' },
  { id: 'forms', label: 'Forms' },
  { id: 'security', label: 'Security' },
  { id: 'optimize', label: 'Optimize' },
  { id: 'batch', label: 'Batch' }
] as const;

function tool(definition: Omit<ToolDefinition, 'load'>): ToolDefinition {
  return { ...definition, load: () => import('./workspaceWithRecovery') };
}

export const tools: ToolDefinition[] = [
  {
    id: 'preview', name: 'View PDF', category: 'review',
    description: 'Inspect pages with worker-backed PDF.js rendering, virtualized thumbnails, zoom, fit modes and keyboard/wheel navigation.',
    keywords: ['preview','view','inspect','zoom','fit'], icon: '⌕', quality: 'Inspection', status: 'Migrated', multipleFiles: false,
    load: () => import('./previewWorkspace')
  },
  tool({ id: 'merge', name: 'Merge PDF', category: 'organize', description: 'Combine PDFs without intentionally rasterizing page content.', keywords: ['combine','join'], icon: '⊕', quality: 'Lossless', status: 'Migrated', multipleFiles: true }),
  tool({ id: 'split', name: 'Split PDF', category: 'organize', description: 'Extract ranges, individual pages, or chunks into new PDFs.', keywords: ['extract','range','pages'], icon: '✂', quality: 'Lossless', status: 'Migrated', multipleFiles: false }),
  tool({ id: 'remove-pages', name: 'Remove pages', category: 'organize', description: 'Remove selected pages structurally while preserving the remaining page content.', keywords: ['delete','remove','pages'], icon: '−', quality: 'Lossless', status: 'Migrated', multipleFiles: false }),
  tool({ id: 'extract-pages', name: 'Extract pages', category: 'organize', description: 'Create a new PDF from selected pages without intentionally rasterizing them.', keywords: ['extract','copy','selected pages'], icon: '⇥', quality: 'Lossless', status: 'Migrated', multipleFiles: false }),
  {
    id: 'organize', name: 'Organize pages', category: 'organize',
    description: 'Visually reorder, remove and duplicate pages with lazy thumbnails, multi-select and undo/redo while preserving a deterministic structural operation plan.',
    keywords: ['reorder','remove','rotate','duplicate','drag','undo','pages'], icon: '▦', quality: 'Lossless', status: 'Migrated', multipleFiles: false,
    load: () => import('./organizeWorkspace')
  },
  tool({ id: 'rotate', name: 'Rotate pages', category: 'organize', description: 'Rotate all, odd, even, or selected pages structurally.', keywords: ['orientation'], icon: '↻', quality: 'Lossless', status: 'Migrated', multipleFiles: false }),
  tool({ id: 'page-numbers', name: 'Add page numbers', category: 'edit', description: 'Add configurable numbering to selected page ranges.', keywords: ['number','footer'], icon: '#', quality: 'Lossless', status: 'Migrated', multipleFiles: false }),
  {
    id: 'watermark', name: 'Add watermark', category: 'edit',
    description: 'Add text or PNG/JPEG image watermarks while preserving existing page content.',
    keywords: ['stamp','text','image','logo','watermark'], icon: 'W', quality: 'Lossless', status: 'Migrated', multipleFiles: false,
    load: () => import('./watermarkWorkspace')
  },
  tool({ id: 'images-to-pdf', name: 'Images to PDF', category: 'convert', description: 'Create a PDF from JPEG or PNG images.', keywords: ['jpg','jpeg','png'], icon: '▣', quality: 'Potentially lossy', status: 'Migrated', multipleFiles: true }),
  tool({ id: 'pdf-to-images', name: 'PDF to images', category: 'convert', description: 'Render selected PDF pages to PNG or JPEG.', keywords: ['png','jpg','render'], icon: '▤', quality: 'Potentially lossy', status: 'Migrated', multipleFiles: false }),
  {
    id: 'extract-images', name: 'Extract images', category: 'convert',
    description: 'Extract decoded embedded raster images as PNG without rendering whole pages. Original compressed stream bytes are not claimed to be preserved.',
    keywords: ['embedded','image','extract','xobject','inline','png'], icon: '◫', quality: 'Potentially lossy', status: 'Migrated', multipleFiles: false,
    load: () => import('./extractImagesWorkspace')
  },
  tool({ id: 'forms', name: 'Fill PDF forms', category: 'forms', description: 'Edit supported AcroForm fields; XFA is detected and reported as unsupported.', keywords: ['acroform','xfa','fields'], icon: '☑', quality: 'Lossless', status: 'Migrated', multipleFiles: false }),
  {
    id: 'protect-pdf', name: 'Protect PDF', category: 'security',
    description: 'Encrypt a PDF locally with AES-256 using the pinned qpdf 12.3.2 WebAssembly engine. Passwords are not persisted by DocFlow.',
    keywords: ['encrypt','password','protect','aes-256','security','qpdf'], icon: '🔒', quality: 'Lossless', status: 'Migrated', multipleFiles: false,
    load: () => import('./encryptionWorkspace')
  },
  {
    id: 'unlock-pdf', name: 'Unlock PDF', category: 'security',
    description: 'Remove PDF encryption locally after validating the supplied user or owner password with qpdf 12.3.2.',
    keywords: ['decrypt','password','unlock','security','qpdf'], icon: '🔓', quality: 'Lossless', status: 'Migrated', multipleFiles: false,
    load: () => import('./encryptionWorkspace')
  },
  tool({ id: 'metadata', name: 'Document information', category: 'review', description: 'Inspect standard PDF metadata and encryption state.', keywords: ['metadata','author','title'], icon: 'i', quality: 'Inspection', status: 'Migrated', multipleFiles: false }),
  {
    id: 'compress', name: 'Optimize PDF', category: 'optimize',
    description: 'Selectively recompress safe RGB JPEG image XObjects while preserving PDF page, text, vector and form structure. Complex image/color cases are left untouched.',
    keywords: ['compress','size','optimize','jpeg','image','recompress'], icon: '⇲', quality: 'Potentially lossy', status: 'Migrated', multipleFiles: false,
    load: () => import('./compressionWorkspace')
  },
  {
    id: 'batch', name: 'Batch process PDFs', category: 'batch',
    description: 'Process multiple PDFs sequentially with a bounded one-worker queue, per-file status, cancellation and optional ZIP packaging. Quality depends on the selected batch operation.',
    keywords: ['batch','queue','multiple','bulk','rotate','number','watermark','optimize','zip'], icon: '≣', quality: 'Potentially lossy', status: 'Migrated', multipleFiles: true,
    load: () => import('./batchWorkspace')
  }
];
