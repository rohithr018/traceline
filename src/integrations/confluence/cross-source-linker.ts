import { createGraphEdge } from "../../graph/models/graph-edge";
import type { GraphEdge } from "../../graph/models/graph-edge";
import type { GraphNode } from "../../graph/models/graph-node";
import type { GraphRepository } from "../../graph/repository/graph-repository";
import { extractJiraIssueKeys } from "./jira-reference-extractor";

export interface CrossSourceLinkResult {
	documentId: string;
	extractedReferences: number;
	resolvedReferences: number;
	unresolvedReferences: string[];
	createdEdges: number;
}

function getDocumentContent(document: GraphNode): string {
	const storageBody = document.attributes.storageBody;

	return [
		document.name,
		document.description ?? "",
		typeof storageBody === "string" ? storageBody : "",
	].join("\n");
}

function getJiraIssueKey(node: GraphNode): string | undefined {
	if (node.type !== "ISSUE" || node.source !== "JIRA") {
		return undefined;
	}

	const attributeKey = node.attributes.issueKey;

	const key = typeof attributeKey === "string" ? attributeKey : node.externalId;

	if (typeof key !== "string" || !key.trim()) {
		return undefined;
	}

	return key.toUpperCase();
}

function createDocumentedByEdge(
	issue: GraphNode,
	document: GraphNode,
	issueKey: string,
): GraphEdge {
	return createGraphEdge({
		id: `cross-source:jira-document:${issue.id}:${document.id}`,
		tenantId: document.tenantId,
		sourceNodeId: issue.id,
		targetNodeId: document.id,
		type: "DOCUMENTED_BY",
		weight: 1,
		confidence: 1,
		provenance: {
			sourceSystem: "CONFLUENCE",
			externalReference: document.externalId ?? document.id,
			evidenceText: `Confluence document references Jira issue ${issueKey}`,
		},
	});
}

export class CrossSourceLinker {
	constructor(private readonly repository: GraphRepository) {}

	async linkDocumentToJiraIssues(
		document: GraphNode,
	): Promise<CrossSourceLinkResult> {
		if (document.type !== "DOCUMENT") {
			throw new Error("Cross-source linking requires a DOCUMENT node");
		}

		if (document.source !== "CONFLUENCE") {
			throw new Error("Document must originate from Confluence");
		}

		if (!document.tenantId.trim()) {
			throw new Error("Tenant ID is required");
		}

		const content = getDocumentContent(document);
		const issueKeys = extractJiraIssueKeys(content);

		const nodes = await this.repository.listNodes(document.tenantId);

		const jiraIssuesByKey = new Map<string, GraphNode>();

		for (const node of nodes) {
			const issueKey = getJiraIssueKey(node);

			if (issueKey && !jiraIssuesByKey.has(issueKey)) {
				jiraIssuesByKey.set(issueKey, node);
			}
		}

		const unresolvedReferences: string[] = [];
		let resolvedReferences = 0;
		let createdEdges = 0;

		for (const issueKey of issueKeys) {
			const issue = jiraIssuesByKey.get(issueKey);

			if (!issue) {
				unresolvedReferences.push(issueKey);
				continue;
			}

			resolvedReferences++;

			const edge = createDocumentedByEdge(issue, document, issueKey);

			await this.repository.upsertEdge(edge);
			createdEdges++;
		}

		return {
			documentId: document.id,
			extractedReferences: issueKeys.length,
			resolvedReferences,
			unresolvedReferences,
			createdEdges,
		};
	}

	async linkAllDocuments(tenantId: string): Promise<CrossSourceLinkResult[]> {
		if (!tenantId.trim()) {
			throw new Error("Tenant ID is required");
		}

		const nodes = await this.repository.listNodes(tenantId);

		const documents = nodes.filter(
			(node) =>
				node.type === "DOCUMENT" &&
				node.source === "CONFLUENCE" &&
				node.tenantId === tenantId,
		);

		const results: CrossSourceLinkResult[] = [];

		for (const document of documents) {
			const result = await this.linkDocumentToJiraIssues(document);
			results.push(result);
		}

		return results;
	}
}
