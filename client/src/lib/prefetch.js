import { api } from "./api.js";
import { loaders } from "../routes.js";

// On hover or focus of a case link, start loading that page's code and data, so the click
// feels instant. Both are cached: repeated hovers cost nothing.
export function prefetchCase(queryClient, caseId) {
  loaders.caseDetail();
  queryClient.prefetchQuery({ queryKey: ["case", caseId], queryFn: ({ signal }) => api(`/cases/${caseId}`, { signal }) });
}

export function prefetchRecord(queryClient, caseId) {
  loaders.caseRecord();
  queryClient.prefetchQuery({ queryKey: ["record", `/cases/${caseId}`], queryFn: ({ signal }) => api(`/cases/${caseId}/document`, { signal }) });
}
