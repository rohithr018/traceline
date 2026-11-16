import test from "node:test";
import assert from "node:assert/strict";

import { ConfluenceIngestionService } from "../src/integrations/confluence/confluence-ingestion-service";
import type {
	ConfluenceClient,
	ConfluencePage,
	ConfluencePageSearchResponse,
} from "../src/integrations/confluence/confluence-types";
import type { GraphNode } from "../src/graph/models/graph-node";
import type { GraphEdge } from "../src/graph/models/graph-edge";
import type { GraphRepository } from "../src/graph/repository/graph-repository";

class FakeRepository implements GraphRepository {
	nodes = new Map<string, GraphNode>();

	async upsertNode(node: GraphNode): Promise<void> {
		this.nodes.set(node.id, node);
	}

	async upsertEdge(_edge: GraphEdge): Promise<void> {}

	async getNode(id: string, tenantId: string): Promise<GraphNode | null> {
		const node = this.nodes.get(id);

		return node?.tenantId === tenantId ? node : null;
	}

	async getOutgoingEdges(
		_nodeId: string,
		_tenantId: string,
	): Promise<GraphEdge[]> {
		return [];
	}

	async getIncomingEdges(
		_nodeId: string,
		_tenantId: string,
	): Promise<GraphEdge[]> {
		return [];
	}

	async listNodes(_tenantId: string): Promise<GraphNode[]> {
		return [...this.nodes.values()];
	}

	async listEdges(_tenantId: string): Promise<GraphEdge[]> {
		return [];
	}
}

class FakeConfluenceClient implements ConfluenceClient {
	calls: Array<string | undefined> = [];

	async listPages(
		_spaceId: string,
		cursor?: string,
	): Promise<ConfluencePageSearchResponse> {
		this.calls.push(cursor);

		if (!cursor) {
			return {
				results: [this.createPage("101", "Architecture")],
				_links: {
					base: "https://example.atlassian.net/wiki",
					next: "/wiki/api/v2/spaces/10/pages?cursor=next-page",
				},
			};
		}

		return {
			results: [this.createPage("102", "Engineering Decisions")],
		};
	}

	private createPage(id: string, title: string): ConfluencePage {
		return {
			id,
			status: "current",
			title,
			spaceId: "10",
			createdAt: "2026-01-01T10:00:00.000Z",
			version: {
				number: 1,
				createdAt: "2026-01-02T10:00:00.000Z",
			},
			body: {
				storage: {
					value: `<p>${title} content</p>`,
					representation: "storage",
				},
			},
		};
	}
}

test("imports and persists paginated Confluence pages", async () => {
	const repository = new FakeRepository();
	const client = new FakeConfluenceClient();

	const service = new ConfluenceIngestionService(repository, client);

	const result = await service.ingestSpace({
		tenantId: "tenant-1",
		spaceId: "10",
	});

	assert.equal(result.fetchedPages, 2);
	assert.equal(result.persistedNodes, 2);
	assert.equal(repository.nodes.size, 2);

	assert.deepEqual(client.calls, [undefined, "next-page"]);

	const architecture = repository.nodes.get("confluence:page:101");

	assert.equal(architecture?.name, "Architecture");
	assert.equal(architecture?.type, "DOCUMENT");
	assert.equal(architecture?.source, "CONFLUENCE");
});

test("rejects invalid Confluence space IDs", async () => {
	const service = new ConfluenceIngestionService(
		new FakeRepository(),
		new FakeConfluenceClient(),
	);

	await assert.rejects(
		() =>
			service.ingestSpace({
				tenantId: "tenant-1",
				spaceId: "invalid",
			}),
		/Invalid Confluence space ID/,
	);
});

test("rejects invalid page limits", async () => {
	const service = new ConfluenceIngestionService(
		new FakeRepository(),
		new FakeConfluenceClient(),
	);

	await assert.rejects(
		() =>
			service.ingestSpace({
				tenantId: "tenant-1",
				spaceId: "10",
				maxPages: 0,
			}),
		/maxPages must be a positive integer/,
	);
});
