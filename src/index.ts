import { Queue } from "@forge/events";
import { handler as impactAnalysisHandler } from "./impact/api/impact-resolver";
import { runMigration as executeMigration } from "./database/migration-runner";
import { verifyStorage as executeStorageVerification } from "./database/verify-storage";

const migrationQueue = new Queue({
	key: "schema-migration-queue",
});

export async function enqueueMigration(): Promise<void> {
	console.info(
		"TraceLine app lifecycle event received. Enqueueing migrations.",
	);

	const result = await migrationQueue.push({
		body: {},
	});

	console.info("TraceLine migration job enqueued:", result);
}

export async function runMigration(): Promise<void> {
	console.info("TraceLine migration consumer started");

	try {
		await executeMigration();

		console.info("TraceLine migration execution completed successfully");
	} catch (error) {
		console.error("TraceLine migration execution failed:", error);
		throw error;
	} finally {
		console.info("TraceLine migration consumer finished");
	}
}

interface StorageVerificationRequest {
	method?: string;
	headers?: Record<string, string[] | undefined>;
}

export async function verifyStorageHandler(
	request: StorageVerificationRequest,
): Promise<{ outputKey: string }> {
	const expectedToken = process.env.TRACELINE_VERIFY_TOKEN;

	const authorization =
		request.headers?.authorization?.[0] ?? request.headers?.Authorization?.[0];

	if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
		return { outputKey: "unauthorized" };
	}

	if (request.method !== "POST") {
		return { outputKey: "method-not-allowed" };
	}

	try {
		const result = await executeStorageVerification();

		console.info("TraceLine SQL storage verification passed:", result);

		return { outputKey: "ok" };
	} catch (error) {
		console.error("TraceLine SQL storage verification failed:", error);

		return { outputKey: "failed" };
	}
}

export async function runMigrationsHandler(
	request: StorageVerificationRequest,
): Promise<{ outputKey: string }> {
	const expectedToken = process.env.TRACELINE_VERIFY_TOKEN;

	const authorization =
		request.headers?.authorization?.[0] ?? request.headers?.Authorization?.[0];

	if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
		return { outputKey: "unauthorized" };
	}

	if (request.method !== "POST") {
		return { outputKey: "method-not-allowed" };
	}

	try {
		console.info("TraceLine manual migration execution started");

		await executeMigration();

		console.info("TraceLine manual migration execution completed");

		return { outputKey: "ok" };
	} catch (error) {
		console.error("TraceLine manual migration execution failed:", error);

		return { outputKey: "failed" };
	}
}

export * from "./graph/models/graph-node";
export * from "./graph/models/graph-edge";

export * from "./graph/errors/graph-errors";

export * from "./graph/repository/graph-repository";
export * from "./graph/repository/in-memory-graph-repository";
export * from "./graph/repository/sql-graph-repository";

export * from "./graph/graph-service";

export * from "./graph/algorithms/impact-traversal";
export * from "./graph/algorithms/cycle-detection";

export * from "./integrations/confluence/confluence-types";
export * from "./integrations/confluence/forge-confluence-client";
export * from "./integrations/confluence/confluence-mapper";
export * from "./integrations/confluence/confluence-ingestion-service";

export * from "./integrations/confluence/jira-reference-extractor";
export * from "./integrations/confluence/cross-source-linker";

export * from "./sync/sync-checkpoint";
export * from "./sync/sql-sync-checkpoint-store";
export * from "./sync/sync-orchestrator";

export * from "./impact/models/impact-analysis";
export * from "./impact/validation/impact-request-validator";
export * from "./impact/services/impact-analysis-service";

export * from "./impact/services/impact-scoring";

export * from "./impact/services/impact-explanation";

export * from "./impact/api/impact-api-contract";
export { impactAnalysisHandler };
