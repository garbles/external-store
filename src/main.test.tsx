import { renderHook, act, render } from "@testing-library/react";
import { ExternalStore } from "./main";

class CounterStore extends ExternalStore<{ count: number }> {
  constructor(public incrementer = 1) {
    super({ count: 0 });
  }

  increment() {
    this.setState((prev) => ({ count: prev.count + this.incrementer }));
  }

  decrement() {
    this.setState((prev) => ({ count: prev.count - this.incrementer }));
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

  expect(result.current[0]).toEqual({ count: 0 });

  act(() => {
    result.current[1].increment();
    result.current[1].increment();
  });

  expect(result.current[0]).toEqual({ count: 10 });

  act(() => {
    result.current[1].decrement();
  });

  expect(result.current[0]).toEqual({ count: 5 });
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

  const App = () => {
    const [state, actions] = useTestStore();

    return (
      <div>
        <span data-testid="count">{state.count}</span>
        <span data-testid="loading">{Number(state.loading)}</span>
        <button
          data-testid="increment"
          onClick={() => actions.incrementAsync()}
        >
          Increment
        </button>
        <button
          data-testid="decrement"
          onClick={() => actions.decrementAsync()}
        >
          Decrement
        </button>
      </div>
    );
  };

  test("use the store via context provider", async () => {
    vi.useFakeTimers();

    const { getByTestId } = render(<App />, { wrapper: TestStoreProvider });

    expect(getByTestId("count").textContent).toBe("0");
    expect(getByTestId("loading").textContent).toBe("0");

    await act(async () => {
      getByTestId("increment").click();
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    expect(getByTestId("count").textContent).toBe("0");
    expect(getByTestId("loading").textContent).toBe("1");

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(getByTestId("count").textContent).toBe("1");
    expect(getByTestId("loading").textContent).toBe("0");

    await act(async () => {
      getByTestId("decrement").click();
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(getByTestId("count").textContent).toBe("0");
    expect(getByTestId("loading").textContent).toBe("0");
  });

  test("can inject test store via provider", async () => {
    const testStore = new TestAsyncCounterStore();

    const { getByTestId } = render(<App />, {
      wrapper: ({ children }) => (
        <TestStoreProvider store={testStore}>{children}</TestStoreProvider>
      ),
    });

    expect(getByTestId("count").textContent).toBe("0");
    expect(getByTestId("loading").textContent).toBe("0");

    await act(async () => {
      getByTestId("increment").click();
      await Promise.resolve();
    });

    expect(getByTestId("count").textContent).toBe("1");
    expect(getByTestId("loading").textContent).toBe("0");

    await act(async () => {
      getByTestId("decrement").click();
      await Promise.resolve();
    });

    expect(getByTestId("count").textContent).toBe("0");
    expect(getByTestId("loading").textContent).toBe("0");
  });
});
