import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeChange, type TextChange } from '../src/textDiff.ts';

function apply(text: string, change: TextChange | undefined): string {
  return change ? text.slice(0, change.start) + change.text + text.slice(change.end) : text;
}

function splitsPair(text: string, index: number): boolean {
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) || (before === 13 && after === 10);
}

test('identical texts produce no change', () => {
  assert.equal(computeChange('abc', 'abc'), undefined);
  assert.equal(computeChange('', ''), undefined);
});

test('trims common prefix and suffix', () => {
  assert.deepEqual(computeChange('hello world', 'hello brave world'), { start: 6, end: 6, text: 'brave ' });
  assert.deepEqual(computeChange('hello brave world', 'hello world'), { start: 6, end: 12, text: '' });
  assert.deepEqual(computeChange('# Title\n\nold\n', '# Title\n\nnew\n'), { start: 9, end: 12, text: 'new' });
});

test('handles empty documents', () => {
  assert.deepEqual(computeChange('', 'abc'), { start: 0, end: 0, text: 'abc' });
  assert.deepEqual(computeChange('abc', ''), { start: 0, end: 3, text: '' });
});

test('repeated characters stay consistent', () => {
  const change = computeChange('aaaa', 'aaaaaa');
  assert.equal(apply('aaaa', change), 'aaaaaa');
});

test('never splits CRLF or surrogate pairs', () => {
  assert.equal(apply('a\r\nb', computeChange('a\r\nb', 'a\rb')), 'a\rb');
  const change = computeChange('x😀y', 'x😁y')!;
  assert.ok(!splitsPair('x😀y', change.start) && !splitsPair('x😀y', change.end));
});

test('random edits round-trip without splitting pairs', () => {
  const atoms = ['a', 'b', '\n', '\r\n', '\r', '😀', '😁', ' '];
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const randomText = () => Array.from({ length: Math.floor(random() * 12) }, () => atoms[Math.floor(random() * atoms.length)]).join('');

  for (let i = 0; i < 20000; i++) {
    const oldText = randomText();
    const newText = random() < 0.5 ? randomText() : oldText.slice(0, Math.floor(random() * oldText.length)) + randomText();
    const change = computeChange(oldText, newText);
    assert.equal(apply(oldText, change), newText, JSON.stringify({ oldText, newText, change }));
    if (change) {
      const newEnd = change.start + change.text.length;
      assert.ok(!splitsPair(oldText, change.start) && !splitsPair(oldText, change.end), JSON.stringify({ oldText, newText, change }));
      assert.ok(!splitsPair(newText, change.start) && !splitsPair(newText, newEnd), JSON.stringify({ oldText, newText, change }));
    }
  }
});
