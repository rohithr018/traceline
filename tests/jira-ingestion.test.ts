import test from "node:test";
import assert from "node:assert/strict";

import { JiraIngestionService } from "../src/integrations/jira/jira-ingestion-service";

import type { GraphNode } from "../src/graph/models/graph-node";
import type { GraphEdge } from "../src/graph/models/graph-edge";
import type { GraphRepository } from "../src/graph/repository/graph-repository";

import type {
	JiraClient,
	JiraIssue,
	JiraSearchResponse,
} from "../src/integrations/jira/jira-types";

class FakeRepository implements GraphRepository {
	nodes = new Map<string, GraphNode>();

	async upsertNode(node: GraphNode): Promise<void> {
		this.nodes.set(`${node.tenantId}:${node.id}`, node);
	}

	async upsertEdge(): Promise<void> {}

	async deleteEdge(): Promise<boolean> {
		return false;
	}

	async getNode(tenantId: string, nodeId: string): Promise<GraphNode | null> {
		return this.nodes.get(`${tenantId}:${nodeId}`) ?? null;
	}

	async getOutgoingEdges(): Promise<GraphEdge[]> {
		return [];
	}

	async getIncomingEdges(): Promise<GraphEdge[]> {
		return [];
	}

	async listNodes(tenantId: string): Promise<GraphNode[]> {
		return [...this.nodes.values()].filter(
			(node) => node.tenantId === tenantId,
		);
	}

	async listEdges(): Promise<GraphEdge[]> {
		return [];
	}
}

class FakeJiraClient implements JiraClient {
	calls = 0;

	async searchIssues(
		_jql: string,
		nextPageToken?: string,
	): Promise<JiraSearchResponse> {
		this.calls++;

		if (!nextPageToken) {
			return {
				issues: [createIssue("10001", "DEMO-1")],
				nextPageToken: "page-2",
			};
		}

		return {
			issues: [createIssue("10002", "DEMO-2")],
			isLast: true,
		};
	}
}

function createIssue(id: string, key: string): JiraIssue {
	return {
		id,
		key,
		self: `https://example.atlassian.net/rest/api/3/issue/${id}`,
		fields: {
			summary: `Test issue ${key}`,
			description: {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "text",
								text: "Test description",
							},
						],
					},
				],
			},
			created: "2026-01-01T10:00:00.000Z",
			updated: "2026-01-02T10:00:00.000Z",
			project: {
				id: "10000",
				key: "DEMO",
				name: "Demo Project",
			},
			issuetype: {
				id: "10001",
				name: "Task",
			},
			status: {
				id: "3",
				name: "In Progress",
			},
			priority: {
				id: "2",
				name: "High",
			},
			assignee: null,
			labels: ["backend"],
		},
	};
}

test("Jira ingestion imports and persists paginated issues", async () => {
	const repository = new FakeRepository();
	const client = new FakeJiraClient();

	const service = new JiraIngestionService(repository, client);

	const result = await service.ingestProject({
		tenantId: "test-tenant",
		projectKey: "DEMO",
	});

	assert.equal(result.fetchedIssues, 2);
	assert.equal(result.persistedNodes, 2);
	assert.equal(client.calls, 2);

	const nodes = await repository.listNodes("test-tenant");

	assert.equal(nodes.length, 2);

	const first = await repository.getNode("test-tenant", "jira:issue:10001");

	assert.ok(first);
	assert.equal(first.type, "ISSUE");
	assert.equal(first.source, "JIRA");
	assert.equal(first.externalId, "DEMO-1");
	assert.equal(first.name, "Test issue DEMO-1");
	assert.equal(first.description, "Test description");
});

test("Jira ingestion rejects invalid project keys", async () => {
	const service = new JiraIngestionService(
		new FakeRepository(),
		new FakeJiraClient(),
	);

	await assert.rejects(
		service.ingestProject({
			tenantId: "test-tenant",
			projectKey: 'DEMO" OR 1=1',
		}),
		/Invalid Jira project key/,
	);
});
