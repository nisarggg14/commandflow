import test from "node:test";
import assert from "node:assert/strict";

import { isAdminSelfApprovalEnabled, isSelfApprovalAllowed } from "../lib/approval-policy";

test("admin self-approval is enabled by the project default and can be explicitly disabled", () => {
  const previous = process.env.ALLOW_ADMIN_SELF_APPROVAL;
  try {
    delete process.env.ALLOW_ADMIN_SELF_APPROVAL;
    assert.equal(isAdminSelfApprovalEnabled(), true);
    assert.equal(isSelfApprovalAllowed({ requesterId: "u1", approverId: "u1", approverRole: "ADMIN" }), true);

    process.env.ALLOW_ADMIN_SELF_APPROVAL = "false";
    assert.equal(isAdminSelfApprovalEnabled(), false);
    assert.equal(isSelfApprovalAllowed({ requesterId: "u1", approverId: "u1", approverRole: "ADMIN" }), false);

    process.env.ALLOW_ADMIN_SELF_APPROVAL = "true";
    assert.equal(isAdminSelfApprovalEnabled(), true);
    assert.equal(isSelfApprovalAllowed({ requesterId: "u1", approverId: "u1", approverRole: "ADMIN" }), true);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_ADMIN_SELF_APPROVAL;
    else process.env.ALLOW_ADMIN_SELF_APPROVAL = previous;
  }
});

test("self-approval policy never permits a manager", () => {
  const previous = process.env.ALLOW_ADMIN_SELF_APPROVAL;
  try {
    process.env.ALLOW_ADMIN_SELF_APPROVAL = "true";
    assert.equal(isSelfApprovalAllowed({ requesterId: "u1", approverId: "u1", approverRole: "MANAGER" }), false);
    assert.equal(isSelfApprovalAllowed({ requesterId: "u1", approverId: "u2", approverRole: "MANAGER" }), true);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_ADMIN_SELF_APPROVAL;
    else process.env.ALLOW_ADMIN_SELF_APPROVAL = previous;
  }
});
