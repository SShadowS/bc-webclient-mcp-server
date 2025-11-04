import type { MasterPage, ActionDefinition, ControlDefinition } from './types.js';

/**
 * Format MasterPage metadata into readable, structured output
 */
export class MetadataFormatter {
  /**
   * Format full page metadata
   */
  static formatMasterPage(page: MasterPage): string {
    const lines: string[] = [];

    lines.push('═'.repeat(80));
    lines.push(`PAGE METADATA`);
    lines.push('═'.repeat(80));
    lines.push('');

    // Basic Info
    lines.push('📄 BASIC INFORMATION');
    lines.push('─'.repeat(80));
    lines.push(`  ID:          ${page.id}`);
    lines.push(`  Name:        ${page.name}`);
    lines.push(`  Caption:     ${page.caption}`);
    if (page.pageType) lines.push(`  Type:        ${page.pageType}`);
    if (page.sourceTable) lines.push(`  Source:      ${page.sourceTable}`);
    lines.push('');

    // Permissions/Properties
    if (page.pageProperties) {
      lines.push('🔒 PERMISSIONS');
      lines.push('─'.repeat(80));
      const props = page.pageProperties;
      lines.push(`  Insert:      ${props.insertAllowed ? '✓' : '✗'}`);
      lines.push(`  Modify:      ${props.modifyAllowed ? '✓' : '✗'}`);
      lines.push(`  Delete:      ${props.deleteAllowed ? '✓' : '✗'}`);
      lines.push(`  Editable:    ${props.editable ? '✓' : '✗'}`);
      lines.push('');
    }

    // Actions
    if (page.commandBar?.actions && page.commandBar.actions.length > 0) {
      lines.push('⚡ ACTIONS / COMMANDS');
      lines.push('─'.repeat(80));
      lines.push(this.formatActions(page.commandBar.actions));
      lines.push('');
    }

    // Controls/Fields
    if (page.contentArea?.controls && page.contentArea.controls.length > 0) {
      lines.push('🎛️  CONTROLS / FIELDS');
      lines.push('─'.repeat(80));
      lines.push(this.formatControls(page.contentArea.controls));
      lines.push('');
    }

    // Groups
    if (page.contentArea?.groups && page.contentArea.groups.length > 0) {
      lines.push('📦 CONTROL GROUPS');
      lines.push('─'.repeat(80));
      page.contentArea.groups.forEach((group) => {
        lines.push(`  Group: ${group.caption || '(unnamed)'} (ID: ${group.id})`);
        if (group.controls && group.controls.length > 0) {
          lines.push(this.formatControls(group.controls, 4));
        }
        lines.push('');
      });
    }

    // Methods
    if (page.methods && page.methods.length > 0) {
      lines.push('🔧 CALLABLE METHODS');
      lines.push('─'.repeat(80));
      page.methods.forEach((method) => {
        const params = method.parameters
          ? `(${method.parameters.map(p => `${p.name}: ${p.type}`).join(', ')})`
          : '()';
        lines.push(`  ${method.name}${params} - ID: ${method.id}`);
      });
      lines.push('');
    }

    // Field Definitions
    if (page.expressions && page.expressions.length > 0) {
      lines.push('📊 FIELD DEFINITIONS');
      lines.push('─'.repeat(80));
      page.expressions.forEach((field) => {
        const length = field.length ? ` (${field.length})` : '';
        lines.push(`  ${field.name}: ${field.dataType}${length} - ID: ${field.id}`);
      });
      lines.push('');
    }

    lines.push('═'.repeat(80));

    return lines.join('\n');
  }

  /**
   * Format actions list
   */
  private static formatActions(actions: ActionDefinition[], indent = 2): string {
    const lines: string[] = [];
    const spacing = ' '.repeat(indent);

    actions.forEach((action) => {
      const status: string[] = [];
      if (action.promoted) status.push('⭐');
      if (action.enabled === false) status.push('🚫');
      if (action.visible === false) status.push('👁️‍🗨️');

      const statusStr = status.length > 0 ? ` ${status.join(' ')}` : '';
      const typeStr = action.type ? ` [${action.type}]` : '';

      lines.push(`${spacing}• ${action.caption} (${action.name})${typeStr}${statusStr}`);
      lines.push(`${spacing}  ID: ${action.id}`);
    });

    return lines.join('\n');
  }

  /**
   * Format controls list
   */
  private static formatControls(controls: ControlDefinition[], indent = 2): string {
    const lines: string[] = [];
    const spacing = ' '.repeat(indent);

    controls.forEach((control) => {
      const status: string[] = [];
      if (control.editable === false) status.push('🔒');
      if (control.visible === false) status.push('👁️‍🗨️');
      if (control.enabled === false) status.push('🚫');

      const statusStr = status.length > 0 ? ` ${status.join(' ')}` : '';
      const typeInfo = control.dataType ? ` [${control.dataType}]` : ` [${control.controlType}]`;
      const fieldInfo = control.fieldId ? ` Field: ${control.fieldId}` : '';
      const sourceInfo = control.sourceExpr ? ` Source: ${control.sourceExpr}` : '';

      lines.push(`${spacing}• ${control.caption || control.name}${typeInfo}${statusStr}`);
      lines.push(`${spacing}  ID: ${control.id}${fieldInfo}${sourceInfo}`);
    });

    return lines.join('\n');
  }

  /**
   * Format as compact JSON suitable for LLMs
   */
  static formatCompactJson(page: MasterPage): string {
    const compact = {
      page_id: page.id,
      name: page.name,
      caption: page.caption,
      type: page.pageType,
      source_table: page.sourceTable,
      permissions: page.pageProperties ? {
        insert: page.pageProperties.insertAllowed,
        modify: page.pageProperties.modifyAllowed,
        delete: page.pageProperties.deleteAllowed,
        editable: page.pageProperties.editable
      } : undefined,
      actions: page.commandBar?.actions?.map(a => ({
        id: a.id,
        name: a.name,
        caption: a.caption,
        type: a.type,
        promoted: a.promoted
      })) || [],
      fields: page.contentArea?.controls?.map(c => ({
        id: c.id,
        name: c.name,
        caption: c.caption,
        type: c.dataType || c.controlType,
        field_id: c.fieldId,
        editable: c.editable,
        visible: c.visible
      })) || [],
      methods: page.methods?.map(m => ({
        id: m.id,
        name: m.name,
        parameters: m.parameters
      })) || []
    };

    return JSON.stringify(compact, null, 2);
  }

  /**
   * Create a summary suitable for LLM context
   */
  static formatSummary(page: MasterPage): string {
    const lines: string[] = [];

    lines.push(`Page: ${page.caption} (${page.name}, ID: ${page.id})`);

    if (page.pageType) {
      lines.push(`Type: ${page.pageType}`);
    }

    const actionCount = page.commandBar?.actions?.length || 0;
    const controlCount = page.contentArea?.controls?.length || 0;
    const methodCount = page.methods?.length || 0;

    lines.push(`Contains: ${actionCount} actions, ${controlCount} controls, ${methodCount} methods`);

    if (page.pageProperties) {
      const perms: string[] = [];
      if (page.pageProperties.insertAllowed) perms.push('insert');
      if (page.pageProperties.modifyAllowed) perms.push('modify');
      if (page.pageProperties.deleteAllowed) perms.push('delete');
      lines.push(`Permissions: ${perms.join(', ') || 'read-only'}`);
    }

    return lines.join('\n');
  }
}
