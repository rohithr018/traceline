import { createGraphNode } from "../../graph/models/graph-node";
import { createGraphEdge } from "../../graph/models/graph-edge";

import type { GraphNode } from "../../graph/models/graph-node";
import type { GraphEdge } from "../../graph/models/graph-edge";

import type {
	BitbucketCommit,
	BitbucketDiffStat,
	BitbucketPullRequest,
	BitbucketRepository,
} from "./bitbucket-types";

function parseTimestamp(value?: string): number {
	if (!value) {
		return Date.now();
	}

	const timestamp = Date.parse(value);

	return Number.isFinite(timestamp) ? timestamp : Date.now();
}

export function getBitbucketRepositoryNodeId(
	repository: BitbucketRepository,
): string {
	return `bitbucket:repository:${repository.uuid}`;
}

export function getBitbucketPullRequestNodeId(
	repository: BitbucketRepository,
	pullRequest: BitbucketPullRequest,
): string {
	return `bitbucket:pullrequest:${repository.uuid}:${pullRequest.id}`;
}

export function mapBitbucketRepositoryToGraphNode(
	repository: BitbucketRepository,
	tenantId: string,
	workspaceId: string,
): GraphNode {
	const now = Date.now();

	const node = createGraphNode({
		id: getBitbucketRepositoryNodeId(repository),
		tenantId,
		type: "REPOSITORY",
		source: "BITBUCKET",
		externalId: repository.uuid,
		name: repository.name,
		description: repository.description ?? undefined,
		url: repository.links?.html?.href ?? repository.html,
		attributes: {
			repositoryUuid: repository.uuid,
			repositorySlug: repository.slug,
			fullName: repository.full_name,
			workspaceId,
			isPrivate: repository.is_private,
			language: repository.language ?? null,
			mainBranch: repository.mainbranch?.name ?? null,
			updatedOn: repository.updated_on ?? null,
		},
	});

	return {
		...node,
		updatedAt: parseTimestamp(repository.updated_on),
		lastSyncedAt: now,
	};
}

export function mapBitbucketPullRequestToGraphNode(
	repository: BitbucketRepository,
	pullRequest: BitbucketPullRequest,
	commits: BitbucketCommit[],
	diffstat: BitbucketDiffStat[],
	tenantId: string,
	workspaceId: string,
): GraphNode {
	const now = Date.now();

	const changedFiles = diffstat.map((file) => ({
		status: file.status,
		path: file.new?.path ?? file.old?.path ?? null,
		oldPath: file.old?.path ?? null,
		newPath: file.new?.path ?? null,
		linesAdded: file.lines_added,
		linesRemoved: file.lines_removed,
	}));

	const node = createGraphNode({
		id: getBitbucketPullRequestNodeId(repository, pullRequest),
		tenantId,
		type: "PULL_REQUEST",
		source: "BITBUCKET",
		externalId: String(pullRequest.id),
		name: pullRequest.title,
		description: pullRequest.description,
		url: pullRequest.links?.html?.href,
		attributes: {
			pullRequestId: pullRequest.id,
			workspaceId,
			repositoryUuid: repository.uuid,
			repositorySlug: repository.slug,
			repositoryFullName: repository.full_name,

			state: pullRequest.state,
			draft: pullRequest.draft ?? false,

			author: {
				displayName: pullRequest.author?.display_name ?? null,
				uuid: pullRequest.author?.uuid ?? null,
				nickname: pullRequest.author?.nickname ?? null,
			},

			sourceBranch: pullRequest.source.branch?.name ?? null,
			destinationBranch: pullRequest.destination.branch?.name ?? null,

			sourceCommit: pullRequest.source.commit?.hash ?? null,
			destinationCommit: pullRequest.destination.commit?.hash ?? null,

			createdOn: pullRequest.created_on,
			updatedOn: pullRequest.updated_on,

			commentCount: pullRequest.comment_count ?? 0,
			taskCount: pullRequest.task_count ?? 0,

			commits: commits.map((commit) => ({
				hash: commit.hash,
				message: commit.message,
				date: commit.date,
				author: commit.author?.raw ?? null,
				authorDisplayName: commit.author?.user?.display_name ?? null,
			})),

			changedFiles,
			changedFileCount: changedFiles.length,

			linesAdded: changedFiles.reduce(
				(total, file) => total + file.linesAdded,
				0,
			),

			linesRemoved: changedFiles.reduce(
				(total, file) => total + file.linesRemoved,
				0,
			),
		},
	});

	return {
		...node,
		createdAt: parseTimestamp(pullRequest.created_on),
		updatedAt: parseTimestamp(pullRequest.updated_on),
		lastSyncedAt: now,
	};
}

export function mapRepositoryPullRequestEdge(
	repository: BitbucketRepository,
	pullRequest: BitbucketPullRequest,
	tenantId: string,
): GraphEdge {
	return createGraphEdge({
		id: `bitbucket:repository-pullrequest:${repository.uuid}:${pullRequest.id}`,
		tenantId,
		sourceNodeId: getBitbucketRepositoryNodeId(repository),
		targetNodeId: getBitbucketPullRequestNodeId(repository, pullRequest),
		type: "RELATED_TO",
		weight: 1,
		confidence: 1,
		provenance: {
			sourceSystem: "BITBUCKET",
			externalReference:
				pullRequest.links?.html?.href ??
				`${repository.full_name}/pull-requests/${pullRequest.id}`,
			evidenceText: "Pull request belongs to this repository",
		},
	});
}
