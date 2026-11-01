import { expect } from 'vitest';

/** Tags are balanced and only the entities Telegram's HTML accepts are present. */
export function expectWellFormed(html: string) {
  const stack: string[] = [];
  const tag = /<(\/?)([a-z][a-z0-9-]*)((?:\s+[a-z-]+="[^"<>]*")*)\s*(\/?)>/g;
  const rest = html.replace(tag, (_match, close: string, name: string, attrs: string, self: string) => {
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
