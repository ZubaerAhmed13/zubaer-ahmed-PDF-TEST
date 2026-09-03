/// <reference lib="webworker" />
import { addPageNumbers, addWatermark, extractPages, fillForms, imagesToPdf, inspectForms, mergePdf, organizePdf, removePages, rotatePdf, splitPdf } from '../pdf/core';
import { recompressPdfImages } from '../pdf/imageRecompression';
import { addImageWatermark } from '../pdf/imageWatermark';
import { metadata } from '../pdf/metadata';
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
  'watermark-image': addImageWatermark,
  'images-to-pdf': imagesToPdf,
  metadata,
  'forms-inspect': inspectForms,
  'forms-fill': fillForms,
  optimize: recompressPdfImages
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
