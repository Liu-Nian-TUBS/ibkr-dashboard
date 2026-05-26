import { useCallback, useEffect, useState } from "react";
import type { DependencyList } from "react";
import type { PageState } from "./contracts";

export function useApiData<T>(
  request: () => Promise<T>,
  deps: DependencyList = [],
  initialData: T | null = null,
) {
  const [state, setState] = useState<PageState<T>>({
    data: initialData,
    loading: initialData === null,
    error: null,
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await request();
      setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "unknown error",
      }));
      return null;
    }
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, setState, load };
}
