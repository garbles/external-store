# Object-Oriented State Management for React

A type-safe, object-oriented React state management library built on `useSyncExternalStore`. `@garbles/external-store` provides a structured approach to state management with first-class TypeScript support, powerful testing capabilities, and clean separation of concerns.

It's essentially an object-oriented `zustand` but with slightly better compile-time support for test mocking.

## ✨ Key Features

- **Object-Oriented**: Clean class-based architecture with encapsulated state and methods
- **Type-Safe**: Full TypeScript support with automatic action extraction and type inference
- **Easy Testing**: Test state logic without React - direct method calls and type-safe mocking
- **React-Optimized**: Built on `useSyncExternalStore` for concurrent-safe updates
- **Selective Subscriptions**: Components only re-render when selected state changes
- **Provider Pattern**: Optional dependency injection with provider/hook pairs
- **Type-Safe Mocking**: Override methods with compile-time safety using TypeScript's `override` keyword

## Quick Start

### Installation

```bash
npm install @garbles/external-store
# or
yarn add @garbles/external-store
# or
pnpm add @garbles/external-store
```

### Basic Usage

```typescript
import { ExternalStore } from "@garbles/external-store";

// 1. Create your store class
class CounterStore extends ExternalStore<{ count: number }> {
  constructor() {
    super({ count: 0 });
  }

  increment() {
    this.setState((prev) => ({ count: prev.count + 1 }));
  }

  decrement() {
    this.setState((prev) => ({ count: prev.count - 1 }));
  }

  reset() {
    this.setState({ count: 0 });
  }
}

// 2. Create store instance
const counterStore = new CounterStore();

// 3. Use in React components
function Counter() {
  const [state, actions] = counterStore.use();

  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button onClick={actions.increment}>+</button>
      <button onClick={actions.decrement}>-</button>
      <button onClick={actions.reset}>Reset</button>
    </div>
  );
}

// 4. Use with selectors for performance
function CountDisplay() {
  const [count] = counterStore.use((state) => state.count);
  return <span>{count}</span>;
}
```

## 📚 Advanced Usage

### Provider Pattern

Create provider/hook pairs for dependency injection and testing:

```typescript
// Create provider and hook
const [CounterProvider, useCounter] = ExternalStore.createProvider(counterStore);

// Use the provider in your app
function App() {
  return (
    <CounterProvider store={counterStore}>
      <Counter />
    </CounterProvider>
  );
}

// Use the hook in components
function Counter() {
  const [state, actions] = useCounter();
  return <button onClick={actions.increment}>{state.count}</button>;
}
```

### Abstract Stores

Define contracts with abstract classes:

```typescript
abstract class AbstractCounterStore extends ExternalStore<{ count: number }> {
  constructor() {
    super({ count: 0 });
  }

  abstract increment(): void;
  abstract decrement(): void;
}

class CounterStore extends AbstractCounterStore {
  increment() {
    this.setState((prev) => ({ count: prev.count + 1 }));
  }

  decrement() {
    this.setState((prev) => ({ count: prev.count - 1 }));
  }
}

// Create abstract provider
const [AbstractCounterProvider, useAbstractCounter] = ExternalStore.createProvider<AbstractCounterStore>("CounterStore");

// Use the provider in your app
function App() {
  return (
    <AbstractCounterProvider store={counterStore}>
      <Counter />
    </AbstractCounterProvider>
  );
}

// Use the hook in components
function Counter() {
  // `actions` are only the _public_ functions defined on the parent class.
  const [state, actions] = useCounter();
  return <button onClick={actions.increment}>{state.count}</button>;
}
```

### Async State Management

Handle async operations with loading states:

```typescript
class AsyncCounterStore extends ExternalStore<{
  count: number;
  loading: boolean;
}> {
  constructor() {
    super({ count: 0, loading: false });
  }

  async incrementAsync() {
    this.setState({ loading: true });

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      this.setState((prev) => ({
        count: prev.count + 1,
        loading: false,
      }));
    } catch (error) {
      this.setState({ loading: false });
    }
  }
}
```

## Testing

### Direct State Testing

Test store logic without React:

```typescript
import { CounterStore } from "./CounterStore";

test("counter increments correctly", () => {
  const store = new CounterStore();

  expect(store.state.count).toBe(0);

  store.increment();
  expect(store.state.count).toBe(1);

  store.increment();
  expect(store.state.count).toBe(2);
});
```

### React Hook Testing

```typescript
import { renderHook, act } from "@testing-library/react";

test("counter hook works correctly", () => {
  const store = new CounterStore();
  const { result } = renderHook(() => store.use());

  expect(result.current[0].count).toBe(0);

  act(() => {
    result.current[1].increment();
  });

  expect(result.current[0].count).toBe(1);
});
```

### Type-Safe Mocking

Creating a Provider provides an optional hook that can be used to override specific methods while unit testing. Override methods for testing with compile-time safety:

```typescript
// AsyncCounterStore.ts

// ....

const [AsyncCounterStoreProvider, useCounterStore] = ExternalStore.createProvider(AsyncCounterStore);

export { AsyncCounterStoreProvider, useCounterStore };

// App.tsx

import { useCounterStore } from "./AsyncCounterStore";

export const App = () => {
  // `actions` are only the _public_ functions defined on the parent class.
  const [state, actions] = useCounter();
  return <button onClick={actions.increment}>{state.count}</button>;
};

// App.test.tsx
import { render } from "@testling-library/react";
import { AsyncCounterStoreProvider, AsyncCounterStore } from "./AsyncCounterStore";
import { App } from "./App";

class MockAsyncCounterStore extends AsyncCounterStore {
  // TypeScript ensures this matches the original method signature
  override async incrementAsync() {
    // Remove delay for fast tests
    this.setState((prev) => ({
      count: prev.count + 1,
      loading: false,
    }));
  }
}

test("async operations work in tests", async () => {
  const store = new MockAsyncCounterStore();

  const result = render(() => <App />, {
    wrapper: ({ children }) => <AbstractProvider store={store}>{children}</AbstractProvider>,
  });

  // ...
});
```

## 🔄 Comparison with Other Libraries

### vs Zustand

Zustand has better community support (obviously). I wrote this library because it does not provide great support for async/API test mocking. The Zustand documentation suggests setting up jest-specific mocks, which rely on developers to be more diligent about avoiding contract drift.

### vs Redux

This library offers a similar set of benefits to Zustand when comparing to Redux: less boilerplate,

- **Less Boilerplate**: No actions, reducers, or dispatch patterns
- **Direct Method Calls**: Call store methods directly instead of dispatching actions
- **Built-in Async**: Handle async operations without middleware
- **Simpler Testing**: Test store methods directly without complex setup

## 📖 API Reference

### `ExternalStore<T>`

Base class for creating stores.

#### Properties

- `state: T` - Current store state (read-only)

#### Methods

- `setState(update: Partial<T> | (prev: T) => Partial<T>): void` - Update state
- `use(): [T, Actions<this>]` - React hook for full state
- `use<U>(selector: (state: T) => U): [U, Actions<this>]` - React hook with selector
- `subscribe(fn: () => void): () => void` - Subscribe to state changes

#### Static Methods

- `createProvider<S>(store: S): [Provider, Hook]` - Create provider with store instance
- `createProvider<S>(name: string): [Provider, Hook]` - Create abstract provider

### Type Definitions

```typescript
type Actions<S> = {
  [K in keyof S as S[K] extends Function ? K : never]: S[K];
};

type State<S> = S extends ExternalStore<infer U> ? U : never;

type Selector<T, U> = (state: T) => U;
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

This library is largely based on Zustand.
