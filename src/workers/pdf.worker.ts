/// <reference lib="webworker" />
import { addPageNumbers, addWatermark, extractPages, fillForms, imagesToPdf, inspectForms, mergePdf, metadata, optimizePdf, organizePdf, removePages, rotatePdf, splitPdf } from '../pdf/core';
import { normalizePdfError } from '../pdf/errors';
import type { OperationResult, WorkerRequest, WorkerResponse } from '../pdf/types';

const handlers = {
  merge: mergePdf,
  split: splitPdf,
  'remove-pages': removePages,
  'extract-pages': extractPages,
  organize: organizePdf,
  rotate: rotatePdf,
  'page-numbers': addPageNumbers,
  watermark: addWatermark,
  'images-to-pdf': imagesToPdf,
  metadata,
  'forms-inspect': inspectForms,
  'forms-fill': fillForms,
  optimize: optimizePdf
} as const;

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const handler = handlers[request.operation];
  void handler(request.files, request.options, (operationProgress) => {
    const response: WorkerResponse = { requestId: request.requestId, type: 'progress', progress: operationProgress };
    self.postMessage(response);
  }).then((result: OperationResult) => {
    const response: WorkerResponse = { requestId: request.requestId, type: 'result', result };
    const transfers = result.outputs.map((output) => output.buffer);
    self.postMessage(response, { transfer: transfers });
  }).catch((error: unknown) => {
    const response: WorkerResponse = { requestId: request.requestId, type: 'error', error: normalizePdfError(error) };
    self.postMessage(response);
  });
});

export {};
