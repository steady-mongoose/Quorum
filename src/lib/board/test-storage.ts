const memory = new Map<string, string>();

const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, String(value));
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
};

function usable(): boolean {
  try {
    globalThis.localStorage.setItem("__probe", "1");
    globalThis.localStorage.removeItem("__probe");
    return true;
  } catch {
    return false;
  }
}

if (typeof globalThis.localStorage === "undefined" || !usable()) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
}

// Zustand persist reads window.localStorage. Node has neither window nor storage.
if (typeof globalThis.window === "undefined") {
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
}
