export const ok = (res, data, { status = 200, message } = {}) =>
  res.status(status).json({ success: true, data, message, requestId: res.req.id });
