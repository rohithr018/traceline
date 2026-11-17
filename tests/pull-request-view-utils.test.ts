import assert from "node:assert/strict";
import test from "node:test";

import {
	getChangedFileMappingStatus,
	getChangedFilePath,
	getFindingCategory,
	getFindingDisplayName,
} from "../src/frontend/utils/pull-request-view-utils.js";

test("shows both sides of a renamed file", () => {
	assert.equal(
		getChangedFilePath({ oldPath: "src/old.ts", newPath: "src/new.ts" }),
		"src/old.ts → src/new.ts",
	);
});

test("falls back safely for a missing changed-file path", () => {
	assert.equal(getChangedFilePath({ status: "modified" }), "Unknown path");
	assert.equal(getChangedFilePath(null), "Unknown path");
});

test("distinguishes mapped and unmatched sides of a renamed file", () => {
	const unmatched = new Set(["src/new.ts"]);
	assert.equal(
		getChangedFileMappingStatus({ oldPath: "src/old.ts", newPath: "src/new.ts" }, unmatched),
		"Partially mapped",
	);
	assert.equal(
		getChangedFileMappingStatus({ path: "src/new.ts" }, unmatched),
		"Unmatched",
	);
	assert.equal(getChangedFileMappingStatus({}), "Unknown");
});

test("classifies direct services, downstream services, and related Jira issues", () => {
	const directService = {
		evidence: [{ depth: 1, nodes: [{ type: "PULL_REQUEST" }, { type: "SERVICE", name: "Payment" }] }],
	};
	const downstreamService = {
		evidence: [{ depth: 2, nodes: [{ type: "PULL_REQUEST" }, { type: "SERVICE" }, { type: "SERVICE", name: "Checkout" }] }],
	};
	const jiraIssue = {
		evidence: [{ depth: 2, nodes: [{ type: "PULL_REQUEST" }, { type: "SERVICE" }, { type: "ISSUE", name: "PAY-12" }] }],
	};

	assert.equal(getFindingCategory(directService), "Changed service");
	assert.equal(getFindingCategory(downstreamService), "Downstream service");
	assert.equal(getFindingCategory(jiraIssue), "Related Jira issue");
	assert.equal(getFindingDisplayName(jiraIssue), "PAY-12");
});
