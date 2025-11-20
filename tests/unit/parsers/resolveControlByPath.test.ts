/**
 * Unit tests for resolveControlByPath() method
 *
 * These tests validate that controlPath resolution uses STRICT INDEX-BASED navigation,
 * not name-based lookup. This is critical for card page PropertyChanges to apply
 * to the correct controls when multiple controls share the same DesignName.
 *
 * See: MappingIssue.md for root cause analysis
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PageDataExtractor } from '../../../src/parsers/page-data-extractor';
import { LogicalForm, Control } from '../../../src/types/bc-types';
import { BCSessionManager } from '../../../src/services/session-manager';

describe('PageDataExtractor.resolveControlByPath', () => {
  let extractor: PageDataExtractor;
  let mockSessionManager: BCSessionManager;

  beforeEach(() => {
    mockSessionManager = {} as BCSessionManager;
    extractor = new PageDataExtractor(mockSessionManager);
  });

  /**
   * Helper to access private resolveControlByPath method
   */
  function resolveControlByPath(form: LogicalForm, controlPath: string): Control | null {
    // Access private method via type assertion
    return (extractor as any).resolveControlByPath(form, controlPath);
  }

  describe('Basic Path Navigation', () => {
    it('should return root form for "server" path', () => {
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: []
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server');
      expect(result).toBe(mockForm);
    });

    it('should return root form for "server:" path', () => {
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: []
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:');
      expect(result).toBe(mockForm);
    });

    it('should navigate single level path "server:c[0]"', () => {
      const child0: Control = { id: 'child0', Properties: {} } as Control;
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [child0]
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:c[0]');
      expect(result).toBe(child0);
    });

    it('should navigate two-level path "server:c[1]/c[0]"', () => {
      const grandchild: Control = { id: 'grandchild', Properties: {} } as Control;
      const child1: Control = {
        id: 'child1',
        Children: [grandchild],
        Properties: {}
      } as Control;
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [
          { id: 'child0', Properties: {} } as Control,
          child1
        ]
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:c[1]/c[0]');
      expect(result).toBe(grandchild);
    });

    it('should navigate deep nested path "server:c[0]/c[1]/c[2]"', () => {
      const deepChild: Control = { id: 'deep', Properties: {} } as Control;
      const level2: Control = {
        id: 'level2',
        Children: [
          { id: 'L2C0', Properties: {} } as Control,
          { id: 'L2C1', Properties: {} } as Control,
          deepChild
        ],
        Properties: {}
      } as Control;
      const level1: Control = {
        id: 'level1',
        Children: [
          { id: 'L1C0', Properties: {} } as Control,
          level2
        ],
        Properties: {}
      } as Control;
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [level1]
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:c[0]/c[1]/c[2]');
      expect(result).toBe(deepChild);
    });
  });

  describe('Edge Cases', () => {
    it('should return null for out-of-bounds index', () => {
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [
          { id: 'child0', Properties: {} } as Control
        ]
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:c[5]');
      expect(result).toBeNull();
    });

    it('should return null when node has no Children array', () => {
      const leafNode: Control = { id: 'leaf', Properties: {} } as Control;
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [leafNode]
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:c[0]/c[0]');
      expect(result).toBeNull();
    });

    it('should return null for invalid path format', () => {
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: []
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:invalid');
      expect(result).toBeNull();
    });

    it('should handle empty path after "server:"', () => {
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: []
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:');
      expect(result).toBe(mockForm);
    });
  });

  describe('Control Type Prefix Support', () => {
    /**
     * CRITICAL: BC uses different prefixes for control types:
     * - c[...] = generic control
     * - gc[...] = group control
     * - sc[...] = string control
     * - dc[...] = decimal control
     *
     * The regex MUST accept any letter prefix, not just "c"
     */
    it('should handle gc[...] (group control) prefix', () => {
      const groupChild: Control = { id: 'group', Properties: {} } as Control;
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [groupChild]
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:gc[0]');
      expect(result).toBe(groupChild);
    });

    it('should handle sc[...] (string control) prefix', () => {
      const stringChild: Control = { id: 'string', Properties: {} } as Control;
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [stringChild]
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:sc[0]');
      expect(result).toBe(stringChild);
    });

    it('should handle dc[...] (decimal control) prefix', () => {
      const decimalChild: Control = { id: 'decimal', Properties: {} } as Control;
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [decimalChild]
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:dc[0]');
      expect(result).toBe(decimalChild);
    });

    it('should handle mixed control types in path "server:gc[0]/sc[1]"', () => {
      const stringControl: Control = { id: 'string', Properties: {} } as Control;
      const groupControl: Control = {
        id: 'group',
        Children: [
          { id: 'gc0c0', Properties: {} } as Control,
          stringControl
        ],
        Properties: {}
      } as Control;
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [groupControl]
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:gc[0]/sc[1]');
      expect(result).toBe(stringControl);
    });
  });

  describe('Name Ambiguity - THE CRITICAL TEST', () => {
    /**
     * ROOT CAUSE TEST: Multiple controls can have the same DesignName.
     * The controlPath MUST use INDEX navigation, NOT name lookup.
     *
     * This test directly reproduces the bug described in MappingIssue.md:
     * - Two "No." fields exist in the tree
     * - One is customer number (should receive "20000")
     * - One is currency field (should receive "20,081.25")
     * - Wrong resolution causes "20000" to be applied to currency field
     */
    it('should distinguish between multiple controls with same DesignName using INDEX', () => {
      // Control at c[0]: "No." field for customer number
      const customerNoField: Control = {
        id: 'customerNo',
        type: 'sc',
        DesignName: 'No.',
        Caption: 'No.',
        Properties: {},
        Children: []
      } as Control;

      // Control at c[1]: "No." field for currency (different field, same name!)
      const currencyNoField: Control = {
        id: 'currencyNo',
        type: 'dc',
        DesignName: 'No.',
        Caption: 'No.',
        Properties: {},
        Children: []
      } as Control;

      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [
          customerNoField,  // index 0
          currencyNoField   // index 1
        ]
      } as LogicalForm;

      // PropertyChange targets "server:c[0]" → should get customerNoField
      const result0 = resolveControlByPath(mockForm, 'server:c[0]');
      expect(result0).toBe(customerNoField);
      expect(result0?.id).toBe('customerNo');

      // PropertyChange targets "server:c[1]" → should get currencyNoField
      const result1 = resolveControlByPath(mockForm, 'server:c[1]');
      expect(result1).toBe(currencyNoField);
      expect(result1?.id).toBe('currencyNo');

      // CRITICAL: Even though both have DesignName="No.", they are DIFFERENT objects
      expect(result0).not.toBe(result1);
    });

    it('should handle nested ambiguity - multiple "No." fields at different levels', () => {
      const innerNo: Control = {
        id: 'innerNo',
        DesignName: 'No.',
        Properties: {}
      } as Control;

      const groupControl: Control = {
        id: 'group',
        DesignName: 'Group',
        Children: [
          { id: 'gc0c0', DesignName: 'Other', Properties: {} } as Control,
          innerNo
        ],
        Properties: {}
      } as Control;

      const outerNo: Control = {
        id: 'outerNo',
        DesignName: 'No.',
        Properties: {}
      } as Control;

      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [
          outerNo,        // c[0]: outer "No." field
          groupControl    // c[1]: group containing inner "No." field
        ]
      } as LogicalForm;

      // "server:c[0]" → outer "No." field
      const outer = resolveControlByPath(mockForm, 'server:c[0]');
      expect(outer?.id).toBe('outerNo');

      // "server:c[1]/c[1]" → inner "No." field
      const inner = resolveControlByPath(mockForm, 'server:c[1]/c[1]');
      expect(inner?.id).toBe('innerNo');

      // Must be different objects despite same DesignName
      expect(outer).not.toBe(inner);
    });
  });

  describe('Real-World PropertyChanges Scenarios', () => {
    /**
     * Simulates actual PropertyChanges from Customer Card page (Page 21)
     * as documented in MappingIssue.md
     */
    it('should correctly resolve Customer Card field paths', () => {
      // Simplified Customer Card structure
      const generalFastTab: Control = {
        id: 'generalFastTab',
        type: 'gc',
        DesignName: 'General',
        Children: [
          {
            id: 'customerNoField',
            type: 'sc',
            DesignName: 'No.',
            Caption: 'No.',
            Properties: {}
          } as Control,
          {
            id: 'customerNameField',
            type: 'sc',
            DesignName: 'Name',
            Caption: 'Name',
            Properties: {}
          } as Control,
          {
            id: 'addressField',
            type: 'sc',
            DesignName: 'Address',
            Caption: 'Address',
            Properties: {}
          } as Control
        ],
        Properties: {}
      } as Control;

      const mockForm: LogicalForm = {
        FormId: '5C2',
        Children: [
          { id: 'header', type: 'gc', Properties: {} } as Control,
          generalFastTab
        ]
      } as LogicalForm;

      // PropertyChange: controlPath="server:c[1]/c[0]", value="20000"
      const noField = resolveControlByPath(mockForm, 'server:c[1]/c[0]');
      expect(noField?.id).toBe('customerNoField');

      // PropertyChange: controlPath="server:c[1]/c[1]", value="Ravel Møbler"
      const nameField = resolveControlByPath(mockForm, 'server:c[1]/c[1]');
      expect(nameField?.id).toBe('customerNameField');

      // PropertyChange: controlPath="server:c[1]/c[2]", value="153 Thomas Drive"
      const addressField = resolveControlByPath(mockForm, 'server:c[1]/c[2]');
      expect(addressField?.id).toBe('addressField');
    });
  });

  describe('Path Format Variations', () => {
    it('should handle paths without "server:" prefix', () => {
      const child: Control = { id: 'child', Properties: {} } as Control;
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [child]
      } as LogicalForm;

      // Some BC versions might send paths without "server:" prefix
      const result = resolveControlByPath(mockForm, 'c[0]');
      expect(result).toBe(child);
    });

    it('should handle paths with trailing slash', () => {
      const child: Control = { id: 'child', Properties: {} } as Control;
      const mockForm: LogicalForm = {
        FormId: 'root',
        Children: [child]
      } as LogicalForm;

      const result = resolveControlByPath(mockForm, 'server:c[0]/');
      expect(result).toBe(child);
    });
  });
});
