import test from 'node:test';
import assert from 'node:assert/strict';
import { readLocalStorageJson } from '../src/lib/safeStorage.ts';

test('recupera armazenamento JSON corrompido sem derrubar o aplicativo', () => {
  const values = new Map<string, string>([
    ['corrompido', '{"valor":'],
    ['tipo-errado', '{"valor":1}'],
    ['valido', '[1,2,3]']
  ]);
  const removed: string[] = [];
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        removed.push(key);
        values.delete(key);
      }
    }
  });

  try {
    assert.deepEqual(readLocalStorageJson('corrompido', []), []);
    assert.deepEqual(
      readLocalStorageJson<number[]>(
        'tipo-errado',
        [],
        (value): value is number[] => Array.isArray(value)
      ),
      []
    );
    assert.deepEqual(
      readLocalStorageJson<number[]>(
        'valido',
        [],
        (value): value is number[] => Array.isArray(value)
      ),
      [1, 2, 3]
    );
    assert.deepEqual(removed.sort(), ['corrompido', 'tipo-errado']);
  } finally {
    if (originalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalStorage);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  }
});
