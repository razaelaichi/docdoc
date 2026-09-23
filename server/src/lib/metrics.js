import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry }); // CPU, memory, event-loop lag, GC

const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export function metricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    // route template (not raw URL) keeps label cardinality bounded
    const route = req.route ? req.baseUrl + req.route.path : "unmatched";
    end({ method: req.method, route, status: res.statusCode });
  });
  next();
}

export const counter = (name, help, labelNames = []) =>
  new client.Counter({ name, help, labelNames, registers: [registry] });
export const histogram = (name, help, labelNames, buckets) =>
  new client.Histogram({ name, help, labelNames, buckets, registers: [registry] });
export const gauge = (name, help, labelNames = []) =>
  new client.Gauge({ name, help, labelNames, registers: [registry] });
