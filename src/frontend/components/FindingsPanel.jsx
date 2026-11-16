import React, { useMemo, useState } from "react";
import {
	Button,
	Heading,
	Inline,
	SectionMessage,
	Select,
	Stack,
	Text,
	Textfield,
} from "@forge/react";

import FindingCard from "./FindingCard";

const SEVERITY_OPTIONS = [
	{ label: "All severities", value: "ALL" },
	{ label: "Critical", value: "CRITICAL" },
	{ label: "High", value: "HIGH" },
	{ label: "Medium", value: "MEDIUM" },
	{ label: "Low", value: "LOW" },
	{ label: "Unclassified", value: "UNCLASSIFIED" },
];

const SORT_OPTIONS = [
	{ label: "Highest impact first", value: "DESC" },
	{ label: "Lowest impact first", value: "ASC" },
	{ label: "Component ID (A–Z)", value: "NAME" },
];

export default function FindingsPanel({
	findings = [],
	selectedFindingId = null,
	onSelectFinding,
}) {
	const [search, setSearch] = useState("");
	const [severity, setSeverity] = useState(SEVERITY_OPTIONS[0]);
	const [sort, setSort] = useState(SORT_OPTIONS[0]);

	const filteredFindings = useMemo(() => {
		const query = search.trim().toLowerCase();

		const result = findings.filter((finding) => {
			const matchesSeverity =
				severity.value === "ALL" ||
				(severity.value === "UNCLASSIFIED"
					? finding.severity === null || finding.severity === undefined
					: finding.severity === severity.value);

			const searchableText = [finding.nodeId, finding.explanation]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();

			const matchesSearch =
				query.length === 0 || searchableText.includes(query);

			return matchesSeverity && matchesSearch;
		});

		result.sort((a, b) => {
			const scoreA = Number.isFinite(a.score) ? a.score : 0;
			const scoreB = Number.isFinite(b.score) ? b.score : 0;

			switch (sort.value) {
				case "ASC":
					return scoreA - scoreB;

				case "NAME":
					return (a.nodeId ?? "").localeCompare(b.nodeId ?? "");

				case "DESC":
				default:
					return scoreB - scoreA;
			}
		});

		return result;
	}, [findings, search, severity, sort]);

	return (
		<Stack space="space.150">
			<Inline alignBlock="center" spread="space-between" shouldWrap>
				<Heading size="medium">Affected components</Heading>
				<Text>
					{filteredFindings.length} of {findings.length} shown
				</Text>
			</Inline>

			<Stack space="space.100">
				<Text weight="semibold">Search affected components</Text>
				<Textfield
					name="finding-search"
					placeholder="Search component ID or explanation"
					value={search}
					onChange={(event) => setSearch(event?.target?.value ?? "")}
				/>

				<Inline space="space.100" shouldWrap rowSpace="space.100">
					<Stack grow="fill" space="space.050">
						<Text weight="medium">Severity</Text>
						<Select
							options={SEVERITY_OPTIONS}
							value={severity}
							onChange={(option) => option && setSeverity(option)}
							isSearchable={false}
						/>
					</Stack>

					<Stack grow="fill" space="space.050">
						<Text weight="medium">Sort by</Text>
						<Select
							options={SORT_OPTIONS}
							value={sort}
							onChange={(option) => option && setSort(option)}
							isSearchable={false}
						/>
					</Stack>
				</Inline>
			</Stack>

			{filteredFindings.length === 0 ? (
				<SectionMessage appearance="information">
					<Stack space="space.050">
						<Text weight="bold">
							{findings.length === 0
								? "No affected components were identified."
								: "No components match these filters."}
						</Text>
						{findings.length > 0 && (
							<Text>Try changing the severity filter or search term.</Text>
						)}
					</Stack>
				</SectionMessage>
			) : (
				filteredFindings.map((finding) => {
					const selected = selectedFindingId === finding.nodeId;

					return (
						<Stack key={finding.nodeId} space="space.100">
							<Inline alignBlock="center" spread="space-between">
								<Text weight="semibold">{finding.nodeId}</Text>

								<Button
									appearance={selected ? "primary" : "subtle"}
									onClick={() => onSelectFinding?.(finding.nodeId)}
								>
									{selected ? "Selected in graph" : "Investigate"}
								</Button>
							</Inline>

							<FindingCard finding={finding} />
						</Stack>
					);
				})
			)}
		</Stack>
	);
}
