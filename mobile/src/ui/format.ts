export function relativeTime(date: string | number): string {
	const elapsed = Date.now() - new Date(date).getTime();
	if (elapsed < 60_000) return "now";
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
	if (elapsed < 172_800_000) return "yesterday";
	return new Date(date).toLocaleDateString(undefined, { weekday: "short" });
}
export function daysUntil(date: string | number): string {
	const days = Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000));
	return `back in ${days} ${days === 1 ? "day" : "days"}`;
}
