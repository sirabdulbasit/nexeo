/**
 * The Wiki handshakes only with Nexeo and Suzi (owner, 13 Nov 2026; Functional
 * Charter row 1; docs/Wiki-Knowledge.md §0.8).
 *
 * Two parties may reach the Wiki: Nexeo itself (a signed-in person in the
 * portal, and Nexeo's own jobs) and Suzi, through the charter's knowledge
 * route and day pack, which have their own sign-in. No other project and no
 * outside agent reads or writes it.
 *
 * A caller holding a machine token (`req.user.isAgent`, set by
 * agentAuthMiddleware) is neither of the two, so the Wiki's routes refuse it.
 */
import type { Request, Response, NextFunction } from 'express';

export const WIKI_HANDSHAKE_REFUSAL = 'The Wiki answers only Nexeo and Suzi.';

export function wikiHandshakeOnly(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).user?.isAgent === true) {
    res.status(403).json({ error: WIKI_HANDSHAKE_REFUSAL });
    return;
  }
  next();
}
