import type { TemplateOverlay, TemplateOverlayOp } from '../../shared/schemas/template';

/**
 * Overlay operation helpers shared by the advanced editor and the plain-language
 * detail tabs. Kept in its own module so the detail route can append one
 * `setModule` / `addPool` op without pulling the whole overlay engine.
 */
/**
 * Appends an overlay operation while compacting redundant tail scalar ops
 * (e.g. repeated `setGroupMode`, `setOutput`, `setFinal`, `setDns`, `setModule`,
 * `setPatch` on the same target) to keep `overlay` concise and readable.
 */
export function appendOverlayOp(overlay: TemplateOverlay, op: TemplateOverlayOp): TemplateOverlay {
  const next = [...overlay];
  const replaceSingleton = (predicate: (existing: TemplateOverlayOp) => boolean) => {
    const idx = next.findIndex(predicate);
    if (idx !== -1) next.splice(idx, 1);
    next.push(op);
    return next;
  };

  switch (op.op) {
    case 'setGroupMode':
      return replaceSingleton((item) => item.op === 'setGroupMode');
    case 'setOutput':
      return replaceSingleton((item) => item.op === 'setOutput');
    case 'setFinal':
      return replaceSingleton((item) => item.op === 'setFinal');
    case 'setDns':
      return replaceSingleton((item) => item.op === 'setDns');
    case 'setGeneral':
      return replaceSingleton((item) => item.op === 'setGeneral');
    case 'setModule':
      return replaceSingleton((item) => item.op === 'setModule' && item.moduleId === op.moduleId);
    case 'setPatch':
      return replaceSingleton((item) => item.op === 'setPatch' && item.client === op.client);
    case 'setCardEnabled':
      return replaceSingleton((item) => item.op === 'setCardEnabled' && item.cardId === op.cardId);
    default:
      next.push(op);
      return next;
  }
}
