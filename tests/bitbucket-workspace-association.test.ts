import assert from "node:assert/strict";
import test from "node:test";

import { createGraphNode } from "../src/graph/models/graph-node";
import { InMemoryGraphRepository } from "../src/graph/repository/in-memory-graph-repository";
import { resolvePullRequestWorkspaceAssociation } from "../src/integrations/bitbucket/bitbucket-workspace-association";

const TENANT_ID = "tenant-1";
const WORKSPACE_UUID = "{8ba415db-861f-4575-b92b-8d057b404599}";
const REPOSITORY_UUID = "{2dfaf678-ad2b-414a-b699-35c9a17b3d68}";

function createPullRequest(attributes: Record<string, unknown> = {}) {
	return createGraphNode({
		id: `bitbucket:pullrequest:${REPOSITORY_UUID}:6`,
		tenantId: TENANT_ID,
		type: "PULL_REQUEST",
		source: "BITBUCKET",
		name: "SCRUM-6 Example",
		attributes: {
			repositoryUuid: REPOSITORY_UUID,
			...attributes,
		},
	});
}

function createRepository(workspaceId = WORKSPACE_UUID) {
	return createGraphNode({
		id: `bitbucket:repository:${REPOSITORY_UUID}`,
		tenantId: TENANT_ID,
		type: "REPOSITORY",
		source: "BITBUCKET",
		externalId: REPOSITORY_UUID,
		name: "traceline-bitbucket",
		attributes: {
			repositoryUuid: REPOSITORY_UUID,
			workspaceId,
		},
	});
}

test("prefers a normalized workspace recorded directly on the pull request", async () => {
	const repository = new InMemoryGraphRepository();
	const pullRequest = createPullRequest({
		workspaceId: "8BA415DB-861F-4575-B92B-8D057B404599",
	});

	const association = await resolvePullRequestWorkspaceAssociation(
		repository,
		TENANT_ID,
		pullRequest,
	);

	assert.deepEqual(association, {
		workspaceUuid: WORKSPACE_UUID,
		source: "PULL_REQUEST",
	});
});

test("repairs a legacy pull request from its same-tenant Bitbucket repository", async () => {
	const repository = new InMemoryGraphRepository();
	const pullRequest = createPullRequest();
	await repository.upsertNode(createRepository());

	const association = await resolvePullRequestWorkspaceAssociation(
		repository,
		TENANT_ID,
		pullRequest,
	);

	assert.deepEqual(association, {
		workspaceUuid: WORKSPACE_UUID,
		source: "REPOSITORY",
	});
});

test("does not infer a workspace when the trusted repository record is absent or malformed", async () => {
	const repository = new InMemoryGraphRepository();
	const pullRequest = createPullRequest();

	assert.equal(
		await resolvePullRequestWorkspaceAssociation(repository, TENANT_ID, pullRequest),
		null,
	);

	await repository.upsertNode(createRepository("not-a-workspace"));
	assert.equal(
		await resolvePullRequestWorkspaceAssociation(repository, TENANT_ID, pullRequest),
		null,
	);
});
