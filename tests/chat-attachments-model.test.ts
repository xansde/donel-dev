// T088 (014-chat) - pure model of the composer attachments.
import { describe, expect, it } from 'vitest';
import {
  appendMention,
  canSend,
  imageLabels,
  imageTypeOf,
  mentionFor,
  sendRequestOf,
  type DraftImage,
} from '../src/renderer/src/chat/composer/attachmentsModel';

const img = (id: string, origin: 'pasted' | 'picked', name?: string): DraftImage => ({
  id,
  path: `C:/ud/chat-attachments/s1/${id}.png`,
  mediaType: 'image/png',
  origin,
  ...(name !== undefined ? { name } : {}),
});

describe('imageTypeOf', () => {
  it('trusts a known browser type and falls back to the extension when the type is empty', () => {
    expect(imageTypeOf({ name: 'a.bin', type: 'image/webp' })).toBe('image/webp');
    expect(imageTypeOf({ name: 'Print.PNG', type: '' })).toBe('image/png');
    expect(imageTypeOf({ name: 'x.jpeg', type: 'application/octet-stream' })).toBe('image/jpeg');
  });
  it('refuses SVG, documents and anything else', () => {
    expect(imageTypeOf({ name: 'a.svg', type: 'image/svg+xml' })).toBeNull();
    expect(imageTypeOf({ name: 'a.pdf', type: 'application/pdf' })).toBeNull();
    expect(imageTypeOf({ name: 'a.png', type: 'text/plain' })).toBeNull();
    expect(imageTypeOf({ name: 'noext', type: '' })).toBeNull();
  });
});

describe('mentionFor', () => {
  it('is @relative inside the cwd (Windows paths, any slash, any case of the drive)', () => {
    expect(mentionFor('C:\\Users\\x\\proj\\src\\a.ts', 'c:\\users\\x\\proj')).toBe('@src/a.ts');
    expect(mentionFor('C:/Users/x/proj/README.md', 'C:/Users/x/proj/')).toBe('@README.md');
  });
  it('is the plain absolute path outside the cwd (the @ with absolute path is unconfirmed, R4)', () => {
    expect(mentionFor('D:\\other\\a.ts', 'C:\\Users\\x\\proj')).toBe('D:/other/a.ts');
    expect(mentionFor('C:\\Users\\x\\project2\\a.ts', 'C:\\Users\\x\\proj')).toBe('C:/Users/x/project2/a.ts');
  });
  it('quotes a path with spaces and tolerates an unknown cwd', () => {
    expect(mentionFor('C:\\p\\my docs\\a.md', 'C:\\p')).toBe('@"my docs/a.md"');
    expect(mentionFor('/home/u/a.md', undefined)).toBe('/home/u/a.md');
    expect(mentionFor('/home/u/proj/a.md', '/home/u/proj')).toBe('@a.md');
  });
});

describe('appendMention', () => {
  it('separates with a single space and leaves the caret-friendly trailing space', () => {
    expect(appendMention('', '@a.ts')).toBe('@a.ts ');
    expect(appendMention('olhe', '@a.ts')).toBe('olhe @a.ts ');
    expect(appendMention('olhe ', '@a.ts')).toBe('olhe @a.ts ');
  });
});

describe('imageLabels', () => {
  it('numbers the pasted ones in order and keeps the name of the picked ones', () => {
    expect(imageLabels([img('a', 'pasted'), img('b', 'picked', 'erro.png'), img('c', 'pasted')])).toEqual([
      'imagem colada 1',
      'erro.png',
      'imagem colada 2',
    ]);
  });
});

describe('sending', () => {
  it('an image alone (empty text) can be sent; empty everything cannot', () => {
    expect(canSend('', [img('a', 'pasted')])).toBe(true);
    expect(canSend('  ', [])).toBe(false);
    expect(canSend('oi', [])).toBe(true);
  });
  it('builds the request with one path per image, in order', () => {
    expect(sendRequestOf('olhe', [img('a', 'pasted'), img('b', 'picked')], 'normal')).toEqual({
      text: 'olhe',
      mode: 'normal',
      imagePaths: ['C:/ud/chat-attachments/s1/a.png', 'C:/ud/chat-attachments/s1/b.png'],
    });
  });
  it('omits imagePaths when there is no image', () => {
    expect(sendRequestOf('oi', [], 'interrupt-first')).toEqual({ text: 'oi', mode: 'interrupt-first' });
  });
});
