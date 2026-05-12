import { describe, expect, it } from "vitest";

import {
  ADMIN_PATH,
  ADMIN_USERS_PATH,
  isAdminUsersPath,
  isPlodaiPath,
  PLODAI_PATH,
} from "../router";

describe("app router", () => {
  it("recognizes primary shell routes", () => {
    expect(isPlodaiPath(PLODAI_PATH)).toBe(true);
    expect(isAdminUsersPath(ADMIN_PATH)).toBe(true);
    expect(isAdminUsersPath(ADMIN_USERS_PATH)).toBe(true);
    expect(isAdminUsersPath("/admin/users")).toBe(false);
    expect(isAdminUsersPath(PLODAI_PATH)).toBe(false);
  });
});
