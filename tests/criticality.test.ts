import test from "node:test";
import assert from "node:assert/strict";

import type { GraphNode } from "../src/graph/models/graph-node";
import {
	CRITICALITY_SCORES,
	getNodeCriticality,
} from "../src/risk/models/criticality";
import {
	CriticalityValidationError,
	validateCriticalityTarget,
	validateCriticalityUpdateRequest,
} from "../src/risk/validation/criticality-validator";

function createNode(
	type = "ISSUE",
	tenantId = "tenant-1",
	attributes: Record<string, unknown> = {},
): GraphNode {
	return {
		id: "jira:issue:10005",
		tenantId,
		type,
		source: "JIRA",
		externalId: "10005",
		attributes,
	} as GraphNode;
}

test("accepts a valid criticality update request", () => {
	const result = validateCriticalityUpdateRequest({
		nodeId: " jira:issue:10005 ",
		criticality: "HIGH",
	});

	assert.deepEqual(result, {
		nodeId: "jira:issue:10005",
		criticality: "HIGH",
	});
});

test("rejects an empty node ID", () => {
	assert.throws(
		() =>
			validateCriticalityUpdateRequest({
				nodeId: " ",
				criticality: "HIGH",
			}),
		CriticalityValidationError,
	);
});

test("rejects an invalid criticality value", () => {
	assert.throws(
		() =>
			validateCriticalityUpdateRequest({
				nodeId: "jira:issue:10005",
				criticality: "URGENT",
			}),
		CriticalityValidationError,
	);
});

test("rejects a non-object request", () => {
	assert.throws(
		() => validateCriticalityUpdateRequest(null),
		CriticalityValidationError,
	);
});

test("accepts an eligible node belonging to the tenant", () => {
	assert.doesNotThrow(() =>
		validateCriticalityTarget(createNode(), "tenant-1"),
	);
});

test("rejects a node belonging to another tenant", () => {
	assert.throws(
		() => validateCriticalityTarget(createNode(), "tenant-2"),
		CriticalityValidationError,
	);
});

test("rejects an unsupported node type", () => {
	assert.throws(
		() => validateCriticalityTarget(createNode("DOCUMENT"), "tenant-1"),
		CriticalityValidationError,
	);
});

test("rejects an empty tenant ID", () => {
	assert.throws(
		() => validateCriticalityTarget(createNode(), " "),
		CriticalityValidationError,
	);
});

test("returns UNKNOWN when criticality metadata is missing", () => {
	assert.equal(getNodeCriticality(createNode()), "UNKNOWN");
});

test("returns configured criticality from node attributes", () => {
	const node = createNode("ISSUE", "tenant-1", {
		criticality: "CRITICAL",
	});

	assert.equal(getNodeCriticality(node), "CRITICAL");
});

test("falls back to UNKNOWN for unrecognized stored metadata", () => {
	const node = createNode("ISSUE", "tenant-1", {
		criticality: "URGENT",
	});

	assert.equal(getNodeCriticality(node), "UNKNOWN");
});

test("uses the agreed criticality score mapping", () => {
	assert.deepEqual(CRITICALITY_SCORES, {
		UNKNOWN: 50,
		LOW: 25,
		MEDIUM: 50,
		HIGH: 75,
		CRITICAL: 100,
	});
});
