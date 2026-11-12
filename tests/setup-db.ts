import { afterAll, beforeEach } from "vitest";
import { kosongkanDb, sqlTest } from "./helpers";

beforeEach(async () => {
  await kosongkanDb();
});

afterAll(async () => {
  await sqlTest.end();
});
