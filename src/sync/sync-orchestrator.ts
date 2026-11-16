import type {
	JiraIngestionService,
	JiraIngestionResult,
} from "../integrations/jira/jira-ingestion-service";

import type {
	ConfluenceIngestionService,
	ConfluenceIngestionResult,
} from "../integrations/confluence/confluence-ingestion-service";

import type {
	CrossSourceLinker,
	CrossSourceLinkResult,
} from "../integrations/confluence/cross-source-linker";

import type {
	SyncCheckpoint,
	SyncCheckpointStore,
	SyncSource,
} from "./sync-checkpoint";

export interface UnifiedSyncInput {
	tenantId: string;
	projectKey: string;
	spaceId: string;
	maxIssues?: number;
	maxPages?: number;
}

export interface SyncStepResult<T> {
	source: SyncSource;
	scopeId: string;
	status: "SUCCEEDED" | "FAILED";
	result?: T;
	error?: string;
}

export interface UnifiedSyncResult {
	tenantId: string;
	startedAt: number;
	completedAt: number;
	status: "SUCCEEDED" | "PARTIAL_FAILURE";
	steps: {
		jira: SyncStepResult<JiraIngestionResult>;
		confluence: SyncStepResult<ConfluenceIngestionResult>;
		crossSource: SyncStepResult<CrossSourceLinkResult[]>;
	};
}

type JiraIngestion = Pick<JiraIngestionService, "ingestProject">;
type ConfluenceIngestion = Pick<ConfluenceIngestionService, "ingestSpace">;
type CrossSourceLinking = Pick<CrossSourceLinker, "linkAllDocuments">;

export class SyncOrchestrator {
	constructor(
		private readonly jira: JiraIngestion,
		private readonly confluence: ConfluenceIngestion,
		private readonly linker: CrossSourceLinking,
		private readonly checkpoints: SyncCheckpointStore,
	) {}

	async run(input: UnifiedSyncInput): Promise<UnifiedSyncResult> {
		if (!input.tenantId.trim()) {
			throw new Error("Tenant ID is required");
		}

		if (!input.projectKey.trim()) {
			throw new Error("Jira project key is required");
		}

		if (!input.spaceId.trim()) {
			throw new Error("Confluence space ID is required");
		}

		const startedAt = Date.now();

		const jira = await this.executeStep(
			input.tenantId,
			"JIRA",
			input.projectKey,
			() =>
				this.jira.ingestProject({
					tenantId: input.tenantId,
					projectKey: input.projectKey,
					maxIssues: input.maxIssues,
				}),
		);

		const confluence = await this.executeStep(
			input.tenantId,
			"CONFLUENCE",
			input.spaceId,
			() =>
				this.confluence.ingestSpace({
					tenantId: input.tenantId,
					spaceId: input.spaceId,
					maxPages: input.maxPages,
				}),
		);

		const crossSource = await this.executeStep(
			input.tenantId,
			"CROSS_SOURCE",
			`${input.projectKey}:${input.spaceId}`,
			() => this.linker.linkAllDocuments(input.tenantId),
		);

		const completedAt = Date.now();

		const allSucceeded = [jira, confluence, crossSource].every(
			(step) => step.status === "SUCCEEDED",
		);

		return {
			tenantId: input.tenantId,
			startedAt,
			completedAt,
			status: allSucceeded ? "SUCCEEDED" : "PARTIAL_FAILURE",
			steps: {
				jira,
				confluence,
				crossSource,
			},
		};
	}

	private async executeStep<T>(
		tenantId: string,
		source: SyncSource,
		scopeId: string,
		operation: () => Promise<T>,
	): Promise<SyncStepResult<T>> {
		const now = Date.now();

		const previous = await this.checkpoints.get(tenantId, source, scopeId);

		const checkpoint: SyncCheckpoint = {
			tenantId,
			source,
			scopeId,
			status: "IN_PROGRESS",
			lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt ?? null,
			startedAt: now,
			completedAt: null,
			lastError: null,
			updatedAt: now,
		};

		await this.checkpoints.save(checkpoint);

		try {
			const result = await operation();
			const completedAt = Date.now();

			await this.checkpoints.save({
				...checkpoint,
				status: "SUCCEEDED",
				lastSuccessfulSyncAt: completedAt,
				completedAt,
				updatedAt: completedAt,
			});

			return {
				source,
				scopeId,
				status: "SUCCEEDED",
				result,
			};
		} catch (error) {
			const completedAt = Date.now();

			const message = error instanceof Error ? error.message : String(error);

			await this.checkpoints.save({
				...checkpoint,
				status: "FAILED",
				completedAt,
				lastError: message,
				updatedAt: completedAt,
			});

			return {
				source,
				scopeId,
				status: "FAILED",
				error: message,
			};
		}
	}
}
