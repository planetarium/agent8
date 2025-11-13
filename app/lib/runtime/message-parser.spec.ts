import { describe, expect, it, vi } from 'vitest';
import { StreamingMessageParser, type ActionCallback, type ArtifactCallback } from './message-parser';

interface ExpectedResult {
  output: string;
  callbacks?: {
    onArtifactOpen?: number;
    onArtifactClose?: number;
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

  describe('no artifacts', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      ['Foo bar', 'Foo bar'],
      ['Foo bar <', 'Foo bar '],
      ['Foo bar <p', 'Foo bar <p'],
      [['Foo bar <', 's', 'p', 'an>some text</span>'], 'Foo bar <span>some text</span>'],
    ])('should correctly parse chunks and strip out bolt artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('invalid or incomplete artifacts', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      ['Foo bar <b', 'Foo bar '],
      ['Foo bar <ba', 'Foo bar <ba'],
      ['Foo bar <bol', 'Foo bar '],
      ['Foo bar <bolt', 'Foo bar '],
      ['Foo bar <bolta', 'Foo bar <bolta'],
      ['Foo bar <boltA', 'Foo bar '],
      ['Foo bar <boltArtifacs></boltArtifact>', 'Foo bar <boltArtifacs></boltArtifact>'],
      ['Before <oltArtfiact>foo</boltArtifact> After', 'Before <oltArtfiact>foo</boltArtifact> After'],
      ['Before <boltArtifactt>foo</boltArtifact> After', 'Before <boltArtifactt>foo</boltArtifact> After'],
    ])('should correctly parse chunks and strip out bolt artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('valid artifacts without actions', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      [
        'Before <boltArtifact title="Some title" id="artifact_1">foo bar</boltArtifact> After',
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        ['Before <boltArti', 'fact', ' title="Some title" id="artifact_1" type="bundled" >foo</boltArtifact> After'],
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        ['Before <boltArti', 'fac', 't title="Some title" id="artifact_1"', ' ', '>', 'foo</boltArtifact> After'],
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        ['Before <boltArti', 'fact', ' title="Some title" id="artifact_1"', ' >fo', 'o</boltArtifact> After'],
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        ['Before <boltArti', 'fact tit', 'le="Some ', 'title" id="artifact_1">fo', 'o', '<', '/boltArtifact> After'],
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        ['Before <boltArti', 'fact title="Some title" id="artif', 'act_1">fo', 'o<', '/boltArtifact> After'],
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        'Before <boltArtifact title="Some title" id="artifact_1">foo</boltArtifact> After',
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
    ])('should correctly parse chunks and strip out bolt artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('valid artifacts with actions', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      [
        'Before <boltArtifact title="Some title" id="artifact_1"><boltAction type="shell">npm install</boltAction></boltArtifact> After',
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 1, onActionClose: 1 },
        },
      ],
      [
        'Before <boltArtifact title="Some title" id="artifact_1"><boltAction type="shell">npm install</boltAction><boltAction type="file" filePath="index.js">some content</boltAction></boltArtifact> After',
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 2, onActionClose: 2 },
        },
      ],
    ])('should correctly parse chunks and strip out bolt artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('action continuation with same file path', () => {
    it('should prevent content duplication when second action already contains first action content', () => {
      const callbacks = {
        onArtifactOpen: vi.fn<ArtifactCallback>(),
        onArtifactClose: vi.fn<ArtifactCallback>(),
        onActionOpen: vi.fn<ActionCallback>(),
        onActionStream: vi.fn<ActionCallback>(),
        onActionClose: vi.fn<ActionCallback>(),
      };

      const parser = new StreamingMessageParser({
        artifactElement: () => '',
        callbacks,
      });

      // First chunk with incomplete action
      const firstChunk =
        '<boltArtifact title="Continue Test" id="artifact_1"><boltAction type="file" filePath="1.txt">Hello';
      parser.parse('message_1', firstChunk);

      // Second chunk with new action that already contains the content from first action
      const secondChunk = '<boltAction type="file" filePath="1.txt">Hello World</boltAction></boltArtifact>';
      parser.parse('message_1', firstChunk + secondChunk);

      // Check if actions were processed correctly
      expect(callbacks.onArtifactOpen).toHaveBeenCalledTimes(1);
      expect(callbacks.onActionOpen).toHaveBeenCalledTimes(2);

      // The first action should have been closed automatically
      expect(callbacks.onActionClose).toHaveBeenCalledTimes(2);

      // Check content wasn't duplicated (should be 'Hello World', not 'HelloHello World')
      const lastActionCall = callbacks.onActionClose.mock.calls[1][0];
      expect(lastActionCall.action.content).toBe('Hello World\n');
    });

    it('should prevent content duplication when second action already contains first action content as markdown code block', () => {
      const callbacks = {
        onArtifactOpen: vi.fn<ArtifactCallback>(),
        onArtifactClose: vi.fn<ArtifactCallback>(),
        onActionOpen: vi.fn<ActionCallback>(),
        onActionStream: vi.fn<ActionCallback>(),
        onActionClose: vi.fn<ActionCallback>(),
      };

      const parser = new StreamingMessageParser({
        artifactElement: () => '',
        callbacks,
      });

      // First chunk with incomplete action
      const firstChunk =
        '<boltArtifact title="Continue Test" id="artifact_1"><boltAction type="file" filePath="1.txt">// Fire 8 missiles in a radial pattern\n        for (let i =';
      parser.parse('message_1', firstChunk);

      // Second chunk with new action that already contains the content from first action
      const secondChunk =
        '<boltAction type="file" filePath="1.txt">\n// Fire 8 missiles in a radial pattern\n        for (let i = 0; i < 8; i++) {\n\n</boltAction></boltArtifact>';
      parser.parse('message_1', firstChunk + secondChunk);

      // Check if actions were processed correctly
      expect(callbacks.onArtifactOpen).toHaveBeenCalledTimes(1);
      expect(callbacks.onActionOpen).toHaveBeenCalledTimes(2);

      // The first action should have been closed automatically
      expect(callbacks.onActionClose).toHaveBeenCalledTimes(2);

      // Check content wasn't duplicated
      const lastActionCall = callbacks.onActionClose.mock.calls[1][0];
      expect(lastActionCall.action.content).toBe(
        '// Fire 8 missiles in a radial pattern\n        for (let i = 0; i < 8; i++) {\n',
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
    onArtifactOpen: vi.fn<ArtifactCallback>((data) => {
      expect(data).toMatchSnapshot('onArtifactOpen');
    }),
    onArtifactClose: vi.fn<ArtifactCallback>((data) => {
      expect(data).toMatchSnapshot('onArtifactClose');
    }),
    onActionOpen: vi.fn<ActionCallback>((data) => {
      expect(data).toMatchSnapshot('onActionOpen');
    }),
    onActionClose: vi.fn<ActionCallback>((data) => {
      expect(data).toMatchSnapshot('onActionClose');
    }),
  };

  const parser = new StreamingMessageParser({
    artifactElement: () => '',
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
