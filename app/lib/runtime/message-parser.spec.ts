import { describe, expect, it, vi } from 'vitest';
import { StreamingMessageParser, type ActionCallback } from './message-parser';

interface ExpectedResult {
  output: string;
  callbacks?: {
    onActionOpen?: number;
    onActionClose?: number;
  };
}

describe('StreamingMessageParser', () => {
  it('should pass through normal text', () => {
    const parser = new StreamingMessageParser();
    expect(parser.parse('test_id', 'Hello, world!')).toBe('Hello, world!');
  });

  it('should allow normal HTML tags', () => {
    const parser = new StreamingMessageParser();
    expect(parser.parse('test_id', 'Hello <strong>world</strong>!')).toBe('Hello <strong>world</strong>!');
  });

  describe('no actions', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      ['Foo bar', 'Foo bar'],
      ['Foo bar <', 'Foo bar '],
      ['Foo bar <p', 'Foo bar <p'],
      [['Foo bar <', 's', 'p', 'an>some text</span>'], 'Foo bar <span>some text</span>'],
    ])('should correctly parse chunks (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('invalid or incomplete actions', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      ['Foo bar <b', 'Foo bar '],
      ['Foo bar <ba', 'Foo bar <ba'],
      ['Foo bar <bol', 'Foo bar '],
      ['Foo bar <bolt', 'Foo bar '],
      ['Foo bar <bolta', 'Foo bar <bolta'],
      ['Foo bar <boltA', 'Foo bar '],
      ['Foo bar <boltActions></boltAction>', 'Foo bar <boltActions></boltAction>'],
      ['Before <oltAction>foo</boltAction> After', 'Before <oltAction>foo</boltAction> After'],
      ['Before <boltActionn>foo</boltAction> After', 'Before <boltActionn>foo</boltAction> After'],
    ])('should correctly parse chunks (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('valid actions', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      [
        'Some text before <boltAction type="shell">npm install</boltAction> Some more text',
        {
          output:
            'Some text before <div class="__boltAction__" data-message-id="message_1" data-action-id="message_1:action-0"></div>\n Some more text',
          callbacks: { onActionOpen: 1, onActionClose: 1 },
        },
      ],
      [
        ['Some text before <boltAct', 'ion', ' type="shell">npm install</boltAction> Some more text'],
        {
          output:
            'Some text before <div class="__boltAction__" data-message-id="message_1" data-action-id="message_1:action-0"></div>\n Some more text',
          callbacks: { onActionOpen: 1, onActionClose: 1 },
        },
      ],
      [
        [
          'Some text before <boltAct',
          'io',
          'n type="file" filePath="test.js"',
          ' ',
          '>',
          'content</boltAction> Some more text',
        ],
        {
          output:
            'Some text before <div class="__boltAction__" data-message-id="message_1" data-action-id="message_1:action-0"></div>\n Some more text',
          callbacks: { onActionOpen: 1, onActionClose: 1 },
        },
      ],
      [
        ['Some text before <boltAct', 'ion', ' type="shell"', ' >np', 'm test</boltAction> Some more text'],
        {
          output:
            'Some text before <div class="__boltAction__" data-message-id="message_1" data-action-id="message_1:action-0"></div>\n Some more text',
          callbacks: { onActionOpen: 1, onActionClose: 1 },
        },
      ],
      [
        ['Some text before <boltAct', 'ion ty', 'pe="shel', 'l">npm', ' test', '<', '/boltAction> Some more text'],
        {
          output:
            'Some text before <div class="__boltAction__" data-message-id="message_1" data-action-id="message_1:action-0"></div>\n Some more text',
          callbacks: { onActionOpen: 1, onActionClose: 1 },
        },
      ],
      [
        ['Some text before <boltAct', 'ion type="shell"', '>npm t', 'est<', '/boltAction> Some more text'],
        {
          output:
            'Some text before <div class="__boltAction__" data-message-id="message_1" data-action-id="message_1:action-0"></div>\n Some more text',
          callbacks: { onActionOpen: 1, onActionClose: 1 },
        },
      ],
      [
        'Before <boltAction type="shell">npm test</boltAction> After',
        {
          output:
            'Before <div class="__boltAction__" data-message-id="message_1" data-action-id="message_1:action-0"></div>\n After',
          callbacks: { onActionOpen: 1, onActionClose: 1 },
        },
      ],
    ])('should correctly parse chunks (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('multiple actions', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      [
        'Before <boltAction type="shell">npm install</boltAction> After',
        {
          output:
            'Before <div class="__boltAction__" data-message-id="message_1" data-action-id="message_1:action-0"></div>\n After',
          callbacks: { onActionOpen: 1, onActionClose: 1 },
        },
      ],
      [
        'Before <boltAction type="shell">npm install</boltAction><boltAction type="file" filePath="index.js">some content</boltAction> After',
        {
          output:
            'Before <div class="__boltAction__" data-message-id="message_1" data-action-id="message_1:action-0"></div>\n<div class="__boltAction__" data-message-id="message_1" data-action-id="message_1:action-1"></div>\n After',
          callbacks: { onActionOpen: 2, onActionClose: 2 },
        },
      ],
    ])('should correctly parse chunks (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('action continuation with same file path', () => {
    it('should handle action content correctly when streamed in chunks', () => {
      const callbacks = {
        onActionOpen: vi.fn<ActionCallback>(),
        onActionStream: vi.fn<ActionCallback>(),
        onActionClose: vi.fn<ActionCallback>(),
      };

      const parser = new StreamingMessageParser({
        callbacks,
      });

      // First chunk with incomplete action
      const firstChunk = '<boltAction type="file" filePath="1.txt">Hello';
      parser.parse('message_1', firstChunk);

      // Second chunk completing the action
      const secondChunk = ' World</boltAction>';
      parser.parse('message_1', firstChunk + secondChunk);

      // Check if action was processed correctly
      expect(callbacks.onActionOpen).toHaveBeenCalledTimes(1);

      // The action should have been closed
      expect(callbacks.onActionClose).toHaveBeenCalledTimes(1);

      // Check content is correct
      const lastActionCall = callbacks.onActionClose.mock.calls[0][0];
      expect(lastActionCall.action.content).toBe('Hello World\n');
    });

    it('should handle action content correctly with markdown code blocks', () => {
      const callbacks = {
        onActionOpen: vi.fn<ActionCallback>(),
        onActionStream: vi.fn<ActionCallback>(),
        onActionClose: vi.fn<ActionCallback>(),
      };

      const parser = new StreamingMessageParser({
        callbacks,
      });

      // First chunk with incomplete action
      const firstChunk =
        '<boltAction type="file" filePath="1.txt">// Fire 8 missiles in a radial pattern\n        for (let i =';
      parser.parse('message_1', firstChunk);

      // Second chunk completing the action
      const secondChunk = ' 0; i < 8; i++) {\n\n}</boltAction>';
      parser.parse('message_1', firstChunk + secondChunk);

      // Check if action was processed correctly
      expect(callbacks.onActionOpen).toHaveBeenCalledTimes(1);

      // The action should have been closed
      expect(callbacks.onActionClose).toHaveBeenCalledTimes(1);

      // Check content is correct
      const lastActionCall = callbacks.onActionClose.mock.calls[0][0];
      expect(lastActionCall.action.content).toBe(
        '// Fire 8 missiles in a radial pattern\n        for (let i = 0; i < 8; i++) {\n\n}\n',
      );
    });
  });
});

function runTest(input: string | string[], outputOrExpectedResult: string | ExpectedResult) {
  let expected: ExpectedResult;

  if (typeof outputOrExpectedResult === 'string') {
    expected = { output: outputOrExpectedResult };
  } else {
    expected = outputOrExpectedResult;
  }

  const callbacks = {
    onActionOpen: vi.fn<ActionCallback>((data) => {
      expect(data).toMatchSnapshot('onActionOpen');
    }),
    onActionClose: vi.fn<ActionCallback>((data) => {
      expect(data).toMatchSnapshot('onActionClose');
    }),
  };

  const parser = new StreamingMessageParser({
    callbacks,
  });

  let message = '';

  let result = '';

  const chunks = Array.isArray(input) ? input : input.split('');

  for (const chunk of chunks) {
    message += chunk;

    result += parser.parse('message_1', message);
  }

  for (const name in expected.callbacks) {
    const callbackName = name;

    expect(callbacks[callbackName as keyof typeof callbacks]).toHaveBeenCalledTimes(
      expected.callbacks[callbackName as keyof typeof expected.callbacks] ?? 0,
    );
  }

  expect(result).toEqual(expected.output);
}
