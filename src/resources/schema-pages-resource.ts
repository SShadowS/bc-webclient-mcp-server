/**
 * BC Page Schema Resource
 *
 * Provides a list of available Business Central pages with IDs, types, and capabilities.
 * This helps AI assistants discover and understand BC pages.
 *
 * NOTE: This version uses a static list of common BC pages.
 * Future versions could query BC metadata dynamically.
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { InternalError } from '../core/errors.js';
import type { IMCPResource, ILogger } from '../core/interfaces.js';

/**
 * Schema entry for a BC page.
 */
export interface BCPageSchemaEntry {
  readonly pageId: string;
  readonly name: string;
  readonly type: 'Card' | 'List' | 'Document' | 'Worksheet' | string;
  readonly description?: string;
  readonly primaryKeyFields?: readonly string[];
  readonly supportsCreate?: boolean;
  readonly supportsDelete?: boolean;
  readonly category?: string;
}

/**
 * BCSchemaPagesResource provides metadata about available BC pages.
 */
export class BCSchemaPagesResource implements IMCPResource {
  public readonly uri = 'bc://schema/pages';
  public readonly name = 'Business Central Page Schema';
  public readonly description = 'List of available BC pages with IDs, types, and capabilities.';
  public readonly mimeType = 'application/json';

  public constructor(private readonly logger?: ILogger) {}

  /**
   * Reads the BC page schema.
   * @returns JSON array of BC pages
   */
  public async read(): Promise<Result<string, BCError>> {
    try {
      this.logger?.debug('Reading BC page schema');

      const pages: BCPageSchemaEntry[] = [
        // Customer pages
        {
          pageId: '21',
          name: 'Customer Card',
          type: 'Card',
          description: 'Customer master data including contact and posting details.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Sales',
        },
        {
          pageId: '22',
          name: 'Customer List',
          type: 'List',
          description: 'List of all customers.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Sales',
        },

        // Item pages
        {
          pageId: '30',
          name: 'Item Card',
          type: 'Card',
          description: 'Item master data including inventory and costing details.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Inventory',
        },
        {
          pageId: '31',
          name: 'Item List',
          type: 'List',
          description: 'List of all items.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Inventory',
        },

        // Vendor pages
        {
          pageId: '26',
          name: 'Vendor Card',
          type: 'Card',
          description: 'Vendor master data including contact and posting details.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Purchasing',
        },
        {
          pageId: '27',
          name: 'Vendor List',
          type: 'List',
          description: 'List of all vendors.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Purchasing',
        },

        // Sales documents
        {
          pageId: '42',
          name: 'Sales Order',
          type: 'Document',
          description: 'Sales order document with header and lines.',
          primaryKeyFields: ['Document Type', 'No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Sales',
        },
        {
          pageId: '43',
          name: 'Sales Invoice',
          type: 'Document',
          description: 'Sales invoice document with header and lines.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Sales',
        },
        {
          pageId: '9305',
          name: 'Sales Order List',
          type: 'List',
          description: 'List of sales orders.',
          primaryKeyFields: ['Document Type', 'No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Sales',
        },

        // Purchase documents
        {
          pageId: '50',
          name: 'Purchase Order',
          type: 'Document',
          description: 'Purchase order document with header and lines.',
          primaryKeyFields: ['Document Type', 'No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Purchasing',
        },
        {
          pageId: '51',
          name: 'Purchase Invoice',
          type: 'Document',
          description: 'Purchase invoice document with header and lines.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Purchasing',
        },

        // General Ledger
        {
          pageId: '17',
          name: 'G/L Account Card',
          type: 'Card',
          description: 'General ledger account master data.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Financial Management',
        },
        {
          pageId: '18',
          name: 'G/L Account List',
          type: 'List',
          description: 'List of general ledger accounts.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Financial Management',
        },

        // Contact pages
        {
          pageId: '5050',
          name: 'Contact Card',
          type: 'Card',
          description: 'Contact master data for CRM.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Relationship Management',
        },
        {
          pageId: '5052',
          name: 'Contact List',
          type: 'List',
          description: 'List of all contacts.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Relationship Management',
        },

        // Resource pages
        {
          pageId: '76',
          name: 'Resource Card',
          type: 'Card',
          description: 'Resource master data for capacity and job planning.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Jobs',
        },
        {
          pageId: '77',
          name: 'Resource List',
          type: 'List',
          description: 'List of all resources.',
          primaryKeyFields: ['No.'],
          supportsCreate: true,
          supportsDelete: true,
          category: 'Jobs',
        },
      ];

      const result = {
        timestamp: new Date().toISOString(),
        version: '1.0',
        pageCount: pages.length,
        pages,
      };

      const json = JSON.stringify(result, null, 2);

      this.logger?.debug('Returning BC page schema', {
        pageCount: pages.length,
      });

      return ok(json);
    } catch (error) {
      this.logger?.error('Failed to read BCSchemaPagesResource', {
        error: String(error),
      });

      return err(
        new InternalError('Failed to read BC schema pages resource', {
          code: 'READ_SCHEMA_PAGES_FAILED',
          error: String(error),
        })
      );
    }
  }
}
