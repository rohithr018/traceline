import React, { useState } from "react";

import {
	Button,
	Heading,
	Inline,
	SectionMessage,
	Spinner,
	Stack,
	Text,
} from "@forge/react";

import ImpactGraph from "./ImpactGraph";
import ImpactPathPanel from "./ImpactPathPanel";
import RiskSummary from "./RiskSummary";
import { formatTimestamp } from "../utils/formatters";
import {
	getChangedFileMappingStatus,
	getChangedFilePath,
	getFindingCategory,
	getFindingDisplayName,
} from "../utils/pull-request-view-utils";

function PullRequestSummary({ pullRequest }) {
	return (
		<SectionMessage appearance="information">
			<Stack space="space.100">
				<Heading size="medium">{pullRequest.name}</Heading>
				<Inline space="space.200" shouldWrap>
					<Text>{pullRequest.repository}</Text>
					<Text>{pullRequest.state}</Text>
					<Text>By {pullRequest.author || "Unknown author"}</Text>
					<Text>Updated {formatTimestamp(pullRequest.updatedOn)}</Text>
				</Inline>
				{pullRequest.url && (
					<Button
						appearance="link"
						onClick={() => window.open(pullRequest.url, "_blank", "noopener,noreferrer")}
					>
						Open pull request in Bitbucket
					</Button>
				)}
			</Stack>
		</SectionMessage>
	);
}

function ChangedFiles({ files = [], mapping = {} }) {
	const unmatched = new Set(
		(mapping.unmatchedFiles ?? []).map((file) => file.filePath),
	);
	const visibleFiles = files.slice(0, 30);

	return (
		<Stack space="space.100">
			<Heading size="medium">Changed files ({files.length})</Heading>
			<Inline space="space.200" shouldWrap>
				<Text>Mapped changed paths: {mapping.matchedFiles ?? "—"}</Text>
				<Text>Unmatched changed paths: {unmatched.size}</Text>
				<Text>Jira references linked: {mapping.linkedJiraReferences ?? 0}</Text>
				{mapping.unresolvedJiraReferences > 0 && (
					<Text>Unresolved Jira references: {mapping.unresolvedJiraReferences}</Text>
				)}
			</Inline>

			{files.length === 0 ? (
				<SectionMessage appearance="information"><Text>No changed-file details were received for this pull request.</Text></SectionMessage>
			) : (
				<Stack space="space.050">
					{visibleFiles.map((file, index) => {
						const path = getChangedFilePath(file);
						const mappingStatus = getChangedFileMappingStatus(file, unmatched);
						const lineChange = [
							Number.isFinite(file.linesAdded) ? `+${file.linesAdded}` : null,
							Number.isFinite(file.linesRemoved) ? `−${file.linesRemoved}` : null,
						].filter(Boolean).join(" / ");
						return (
							<Inline key={`${path}-${index}`} alignBlock="center" spread="space-between" shouldWrap>
								<Stack space="space.025">
									<Text weight="medium">{path}</Text>
									<Text color="color.text.subtle" size="small">
										{file.status || "Changed"}{lineChange ? ` · ${lineChange} lines` : ""}
									</Text>
								</Stack>
								<Text color={mappingStatus === "Unmatched" ? "color.text.warning" : mappingStatus === "Mapped" ? "color.text.success" : "color.text.subtle"} size="small">
									{mappingStatus}
								</Text>
							</Inline>
						);
					})}
					{files.length > visibleFiles.length && (
						<Text color="color.text.subtle">Showing the first {visibleFiles.length} files.</Text>
					)}
				</Stack>
			)}

			{unmatched.size > 0 && (
				<SectionMessage appearance="warning">
					<Stack space="space.050">
						<Text weight="bold">Some files do not have a configured service mapping.</Text>
						{[...unmatched].slice(0, 20).map((path) => <Text key={path}>{path}</Text>)}
					</Stack>
				</SectionMessage>
			)}
		</Stack>
	);
}

function MatchedServices({ mapping = {} }) {
	const services = Array.isArray(mapping.matchedServices) ? mapping.matchedServices : [];
	if (services.length === 0) {
		return (
			<SectionMessage appearance="warning">
				<Text>No changed files matched a configured service. Configure a source path before relying on downstream impact results.</Text>
			</SectionMessage>
		);
	}
	return (
		<Stack space="space.100">
			<Heading size="medium">Changed services</Heading>
			{services.map((service) => (
				<SectionMessage key={service.id} appearance="confirmation">
					<Stack space="space.050">
						<Text weight="bold">{service.name}</Text>
						<Text size="small">{service.id}</Text>
						{service.evidenceText && <Text color="color.text.subtle">{service.evidenceText}</Text>}
					</Stack>
				</SectionMessage>
			))}
		</Stack>
	);
}

function ImpactFindings({ findings = [], selectedNodeId, onSelectFinding }) {
	if (findings.length === 0) {
		return (
			<SectionMessage appearance="information">
				<Text>No downstream impacts were confirmed from the available graph paths.</Text>
			</SectionMessage>
		);
	}

	return (
		<Stack space="space.150">
			<Heading size="medium">Potentially affected components ({findings.length})</Heading>
			<Text color="color.text.subtle">Each result below is supported by a graph path. A path indicates a potential engineering impact, not a confirmed defect.</Text>
			{findings.map((finding) => (
				<Stack key={finding.nodeId} space="space.100">
					<SectionMessage appearance={finding.severity === "CRITICAL" || finding.severity === "HIGH" ? "warning" : "information"}>
						<Stack space="space.050">
							<Inline alignBlock="center" spread="space-between" shouldWrap>
								<Stack space="space.025">
									<Text weight="bold">{getFindingDisplayName(finding)}</Text>
									<Text color="color.text.subtle" size="small">{getFindingCategory(finding)}</Text>
								</Stack>
								<Text weight="semibold">{finding.severity || "Unclassified"} · {finding.score ?? "—"}/100</Text>
								<Button
									appearance={selectedNodeId === finding.nodeId ? "primary" : "subtle"}
									onClick={() => onSelectFinding?.(finding.nodeId)}
								>
									{selectedNodeId === finding.nodeId ? "Shown in graph" : "Show in graph"}
								</Button>
							</Inline>
							<Text>Depth: {finding.minimumDepth} · Confidence: {Math.round((finding.strongestPathConfidence ?? 0) * 100)}%</Text>
							{finding.explanation && <Text>{finding.explanation}</Text>}
						</Stack>
					</SectionMessage>
					{(finding.evidence ?? []).slice(0, 3).map((path, index) => (
						<ImpactPathPanel key={`${finding.nodeId}-${index}`} finding={{ ...finding, evidence: [path] }} />
					))}
				</Stack>
			))}
		</Stack>
	);
}

export default function PullRequestInvestigation({
	data,
	loading = false,
	error = "",
	onAnalyze,
}) {
	const [selectedNodeId, setSelectedNodeId] = useState(null);

	if (loading && !data) {
		return <Inline alignBlock="center" space="space.100"><Spinner size="small" /><Text>Analyzing pull request changes...</Text></Inline>;
	}
	if (!data) {
		return <SectionMessage appearance={error ? "error" : "information"}><Stack space="space.100"><Text>{error || "Select a pull request to inspect its engineering impact."}</Text>{error && onAnalyze && <Button appearance="primary" onClick={onAnalyze}>Retry analysis</Button>}</Stack></SectionMessage>;
	}

	const findings = data.analysis?.findings ?? [];
	const sourceNodeId = data.pullRequest.id;

	return (
		<Stack space="space.200">
			{error && <SectionMessage appearance="error"><Text>{error} The last successful results remain visible.</Text></SectionMessage>}
			<PullRequestSummary pullRequest={data.pullRequest} />
			<ChangedFiles files={data.changedFiles ?? []} mapping={data.mapping} />
			<MatchedServices mapping={data.mapping} />
			{data.analysis?.truncated && <SectionMessage appearance="warning"><Text>Traversal reached a configured limit. Some potential impacts may be missing.</Text></SectionMessage>}
			<ImpactGraph
				key={sourceNodeId}
				sourceNodeId={sourceNodeId}
				sourceName={data.pullRequest.name}
				sourceType="PULL_REQUEST"
				sourceLabel="Source pull request"
				findings={findings}
				risk={data.analysis?.risk ?? null}
				selectedNodeId={selectedNodeId}
				onSelectNode={setSelectedNodeId}
			/>
			<ImpactFindings
				findings={findings}
				selectedNodeId={selectedNodeId}
				onSelectFinding={setSelectedNodeId}
			/>
			<RiskSummary risk={data.analysis?.risk ?? null} />
			{onAnalyze && <Button appearance="primary" onClick={onAnalyze} isDisabled={loading}>{loading ? "Refreshing analysis..." : "Refresh analysis"}</Button>}
		</Stack>
	);
}
