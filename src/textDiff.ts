export interface TextChange {
  /** Offset in the old text where the replaced range starts. */
  start: number;
  /** Offset in the old text where the replaced range ends (exclusive). */
  end: number;
  /** Replacement text. */
  text: string;
}

/**
 * Computes the smallest single-range replacement that turns `oldText` into
 * `newText` by trimming their common prefix and suffix. Returns `undefined`
 * when the texts are identical.
 */
export function computeChange(oldText: string, newText: string): TextChange | undefined {
  if (oldText === newText) {
    return undefined;
  }

  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix++;
  }

  const maxSuffix = maxPrefix - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }

  // Never split a surrogate pair or a CRLF sequence across the edit boundary,
  // in either text: VS Code would normalize the dangling half.
  while (prefix > 0 && (isSplitPoint(oldText, prefix) || isSplitPoint(newText, prefix))) {
    prefix--;
  }
  while (
    suffix > 0 &&
    (isSplitPoint(oldText, oldText.length - suffix) || isSplitPoint(newText, newText.length - suffix))
  ) {
    suffix--;
  }

  return {
    start: prefix,
    end: oldText.length - suffix,
    text: newText.slice(prefix, newText.length - suffix),
  };
}

function isSplitPoint(text: string, index: number): boolean {
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  const highSurrogate = before >= 0xd800 && before <= 0xdbff;
  const lowSurrogate = after >= 0xdc00 && after <= 0xdfff;
  return (highSurrogate && lowSurrogate) || (before === 0x0d && after === 0x0a);
}
