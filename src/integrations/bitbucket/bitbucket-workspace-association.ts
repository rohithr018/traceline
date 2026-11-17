import type { GraphNode } from "../../graph/models/graph-node";
import type { GraphRepository } from "../../graph/repository/graph-repository";

import { normalizeBitbucketWorkspaceUuid } from "./bitbucket-bridge-store";

export interface PullRequestWorkspaceAssociation {
	workspaceUuid: string;
	source: "PULL_REQUEST" | "REPOSITORY";
}

function readWorkspaceUuid(node: GraphNode): string | null {
	const candidate = node.attributes.workspaceId;

	if (typeof candidate !== "string") {
		return null;
	}

	try {
		return normalizeBitbucketWorkspaceUuid(candidate);
	} catch {
		return null;
	}
}

/**
 * Resolves a PR workspace only from graph records already isolated to this
 * tenant. The repository fallback repairs PRs created before the bridge began
 * writing workspaceId to PR attributes; it never trusts browser input.
 */
export async function resolvePullRequestWorkspaceAssociation(
	repository: GraphRepository,
	tenantId: string,
	pullRequest: GraphNode,
): Promise<PullRequestWorkspaceAssociation | null> {
	const pullRequestWorkspaceUuid = readWorkspaceUuid(pullRequest);

	if (pullRequestWorkspaceUuid) {
		return {
			workspaceUuid: pullRequestWorkspaceUuid,
			source: "PULL_REQUEST",
		};
	}

	const repositoryUuid = pullRequest.attributes.repositoryUuid;

	if (typeof repositoryUuid !== "string" || !repositoryUuid.trim()) {
		return null;
	}

	const repositoryNode = await repository.getNode(
		tenantId,
		`bitbucket:repository:${repositoryUuid}`,
	);

	if (
		!repositoryNode ||
		repositoryNode.type !== "REPOSITORY" ||
		repositoryNode.source !== "BITBUCKET" ||
		(repositoryNode.attributes.repositoryUuid !== repositoryUuid &&
			repositoryNode.externalId !== repositoryUuid)
	) {
		return null;
	}

	const repositoryWorkspaceUuid = readWorkspaceUuid(repositoryNode);

	return repositoryWorkspaceUuid
		? {
				workspaceUuid: repositoryWorkspaceUuid,
				source: "REPOSITORY",
			}
		: null;
}
