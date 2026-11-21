/**
 * Resiliently extracts a JSON object from an LLM/Agent response that may include
 * prose, thinking output, or markdown code fences.
 */
export function extractJsonObject<T = Record<string, unknown>>(rawText: string): T | null {
  const text = rawText.trim();
  if (!text) return null;

  // 1. Direct parse
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === 'object') return direct as T;
  } catch {
    // continue
  }

  // 2. Markdown ```json ... ``` blocks (prefer the LAST valid JSON block, as agents often explain first)
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  const fencedCandidates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    if (match[1]?.trim()) fencedCandidates.push(match[1].trim());
  }
  for (let i = fencedCandidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(fencedCandidates[i]);
      if (parsed && typeof parsed === 'object') return parsed as T;
    } catch {
      // continue
    }
  }

  // 3. Balanced brace scan from the end / start
  const braceCandidates = collectBalancedObjects(text);
  for (let i = braceCandidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(braceCandidates[i]);
      if (parsed && typeof parsed === 'object') return parsed as T;
    } catch {
      // continue
    }
  }

  return null;
}

function collectBalancedObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          results.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return results;
}
