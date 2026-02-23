function normalizeGlobCandidate(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function globToRegExpSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      const next = pattern[index + 1];
      if (next === "*") {
        const nextNext = pattern[index + 2];
        if (nextNext === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    if ("\\^$+?.()|{}[]/-".includes(char)) {
      source += `\\${char}`;
      continue;
    }

    source += char;
  }
  return source;
}

export function normalizeGlobPattern(pattern: string): string {
  return normalizeGlobCandidate(pattern.trim());
}

export function compileGlobPatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(`^${globToRegExpSource(pattern)}$`, "u"));
}

export function matchesAnyGlob(candidate: string, compiledPatterns: RegExp[]): boolean {
  const normalized = normalizeGlobCandidate(candidate);
  return compiledPatterns.some((pattern) => pattern.test(normalized));
}
