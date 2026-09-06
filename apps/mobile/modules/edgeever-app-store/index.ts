import { requireNativeModule } from "expo";

export type GooglePlayOpenResult = "disabled" | "not-installed" | "opened" | "unavailable";

type EdgeEverAppStoreNativeModule = {
  openGooglePlayDetails: (applicationId: string) => Promise<GooglePlayOpenResult | boolean>;
};

export const openGooglePlayDetails = async (applicationId: string): Promise<GooglePlayOpenResult> => {
  const result = await requireNativeModule<EdgeEverAppStoreNativeModule>("EdgeEverAppStore")
    .openGooglePlayDetails(applicationId);
  if (result === true) {
    return "opened";
  }
  if (result === false) {
    return "unavailable";
  }
  return result;
};
