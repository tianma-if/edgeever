export const AI_STREAMING_STORAGE_KEY = "edgeever.aiStreamingEnabled";

export const readAiStreamingPreference = () => {
  try {
    return typeof window !== "undefined"
      && window.localStorage.getItem(AI_STREAMING_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const writeAiStreamingPreference = (enabled: boolean) => {
  try {
    window.localStorage.setItem(AI_STREAMING_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};
