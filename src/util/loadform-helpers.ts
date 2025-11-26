/**
 * LoadForm Helpers for BC Page Loading
 *
 * Implements the complete LoadForm solution based on WebSocket capture analysis.
 * See: LOADFORM_SOLUTION_COMPLETE.md for full documentation.
 */

import { gunzipSync } from 'zlib';
import type { Control } from '../types/bc-types.js';
import { logger } from '../core/logger.js';

/**
 * Child form information extracted from response
 */
export interface ChildFormInfo {
  serverId: string;
  container: Control;
  form: Control;
}

/**
 * Result of extracting ServerIds from form structure
 */
export interface ServerIdsExtractResult {
  shellFormId: string;
  childFormIds: ChildFormInfo[];
}

/** Response structure for decompression */
interface CompressedPayload {
  compressedResult?: string;
  params?: Array<{ compressedData?: string }>;
}

/**
 * Decompress BC server response if compressed.
 *
 * BC compresses responses using gzip in base64 encoding:
 * - First response: `payload.compressedResult`
 * - Subsequent responses: `payload.params[0].compressedData`
 *
 * @param payload - Raw response payload from BC
 * @returns Decompressed data or null if not compressed
 */
export function decompressResponse(payload: unknown): unknown {
  if (!payload) {
    return null;
  }

  const typedPayload = payload as CompressedPayload;
  let compressedBase64: string | null = null;

  // First response pattern
  if (typedPayload.compressedResult) {
    compressedBase64 = typedPayload.compressedResult;
  }

  // Subsequent responses pattern
  if (typedPayload.params?.[0]?.compressedData) {
    compressedBase64 = typedPayload.params[0].compressedData;
  }

  if (!compressedBase64) {
    return null; // Not compressed
  }

  try {
    const buffer = Buffer.from(compressedBase64, 'base64');
    const decompressed = gunzipSync(buffer);
    return JSON.parse(decompressed.toString('utf-8'));
  } catch (error) {
    logger.error(`[LoadFormHelpers] Decompression failed: ${String(error)}`);
    throw error;
  }
}

/** Handler structure for form lookups */
interface FormHandler {
  parameters?: readonly unknown[];
}

/** Form structure in handler parameters */
interface FormStructure {
  ServerId?: string;
  Children?: unknown[];
}

/**
 * Find the handler containing form structure in response array.
 *
 * The form structure handler contains:
 * - parameters[1].ServerId (shell form)
 * - parameters[1].Children (array of child controls/forms)
 *
 * @param response - Array of handlers from BC response
 * @returns Form structure handler or null if not found
 */
export function findFormStructureHandler(response: unknown[]): FormHandler | null {
  if (!Array.isArray(response)) {
    return null;
  }

  return response.find((h) => {
    const handler = h as FormHandler;
    const form = handler?.parameters?.[1] as FormStructure | undefined;
    return form?.ServerId && form?.Children;
  }) as FormHandler | undefined ?? null;
}

/** Extended form structure with Children */
interface RootFormStructure {
  ServerId?: string;
  Children?: Array<{
    Children?: Array<{ ServerId?: string } & Control>;
  } & Control>;
}

/**
 * Extract ServerIds from form structure.
 *
 * Pattern: response[handler].parameters[1] contains:
 * - ServerId: Shell/container form ID
 * - Children[N].Children[0].ServerId: Child form IDs
 *
 * @param response - Array of handlers from BC response
 * @returns Shell form ID and array of child forms
 * @throws Error if form structure not found
 */
export function extractServerIds(response: unknown[]): ServerIdsExtractResult {
  const formHandler = findFormStructureHandler(response);

  if (!formHandler) {
    throw new Error('[LoadFormHelpers] Form structure handler not found in response');
  }

  const rootForm = formHandler.parameters![1] as RootFormStructure;
  const shellFormId = rootForm.ServerId;

  if (!shellFormId) {
    throw new Error('[LoadFormHelpers] Shell form ServerId not found');
  }

  const childFormIds: ChildFormInfo[] = [];

  if (Array.isArray(rootForm.Children)) {
    for (const child of rootForm.Children) {
      // Pattern: Children[N].Children[0] contains the actual child form
      if (child?.Children?.[0]?.ServerId) {
        childFormIds.push({
          serverId: child.Children[0].ServerId,
          container: child as Control,
          form: child.Children[0] as Control
        });
      }
    }
  }

  logger.debug(`[LoadFormHelpers] Extracted ServerIds: shell=${shellFormId}, children=${childFormIds.length}`);

  return { shellFormId, childFormIds };
}

/**
 * Determine if a child form should be LoadForm'd.
 *
 * Pattern (100% validated with Page 22):
 * LoadForm if ALL of:
 * 1. container.Visible !== false (not explicitly hidden)
 * 2. EITHER:
 *    a) form.DelayedControls exists, OR
 *    b) container.ExpressionProperties exists
 *
 * @param child - Child form info from extractServerIds()
 * @returns true if form should be loaded
 */
export function shouldLoadForm(child: ChildFormInfo): boolean {
  // Rule 1: Skip if explicitly hidden
  if (child.container.Visible === false) {
    return false;
  }

  // Rule 2: Load if DelayedControls exists OR ExpressionProperties exists
  const hasDelayedControls = child.form.DelayedControls !== undefined;
  const hasExpressionProps = child.container.ExpressionProperties !== undefined;

  const shouldLoad = hasDelayedControls || hasExpressionProps;

  if (shouldLoad) {
    logger.debug(`[LoadFormHelpers] Will LoadForm: ${child.serverId} (${child.form.Caption || 'no caption'})`);
  } else {
    logger.debug(`[LoadFormHelpers] Skip LoadForm: ${child.serverId} (${child.form.Caption || 'no caption'}) - no DelayedControls or ExpressionProperties`);
  }

  return shouldLoad;
}

/**
 * Filter child forms by LoadForm criteria.
 *
 * @param childForms - Array of child forms from extractServerIds()
 * @returns Filtered array of forms that should be loaded
 */
export function filterFormsToLoad(childForms: ChildFormInfo[]): ChildFormInfo[] {
  return childForms.filter(shouldLoadForm);
}

/** LoadForm interaction structure */
interface LoadFormInteraction {
  interactionName: string;
  formId: string;
  controlPath: string;
  callbackId: string;
  namedParameters: {
    delayed: boolean;
    openForm: boolean;
    loadData: boolean;
  };
}

/**
 * Create LoadForm interaction parameters.
 *
 * Standard parameters used by BC web client:
 * - delayed: true
 * - openForm: true
 * - loadData: true
 *
 * @param formId - ServerId to load
 * @param callbackId - Unique callback ID
 * @returns LoadForm interaction object
 */
export function createLoadFormInteraction(formId: string, callbackId: string): LoadFormInteraction {
  return {
    interactionName: 'LoadForm',
    formId: formId,
    controlPath: 'server:',
    callbackId: callbackId,
    namedParameters: {
      delayed: true,
      openForm: true,
      loadData: true
    }
  };
}
