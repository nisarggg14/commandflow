import assert from "node:assert/strict";
import test from "node:test";
import { ZodError } from "zod";

import { getRegistrationErrorResponse } from "../app/api/auth/register/route";

test("registration validation and conflicts keep safe client-facing responses", () => {
  assert.deepEqual(getRegistrationErrorResponse(new ZodError([])), {
    status: 400,
    message: "Invalid registration request.",
  });
  assert.deepEqual(getRegistrationErrorResponse(new Error("An account with this email already exists.")), {
    status: 409,
    message: "An account with this email already exists.",
  });
});

test("unexpected registration failures do not expose infrastructure details", () => {
  const result = getRegistrationErrorResponse(new Error("Prisma failed to connect to postgresql://private.example"));

  assert.equal(result.status, 500);
  assert.equal(result.message, "Registration failed. Please try again later.");
  assert.equal(result.message.includes("private.example"), false);
});
