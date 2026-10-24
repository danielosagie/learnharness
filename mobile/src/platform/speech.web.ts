export const ExpoSpeechRecognitionModule = {
	stop() {},
	async requestPermissionsAsync() { return { granted: false }; },
	start(_options: unknown) {},
};
export function useSpeechRecognitionEvent(_name: string, _callback: (event: { results: { transcript: string }[] }) => void) {}
