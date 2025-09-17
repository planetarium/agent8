import { describe, expect, it } from 'vitest';
import { stripCodeFenceFromAction } from './Markdown';

describe('stripCodeFenceFromAction', () => {
  it('should remove code fences around action element', () => {
    const input = "```xml\n<div class='__boltAction__'></div>\n```";
    const expected = "\n<div class='__boltAction__'></div>\n";
    expect(stripCodeFenceFromAction(input)).toBe(expected);
  });

  it('should handle code fence with language specification', () => {
    const input = "```typescript\n<div class='__boltAction__'></div>\n```";
    const expected = "\n<div class='__boltAction__'></div>\n";
    expect(stripCodeFenceFromAction(input)).toBe(expected);
  });

  it('should handle code fences with CDATA', () => {
    const input = "<![CDATA[\n<div class='__boltAction__'></div>\n]]>";
    const expected = "\n<div class='__boltAction__'></div>\n";
    expect(stripCodeFenceFromAction(input)).toBe(expected);
  });

  it('should not modify content without actions', () => {
    const input = '```\nregular code block\n```';
    expect(stripCodeFenceFromAction(input)).toBe(input);
  });

  it('should handle empty input', () => {
    expect(stripCodeFenceFromAction('')).toBe('');
  });

  it('should handle action without code fences', () => {
    const input = "<div class='__boltAction__'></div>";
    expect(stripCodeFenceFromAction(input)).toBe(input);
  });

  it('should handle multiple action but only remove fences around them', () => {
    const input = [
      'Some text',
      '```typescript',
      "<div class='__boltAction__'></div>",
      '```',
      '```',
      'regular code',
      '```',
    ].join('\n');

    const expected = ['Some text', '', "<div class='__boltAction__'></div>", '', '```', 'regular code', '```'].join(
      '\n',
    );

    expect(stripCodeFenceFromAction(input)).toBe(expected);
  });
});
