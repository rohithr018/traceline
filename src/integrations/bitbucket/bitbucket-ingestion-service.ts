import type { GraphRepository } from "../../graph/repository/graph-repository";

import { ForgeBitbucketClient } from "./forge-bitbucket-client";

import {
	mapBitbucketRepositoryToGraphNode,
	mapBitbucketPullRequestToGraphNode,
	mapRepositoryPullRequestEdge,
} from "./bitbucket-mapper";

import type { BitbucketClient, BitbucketRepository } from "./bitbucket-types";

export interface BitbucketIngestionInput {
	tenantId: string;
	workspaceId: string;
}

export interface BitbucketIngestionResult {
	workspaceId: string;
	fetchedRepositories: number;
	fetchedPullRequests: number;
	fetchedCommits: number;
	fetchedChangedFiles: number;
	persistedNodes: number;
	persistedEdges: number;
}

export class BitbucketIngestionService {
	constructor(
		private readonly repository: GraphRepository,
		private readonly client: BitbucketClient = new ForgeBitbucketClient(),
	) {}

	async ingestWorkspace(
		input: BitbucketIngestionInput,
	): Promise<BitbucketIngestionResult> {
		const { tenantId, workspaceId } = input;

		if (!tenantId.trim()) {
			throw new Error("Tenant ID is required");
		}

		if (!workspaceId.trim()) {
			throw new Error("Bitbucket workspace ID is required");
		}

		const repositories = await this.client.listRepositories(workspaceId);

		let fetchedPullRequests = 0;
		let fetchedCommits = 0;
		let fetchedChangedFiles = 0;
		let persistedNodes = 0;
		let persistedEdges = 0;

		for (const bitbucketRepository of repositories) {
			await this.ingestRepository(bitbucketRepository, tenantId, workspaceId);

			persistedNodes++;

			const pullRequests = await this.client.listPullRequests(
				workspaceId,
				bitbucketRepository.slug,
			);

			for (const pullRequest of pullRequests) {
				const [commits, diffstat] = await Promise.all([
					this.client.listPullRequestCommits(
						workspaceId,
						bitbucketRepository.slug,
						pullRequest.id,
					),

					this.client.listPullRequestDiffStat(
						workspaceId,
						bitbucketRepository.slug,
						pullRequest.id,
					),
				]);

				const pullRequestNode = mapBitbucketPullRequestToGraphNode(
					bitbucketRepository,
					pullRequest,
					commits,
					diffstat,
					tenantId,
					workspaceId,
				);

				await this.repository.upsertNode(pullRequestNode);

				const edge = mapRepositoryPullRequestEdge(
					bitbucketRepository,
					pullRequest,
					tenantId,
				);

				await this.repository.upsertEdge(edge);

				fetchedPullRequests++;
				fetchedCommits += commits.length;
				fetchedChangedFiles += diffstat.length;

				persistedNodes++;
				persistedEdges++;
			}
		}

		return {
			workspaceId,
			fetchedRepositories: repositories.length,
			fetchedPullRequests,
			fetchedCommits,
			fetchedChangedFiles,
			persistedNodes,
			persistedEdges,
		};
	}

	private async ingestRepository(
		bitbucketRepository: BitbucketRepository,
		tenantId: string,
		workspaceId: string,
	): Promise<void> {
		const node = mapBitbucketRepositoryToGraphNode(
			bitbucketRepository,
			tenantId,
			workspaceId,
		);

		await this.repository.upsertNode(node);
	}
}
