import { describe, expect, it } from "vitest";

import {
  ADMIN_USERS_PATH,
  buildFarmOrderPath,
  isAdminUsersPath,
  isFarmOrderPath,
  isPlodaiPath,
  parseFarmOrderPath,
  PLODAI_PATH,
} from "../router";

describe("farm router", () => {
  it("builds and parses farm order paths", () => {
    const path = buildFarmOrderPath("farm_123", "order_456");

    expect(path).toBe("/farms/farm_123/orders/order_456");
    expect(isFarmOrderPath(path)).toBe(true);
    expect(parseFarmOrderPath(path)).toEqual({
      farmId: "farm_123",
      orderId: "order_456",
    });
  });

  it("recognizes primary shell routes", () => {
    expect(isPlodaiPath(PLODAI_PATH)).toBe(true);
    expect(isAdminUsersPath(ADMIN_USERS_PATH)).toBe(true);
    expect(isAdminUsersPath(PLODAI_PATH)).toBe(false);
  });
});
