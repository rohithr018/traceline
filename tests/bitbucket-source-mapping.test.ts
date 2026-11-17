import test from "node:test";
import assert from "node:assert/strict";

import type { GraphNode } from "../src/graph/models/graph-node";

import {
	getBitbucketSourceMappings,
	mapBitbucketFileToServices,
} from "../src/integrations/bitbucket/bitbucket-source-mapping";

function createService(
	id: string,
	name: string,
	mappings?: unknown,
): GraphNode {
	return {
		id,
		tenantId: "tenant-1",
		type: "SERVICE",
		source: "USER",
		name,
		attributes:
			mappings === undefined ? {} : { bitbucketSourceMappings: mappings },
		createdAt: 1,
		updatedAt: 1,
		lastSyncedAt: 1,
	};
}

test("returns no mappings when a service has no mapping metadata", () => {
	const service = createService("service-1", "Payment");

	assert.deepEqual(getBitbucketSourceMappings(service), []);
});

test("normalizes configured path prefixes", () => {
	const service = createService("service-1", "Payment", [
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "./src/payment/",
		},
	]);

	assert.deepEqual(getBitbucketSourceMappings(service), [
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/payment",
		},
	]);
});

test("matches a changed file against its configured service", () => {
	const service = createService("service-1", "Payment", [
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/payment/",
		},
	]);

	const matches = mapBitbucketFileToServices(
		"{repo-1}",
		"src/payment/transaction.ts",
		[service],
	);

	assert.equal(matches.length, 1);
	assert.equal(matches[0].serviceNodeId, "service-1");
	assert.equal(matches[0].serviceName, "Payment");
	assert.equal(matches[0].filePath, "src/payment/transaction.ts");
});

test("does not match a similar but different directory name", () => {
	const service = createService("service-1", "Payment", [
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/payment/",
		},
	]);

	const matches = mapBitbucketFileToServices(
		"{repo-1}",
		"src/payments/transaction.ts",
		[service],
	);

	assert.deepEqual(matches, []);
});

test("does not match mappings from another repository", () => {
	const service = createService("service-1", "Payment", [
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/payment/",
		},
	]);

	const matches = mapBitbucketFileToServices(
		"{repo-2}",
		"src/payment/transaction.ts",
		[service],
	);

	assert.deepEqual(matches, []);
});

test("supports explicit mappings to multiple services", () => {
	const payment = createService("service-1", "Payment", [
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/shared/",
		},
	]);

	const billing = createService("service-2", "Billing", [
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/shared/",
		},
	]);

	const matches = mapBitbucketFileToServices(
		"{repo-1}",
		"src/shared/client.ts",
		[payment, billing],
	);

	assert.deepEqual(
		matches.map((match) => match.serviceNodeId),
		["service-1", "service-2"],
	);
});

test("uses the most specific matching prefix for a service", () => {
	const service = createService("service-1", "Payment", [
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/",
		},
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/payment/",
		},
	]);

	const matches = mapBitbucketFileToServices(
		"{repo-1}",
		"src/payment/transaction.ts",
		[service],
	);

	assert.equal(matches.length, 1);
	assert.equal(matches[0].pathPrefix, "src/payment");
});

test("rejects duplicate mappings", () => {
	const service = createService("service-1", "Payment", [
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/payment/",
		},
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/payment",
		},
	]);

	assert.throws(
		() => getBitbucketSourceMappings(service),
		/Duplicate Bitbucket source mapping/,
	);
});

test("rejects parent-directory traversal in mapping prefixes", () => {
	const service = createService("service-1", "Payment", [
		{
			repositoryUuid: "{repo-1}",
			pathPrefix: "src/../secrets",
		},
	]);

	assert.throws(
		() => getBitbucketSourceMappings(service),
		/invalid path segment/,
	);
});

test("rejects absolute changed file paths", () => {
	assert.throws(
		() => mapBitbucketFileToServices("{repo-1}", "/etc/passwd", []),
		/relative path/,
	);
});

test("rejects mappings attached to non-service nodes", () => {
	const issue: GraphNode = {
		...createService("issue-1", "Issue"),
		type: "ISSUE",
	};

	assert.throws(
		() => getBitbucketSourceMappings(issue),
		/only valid on SERVICE nodes/,
	);
});
