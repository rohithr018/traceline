export function formatTimestamp(timestamp) {
	if (timestamp === null || timestamp === undefined || timestamp === "") {
		return "Not available";
	}

	const date = new Date(timestamp);

	return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

export function formatNumber(value, fractionDigits = 2) {
	if (value === null || value === undefined || value === "") {
		return "—";
	}

	const number = Number(value);

	return Number.isFinite(number) ? number.toFixed(fractionDigits) : "—";
}

export function formatPercent(value, fractionDigits = 0) {
	if (value === null || value === undefined || value === "") {
		return "—";
	}

	const number = Number(value);

	return Number.isFinite(number)
		? `${(number * 100).toFixed(fractionDigits)}%`
		: "—";
}

export function getSeverityLabel(severity) {
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

export function getRiskAppearance(level) {
	switch (level) {
		case "CRITICAL":
		case "HIGH":
			return "warning";
		case "LOW":
		case "MINIMAL":
			return "confirmation";
		default:
			return "information";
	}
}

export function getRiskLevelLabel(level) {
	switch (level) {
		case "CRITICAL":
			return "Critical risk";
		case "HIGH":
			return "High risk";
		case "MODERATE":
			return "Moderate risk";
		case "LOW":
			return "Low risk";
		case "MINIMAL":
			return "Minimal risk";
		default:
			return "Unclassified risk";
	}
}

export function getFactorLabel(factor) {
	const labels = {
		impactBreadth: "Impact breadth",
		componentCriticality: "Component criticality",
		dependencyCentrality: "Dependency centrality",
		propagationConfidence: "Propagation confidence",
		propagationProximity: "Propagation proximity",
	};

	return labels[factor] ?? factor;
}
