/**
 * Utility functions for pageContextId handling
 *
 * PageContextId format: "sessionId:page:pageId:timestamp"
 */

export interface PageContextParts {
  sessionId: string;
  pageId: string;
  timestamp?: string;
}

/**
 * Parse a pageContextId into its component parts
 */
export function parsePageContextId(pageContextId: string): PageContextParts {
  // format: "sessionId:page:pageId:timestamp"
  const [sessionId, pageTag, pageId, timestamp] = pageContextId.split(':');
  if (!sessionId || pageTag !== 'page' || !pageId) {
    throw new Error(`Invalid pageContextId format: ${pageContextId}`);
  }
  return { sessionId, pageId, timestamp };
}

/**
 * Build a pageContextId from components
 */
export function buildPageContextId(sessionId: string, pageId: string | number, timestamp = Date.now()): string {
  return `${sessionId}:page:${String(pageId)}:${timestamp}`;
}

/**
 * Ensure we have the necessary page identifiers, extracting from pageContextId if needed
 */
export function ensurePageIdentifiers(args: {
  pageContextId?: string;
  pageId?: string | number;
  sessionId?: string;
}): { pageContextId?: string; pageId?: string; sessionId?: string } {
  if (args.pageContextId) {
    const parts = parsePageContextId(args.pageContextId);
    return {
      pageContextId: args.pageContextId,
      pageId: parts.pageId,
      sessionId: parts.sessionId
    };
  }
  return {
    pageContextId: undefined,
    pageId: args.pageId?.toString(),
    sessionId: args.sessionId,
  };
}