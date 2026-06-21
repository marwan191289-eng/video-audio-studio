import { useState, useEffect } from "react";

export function useLocalSettings<T>(
  key: string,
  defaultValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return defaultValue;
      const parsed = JSON.parse(stored) as T;
      if (
        typeof defaultValue === "object" &&
        defaultValue !== null &&
        !Array.isArray(defaultValue) &&
        typeof parsed === "object" &&
        parsed !== null
      ) {
        return { ...defaultValue, ...parsed } as T;
      }
      return parsed;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
    }
  }, [key, value]);

  return [value, setValue];
}
