import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@forge/bridge";
import ForgeReconciler, {
	Button,
	Heading,
	Inline,
	SectionMessage,
	Stack,
	Text,
	useProductContext,
} from "@forge/react";

import RiskSummary from "./components/RiskSummary";
import SyncPanel from "./components/SyncPanel";
import FindingsPanel from "./components/FindingsPanel";
import AnalysisStatus from "./components/AnalysisStatus";
import ImpactGraph from "./components/ImpactGraph";
import ImpactPathPanel from "./components/ImpactPathPanel";
import InvestigationSummary from "./components/InvestigationSummary";

function TraceLinePanel() {
	const analysisRequests = useRef(new Map());
	const syncLock = useRef(false);
	const criticalityLock = useRef(null);

	const context = useProductContext();
	const issue = context?.extension?.issue;

	const issueId = issue?.id;
	const issueKey = issue?.key;

	const projectKey = issueKey?.match(/^([A-Z][A-Z0-9_]*)-\d+$/)?.[1];

	const currentIssueIdRef = useRef(issueId);
	currentIssueIdRef.current = issueId;
	const currentProjectKeyRef = useRef(projectKey);
	currentProjectKeyRef.current = projectKey;

	const [loading, setLoading] = useState(false);
	const [syncing, setSyncing] = useState(false);

	const [findings, setFindings] = useState([]);
	const [risk, setRisk] = useState(null);
	const [analysisDataIssueId, setAnalysisDataIssueId] = useState(null);

	const [error, setError] = useState("");
	const [analysisErrorIssueId, setAnalysisErrorIssueId] = useState(null);
	const [analysisLoadingIssueId, setAnalysisLoadingIssueId] = useState(null);
	const [syncError, setSyncError] = useState("");
	const [criticalityError, setCriticalityError] = useState("");
	const [criticalityMessage, setCriticalityMessage] = useState("");

	const [criticalityUpdatingNodeId, setCriticalityUpdatingNodeId] =
		useState(null);

	const [syncResult, setSyncResult] = useState(null);
	const [syncStatus, setSyncStatus] = useState(null);
	const [syncProjectKey, setSyncProjectKey] = useState(null);

	const [truncated, setTruncated] = useState(false);
	const [hasAnalyzed, setHasAnalyzed] = useState(false);
	const [selectedFindingId, setSelectedFindingId] = useState(null);

	const hasCurrentAnalysis = hasAnalyzed && analysisDataIssueId === issueId;
	const currentAnalysisLoading =
		loading && analysisLoadingIssueId === issueId;
	const currentAnalysisError =
		analysisErrorIssueId === issueId ? error : "";
	const currentFindings = hasCurrentAnalysis ? findings : [];
	const currentRisk = hasCurrentAnalysis ? risk : null;

	// Clear issue-specific investigation data when Jira navigation changes.
	useEffect(() => {
		setSelectedFindingId(null);
		setFindings([]);
		setRisk(null);
		setAnalysisDataIssueId(null);
		setTruncated(false);
		setHasAnalyzed(false);
		setLoading(false);
		setAnalysisLoadingIssueId(null);
		setError("");
		setAnalysisErrorIssueId(null);
		setCriticalityError("");
		setCriticalityMessage("");
		setCriticalityUpdatingNodeId(null);
		criticalityLock.current = null;
	}, [issueId]);

	async function runImpactAnalysis(targetIssueId) {
		if (!targetIssueId) {
			throw new Error("Unable to identify the current Jira issue.");
		}

		const response = await invoke("impact.analyze", {
			sourceNodeId: `jira:issue:${targetIssueId}`,
		});

		if (!response?.ok) {
			throw new Error(response?.error?.message ?? "Impact analysis failed.");
		}

		// Ignore results belonging to an issue that is no longer open.
		if (currentIssueIdRef.current !== targetIssueId) {
			return false;
		}

		const data = response.data;

		// Replace previous results only after successful analysis.
		setFindings(Array.isArray(data?.findings) ? data.findings : []);
		setRisk(data?.risk && typeof data.risk === "object" ? data.risk : null);
		setTruncated(Boolean(data?.truncated));
		setHasAnalyzed(true);
		setAnalysisDataIssueId(targetIssueId);
		setSelectedFindingId(null);

		return true;
	}

	async function analyzeImpact() {
		if (!issueId) {
			return false;
		}

		const targetIssueId = issueId;

		// Prevent duplicate requests for the same issue while allowing
		// a new issue to be analyzed during navigation.
		if (analysisRequests.current.has(targetIssueId)) {
			return false;
		}

		const requestToken = Symbol(targetIssueId);
		analysisRequests.current.set(targetIssueId, requestToken);

		setLoading(true);
		setAnalysisLoadingIssueId(targetIssueId);
		setError("");
		setAnalysisErrorIssueId(null);

		let succeeded = false;

		try {
			succeeded = await runImpactAnalysis(targetIssueId);
		} catch (err) {
			if (currentIssueIdRef.current === targetIssueId) {
				setError(
					err instanceof Error
						? err.message
						: "Unable to complete impact analysis.",
				);
				setAnalysisErrorIssueId(targetIssueId);
			}
		} finally {
			if (analysisRequests.current.get(targetIssueId) === requestToken) {
				analysisRequests.current.delete(targetIssueId);
			}

			if (currentIssueIdRef.current === targetIssueId) {
				setLoading(false);
				setAnalysisLoadingIssueId(null);
			}
		}

		return succeeded;
	}

	async function updateCriticality(nodeId, criticality) {
		if (criticalityLock.current !== null) {
			return;
		}

		const targetIssueId = issueId;
		const requestToken = Symbol(nodeId);

		criticalityLock.current = requestToken;
		setCriticalityUpdatingNodeId(nodeId);
		setCriticalityError("");
		setCriticalityMessage("");

		try {
			const response = await invoke("risk.updateCriticality", {
				nodeId,
				criticality,
			});

			if (!response?.ok) {
				throw new Error(
					response?.error?.message ?? "Unable to update component criticality.",
				);
			}

			// Do not update the newly opened issue's UI with an old
			// issue's criticality operation.
			if (currentIssueIdRef.current !== targetIssueId) {
				return;
			}

			const refreshed = await analyzeImpact();

			if (currentIssueIdRef.current !== targetIssueId) {
				return;
			}

			if (refreshed) {
				setCriticalityMessage(
					`Criticality for ${nodeId} updated to ${criticality}.`,
				);
			} else {
				setCriticalityMessage(
					`Criticality for ${nodeId} was updated. Re-analyze to refresh the risk scores.`,
				);
			}
		} catch (err) {
			if (currentIssueIdRef.current === targetIssueId) {
				setCriticalityError(
					err instanceof Error
						? err.message
						: "Unable to update component criticality.",
				);
			}
		} finally {
			if (criticalityLock.current === requestToken) {
				criticalityLock.current = null;
				setCriticalityUpdatingNodeId(null);
			}
		}
	}

	async function syncProject() {
		if (!projectKey) {
			setSyncError("Unable to determine the Jira project key.");
			return;
		}

		if (syncLock.current) {
			return;
		}

		const targetIssueId = issueId;

		syncLock.current = true;
		setSyncing(true);
		setSyncProjectKey(projectKey);
		setSyncStatus("QUEUED");
		setSyncError("");
		setSyncResult(null);

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

			if (currentIssueIdRef.current !== targetIssueId) {
				return;
			}

			const status = response.data?.status;
			setSyncStatus(status ?? "QUEUED");

			if (status === "SUCCEEDED") {
				setSyncResult(response.data);
				setSyncing(false);
				await analyzeImpact();
			}
		} catch (err) {
			if (currentIssueIdRef.current === targetIssueId) {
				setSyncing(false);
				setSyncError(
					err instanceof Error
						? err.message
						: "Unable to synchronize the Jira project.",
				);
			}
		} finally {
			syncLock.current = false;
		}
	}

	// Poll Jira synchronization status.
	useEffect(() => {
		if (!syncing || !syncProjectKey) {
			return;
		}

		let cancelled = false;
		let timeoutId;
		const pollStartedAt = Date.now();

		async function pollSyncStatus() {
			try {
				if (Date.now() - pollStartedAt > 20 * 60 * 1000) {
					setSyncError("Synchronization is taking longer than expected.");
					setSyncing(false);
					return;
				}

				const response = await invoke("jira.getSyncStatus", {
					projectKey: syncProjectKey,
				});

				if (cancelled) {
					return;
				}

				if (!response?.ok) {
					throw new Error(
						response?.error?.message ??
							"Unable to retrieve synchronization status.",
					);
				}

				const checkpoint = response.data;

				if (!checkpoint) {
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

					if (
						!cancelled &&
						currentProjectKeyRef.current === syncProjectKey
					) {
						await analyzeImpact();
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

				timeoutId = setTimeout(pollSyncStatus, 2000);
			} catch (err) {
				if (cancelled) {
					return;
				}

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
	}, [syncing, syncProjectKey]);

	// Initial analysis when the Jira panel opens or issue changes.
	useEffect(() => {
		if (!issueId) {
			return;
		}

		analyzeImpact();
	}, [issueId]);

	if (!issueId) {
		return (
			<SectionMessage appearance="error">
				<Text>Jira issue context is unavailable.</Text>
			</SectionMessage>
		);
	}

	const selectedFinding =
		currentFindings.find((finding) => finding.nodeId === selectedFindingId) ??
		null;

	return (
		<Stack space="space.200">
			<Stack space="space.050">
				<Heading size="large">TraceLine Impact Analysis</Heading>

				<Text>Engineering dependency and change impact intelligence.</Text>

				<Text weight="bold">Issue: {issueKey ?? issueId}</Text>

				<Text>Project: {projectKey ?? "Unknown"}</Text>
			</Stack>

			<SyncPanel
				projectKey={projectKey}
				syncProjectKey={syncProjectKey}
				syncing={syncing}
				loading={currentAnalysisLoading || criticalityUpdatingNodeId !== null}
				syncStatus={syncStatus}
				syncResult={syncResult}
				syncError={syncError}
				onSync={syncProject}
			/>

			<Stack space="space.100">
				<Inline alignBlock="center" spread="space-between">
					<Heading size="medium">Impact analysis</Heading>

					<Button
						appearance="subtle"
						onClick={analyzeImpact}
						isDisabled={
						currentAnalysisLoading || syncing || criticalityUpdatingNodeId !== null
						}
					>
						Re-analyze
					</Button>
				</Inline>

				<Text>Review affected components and understand their risk.</Text>

				<AnalysisStatus
					loading={currentAnalysisLoading}
					hasAnalyzed={hasCurrentAnalysis}
					error={currentAnalysisError}
					onRetry={analyzeImpact}
				/>

				{truncated && hasCurrentAnalysis && (
					<SectionMessage appearance="warning">
						<Text>
							This analysis reached a traversal limit. Some affected components or
							dependency paths may be missing.
						</Text>
					</SectionMessage>
				)}

				{hasCurrentAnalysis && (
					<Stack space="space.200">
						<InvestigationSummary
							findings={currentFindings}
							risk={currentRisk}
						/>

						{criticalityError && (
							<SectionMessage appearance="error">
								<Text>{criticalityError}</Text>
							</SectionMessage>
						)}

						{criticalityMessage && (
							<SectionMessage appearance="confirmation">
								<Text>{criticalityMessage}</Text>
							</SectionMessage>
						)}

						<ImpactGraph
							key={issueId}
							sourceNodeId={`jira:issue:${issueId}`}
							findings={currentFindings}
							risk={currentRisk}
							selectedNodeId={selectedFindingId}
							onSelectNode={setSelectedFindingId}
						/>

						<RiskSummary
							risk={currentRisk}
							onCriticalityChange={updateCriticality}
							updatingNodeId={criticalityUpdatingNodeId}
							analysisLoading={currentAnalysisLoading}
						/>

						<FindingsPanel
							key={issueId}
							findings={currentFindings}
							selectedFindingId={selectedFindingId}
							onSelectFinding={setSelectedFindingId}
						/>

						<ImpactPathPanel finding={selectedFinding} />
					</Stack>
				)}
			</Stack>
		</Stack>
	);
}

ForgeReconciler.render(<TraceLinePanel />);
