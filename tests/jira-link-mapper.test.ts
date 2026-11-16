import test from "node:test";
import assert from "node:assert/strict";

import { mapJiraIssueLinksToGraphEdges } from "../src/integrations/jira/jira-link-mapper";
import type { JiraIssue } from "../src/integrations/jira/jira-types";

function createIssue(
	issuelinks: NonNullable<JiraIssue["fields"]["issuelinks"]>,
): JiraIssue {
	return {
		id: "100",
		key: "DEMO-1",
		self: "https://example.atlassian.net/rest/api/3/issue/100",
		fields: {
			summary: "Current issue",
			created: "2026-01-01T10:00:00.000Z",
			updated: "2026-01-02T10:00:00.000Z",
			project: {
				id: "10",
				key: "DEMO",
				name: "Demo",
			},
			issuetype: {
				id: "1",
				name: "Task",
			},
			status: {
				id: "3",
				name: "In Progress",
			},
			issuelinks,
		},
	};
}

test("maps outward blocks link from current issue to linked issue", () => {
	const issue = createIssue([
		{
			id: "500",
			type: {
				id: "1",
				name: "Blocks",
				inward: "is blocked by",
				outward: "blocks",
			},
			outwardIssue: {
				id: "200",
				key: "DEMO-2",
				self: "https://example.atlassian.net/rest/api/3/issue/200",
			},
		},
	]);

	const edges = mapJiraIssueLinksToGraphEdges(issue, "tenant-1");

	assert.equal(edges.length, 1);
	assert.equal(edges[0].type, "BLOCKS");
	assert.equal(edges[0].sourceNodeId, "jira:issue:100");
	assert.equal(edges[0].targetNodeId, "jira:issue:200");
	assert.equal(edges[0].id, "jira:issue-link:500");
});

test("reverses direction for inward blocked-by link", () => {
	const issue = createIssue([
		{
			id: "501",
			type: {
				id: "1",
				name: "Blocks",
				inward: "is blocked by",
				outward: "blocks",
			},
			inwardIssue: {
				id: "200",
				key: "DEMO-2",
				self: "https://example.atlassian.net/rest/api/3/issue/200",
			},
		},
	]);

	const edges = mapJiraIssueLinksToGraphEdges(issue, "tenant-1");

	assert.equal(edges.length, 1);
	assert.equal(edges[0].type, "BLOCKS");
	assert.equal(edges[0].sourceNodeId, "jira:issue:200");
	assert.equal(edges[0].targetNodeId, "jira:issue:100");
});

test("maps depends-on relationship in the correct direction", () => {
	const issue = createIssue([
		{
			id: "502",
			type: {
				id: "2",
				name: "Dependency",
				inward: "is depended on by",
				outward: "depends on",
			},
			outwardIssue: {
				id: "300",
				key: "DEMO-3",
				self: "https://example.atlassian.net/rest/api/3/issue/300",
			},
		},
	]);

	const edges = mapJiraIssueLinksToGraphEdges(issue, "tenant-1");

	assert.equal(edges.length, 1);
	assert.equal(edges[0].type, "DEPENDS_ON");
	assert.equal(edges[0].sourceNodeId, "jira:issue:100");
	assert.equal(edges[0].targetNodeId, "jira:issue:300");
});

test("creates a stable canonical direction for related-to links", () => {
	const issue = createIssue([
		{
			id: "503",
			type: {
				id: "3",
				name: "Relates",
				inward: "is related to",
				outward: "relates to",
			},
			inwardIssue: {
				id: "200",
				key: "DEMO-2",
				self: "https://example.atlassian.net/rest/api/3/issue/200",
			},
		},
	]);

	const edges = mapJiraIssueLinksToGraphEdges(issue, "tenant-1");

	assert.equal(edges.length, 1);
	assert.equal(edges[0].type, "RELATED_TO");
	assert.equal(edges[0].sourceNodeId, "jira:issue:100");
	assert.equal(edges[0].targetNodeId, "jira:issue:200");
});

test("ignores unsupported Jira link labels", () => {
	const issue = createIssue([
		{
			id: "504",
			type: {
				id: "4",
				name: "Custom",
				inward: "is reviewed by",
				outward: "reviews",
			},
			outwardIssue: {
				id: "400",
				key: "DEMO-4",
				self: "https://example.atlassian.net/rest/api/3/issue/400",
			},
		},
	]);

	const edges = mapJiraIssueLinksToGraphEdges(issue, "tenant-1");

	assert.equal(edges.length, 0);
});

test("preserves Jira provenance on mapped edges", () => {
	const issue = createIssue([
		{
			id: "505",
			type: {
				id: "1",
				name: "Blocks",
				inward: "is blocked by",
				outward: "blocks",
			},
			outwardIssue: {
				id: "200",
				key: "DEMO-2",
				self: "https://example.atlassian.net/rest/api/3/issue/200",
			},
		},
	]);

	const edges = mapJiraIssueLinksToGraphEdges(issue, "tenant-1");

	assert.equal(edges[0].tenantId, "tenant-1");
	assert.equal(edges[0].provenance.sourceSystem, "JIRA");
	assert.equal(edges[0].provenance.externalReference, "505");
});
