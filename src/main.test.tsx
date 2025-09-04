import { act, renderHook } from "@testing-library/react";
import { ExternalStore } from "./main";

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

  reset() {
    this.setState({ count: 0 });
  }
}

class AsyncCounterStore extends ExternalStore<{
  loading: boolean;
  count: number;
}> {
  constructor() {
    super({ loading: false, count: 0 });
  }

  async incrementAsync() {
    this.setState((prev) => ({ loading: true, count: prev.count }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.setState((prev) => ({ loading: false, count: prev.count + 1 }));
  }

  async decrementAsync() {
    this.setState((prev) => ({ loading: true, count: prev.count }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.setState((prev) => ({ loading: false, count: prev.count - 1 }));
  }
}

class TestAsyncCounterStore extends AsyncCounterStore {
  override async incrementAsync() {
    this.setState((prev) => ({ loading: false, count: prev.count + 1 }));
  }

  override async decrementAsync() {
    this.setState((prev) => ({ loading: false, count: prev.count - 1 }));
  }
}

test("type checks", () => {
  const store = new CounterStore();

  const [_Provider, useStore] = ExternalStore.createProvider(store);

  /**
   * These members exist on the store, but should not be accessed directly from the hook.
   */
  store.state;
  store.use;
  store.subscribe;

  /**
   * This member is defined on the subclass, so it is accessible here, but not from the hook.
   */
  store.incrementer;

  // @ts-ignore
  function App() {
    const [_state, actions] = useStore();

    /**
     * These members exist on the JS object but ideally shouldn't be used,
     * so make sure that we use the typesystem to prevent access.
     */

    // @ts-expect-error
    actions.use;

    // @ts-expect-error
    actions.state;

    // @ts-expect-error
    actions.setState;

    // @ts-expect-error
    actions.incrementer;

    // @ts-expect-error
    actions.subscribe;
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
    result.current[1].reset();
  });

  expect(result.current[0]).toEqual({ count: 0 });
  expect(resultWithSelector.current[0]).toEqual(0);
});

test("uses a store with async actions as a hook", async () => {
  vi.useFakeTimers();

  const store = new AsyncCounterStore();

  const { result } = renderHook(() => store.use());

  expect(result.current[0]).toEqual({ loading: false, count: 0 });

  act(() => {
    result.current[1].incrementAsync();
    vi.advanceTimersByTime(50);
  });

  expect(result.current[0]).toEqual({ loading: true, count: 0 });

  await act(async () => {
    vi.advanceTimersByTime(50);
    await Promise.resolve();
  });

  expect(result.current[0]).toEqual({ loading: false, count: 1 });
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

describe("ExternalStore.createStoreProvider", () => {
  const store = new AsyncCounterStore();

  const [TestStoreProvider, useTestStore] = ExternalStore.createProvider(store);
  const [AbstractProvider, useAbstractStore] = ExternalStore.createProvider<AbstractCounterStore>("CounterStore");

  test("use the store via hook without the context provider", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useTestStore());

    expect(result.current[0]).toEqual({ loading: false, count: 0 });

    await act(async () => {
      result.current[1].incrementAsync();
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    expect(result.current[0]).toEqual({ loading: true, count: 0 });

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(result.current[0]).toEqual({ loading: false, count: 1 });

    await act(async () => {
      result.current[1].decrementAsync();
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(result.current[0]).toEqual({ loading: false, count: 0 });
  });

  test("can inject test store via provider", async () => {
    const testStore = new TestAsyncCounterStore();

    const { result } = renderHook(() => useTestStore(), {
      wrapper: ({ children }) => <TestStoreProvider store={testStore}>{children}</TestStoreProvider>,
    });

    expect(result.current[0]).toEqual({ loading: false, count: 0 });

    await act(async () => {
      result.current[1].incrementAsync();
      await Promise.resolve();
    });

    expect(result.current[0]).toEqual({ loading: false, count: 1 });

    await act(async () => {
      result.current[1].decrementAsync();
      await Promise.resolve();
    });

    expect(result.current[0]).toEqual({ loading: false, count: 0 });
  });

  test("creates a provider and hook for an abstract store", () => {
    const store = new CounterStore(3);

    const { result } = renderHook(() => useAbstractStore((s) => s.count), {
      wrapper: ({ children }) => <AbstractProvider store={store}>{children}</AbstractProvider>,
    });

    expect(result.current[0]).toEqual(0);

    act(() => {
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
