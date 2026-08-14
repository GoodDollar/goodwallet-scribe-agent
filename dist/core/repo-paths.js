import { normalize } from "node:path";
export function toRepoPath(path) {
    return normalize(path).replaceAll("\\", "/").replace(/^\.\//, "");
}
export function isSecretPath(path) {
    const normalizedPath = toRepoPath(path).toLowerCase();
    const fileName = normalizedPath.split("/").at(-1) ?? normalizedPath;
    return (fileName.startsWith(".env")
        || fileName.endsWith(".key")
        || fileName.endsWith(".pem")
        || fileName.endsWith(".p12")
        || fileName.endsWith(".pfx")
        || normalizedPath.includes("credential")
        || normalizedPath.includes("secret"));
}
