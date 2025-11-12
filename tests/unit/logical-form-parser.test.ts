/**
 * Unit Tests for Logical Form Parser
 *
 * Tests parsing of BC WebSocket LogicalForm structures for Tell Me search results.
 * Covers both legacy format and BC27+ LogicalClientChangeHandler format.
 */

import { describe, it, expect } from 'vitest';
import {
  extractTellMeResults,
  extractTellMeResultsFromChangeHandler,
  convertToPageSearchResults,
  getFormId,
  getSearchQuery,
  type TellMeSearchResultRow,
} from '../../src/protocol/logical-form-parser.js';
import { isOk, isErr } from '../../src/core/result.js';

describe('Logical Form Parser', () => {
  // ============================================================================
  // extractTellMeResults (Legacy Format)
  // ============================================================================

  describe('extractTellMeResults', () => {
    it('should extract results from valid LogicalForm', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [
            { Type: 10 }, // Search input
            {
              Type: 11, // Repeater
              Value: [
                ['Customer List', 'List', '22', 'Page', 'key-guid-1'],
                ['Customer Card', 'Card', '21', 'Page', 'key-guid-2'],
              ],
            },
          ],
        },
      };

      const result = extractTellMeResults(logicalForm);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(2);

        expect(result.value[0]).toEqual({
          name: 'Customer List',
          category: 'List',
          objectId: '22',
          objectType: 'Page',
          key: 'key-guid-1',
          context: undefined,
          action: undefined,
          actionKey: undefined,
        });

        expect(result.value[1]).toEqual({
          name: 'Customer Card',
          category: 'Card',
          objectId: '21',
          objectType: 'Page',
          key: 'key-guid-2',
          context: undefined,
          action: undefined,
          actionKey: undefined,
        });
      }
    });

    it('should extract results with optional context fields', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [
            { Type: 10 },
            {
              Type: 11,
              Value: [
                [
                  'Sales Order',
                  'Document',
                  '42',
                  'Page',
                  'key-1',
                  'Order processing',
                  'open',
                  'action-key-1',
                ],
              ],
            },
          ],
        },
      };

      const result = extractTellMeResults(logicalForm);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value[0]).toEqual({
          name: 'Sales Order',
          category: 'Document',
          objectId: '42',
          objectType: 'Page',
          key: 'key-1',
          context: 'Order processing',
          action: 'open',
          actionKey: 'action-key-1',
        });
      }
    });

    it('should use Children property if Controls not present', () => {
      const logicalForm = {
        LogicalForm: {
          Children: [
            { Type: 10 },
            {
              Type: 11,
              Value: [['Item Card', 'Card', '30', 'Page', 'key-1']],
            },
          ],
        },
      };

      const result = extractTellMeResults(logicalForm);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value[0].name).toBe('Item Card');
        expect(result.value[0].objectId).toBe('30');
      }
    });

    it('should extract results from nested Properties.Value', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [
            { Type: 10 },
            {
              Type: 11,
              Properties: {
                Value: [['Posted Invoice', 'Document', '132', 'Page', 'key-1']],
              },
            },
          ],
        },
      };

      const result = extractTellMeResults(logicalForm);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value[0].name).toBe('Posted Invoice');
        expect(result.value[0].objectId).toBe('132');
      }
    });

    it('should return empty array for empty results', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [{ Type: 10 }, { Type: 11, Value: [] }],
        },
      };

      const result = extractTellMeResults(logicalForm);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return empty array if repeater has no Value', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [{ Type: 10 }, { Type: 11 }],
        },
      };

      const result = extractTellMeResults(logicalForm);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should handle alternative repeater type (t="rc")', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [
            { Type: 10 },
            {
              t: 'rc', // Alternative type indicator
              Value: [['Test Page', 'List', '999', 'Page', 'key-1']],
            },
          ],
        },
      };

      const result = extractTellMeResults(logicalForm);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value[0].name).toBe('Test Page');
      }
    });

    it('should return error for missing LogicalForm', () => {
      const logicalForm = {};

      const result = extractTellMeResults(logicalForm);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('does not contain LogicalForm');
      }
    });

    it('should return error for missing controls', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [],
        },
      };

      const result = extractTellMeResults(logicalForm);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('does not have expected control structure');
      }
    });

    it('should return error for wrong control type at index 1', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [{ Type: 10 }, { Type: 99 }], // Wrong type
        },
      };

      const result = extractTellMeResults(logicalForm);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Expected repeater control');
      }
    });

    it('should handle rows with missing fields gracefully', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [
            { Type: 10 },
            {
              Type: 11,
              Value: [
                ['Name', '', '', '', 'key-1'], // Missing category/id/type
                [null, null, null, null, 'key-2'], // Null values
              ],
            },
          ],
        },
      };

      const result = extractTellMeResults(logicalForm);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].name).toBe('Name');
        expect(result.value[0].category).toBe('');
        expect(result.value[1].name).toBe('');
      }
    });
  });

  // ============================================================================
  // extractTellMeResultsFromChangeHandler (BC27+ Format)
  // ============================================================================

  describe('extractTellMeResultsFromChangeHandler', () => {
    it('should extract results from BC27+ DataRefreshChange', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: [
            'form123',
            [
              { t: 'PropertyChanges' },
              {
                t: 'DataRefreshChange',
                ControlReference: { controlPath: 'server:c[1]' },
                RowChanges: [
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [
                      0,
                      {
                        bookmark: 'bookmark-1',
                        cells: {
                          CacheKey: { stringValue: '22:pagemode(...)' },
                          Name: { stringValue: 'Customer List' },
                          DepartmentCategory: { stringValue: 'List' },
                          DepartmentPath: { stringValue: 'Sales' },
                        },
                      },
                    ],
                  },
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [
                      1,
                      {
                        bookmark: 'bookmark-2',
                        cells: {
                          CacheKey: { stringValue: '21:pagemode(...)' },
                          Name: { stringValue: 'Customer Card' },
                          DepartmentCategory: { stringValue: 'Card' },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
      ];

      const result = extractTellMeResultsFromChangeHandler(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(2);

        expect(result.value[0]).toEqual({
          name: 'Customer List',
          category: 'List',
          objectId: '22',
          objectType: 'Page',
          key: 'bookmark-1',
          context: 'Sales',
          action: undefined,
          actionKey: undefined,
        });

        expect(result.value[1]).toEqual({
          name: 'Customer Card',
          category: 'Card',
          objectId: '21',
          objectType: 'Page',
          key: 'bookmark-2',
          context: undefined,
          action: undefined,
          actionKey: undefined,
        });
      }
    });

    it('should return empty array if no LogicalClientChangeHandler', () => {
      const handlers = [
        { handlerType: 'SomeOtherHandler' },
        { handlerType: 'AnotherHandler' },
      ];

      const result = extractTellMeResultsFromChangeHandler(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return empty array if no DataRefreshChange', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: ['form123', [{ t: 'PropertyChanges' }]],
        },
      ];

      const result = extractTellMeResultsFromChangeHandler(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return empty array if DataRefreshChange has no RowChanges', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: [
            'form123',
            [
              {
                t: 'DataRefreshChange',
                ControlReference: { controlPath: 'server:c[1]' },
                RowChanges: [],
              },
            ],
          ],
        },
      ];

      const result = extractTellMeResultsFromChangeHandler(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should filter out non-DataRowInserted changes', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: [
            'form123',
            [
              {
                t: 'DataRefreshChange',
                ControlReference: { controlPath: 'server:c[1]' },
                RowChanges: [
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [
                      0,
                      {
                        bookmark: 'bookmark-1',
                        cells: {
                          CacheKey: { stringValue: '22:pagemode(...)' },
                          Name: { stringValue: 'Customer List' },
                          DepartmentCategory: { stringValue: 'List' },
                        },
                      },
                    ],
                  },
                  { t: 'DataRowDeleted' }, // Should be filtered out
                  { t: 'DataRowUpdated' }, // Should be filtered out
                ],
              },
            ],
          ],
        },
      ];

      const result = extractTellMeResultsFromChangeHandler(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe('Customer List');
      }
    });

    it('should handle rows with missing cells data', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: [
            'form123',
            [
              {
                t: 'DataRefreshChange',
                ControlReference: { controlPath: 'server:c[1]' },
                RowChanges: [
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [0, { bookmark: 'bookmark-1' }], // No cells
                  },
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [
                      1,
                      {
                        bookmark: 'bookmark-2',
                        cells: {
                          CacheKey: { stringValue: '22:pagemode(...)' },
                          Name: { stringValue: 'Customer List' },
                          DepartmentCategory: { stringValue: 'List' },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
      ];

      const result = extractTellMeResultsFromChangeHandler(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // First row filtered out (no cells), second row included
        expect(result.value).toHaveLength(1);
        expect(result.value[0].name).toBe('Customer List');
      }
    });

    it('should extract page ID from CacheKey correctly', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: [
            'form123',
            [
              {
                t: 'DataRefreshChange',
                ControlReference: { controlPath: 'server:c[1]' },
                RowChanges: [
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [
                      0,
                      {
                        bookmark: 'bookmark-1',
                        cells: {
                          CacheKey: { stringValue: '9999:pagemode(edit):bookmark(...)' },
                          Name: { stringValue: 'Test Page' },
                          DepartmentCategory: { stringValue: 'List' },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
      ];

      const result = extractTellMeResultsFromChangeHandler(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value[0].objectId).toBe('9999');
      }
    });

    it('should handle CacheKey without page ID', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: [
            'form123',
            [
              {
                t: 'DataRefreshChange',
                ControlReference: { controlPath: 'server:c[1]' },
                RowChanges: [
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [
                      0,
                      {
                        bookmark: 'bookmark-1',
                        cells: {
                          CacheKey: { stringValue: 'invalid-format' },
                          Name: { stringValue: 'Test Page' },
                          DepartmentCategory: { stringValue: 'List' },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
      ];

      const result = extractTellMeResultsFromChangeHandler(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value[0].objectId).toBe('');
      }
    });

    it('should return error for invalid handlers parameter', () => {
      const result = extractTellMeResultsFromChangeHandler('not-an-array' as any);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Handlers is not an array');
      }
    });
  });

  // ============================================================================
  // convertToPageSearchResults
  // ============================================================================

  describe('convertToPageSearchResults', () => {
    it('should convert Tell Me results to PageSearchResult format', () => {
      const tellMeResults: TellMeSearchResultRow[] = [
        {
          name: 'Customer List',
          category: 'List',
          objectId: '22',
          objectType: 'Page',
          key: 'key-1',
        },
        {
          name: 'Customer Card',
          category: 'Card',
          objectId: '21',
          objectType: 'Page',
          key: 'key-2',
        },
      ];

      const results = convertToPageSearchResults(tellMeResults);

      expect(results).toHaveLength(2);

      expect(results[0]).toEqual({
        pageId: '22',
        caption: 'Customer List',
        type: 'List',
        appName: 'Base Application',
      });

      expect(results[1]).toEqual({
        pageId: '21',
        caption: 'Customer Card',
        type: 'Card',
        appName: 'Base Application',
      });
    });

    it('should filter out Reports (only include Pages)', () => {
      const tellMeResults: TellMeSearchResultRow[] = [
        {
          name: 'Customer List',
          category: 'List',
          objectId: '22',
          objectType: 'Page',
          key: 'key-1',
        },
        {
          name: 'Customer Report',
          category: 'Report and analysis',
          objectId: '111',
          objectType: 'Report',
          key: 'key-2',
        },
      ];

      const results = convertToPageSearchResults(tellMeResults);

      expect(results).toHaveLength(1);
      expect(results[0].caption).toBe('Customer List');
    });

    it('should map categories to page types correctly', () => {
      const tellMeResults: TellMeSearchResultRow[] = [
        { name: 'Test', category: 'Liste', objectId: '1', objectType: 'Page', key: 'k1' },
        { name: 'Test', category: 'Card', objectId: '2', objectType: 'Page', key: 'k2' },
        {
          name: 'Test',
          category: 'Document',
          objectId: '3',
          objectType: 'Page',
          key: 'k3',
        },
        {
          name: 'Test',
          category: 'Worksheet',
          objectId: '4',
          objectType: 'Page',
          key: 'k4',
        },
        {
          name: 'Test',
          category: 'Report and analysis',
          objectId: '5',
          objectType: 'Page',
          key: 'k5',
        },
        { name: 'Test', category: 'Unknown', objectId: '6', objectType: 'Page', key: 'k6' },
      ];

      const results = convertToPageSearchResults(tellMeResults);

      expect(results[0].type).toBe('List'); // Case-insensitive matching
      expect(results[1].type).toBe('Card');
      expect(results[2].type).toBe('Document');
      expect(results[3].type).toBe('Worksheet');
      expect(results[4].type).toBe('Report'); // Contains "report"
      expect(results[5].type).toBe('Unknown'); // Unknown category preserved
    });

    it('should handle empty array', () => {
      const results = convertToPageSearchResults([]);
      expect(results).toHaveLength(0);
    });
  });

  // ============================================================================
  // getFormId
  // ============================================================================

  describe('getFormId', () => {
    it('should extract form ID from LogicalForm', () => {
      const logicalForm = {
        LogicalForm: {
          Id: 'form-123-456',
          Controls: [],
        },
      };

      const formId = getFormId(logicalForm);
      expect(formId).toBe('form-123-456');
    });

    it('should return undefined if LogicalForm missing', () => {
      const logicalForm = {};
      const formId = getFormId(logicalForm);
      expect(formId).toBeUndefined();
    });

    it('should return undefined if Id missing', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [],
        },
      };

      const formId = getFormId(logicalForm);
      expect(formId).toBeUndefined();
    });
  });

  // ============================================================================
  // getSearchQuery
  // ============================================================================

  describe('getSearchQuery', () => {
    it('should extract search query from LogicalForm', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [
            {
              Controls: [
                {
                  Properties: {
                    Value: 'customer',
                  },
                },
              ],
            },
          ],
        },
      };

      const query = getSearchQuery(logicalForm);
      expect(query).toBe('customer');
    });

    it('should return undefined if structure invalid', () => {
      const logicalForm = {
        LogicalForm: {
          Controls: [],
        },
      };

      const query = getSearchQuery(logicalForm);
      expect(query).toBeUndefined();
    });

    it('should return undefined if LogicalForm missing', () => {
      const logicalForm = {};
      const query = getSearchQuery(logicalForm);
      expect(query).toBeUndefined();
    });
  });
});
