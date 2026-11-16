import React, { useEffect, useState } from "react";
import { invoke } from "@forge/bridge";
import ForgeReconciler, {
	Button,
	Heading,
	Inline,
	SectionMessage,
	Spinner,
	Stack,
	Text,
	useProductContext,
} from "@forge/react";

function getSeverityLabel(severity) {
	switch (severity) {
		case "CRITICAL":
			return "Critical";
		case "HIGH":
			return "High";
		case "MEDIUM":
			return "Medium";
		case "LOW":
			return "Low";
		default:
			return "Unclassified";
	}
}

function formatTimestamp(timestamp) {
	if (!timestamp) return "Not available";

	return new Date(timestamp).toLocaleString();
}

function FindingCard({ finding }) {
	const [expanded, setExpanded] = useState(false);

	return (
		<Stack space="space.150">
			<Inline alignBlock="center" spread="space-between">
				<Stack space="space.050">
					<Text weight="bold">{finding.nodeId}</Text>
					<Text>{getSeverityLabel(finding.severity)} impact</Text>
				</Stack>

				<Stack space="space.050">
					<Text weight="bold">{finding.score ?? "N/A"}/100</Text>
					<Text>Depth: {finding.minimumDepth}</Text>
				</Stack>
			</Inline>

			{finding.explanation && <Text>{finding.explanation}</Text>}

			{finding.evidence?.length > 0 && (
				<>
					<Button
						appearance="subtle"
						onClick={() => setExpanded((current) => !current)}
					>
						{expanded ? "Hide evidence" : "Show evidence"}
					</Button>

					{expanded && (
						<Stack space="space.150">
							{finding.evidence.map((path, index) => (
								<Stack key={`${finding.nodeId}-${index}`} space="space.100">
									<Text weight="bold">
										Path {index + 1} · Depth {path.depth} · Confidence{" "}
										{(path.confidence * 100).toFixed(0)}%
									</Text>

									{path.relationships.map((relationship) => (
										<Stack key={relationship.edgeId} space="space.050">
											<Text>
												{relationship.sourceName} →{" "}
												{relationship.type ?? "UNKNOWN"} →{" "}
												{relationship.targetName}
											</Text>

											{relationship.sourceSystem && (
												<Text>Source: {relationship.sourceSystem}</Text>
											)}

											{relationship.evidenceText && (
												<Text>Evidence: {relationship.evidenceText}</Text>
											)}
										</Stack>
									))}
								</Stack>
							))}
						</Stack>
					)}
				</>
			)}
		</Stack>
	);
}

function TraceLinePanel() {
	const context = useProductContext();
	const issue = context?.extension?.issue;

	const issueId = issue?.id;
	const issueKey = issue?.key;

	const projectKey = issueKey?.match(/^([A-Z][A-Z0-9_]*)-\d+$/)?.[1];

	const [loading, setLoading] = useState(false);
	const [syncing, setSyncing] = useState(false);

	const [findings, setFindings] = useState([]);
	const [error, setError] = useState("");
	const [syncError, setSyncError] = useState("");

	const [syncResult, setSyncResult] = useState(null);
	const [syncStatus, setSyncStatus] = useState(null);

	const [truncated, setTruncated] = useState(false);
	const [hasAnalyzed, setHasAnalyzed] = useState(false);

	async function runImpactAnalysis() {
		if (!issueId) {
			throw new Error("Unable to identify the current Jira issue.");
		}

		const response = await invoke("impact.analyze", {
			sourceNodeId: `jira:issue:${issueId}`,
		});

		if (!response?.ok) {
			throw new Error(response?.error?.message ?? "Impact analysis failed.");
		}

		setFindings(response.data.findings ?? []);
		setTruncated(response.data.truncated ?? false);
		setHasAnalyzed(true);
	}

	async function analyzeImpact() {
		setLoading(true);
		setError("");

		try {
			await runImpactAnalysis();
		} catch (err) {
			setFindings([]);
			setHasAnalyzed(false);

			setError(
				err instanceof Error
					? err.message
					: "Unable to complete impact analysis.",
			);
		} finally {
			setLoading(false);
		}
	}

	async function syncProject() {
		if (!projectKey) {
			setSyncError("Unable to determine the Jira project key.");
			return;
		}

		setSyncing(true);
		setSyncStatus("QUEUED");
		setSyncError("");
		setSyncResult(null);
		setError("");

		try {
			const response = await invoke("jira.syncProject", {
				projectKey,
			});

			if (!response?.ok) {
				throw new Error(
					response?.error?.message ??
						"Unable to queue project synchronization.",
				);
			}

			const status = response.data?.status;

			setSyncStatus(status ?? "QUEUED");

			// The backend only queues the job.
			// The polling effect below waits for actual completion.
			if (status === "SUCCEEDED") {
				setSyncing(false);
			}
		} catch (err) {
			setSyncing(false);

			setSyncError(
				err instanceof Error
					? err.message
					: "Unable to synchronize the Jira project.",
			);
		}
	}

	/**
	 * Poll the backend while the synchronization is queued or running.
	 *
	 * The effect automatically stops when the component unmounts
	 * or synchronization reaches a terminal state.
	 */
	useEffect(() => {
		if (!syncing || !projectKey) {
			return;
		}

		let cancelled = false;
		let timeoutId;

		async function pollSyncStatus() {
			try {
				const response = await invoke("jira.getSyncStatus", {
					projectKey,
				});

				if (cancelled) return;

				if (!response?.ok) {
					throw new Error(
						response?.error?.message ??
							"Unable to retrieve synchronization status.",
					);
				}

				const checkpoint = response.data;

				if (!checkpoint) {
					// The queue event may not have been processed yet.
					timeoutId = setTimeout(pollSyncStatus, 2000);
					return;
				}

				setSyncStatus(checkpoint.status);

				if (
					checkpoint.status === "QUEUED" ||
					checkpoint.status === "IN_PROGRESS"
				) {
					timeoutId = setTimeout(pollSyncStatus, 2000);
					return;
				}

				if (checkpoint.status === "SUCCEEDED") {
					setSyncResult(checkpoint);
					setSyncing(false);

					// Refresh impact analysis only after ingestion succeeds.
					setLoading(true);
					setError("");

					try {
						await runImpactAnalysis();
					} catch (err) {
						if (!cancelled) {
							setError(
								err instanceof Error
									? err.message
									: "Synchronization succeeded, but impact analysis failed.",
							);
						}
					} finally {
						if (!cancelled) {
							setLoading(false);
						}
					}

					return;
				}

				if (checkpoint.status === "FAILED") {
					setSyncError(
						checkpoint.lastError ?? "Jira project synchronization failed.",
					);

					setSyncing(false);
					return;
				}

				// Unknown status: keep checking instead of assuming success.
				timeoutId = setTimeout(pollSyncStatus, 2000);
			} catch (err) {
				if (cancelled) return;

				setSyncError(
					err instanceof Error
						? err.message
						: "Unable to check synchronization progress.",
				);

				setSyncing(false);
			}
		}

		pollSyncStatus();

		return () => {
			cancelled = true;

			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		};
	}, [syncing, projectKey, issueId]);

	/**
	 * Load impact analysis when the Jira panel opens.
	 */
	useEffect(() => {
		if (!issueId) return;

		let cancelled = false;

		async function initialAnalysis() {
			setLoading(true);
			setError("");

			try {
				const response = await invoke("impact.analyze", {
					sourceNodeId: `jira:issue:${issueId}`,
				});

				if (cancelled) return;

				if (!response?.ok) {
					throw new Error(
						response?.error?.message ?? "Impact analysis failed.",
					);
				}

				setFindings(response.data.findings ?? []);
				setTruncated(response.data.truncated ?? false);
				setHasAnalyzed(true);
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof Error
							? err.message
							: "Unable to complete impact analysis.",
					);
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		initialAnalysis();

		return () => {
			cancelled = true;
		};
	}, [issueId]);

	if (!issueId) {
		return (
			<SectionMessage appearance="error">
				<Text>Jira issue context is unavailable.</Text>
			</SectionMessage>
		);
	}

	return (
		<Stack space="space.200">
			<Stack space="space.050">
				<Heading size="large">TraceLine Impact Analysis</Heading>

				<Text>
					Analyze engineering dependencies and potentially affected work.
				</Text>

				<Text weight="bold">Issue: {issueKey ?? issueId}</Text>

				<Text>Project: {projectKey ?? "Unknown"}</Text>
			</Stack>

			<Stack space="space.100">
				<Heading size="medium">Jira synchronization</Heading>

				<Button
					appearance="primary"
					onClick={syncProject}
					isDisabled={syncing || loading || !projectKey}
				>
					{syncing ? "Synchronization in progress..." : "Sync Jira Project"}
				</Button>

				{syncStatus === "QUEUED" && (
					<SectionMessage appearance="information">
						<Text>
							Synchronization has been queued and is waiting for a worker.
						</Text>
					</SectionMessage>
				)}

				{syncStatus === "IN_PROGRESS" && (
					<Inline alignBlock="center" space="space.100">
						<Spinner size="small" />
						<Text>Importing Jira issues and relationships...</Text>
					</Inline>
				)}

				{syncResult && (
					<SectionMessage appearance="confirmation">
						<Stack space="space.100">
							<Text weight="bold">Project synchronization completed.</Text>

							<Text>
								Last successful sync:{" "}
								{formatTimestamp(syncResult.lastSuccessfulSyncAt)}
							</Text>

							{syncResult.result && (
								<>
									{syncResult.result.fetchedIssues !== undefined && (
										<Text>
											Issues fetched: {syncResult.result.fetchedIssues}
										</Text>
									)}

									{syncResult.result.persistedNodes !== undefined && (
										<Text>
											Nodes persisted: {syncResult.result.persistedNodes}
										</Text>
									)}

									{syncResult.result.placeholderNodes !== undefined && (
										<Text>
											Placeholder nodes: {syncResult.result.placeholderNodes}
										</Text>
									)}

									{syncResult.result.persistedEdges !== undefined && (
										<Text>
											Relationships persisted:{" "}
											{syncResult.result.persistedEdges}
										</Text>
									)}
								</>
							)}
						</Stack>
					</SectionMessage>
				)}

				{syncError && (
					<SectionMessage appearance="error">
						<Text>{syncError}</Text>
					</SectionMessage>
				)}
			</Stack>

			<Stack space="space.100">
				<Heading size="medium">Impact analysis</Heading>

				<Button
					appearance="default"
					onClick={analyzeImpact}
					isDisabled={loading || syncing}
				>
					{loading ? "Analyzing..." : "Refresh impact analysis"}
				</Button>

				{loading && (
					<Inline alignBlock="center" space="space.100">
						<Spinner size="small" />
						<Text>Tracing dependencies...</Text>
					</Inline>
				)}

				{error && (
					<SectionMessage appearance="error">
						<Text>{error}</Text>
					</SectionMessage>
				)}

				{hasAnalyzed && !loading && !error && (
					<Stack space="space.200">
						<Heading size="medium">Affected items ({findings.length})</Heading>

						{truncated && (
							<SectionMessage appearance="warning">
								<Text>
									The analysis reached a traversal limit. Some potential impacts
									may not be included.
								</Text>
							</SectionMessage>
						)}

						{findings.length === 0 ? (
							<SectionMessage appearance="information">
								<Text>No affected graph nodes were found for this issue.</Text>
							</SectionMessage>
						) : (
							findings.map((finding) => (
								<Stack key={finding.nodeId} space="space.150">
									<FindingCard finding={finding} />
								</Stack>
							))
						)}
					</Stack>
				)}
			</Stack>
		</Stack>
	);
}

ForgeReconciler.render(<TraceLinePanel />);
