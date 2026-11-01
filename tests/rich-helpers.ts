import { expect } from 'vitest';

// Supported formatter subset verified against https://core.telegram.org/bots/api#rich-html-style.
// This offline assertion checks syntax, not acceptance/rendering by the service.
const ATTRS: Record<string, readonly string[]> = {
  h3: [], h4: [], p: [], b: [], code: [], mark: [], hr: [], footer: [],
  img: ['src'], a: ['href'], 'tg-button-row': [], 'tg-button': ['type', 'style', 'url'],
};

/** Tags/attributes are documented, balanced and use supported HTML entities. */
export function expectWellFormed(html: string) {
  const stack: string[] = [];
  const tag = /<(\/?)([a-z][a-z0-9-]*)((?:\s+[a-z-]+="[^"<>]*")*)\s*(\/?)>/g;
  const rest = html.replace(tag, (_match, close: string, name: string, attrs: string, self: string) => {
    expect(Object.keys(ATTRS)).toContain(name);
    for (const [, key, value] of attrs.matchAll(/\s+([a-z-]+)="([^"]*)"/g)) {
      expect(ATTRS[name]).toContain(key);
      if (key === 'style') expect(['success', 'primary']).toContain(value);
      if (key === 'type') expect(value).toBe('url');
    }
    if (!close && name === 'footer') expect(stack).toEqual([]); // Independent text block.
    if (!close && name === 'img') expect(stack).toEqual([]); // Separate media block.
    if (!close && name === 'tg-button') expect(stack.at(-1)).toBe('tg-button-row');
    expect(attrs.replace(/&(?:amp|lt|gt|quot);/g, '')).not.toContain('&');
    if (self) expect(['hr', 'img']).toContain(name);
    else if (close) expect(stack.pop()).toBe(name);
    else stack.push(name);
    return '';
  });
  expect(stack).toEqual([]);
  expect(rest).not.toMatch(/[<>]/);
  expect(rest.replace(/&(?:amp|lt|gt|quot);/g, '')).not.toContain('&');
}

/** Button URLs as the reader receives them: HTML entities decoded, nothing else touched. */
export function buttonUrls(parts: string[]): string[] {
  return [...parts.join('').matchAll(/ url="([^"]*)"/g)]
    .map(match => match[1]!.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}
