// Feature Helpers
// Purpose: Centralizes client-side reads of configuration-generated optional feature switches.
// Scope: Keeps layout/components from interpreting the server's public enabled map differently.
export function isFeatureEnabled(state, featureName) {
  /*
    The server configuration definition declares which items are public features.
    React treats missing flags as disabled so partial session payloads fail
    closed without deriving availability from credentials or service data.
  */
  return Boolean(state?.session?.features?.[featureName]);
}

export function anyFeatureEnabled(state, featureNames = []) {
  return featureNames.some((featureName) => isFeatureEnabled(state, featureName));
}
