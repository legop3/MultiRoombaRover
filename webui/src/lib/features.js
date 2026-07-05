// Feature Helpers
// Purpose: Centralizes client-side reads of server-advertised optional features.
// Scope: Keeps layout/components from each inventing their own "is this feature configured?" rule.
export function isFeatureEnabled(state, featureName) {
  /*
    The server owns feature detection because only it can reliably know whether
    config-driven hardware integrations exist. React should treat missing flags
    as disabled so old or partial session payloads fail closed and hide extras.
  */
  return Boolean(state?.session?.features?.[featureName]);
}

export function anyFeatureEnabled(state, featureNames = []) {
  return featureNames.some((featureName) => isFeatureEnabled(state, featureName));
}
