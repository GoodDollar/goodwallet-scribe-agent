import type { Finding } from "../core/findings.js";
import type { PrimaryDocumentContext } from "../core/context.js";

export interface ProviderRequest {
  contexts: PrimaryDocumentContext[];
}

export interface Provider {
  review(request: ProviderRequest): Promise<Finding[]>;
}
