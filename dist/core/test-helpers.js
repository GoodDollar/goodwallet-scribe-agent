import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
export function createTempRepo() {
    const repoRoot = mkdtempSync(join(tmpdir(), "scribe-repo-"));
    runGit(repoRoot, ["init", "--initial-branch=main"]);
    return repoRoot;
}
export function writeRepoFile(repoRoot, relativePath, content) {
    const filePath = join(repoRoot, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
}
export function commitAll(repoRoot, message) {
    runGit(repoRoot, ["add", "."]);
    runGit(repoRoot, ["-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", message]);
    return runGit(repoRoot, ["rev-parse", "HEAD"]);
}
export function createFixtureRepo(fixtureName) {
    const repoRoot = createTempRepo();
    writeFixtureState(repoRoot, fixtureName, "base");
    const baseRef = commitAll(repoRoot, "base");
    writeFixtureState(repoRoot, fixtureName, "head");
    const headRef = commitAll(repoRoot, "head");
    return { repoRoot, baseRef, headRef };
}
export function readFixtureText(relativePath) {
    return readFileSync(resolveFixturePath(relativePath), "utf8");
}
export function runGit(repoRoot, args) {
    return execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
    }).trim();
}
function writeFixtureState(repoRoot, fixtureName, state) {
    clearRepoWorkingTree(repoRoot);
    const sourceDirectory = resolveFixturePath(join(fixtureName, state));
    if (!existsSync(sourceDirectory)) {
        throw new Error(`Missing fixture state: ${fixtureName}/${state}`);
    }
    cpSync(sourceDirectory, repoRoot, { recursive: true });
}
function clearRepoWorkingTree(repoRoot) {
    for (const entry of readdirSync(repoRoot)) {
        if (entry === ".git") {
            continue;
        }
        rmSync(join(repoRoot, entry), { recursive: true, force: true });
    }
}
function resolveFixturePath(relativePath) {
    return join(import.meta.dirname, "..", "..", "fixtures", relativePath);
}
