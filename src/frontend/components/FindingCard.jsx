import React, { useState } from "react";
import { Button, Inline, Stack, Text } from "@forge/react";

import {
	formatNumber,
	formatPercent,
	getSeverityLabel,
} from "../utils/formatters";

export default function FindingCard({ finding }) {
	const [expanded, setExpanded] = useState(false);

	return (
		<Stack space="space.150">
			<Inline alignBlock="center" spread="space-between">
				<Stack space="space.050">
					<Text weight="bold">{finding.nodeId}</Text>
					<Text>{getSeverityLabel(finding.severity)} impact</Text>
				</Stack>

				<Stack space="space.050">
					<Text weight="bold">{formatNumber(finding.score)}/100</Text>
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
										{formatPercent(path.confidence)}
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
