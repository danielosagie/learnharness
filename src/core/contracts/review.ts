/** The practice transcript is the only evidence for the derived review schedule. */
export type ReviewRating = "Again" | "Hard" | "Good";

export interface PracticeRecord {
	chatId: string;
	at: number;
	targets: string[];
	outcome: "solved" | "solvedWithHints" | "movedOn" | "surrendered" | "dismissed";
	rung: "R0" | "R1" | "R2" | "R3" | "R4" | "R5" | null;
	missClass: "cue" | "discrimination" | "execution" | "careless" | "structural" | null;
	missed?: string[];
}

export interface PracticeHistory {
	records: readonly PracticeRecord[];
	teachChatIds: ReadonlySet<string>;
}

export interface PropositionReviewState {
	stability: number | null;
	difficulty: number | null;
	lastReview: number | null;
	reviews: number;
	retrievability: number | null;
	dueAt: number;
	lane: "review" | "new";
}
