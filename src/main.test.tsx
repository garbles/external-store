import { act, renderHook, render } from "@testing-library/react";
import { AsyncExternalStore, ExternalStore } from "./main";
import React from "react";

class ErrorBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override state = { hasError: false };

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

abstract class AbstractCounterStore extends ExternalStore<{ count: number }> {
  constructor(public incrementer = 1) {
    super({ count: 0 });
  }

  abstract increment(): void;

  abstract decrement(): void;
}

class CounterStore extends AbstractCounterStore {
  increment() {
    this.setState((prev) => ({ count: prev.count + this.incrementer }));
  }

  decrement() {
    this.setState((prev) => ({ count: prev.count - this.incrementer }));
  }

  crash() {
    throw new Error("Crash!");
  }
}

class AsyncCounterStore extends AsyncExternalStore<{ count: number }> {
  constructor(intialState?: { count: number }) {
    super(intialState);
  }

  increment() {
    this.setStateAsync(async (prev) => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const count = prev?.count ?? 0;

      return { count: count + 1 };
    });
  }

  decrement() {
    this.setStateAsync(async (prev) => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const count = prev?.count ?? 0;

      return { count: count - 1 };
    });
  }

  crash() {
    this.setStateAsync(async () => {
      throw new Error("Crash!");
    });
  }
}

test("type checks", () => {
  const syncStore = new CounterStore();
  const asyncStore = new AsyncCounterStore();

  const [_Provider, useSyncStore] = ExternalStore.createProvider(syncStore);
  const [AsyncProvider, useAsyncStore] = ExternalStore.createProvider(asyncStore);

  /**
   * These members exist on the store, but should not be accessed directly from the hook.
   */
  syncStore.state;
  syncStore.use;
  syncStore.subscribe;

  /**
   * This member is defined on the subclass, so it is accessible here, but not from the hook.
   */
  syncStore.incrementer;

  const fakeStore = {
    use(): [{ count: number }, { increment(): void; decrement(): void; crash(): void }] {
      return [{ count: 0 }, { increment(): void {}, decrement(): void {}, crash(): void {} }];
    },
  };

  /**
   * Prevent creating a provider for a non-external-store
   */

  // @ts-expect-error
  <AsyncProvider store={fakeStore} />;

  // @ts-ignore
  function App() {
    const [_state, syncActions] = useSyncStore();
    const [_asyncState, asyncActions] = useAsyncStore();

    /**
     * These members exist on the JS object but ideally shouldn't be used,
     * so make sure that we use the typesystem to prevent access.
     */

    // @ts-expect-error
    syncActions.use;

    // @ts-expect-error
    syncActions.state;

    // @ts-expect-error
    syncActions.setState;

    // @ts-expect-error
    syncActions.incrementer;

    // @ts-expect-error
    syncActions.subscribe;

    // @ts-expect-error
    syncActions.reset;

    // @ts-expect-error
    syncActions.hydrate;

    // @ts-expect-error
    asyncActions.use;

    // @ts-expect-error
    asyncActions.setStateAsync;
  }
});

test("uses a store as a hook", () => {
  const store = new CounterStore(5);

  const { result } = renderHook(() => store.use());
  const { result: resultWithSelector } = renderHook(() => store.use((state) => state.count));

  expect(result.current[0]).toEqual({ count: 0 });
  expect(resultWithSelector.current[0]).toEqual(0);

  act(() => {
    result.current[1].increment();
    result.current[1].increment();
  });

  expect(result.current[0]).toEqual({ count: 10 });
  expect(resultWithSelector.current[0]).toEqual(10);

  act(() => {
    result.current[1].decrement();
  });

  expect(result.current[0]).toEqual({ count: 5 });
  expect(resultWithSelector.current[0]).toEqual(5);

  act(() => {
    store.reset();
  });

  expect(result.current[0]).toEqual({ count: 0 });
  expect(resultWithSelector.current[0]).toEqual(0);
});

test("does not require react to be able to test state changes", () => {
  const store = new CounterStore(2);

  expect(store.state).toEqual({ count: 0 });

  store.increment();
  store.increment();
  expect(store.state).toEqual({ count: 4 });

  store.decrement();
  expect(store.state).toEqual({ count: 2 });
});

describe("AsyncExternalStore", () => {
  const Inner = (props: { store: AsyncCounterStore }) => {
    const [count] = props.store.use((s) => s.count);

    return <div data-testid="idle">{count}</div>;
  };

  const App = (props: { store: AsyncCounterStore }) => {
    return (
      <ErrorBoundary fallback={<div data-testid="error">Error!</div>}>
        <React.Suspense fallback={<div data-testid="loading">Loading...</div>}>
          <Inner store={props.store} />
        </React.Suspense>
      </ErrorBoundary>
    );
  };

  test("multiple concurrent async updates will abort previous ones", async () => {
    vi.useFakeTimers();

    const store = new AsyncCounterStore();

    const { result } = renderHook(() => store.use((s) => s.count));

    await act(async () => store.hydrate({ count: 0 }));

    expect(result.current[0]).toEqual(0);

    await act(async () => {
      result.current[1].increment();
      result.current[1].increment();
      result.current[1].increment();
      result.current[1].increment();
      result.current[1].increment();
      result.current[1].decrement();
      result.current[1].increment();

      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current[0]).toEqual(1);
  });

  test("async store will suspend until resolved", async () => {
    vi.useFakeTimers();

    const store = new AsyncCounterStore();

    const { getByTestId } = render(<App store={store} />);

    expect(getByTestId("loading")).toBeDefined();
    expect(store.state).toMatchObject({ status: "uninitialized", loading: false, refreshing: false });

    await act(async () => {
      store.increment();
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    /**
     * Still loading...
     */
    expect(getByTestId("loading")).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(getByTestId("idle")).toBeDefined();
    expect(getByTestId("idle").textContent).toEqual("1");
  });

  test("async store will show error boundary if rejected", async () => {
    vi.useFakeTimers();
    const store = new AsyncCounterStore();

    const { getByTestId } = render(<App store={store} />);

    expect(getByTestId("loading")).toBeDefined();

    await act(async () => {
      store.crash();
      await Promise.resolve();
    });

    expect(getByTestId("error")).toBeDefined();
  });
});

describe("ExternalStore.createProvider", () => {
  const store = new AsyncCounterStore();

  const [AsyncTestStoreProvider, useAsyncTestStore] = ExternalStore.createProvider(store);
  const [AbstractProvider, useAbstractStore] = ExternalStore.createProvider<AbstractCounterStore>("CounterStore");

  test("use the store via hook without the context provider", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useAsyncTestStore((state) => state.count));

    /**
     * Unitialized.
     */
    expect(result.current).toEqual(null);

    await act(() => store.hydrate({ count: 0 }));

    expect(result.current[0]).toEqual(0);

    await act(async () => {
      result.current[1].increment();
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(result.current[0]).toEqual(1);

    await act(async () => {
      result.current[1].decrement();
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(result.current[0]).toEqual(0);
  });

  test("can replace an async store with a sync one as long as they have the same actions", async () => {
    const testStore = new CounterStore();

    const { result } = renderHook(() => useAsyncTestStore((state) => state.count), {
      wrapper: ({ children }) => <AsyncTestStoreProvider store={testStore}>{children}</AsyncTestStoreProvider>,
    });

    expect(result.current[0]).toEqual(0);

    await act(() => result.current[1].increment());

    expect(result.current[0]).toEqual(1);

    await act(() => result.current[1].decrement());

    expect(result.current[0]).toEqual(0);
  });

  test("creates a provider and hook for an abstract store", async () => {
    const store = new CounterStore(3);

    const { result } = renderHook(() => useAbstractStore((s) => s.count), {
      wrapper: ({ children }) => <AbstractProvider store={store}>{children}</AbstractProvider>,
    });

    expect(result.current[0]).toEqual(0);

    await act(async () => {
      result.current[1].increment();
      result.current[1].increment();
    });

    expect(result.current[0]).toEqual(6);
  });

  test("abstract hook throws if used outside of a abstract provider", () => {
    expect(() => renderHook(() => useAbstractStore())).toThrowError("Hook must be used within a ExternalStoreProvider(CounterStore)");
  });

  test("type check: does not provide methods that are not part of the abstract store", () => {
    const store = new CounterStore(3);

    const { result } = renderHook(() => useAbstractStore(), {
      wrapper: ({ children }) => <AbstractProvider store={store}>{children}</AbstractProvider>,
    });

    // @ts-expect-error
    result.current[1].reset;

    store.reset;
  });
});
