import assert from "node:assert/strict";
import test from "node:test";

import { buildImpactAnalysisRequest } from "../src/impact/api/impact-api-contract";

test("uses the Forge installation tenant instead of payload tenantId", () => {
	const request = buildImpactAnalysisRequest(
		{
			tenantId: "attacker-controlled-tenant",
			sourceNodeId: "jira:issue:10001",
		},
		"trusted-cloud-id",
	);

	assert.equal(request.tenantId, "trusted-cloud-id");
});

test("requires a source node ID", () => {
	assert.throws(
		() => buildImpactAnalysisRequest({}, "trusted-cloud-id"),
		/sourceNodeId is required/,
	);
});

test("rejects excessive traversal depth", () => {
	assert.throws(
		() =>
			buildImpactAnalysisRequest(
				{
					sourceNodeId: "jira:issue:10001",
					maxDepth: 9,
				},
				"trusted-cloud-id",
			),
		/maxDepth must be a number no greater than 8/,
	);
});

test("rejects excessive visited node limits", () => {
	assert.throws(
		() =>
			buildImpactAnalysisRequest(
				{
					sourceNodeId: "jira:issue:10001",
					maxVisitedNodes: 501,
				},
				"trusted-cloud-id",
			),
		/maxVisitedNodes must be a number no greater than 500/,
	);
});

test("rejects excessive alternate paths", () => {
	assert.throws(
		() =>
			buildImpactAnalysisRequest(
				{
					sourceNodeId: "jira:issue:10001",
					maxPathsPerNode: 6,
				},
				"trusted-cloud-id",
			),
		/maxPathsPerNode must be a number no greater than 5/,
	);
});

test("rejects malformed payloads", () => {
	assert.throws(
		() => buildImpactAnalysisRequest(null, "trusted-cloud-id"),
		/Request payload must be an object/,
	);
});

test("rejects missing installation tenant", () => {
	assert.throws(
		() => buildImpactAnalysisRequest({ sourceNodeId: "jira:issue:10001" }, ""),
		/valid installation context is required/,
	);
});
