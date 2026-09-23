import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll } from "vitest";
import { connectDb, disconnectDb } from "../src/lib/db.js";
import { register } from "../src/modules/auth/auth.service.js";
import { User } from "../src/modules/users/user.model.js";

export const ORIGIN = "http://localhost:5173";
export const PASSWORD = "correct horse battery";

export function useTestDb() {
  let mongo;
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); // transactions need a replica set
    await connectDb(mongo.getUri());
  }, 120_000);
  afterAll(async () => {
    await disconnectDb();
    await mongo.stop();
  });
}

let n = 0;
// creates a user via the service (HTTP sign-up is rate-limited) and returns a bearer header
export async function signIn(app, role = "doctor") {
  const email = `user${++n}-${Date.now()}@example.com`;
  const user = await register({ email, name: "Test User", password: PASSWORD }, {});
  await User.updateOne({ _id: user._id }, { role });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
}
