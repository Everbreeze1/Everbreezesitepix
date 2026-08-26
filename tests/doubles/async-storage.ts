/** In-memory stand-in for `@react-native-async-storage/async-storage`. */

const store = new Map<string, string>();

export function __reset(): void {
  store.clear();
}

export function __seed(key: string, value: string): void {
  store.set(key, value);
}

export function __has(key: string): boolean {
  return store.has(key);
}

const AsyncStorage = {
  getItem: async (key: string) => (store.has(key) ? (store.get(key) as string) : null),
  setItem: async (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: async (key: string) => {
    store.delete(key);
  },
};

export default AsyncStorage;
