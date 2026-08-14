const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
/**
 * Extracts inline Markdown link destinations, ignoring anything inside fenced code blocks.
 * Links are matched per line, so a destination split across lines is not treated as a link.
 */
export function extractMarkdownLinks(content) {
    const links = [];
    let openFence;
    for (const [index, line] of content.split(/\r?\n/).entries()) {
        const fence = FENCE_PATTERN.exec(line)?.[1];
        if (openFence) {
            if (fence && fence[0] === openFence[0] && fence.length >= openFence.length && isBlankAfterFence(line, fence)) {
                openFence = undefined;
            }
            continue;
        }
        if (fence) {
            openFence = fence;
            continue;
        }
        collectLineLinks(line, index + 1, links);
    }
    return links;
}
/**
 * Converts a link destination into a repository-relative path candidate, or `undefined`
 * when the destination is not a local path reference.
 */
export function toLocalLinkPath(destination) {
    const target = destination.trim();
    if (target.length === 0 || isIgnoredLinkTarget(target)) {
        return undefined;
    }
    const withoutFragment = target.split("#", 1)[0] ?? target;
    const decoded = percentDecode(withoutFragment);
    if (decoded.length === 0 || decoded.includes("\0")) {
        return undefined;
    }
    return decoded;
}
function isIgnoredLinkTarget(target) {
    return (target.startsWith("#")
        || target.startsWith("http://")
        || target.startsWith("https://")
        || target.startsWith("mailto:"));
}
function percentDecode(value) {
    if (!value.includes("%")) {
        return value;
    }
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
function isBlankAfterFence(line, fence) {
    return line.slice(line.indexOf(fence) + fence.length).trim().length === 0;
}
function collectLineLinks(line, lineNumber, links) {
    const codeSpans = findCodeSpans(line);
    for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "[" || isEscaped(line, index) || isInsideCodeSpan(codeSpans, index)) {
            continue;
        }
        const labelEnd = findLabelEnd(line, index + 1);
        if (labelEnd === undefined) {
            continue;
        }
        index = labelEnd;
        if (line[labelEnd + 1] !== "(") {
            continue;
        }
        const inlineLink = parseInlineDestination(line, labelEnd + 2);
        if (!inlineLink) {
            continue;
        }
        index = inlineLink.endIndex;
        if (inlineLink.destination.length > 0 && !isInsideCodeSpan(codeSpans, inlineLink.endIndex)) {
            links.push({ destination: inlineLink.destination, line: lineNumber });
        }
    }
}
/**
 * Locates matched inline code spans on a line. A backtick run opens a span that only the next
 * run of exactly the same length closes; an unmatched run stays literal Markdown, so links after
 * it are still real links.
 */
function findCodeSpans(line) {
    const spans = [];
    for (let index = 0; index < line.length;) {
        if (line[index] !== "`" || isEscaped(line, index)) {
            index += 1;
            continue;
        }
        const openLength = measureBacktickRun(line, index);
        const closeStart = findClosingBacktickRun(line, index + openLength, openLength);
        if (closeStart === undefined) {
            index += openLength;
            continue;
        }
        spans.push({ start: index, end: closeStart + openLength - 1 });
        index = closeStart + openLength;
    }
    return spans;
}
function findClosingBacktickRun(line, start, length) {
    for (let index = start; index < line.length;) {
        if (line[index] !== "`") {
            index += 1;
            continue;
        }
        const runLength = measureBacktickRun(line, index);
        if (runLength === length) {
            return index;
        }
        index += runLength;
    }
    return undefined;
}
function measureBacktickRun(line, start) {
    let length = 0;
    while (line[start + length] === "`") {
        length += 1;
    }
    return length;
}
function isInsideCodeSpan(spans, index) {
    return spans.some((span) => index >= span.start && index <= span.end);
}
function findLabelEnd(line, start) {
    for (let index = start; index < line.length; index += 1) {
        if (line[index] === "]" && !isEscaped(line, index)) {
            return index === start ? undefined : index;
        }
    }
    return undefined;
}
function parseInlineDestination(line, start) {
    let index = skipWhitespace(line, start);
    let destination;
    if (line[index] === "<") {
        const bracketed = readBracketedDestination(line, index + 1);
        if (!bracketed) {
            return undefined;
        }
        destination = bracketed.destination;
        index = bracketed.endIndex;
    }
    else {
        const bare = readBareDestination(line, index);
        destination = bare.destination;
        index = bare.endIndex;
    }
    index = skipWhitespace(line, index);
    const titleEnd = skipTitle(line, index);
    if (titleEnd === undefined) {
        return undefined;
    }
    index = skipWhitespace(line, titleEnd);
    if (line[index] !== ")") {
        return undefined;
    }
    return { destination, endIndex: index };
}
function readBracketedDestination(line, start) {
    let destination = "";
    for (let index = start; index < line.length; index += 1) {
        const character = line[index];
        const next = line[index + 1];
        if (character === "\\" && isPunctuation(next)) {
            destination += next;
            index += 1;
            continue;
        }
        if (character === ">") {
            return { destination, endIndex: index + 1 };
        }
        destination += character ?? "";
    }
    return undefined;
}
function readBareDestination(line, start) {
    let destination = "";
    let depth = 0;
    for (let index = start; index < line.length; index += 1) {
        const character = line[index];
        const next = line[index + 1];
        if (character === "\\" && isPunctuation(next)) {
            destination += next;
            index += 1;
            continue;
        }
        if (character === undefined || character === " " || character === "\t") {
            return { destination, endIndex: index };
        }
        if (character === "(") {
            depth += 1;
        }
        else if (character === ")") {
            if (depth === 0) {
                return { destination, endIndex: index };
            }
            depth -= 1;
        }
        destination += character;
    }
    return { destination, endIndex: line.length };
}
/** Returns the index just past an optional link title, or `undefined` for an unterminated title. */
function skipTitle(line, start) {
    const opener = line[start];
    if (opener !== '"' && opener !== "'" && opener !== "(") {
        return start;
    }
    const closer = opener === "(" ? ")" : opener;
    for (let index = start + 1; index < line.length; index += 1) {
        if (line[index] === "\\" && isPunctuation(line[index + 1])) {
            index += 1;
            continue;
        }
        if (line[index] === closer) {
            return index + 1;
        }
    }
    return undefined;
}
function skipWhitespace(line, start) {
    let index = start;
    while (line[index] === " " || line[index] === "\t") {
        index += 1;
    }
    return index;
}
function isEscaped(line, index) {
    let backslashes = 0;
    for (let current = index - 1; current >= 0 && line[current] === "\\"; current -= 1) {
        backslashes += 1;
    }
    return backslashes % 2 === 1;
}
function isPunctuation(character) {
    return character !== undefined && /[\p{P}\p{S}]/u.test(character);
}
