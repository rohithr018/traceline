import type { GraphNode } from "../../graph/models/graph-node";
import type { GraphRepository } from "../../graph/repository/graph-repository";

import type { ImpactAnalysisRequest } from "../../impact/models/impact-analysis";
import type { EdgeType } from "../../graph/models/graph-edge";

import { BitbucketChangeLinker } from "./bitbucket-change-linker";
import { BitbucketJiraLinker } from "./bitbucket-jira-linker";

export interface BitbucketImpactAnalysisRunner<TResult> {
	analyze(request: ImpactAnalysisRequest): Promise<TResult>;
}

export interface BitbucketChangeImpactInput {
	tenantId: string;
	pullRequestNodeId: string;
	maxDepth?: number;
	maxVisitedNodes?: number;
	maxPathsPerNode?: number;
	minConfidence?: number;
	propagationTypes?: EdgeType[];
	reverseDependencyEdges?: boolean;
}

export interface BitbucketChangeImpactResult<TResult> {
	pullRequest: {
		id: string;
		name: string;
		url?: string;
	};
	mapping: {
		changedFiles: number;
		matchedFiles: number;
		unmatchedFiles: Array<{
			pullRequestNodeId: string;
			filePath: string;
		}>;
		matchedServices: number;
		persistedEdges: number;
		linkedJiraReferences: number;
		unresolvedJiraReferences: number;
	};
	analysis: TResult;
}

export class BitbucketChangeImpactService<TResult> {
	private readonly linker: BitbucketChangeLinker;
	private readonly jiraLinker: BitbucketJiraLinker;

	constructor(
		private readonly repository: GraphRepository,
		private readonly analysisService: BitbucketImpactAnalysisRunner<TResult>,
	) {
		this.linker = new BitbucketChangeLinker(repository);
		this.jiraLinker = new BitbucketJiraLinker(repository);
	}

	async analyzePullRequest(
		input: BitbucketChangeImpactInput,
	): Promise<BitbucketChangeImpactResult<TResult>> {
		const { tenantId, pullRequestNodeId } = input;

		if (!tenantId.trim()) {
			throw new Error("Tenant ID is required.");
		}

		if (!pullRequestNodeId.trim()) {
			throw new Error("Pull request node ID is required.");
		}

		const pullRequest = await this.repository.getNode(
			tenantId,
			pullRequestNodeId,
		);

		if (!pullRequest) {
			throw new Error("Pull request was not found.");
		}

		this.validatePullRequest(pullRequest);

		const mapping = await this.linker.linkPullRequestsToServices(
			tenantId,
			pullRequestNodeId,
		);
		const jiraLinks = await this.jiraLinker.linkPullRequestsToJira(
			tenantId,
			pullRequestNodeId,
		);

		const request: ImpactAnalysisRequest = {
			tenantId,
			sourceNodeId: pullRequest.id,
			...(input.maxDepth !== undefined ? { maxDepth: input.maxDepth } : {}),
			...(input.maxVisitedNodes !== undefined
				? { maxVisitedNodes: input.maxVisitedNodes }
				: {}),
			...(input.maxPathsPerNode !== undefined
				? { maxPathsPerNode: input.maxPathsPerNode }
				: {}),
			...(input.minConfidence !== undefined
				? { minConfidence: input.minConfidence }
				: {}),
			...(input.propagationTypes !== undefined
				? { propagationTypes: input.propagationTypes }
				: {}),
			...(input.reverseDependencyEdges !== undefined
				? { reverseDependencyEdges: input.reverseDependencyEdges }
				: {}),
		};

		const analysis = await this.analysisService.analyze(request);

		return {
			pullRequest: {
				id: pullRequest.id,
				name: pullRequest.name,
				...(pullRequest.url ? { url: pullRequest.url } : {}),
			},
			mapping: {
				changedFiles: mapping.changedFiles,
				matchedFiles: mapping.matchedFiles,
				unmatchedFiles: mapping.unmatchedFiles,
				matchedServices: mapping.matchedServices,
				persistedEdges: mapping.persistedEdges,
				linkedJiraReferences: jiraLinks.resolvedReferences,
				unresolvedJiraReferences: jiraLinks.unresolvedReferences.length,
			},
			analysis,
		};
	}

	private validatePullRequest(node: GraphNode): void {
		if (node.type !== "PULL_REQUEST" || node.source !== "BITBUCKET") {
			throw new Error(
				"Change impact analysis requires a Bitbucket pull request.",
			);
		}
	}
}
