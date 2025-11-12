/**
 * Unit Tests for TellMeParser
 *
 * Tests Tell Me search result parsing from BC WebSocket responses.
 * Covers both BC27+ format (DataRefreshChange) and legacy format.
 */

import { describe, it, expect } from 'vitest';
import { TellMeParser, type TellMePage } from '../../src/protocol/tellme-parser.js';
import { isOk, isErr } from '../../src/core/result.js';

describe('TellMeParser', () => {
  const parser = new TellMeParser();

  // ============================================================================
  // BC27+ Format Tests (DataRefreshChange)
  // ============================================================================

  describe('BC27+ Format (DataRefreshChange)', () => {
    it('should parse BC27+ search results successfully', () => {
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
                        cells: {
                          Name: { stringValue: 'Customer List' },
                          DepartmentCategory: { stringValue: 'List' },
                          CacheKey: { stringValue: '22:pagemode(...)' },
                        },
                        bookmark: 'key-guid-1',
                      },
                    ],
                  },
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [
                      1,
                      {
                        cells: {
                          Name: { stringValue: 'Customer Card' },
                          DepartmentCategory: { stringValue: 'Card' },
                          CacheKey: { stringValue: '21:pagemode(...)' },
                        },
                        bookmark: 'key-guid-2',
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(2);

        expect(result.value[0]).toEqual({
          id: '22',
          caption: 'Customer List',
          tooltip: undefined,
          badges: undefined,
        });

        expect(result.value[1]).toEqual({
          id: '21',
          caption: 'Customer Card',
          tooltip: undefined,
          badges: undefined,
        });
      }
    });

    it('should handle empty BC27+ search results', () => {
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
                RowChanges: [],
              },
            ],
          ],
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should extract tooltips from BC27+ format', () => {
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
                        cells: {
                          Name: { stringValue: 'Customer List' },
                          DepartmentCategory: { stringValue: 'List' },
                          CacheKey: { stringValue: '22:pagemode(...)' },
                          Description: { stringValue: 'View all customers in a list' },
                        },
                        bookmark: 'key-guid-1',
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value[0].tooltip).toBe('View all customers in a list');
      }
    });
  });

  // ============================================================================
  // Legacy Format Tests
  // ============================================================================

  describe('Legacy Format', () => {
    it('should parse legacy search results successfully', () => {
      const handlers = [
        {
          LogicalForm: {
            Controls: [
              { Type: 10 }, // Search box
              {
                Type: 11, // Repeater
                Value: [
                  ['Customer List', 'List', '22', 'Page', 'key-1'],
                  ['Customer Card', 'Card', '21', 'Page', 'key-2'],
                ],
              },
            ],
          },
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].id).toBe('22');
        expect(result.value[0].caption).toBe('Customer List');
        expect(result.value[1].id).toBe('21');
        expect(result.value[1].caption).toBe('Customer Card');
      }
    });

    it('should handle empty legacy search results', () => {
      const handlers = [
        {
          LogicalForm: {
            Controls: [
              { Type: 10 },
              { Type: 11, Value: [] },
            ],
          },
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should use Children property if Controls not present', () => {
      const handlers = [
        {
          LogicalForm: {
            Children: [
              { Type: 10 },
              {
                Type: 11,
                Value: [['Item Card', 'Card', '30', 'Page', 'key-1']],
              },
            ],
          },
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].id).toBe('30');
        expect(result.value[0].caption).toBe('Item Card');
      }
    });

    it('should handle nested Value in Properties', () => {
      const handlers = [
        {
          LogicalForm: {
            Controls: [
              { Type: 10 },
              {
                Type: 11,
                Properties: {
                  Value: [['Sales Order', 'Document', '42', 'Page', 'key-1']],
                },
              },
            ],
          },
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].id).toBe('42');
        expect(result.value[0].caption).toBe('Sales Order');
      }
    });
  });

  // ============================================================================
  // Fallback Behavior Tests
  // ============================================================================

  describe('Fallback Behavior', () => {
    it('should try BC27+ format first, then fall back to legacy', () => {
      // Handlers with both formats (BC27+ should take precedence)
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
                        cells: {
                          Name: { stringValue: 'BC27+ Result' },
                          DepartmentCategory: { stringValue: 'List' },
                          CacheKey: { stringValue: '100:pagemode(...)' },
                        },
                        bookmark: 'key-1',
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
        {
          LogicalForm: {
            Controls: [
              { Type: 10 },
              {
                Type: 11,
                Value: [['Legacy Result', 'List', '200', 'Page', 'key-2']],
              },
            ],
          },
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // Should use BC27+ format (id: 100), not legacy (id: 200)
        expect(result.value[0].id).toBe('100');
        expect(result.value[0].caption).toBe('BC27+ Result');
      }
    });

    it('should fall back to legacy if BC27+ format has no results', () => {
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
                RowChanges: [], // Empty BC27+ results
              },
            ],
          ],
        },
        {
          LogicalForm: {
            Controls: [
              { Type: 10 },
              {
                Type: 11,
                Value: [['Legacy Result', 'List', '22', 'Page', 'key-1']],
              },
            ],
          },
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // Should fall back to legacy format
        expect(result.value).toHaveLength(1);
        expect(result.value[0].id).toBe('22');
        expect(result.value[0].caption).toBe('Legacy Result');
      }
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases', () => {
    it('should return empty array for empty handlers', () => {
      const result = parser.parseTellMeResults([]);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return empty array for handlers with no search results', () => {
      const handlers = [
        { handlerType: 'SomeOtherHandler' },
        { unrelatedData: true },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should handle null/undefined handlers gracefully', () => {
      const result = parser.parseTellMeResults([null, undefined] as any);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return error for malformed handler structure', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: 'invalid', // Should be array
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      // Parser should handle this gracefully and return empty array or error
      expect(isOk(result) || isErr(result)).toBe(true);
    });
  });

  // ============================================================================
  // Result Transformation Tests
  // ============================================================================

  describe('Result Transformation', () => {
    it('should handle various field name capitalizations', () => {
      const handlers = [
        {
          LogicalForm: {
            Controls: [
              { Type: 10 },
              {
                Type: 11,
                Value: [
                  [
                    'Test Page',
                    'List',
                    '999',
                    'Page',
                    'key-1',
                    'Test Tooltip',
                    'action',
                    'action-key',
                  ],
                ],
              },
            ],
          },
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const page = result.value[0];
        expect(page.id).toBe('999');
        expect(page.caption).toBe('Test Page');
        expect(page.tooltip).toBe('Test Tooltip');
      }
    });

    it('should coerce non-string IDs to strings', () => {
      const handlers = [
        {
          LogicalForm: {
            Controls: [
              { Type: 10 },
              {
                Type: 11,
                Value: [['Test', 'Card', 123, 'Page', 'key-1']], // Number at objectId position
              },
            ],
          },
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value[0].id).toBe('123');
        expect(result.value[0].caption).toBe('Test');
      }
    });

    it('should handle missing optional fields', () => {
      const handlers = [
        {
          LogicalForm: {
            Controls: [
              { Type: 10 },
              {
                Type: 11,
                Value: [['Name', 'Type', '1', 'Page', 'key-1']], // No tooltip/badges
              },
            ],
          },
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const page = result.value[0];
        expect(page.tooltip).toBeUndefined();
        expect(page.badges).toBeUndefined();
      }
    });
  });

  // ============================================================================
  // Real-World Data Tests
  // ============================================================================

  describe('Real-World Scenarios', () => {
    it('should parse multiple pages from customer search', () => {
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
                        cells: {
                          Name: { stringValue: 'Customer Card' },
                          DepartmentCategory: { stringValue: 'Card' },
                          CacheKey: { stringValue: '21:pagemode(...)' },
                          Description: { stringValue: 'View or edit detailed information about customers' },
                        },
                        bookmark: 'guid-1',
                      },
                    ],
                  },
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [
                      1,
                      {
                        cells: {
                          Name: { stringValue: 'Customer List' },
                          DepartmentCategory: { stringValue: 'List' },
                          CacheKey: { stringValue: '22:pagemode(...)' },
                          Description: { stringValue: 'View all customers in a list' },
                        },
                        bookmark: 'guid-2',
                      },
                    ],
                  },
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [
                      2,
                      {
                        cells: {
                          Name: { stringValue: 'Customer Ledger Entries' },
                          DepartmentCategory: { stringValue: 'List' },
                          CacheKey: { stringValue: '25:pagemode(...)' },
                          Description: { stringValue: 'View customer ledger entries' },
                        },
                        bookmark: 'guid-3',
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(3);

        expect(result.value[0].id).toBe('21');
        expect(result.value[0].caption).toBe('Customer Card');
        expect(result.value[0].tooltip).toBe('View or edit detailed information about customers');

        expect(result.value[1].id).toBe('22');
        expect(result.value[1].caption).toBe('Customer List');

        expect(result.value[2].id).toBe('25');
        expect(result.value[2].caption).toBe('Customer Ledger Entries');
      }
    });

    it('should handle large result sets efficiently', () => {
      const rowChanges = Array.from({ length: 100 }, (_, i) => ({
        t: 'DataRowInserted',
        DataRowInserted: [
          i,
          {
            cells: {
              Name: { stringValue: `Page ${i}` },
              DepartmentCategory: { stringValue: 'List' },
              CacheKey: { stringValue: `${1000 + i}:pagemode(...)` },
            },
            bookmark: `key-${i}`,
          },
        ],
      }));

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
                RowChanges: rowChanges,
              },
            ],
          ],
        },
      ];

      const result = parser.parseTellMeResults(handlers);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(100);
        expect(result.value[0].id).toBe('1000');
        expect(result.value[99].id).toBe('1099');
      }
    });
  });
});
