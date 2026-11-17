import assert from "node:assert/strict";
import test from "node:test";

import { createGraphNode } from "../src/graph/models/graph-node";
import { InMemoryGraphRepository } from "../src/graph/repository/in-memory-graph-repository";
import { ServiceConfigurationService } from "../src/integrations/bitbucket/service-configuration-service";

const tenantId = "tenant-1";
const repositoryUuid = "{repo-1}";

async function createServiceConfiguration() {
	const repository = new InMemoryGraphRepository();

	await repository.upsertNode(
		createGraphNode({
			id: "bitbucket:repository:{repo-1}",
			tenantId,
			type: "REPOSITORY",
			source: "BITBUCKET",
			externalId: repositoryUuid,
			name: "traceline-bitbucket",
			attributes: { repositoryUuid },
		}),
	);

	return { repository, service: new ServiceConfigurationService(repository) };
}

test("saves service mappings, criticality, and conventional dependencies", async () => {
	const { repository, service } = await createServiceConfiguration();

	await service.save({
		tenantId,
		updatedBy: "admin-1",
		serviceId: "service:payment",
		name: "payment-service",
		mappings: [{ repositoryUuid, pathPrefix: "src/payment/" }],
		criticality: "CRITICAL",
	});

	const result = await service.save({
		tenantId,
		updatedBy: "admin-1",
		serviceId: "service:checkout",
		name: "checkout-service",
		mappings: [{ repositoryUuid, pathPrefix: "src/checkout/" }],
		dependsOnServiceIds: ["service:payment"],
		criticality: "HIGH",
	});

	const checkout = await repository.getNode(tenantId, "service:checkout");
	const dependencies = await repository.getOutgoingEdges(
		tenantId,
		"service:checkout",
		["DEPENDS_ON"],
	);

	assert.equal(checkout?.attributes.criticality, "HIGH");
	assert.equal(result.mappings[0].pathPrefix, "src/checkout");
	assert.equal(dependencies.length, 1);
	assert.equal(dependencies[0].targetNodeId, "service:payment");
});

test("reconciles dependencies removed from a service configuration", async () => {
	const { repository, service } = await createServiceConfiguration();

	await service.save({
		tenantId,
		updatedBy: "admin-1",
		serviceId: "service:payment",
		name: "payment-service",
		mappings: [{ repositoryUuid, pathPrefix: "src/payment/" }],
		criticality: "CRITICAL",
	});

	await service.save({
		tenantId,
		updatedBy: "admin-1",
		serviceId: "service:checkout",
		name: "checkout-service",
		mappings: [{ repositoryUuid, pathPrefix: "src/checkout/" }],
		dependsOnServiceIds: ["service:payment"],
		criticality: "HIGH",
	});

	const result = await service.save({
		tenantId,
		updatedBy: "admin-1",
		serviceId: "service:checkout",
		name: "checkout-service",
		mappings: [{ repositoryUuid, pathPrefix: "src/checkout/" }],
		dependsOnServiceIds: [],
		criticality: "HIGH",
	});

	assert.equal(result.staleDependenciesRemoved, 1);
	assert.deepEqual(
		await repository.getOutgoingEdges(tenantId, "service:checkout", ["DEPENDS_ON"]),
		[],
	);
});

test("rejects mappings for unknown repositories and dependencies", async () => {
	const { service } = await createServiceConfiguration();

	await assert.rejects(
		() =>
			service.save({
				tenantId,
				updatedBy: "admin-1",
				serviceId: "service:payment",
				name: "payment-service",
				mappings: [
					{ repositoryUuid: "{unknown-repository}", pathPrefix: "src/payment/" },
				],
				criticality: "CRITICAL",
			}),
		/has not been received/,
	);

	await assert.rejects(
		() =>
			service.save({
				tenantId,
				updatedBy: "admin-1",
				serviceId: "service:checkout",
				name: "checkout-service",
				mappings: [{ repositoryUuid, pathPrefix: "src/checkout/" }],
				dependsOnServiceIds: ["service:payment"],
				criticality: "HIGH",
			}),
		/does not exist/,
	);
});
