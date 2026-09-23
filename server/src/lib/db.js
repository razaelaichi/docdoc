import mongoose from "mongoose";
import { config, isProd } from "../config/index.js";
import { counter, gauge, histogram } from "./metrics.js";

mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true); // strips $-operators from filters built from user input

const commandDuration = histogram("mongodb_command_duration_seconds", "MongoDB command latency", ["command", "outcome"], [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5]);
const poolCheckedOut = gauge("mongodb_pool_connections_in_use", "Connections checked out of the pool");
const poolWaitFailures = counter("mongodb_pool_checkout_failures_total", "Pool checkouts that failed or timed out", ["reason"]);
const heartbeatFailures = counter("mongodb_heartbeat_failures_total", "Failed server heartbeats (connectivity problems)");
const COMMANDS = new Set(["find", "insert", "update", "delete", "aggregate", "getMore", "count", "findAndModify", "createIndexes", "ping", "commitTransaction", "abortTransaction"]);

// Command monitoring: latency and failures per command type, plus pool pressure and connectivity
function instrument(client) {
  const observe = (outcome) => (e) =>
    commandDuration.observe({ command: COMMANDS.has(e.commandName) ? e.commandName : "other", outcome }, e.duration / 1000);
  client.on("commandSucceeded", observe("ok"));
  client.on("commandFailed", observe("error"));
  client.on("connectionCheckedOut", () => poolCheckedOut.inc());
  client.on("connectionCheckedIn", () => poolCheckedOut.dec());
  client.on("connectionCheckOutFailed", (e) => poolWaitFailures.inc({ reason: String(e.reason) }));
  client.on("serverHeartbeatFailed", () => heartbeatFailures.inc());
}

export async function connectDb(uri = config.MONGODB_URI) {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 20,
    autoIndex: !isProd, // production indexes are built deliberately, not on boot
    monitorCommands: true,
  });
  instrument(mongoose.connection.getClient());
}

export const disconnectDb = () => mongoose.disconnect();

export async function pingDb() {
  if (mongoose.connection.readyState !== 1) throw new Error("not connected");
  await mongoose.connection.db.admin().ping();
}
