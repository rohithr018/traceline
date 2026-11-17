import assert from "node:assert/strict";
import test from "node:test";

import { createGraphNode } from "../src/graph/models/graph-node";
import { countIndexedJiraIssues } from "../src/integrations/jira/jira-readiness";

function issue(id: string, tenantId: string, projectKey: string, placeholder = false) {
	return createGraphNode({
		id,
		tenantId,
		type: "ISSUE",
		source: "JIRA",
		name: id,
		attributes: { projectKey, placeholder },
	});
}

test("counts only real Jira issues in the requested tenant and project", () => {
	const nodes = [
		issue("jira:1", "tenant-a", "PAY"),
		issue("jira:2", "tenant-a", "PAY", true),
		issue("jira:3", "tenant-a", "OPS"),
		issue("jira:4", "tenant-b", "PAY"),
		createGraphNode({
			id: "service:pay",
			tenantId: "tenant-a",
			type: "SERVICE",
			source: "USER",
			name: "Payments",
			attributes: { projectKey: "PAY" },
		}),
	];

	assert.equal(countIndexedJiraIssues(nodes, "tenant-a", "PAY"), 1);
});
