import { AuditLog } from "./audit.model.js";

export const recordAudit = (action, { actorId, ip, requestId, meta } = {}) =>
  AuditLog.create({ action, actorId, ip, requestId, meta });
