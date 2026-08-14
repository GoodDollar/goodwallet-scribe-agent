import { describe, expect, test } from "vitest";
import * as core from "./index.js";
describe("core public API", () => {
    test("exports the stable task-two surface", () => {
        expect(Object.keys(core).sort()).toEqual([
            "checkLocalLinks",
            "collectBoundedContexts",
            "discoverGitChanges",
            "findingSchema",
            "loadConfig",
            "parseProviderFindingsResponse",
            "selectPrimaryDocuments",
        ]);
    });
});
