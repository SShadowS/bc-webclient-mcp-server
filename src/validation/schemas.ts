/**
 * Validation Schemas
 *
 * Zod schemas for MCP tool input validation with type coercion.
 *
 * IMPORTANT: MCP can deliver parameters as both typed values AND strings.
 * For example, pageId can be either "21" (string) or 21 (number).
 * These schemas use z.union() + transform() or z.coerce to handle both.
 */

import { z } from 'zod';

// ============================================================================
// Primitive Type Coercion
// ============================================================================

/**
 * Schema for pageId that accepts string or number.
 * Normalizes to trimmed string representation.
 *
 * Examples:
 * - "21" → "21"
 * - 21 → "21"
 * - " 42 " → "42"
 */
export const PageIdSchema = z
  .union([z.string(), z.number()])
  .transform((val) => {
    if (typeof val === 'string') {
      return val.trim();
    }
    return String(val);
  })
  .refine((val) => val.length > 0, {
    message: 'pageId cannot be empty',
  });

/**
 * Schema for numeric ID that accepts string or number.
 * Coerces to number and validates range.
 *
 * Examples:
 * - "21" → 21
 * - 21 → 21
 * - " 42 " → 42
 */
export const NumericIdSchema = z.coerce
  .number({
    invalid_type_error: 'ID must be a number or numeric string',
  })
  .int('ID must be an integer')
  .positive('ID must be positive');

/**
 * Schema for optional limit parameter.
 * Accepts string or number, coerces to number.
 */
export const LimitSchema = z.coerce
  .number({
    invalid_type_error: 'limit must be a number or numeric string',
  })
  .int('limit must be an integer')
  .min(1, 'limit must be at least 1')
  .max(1000, 'limit cannot exceed 1000')
  .optional();

/**
 * Schema for optional timeout parameter (milliseconds).
 * Accepts string or number, coerces to number.
 */
export const TimeoutSchema = z.coerce
  .number({
    invalid_type_error: 'timeout must be a number or numeric string',
  })
  .int('timeout must be an integer')
  .min(0, 'timeout must be non-negative')
  .max(300000, 'timeout cannot exceed 5 minutes (300000ms)')
  .optional();

/**
 * Schema for boolean that accepts string, boolean, or number.
 * Coerces "true", "1", 1, true → true
 * Coerces "false", "0", 0, false → false
 */
export const BooleanSchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((val) => val === 'true'),
  z.number().transform((val) => val !== 0),
]);

// ============================================================================
// Business Central Specific Schemas
// ============================================================================

/**
 * Schema for pageContextId (opaque string).
 * Format: "connectionId:page:pageId:formId"
 */
export const PageContextIdSchema = z
  .string()
  .trim()
  .min(1, 'pageContextId cannot be empty')
  .refine(
    (val) => val.includes(':page:'),
    'pageContextId must be in format "connectionId:page:pageId:formId"'
  );

/**
 * Schema for field name (string, non-empty).
 */
export const FieldNameSchema = z
  .string()
  .trim()
  .min(1, 'Field name cannot be empty');

/**
 * Schema for action name (string, non-empty).
 */
export const ActionNameSchema = z
  .string()
  .trim()
  .min(1, 'Action name cannot be empty');

/**
 * Schema for page type (enum).
 */
export const PageTypeSchema = z.enum(
  ['Card', 'List', 'Document', 'Worksheet', 'Report'],
  {
    errorMap: () => ({
      message:
        'Invalid page type. Must be one of: Card, List, Document, Worksheet, Report',
    }),
  }
);

/**
 * Schema for field value (can be any JSON-compatible type).
 */
export const FieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.unknown()),
]);

/**
 * Schema for field updates map.
 * Keys are field names, values are field values.
 */
export const FieldUpdatesSchema = z.record(FieldValueSchema);

// ============================================================================
// Tool Input Schemas
// ============================================================================

/**
 * Schema for search_pages tool input.
 */
export const SearchPagesInputSchema = z.object({
  query: z.string().trim().min(1, 'Search query cannot be empty'),
  limit: LimitSchema.default(10),
  type: PageTypeSchema.optional(),
});

export type SearchPagesInput = z.infer<typeof SearchPagesInputSchema>;

/**
 * Schema for get_page_metadata tool input.
 */
export const GetPageMetadataInputSchema = z.object({
  pageId: PageIdSchema,
});

export type GetPageMetadataInput = z.infer<typeof GetPageMetadataInputSchema>;

/**
 * Schema for read_page_data tool input.
 */
export const ReadPageDataInputSchema = z.object({
  pageContextId: PageContextIdSchema,
  filters: z.record(z.unknown()).optional(),
  setCurrent: BooleanSchema.optional().default(false),
  limit: LimitSchema.optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ReadPageDataInput = z.infer<typeof ReadPageDataInputSchema>;

/**
 * Schema for write_page_data tool input.
 */
export const WritePageDataInputSchema = z.object({
  pageContextId: PageContextIdSchema,
  fields: FieldUpdatesSchema,
  stopOnError: BooleanSchema.optional().default(true),
  immediateValidation: BooleanSchema.optional().default(true),
});

export type WritePageDataInput = z.infer<typeof WritePageDataInputSchema>;

/**
 * Schema for execute_action tool input.
 */
export const ExecuteActionInputSchema = z.object({
  pageContextId: PageContextIdSchema,
  actionName: ActionNameSchema,
  controlPath: z.string().trim().optional(),
});

export type ExecuteActionInput = z.infer<typeof ExecuteActionInputSchema>;

/**
 * Schema for update_field tool input.
 */
export const UpdateFieldInputSchema = z.object({
  pageContextId: PageContextIdSchema,
  fieldName: FieldNameSchema,
  value: FieldValueSchema,
});

export type UpdateFieldInput = z.infer<typeof UpdateFieldInputSchema>;

/**
 * Schema for filter_list tool input.
 */
export const FilterListInputSchema = z.object({
  pageContextId: PageContextIdSchema,
  filters: z.record(FieldValueSchema),
});

export type FilterListInput = z.infer<typeof FilterListInputSchema>;

/**
 * Schema for handle_dialog tool input.
 */
export const HandleDialogInputSchema = z.object({
  pageContextId: PageContextIdSchema,
  fields: FieldUpdatesSchema.optional(),
  action: ActionNameSchema,
});

export type HandleDialogInput = z.infer<typeof HandleDialogInputSchema>;

/**
 * Schema for convenience tools that work with records.
 */
export const RecordToolInputSchema = z.object({
  pageId: PageIdSchema,
  fields: FieldUpdatesSchema,
});

export type RecordToolInput = z.infer<typeof RecordToolInputSchema>;
