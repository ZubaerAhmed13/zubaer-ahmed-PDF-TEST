/** Reviewed English product copy. Additional locales need equivalent capability review. */
export const productCopy = {
  examples: [
    { tool: 'images-to-pdf', title: 'Turn receipts into one PDF', detail: 'Crop and straighten your photos, then review their order.' },
    { tool: 'ocr', title: 'Make a scan searchable', detail: 'Prepare English or German OCR, choose pages and check the recognised text.' },
    { tool: 'redact-secure', title: 'Remove confidential regions', detail: 'Review permanent image-only redaction before exporting a new copy.' },
    { tool: 'workflow', title: 'Repeat your usual PDF job', detail: 'Build a recipe, check each step and reuse its settings locally.' }
  ],
  aliases: {
    compress: ['make pdf smaller', 'reduce file size', 'shrink pdf'],
    'images-to-pdf': ['jpg to pdf', 'jpeg to pdf', 'png to pdf', 'photo to pdf', 'receipts'],
    'redact-secure': ['black out confidential', 'hide sensitive information', 'remove sensitive text'],
    ocr: ['searchable scan', 'scan to text', 'recognize text'],
    workflow: ['repeat a job', 'recipe'],
    forms: ['fill in form'],
    merge: ['combine documents'],
    'edit-pdf': ['editable highlights', 'review comments']
  } as Record<string, string[]>,
  limits: 'Existing page-text replacement, Office conversion, certificate signing, PDF/A and PDF/UA export are not available. Added text and visual signatures have their own tools.',
  release: {
    title: 'A1.1 · Editable PDF highlights',
    changes: ['Editable region highlights with review comments in Edit PDF.', 'Reopen supported highlights to move, resize, recolor, duplicate or delete them, with undo/redo.', 'Unsupported highlights are kept unchanged. Original page text stays searchable; highlights do not remove content.']
  },
  acceptance: 'Automated browser checks cover declared scenarios. Physical-device, manual screen-reader, Safari offline execution, real-account cloud and moderated usability acceptance remain unverified.'
} as const;
