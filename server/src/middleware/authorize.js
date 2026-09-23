import { forbidden } from "../lib/errors.js";

// role gate; resource ownership is checked in the service layer
export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user?.role)) throw forbidden();
  next();
};

