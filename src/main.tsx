import React from "react";

type Subscriber = () => void;
type Unsubscribe = () => void;

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

type OnlyMethods<T> = {
  [K in keyof T as T[K] extends Function ? K : never]: T[K];
};

type Selector<T, U> = (state: T) => U;

type State<S> = S extends ExternalStore<infer U> ? U : never;
interface Use<S extends ExternalStore<any>> {
  (): [State<S>, Actions<S, ExternalStore<any>>];
  <U>(selector: Selector<State<S>, U>): [U, Actions<S, ExternalStore<any>>];
}

type Actions<S extends ExternalStore<any>, B = ExternalStore<any>> = Expand<OnlyMethods<Omit<S, keyof B>>>;

type CreateProviderResult<S extends ExternalStore<any>> = [React.FC<ProviderProps<S>>, Use<S>];

type AsyncState<T> =
  | { status: "uninitialized"; loading: false; refreshing: false; data: null; error: null }
  | { status: "pending"; loading: true; refreshing: false; data: null; error: null }
  | { status: "pending"; loading: true; refreshing: true; data: T; error: null }
  | { status: "idle"; loading: false; refreshing: false; data: T; error: null }
  | { status: "error"; loading: false; refreshing: false; data: null; error: Error };

type AsyncExternalStoreOptions = {
  suspense: boolean;
};

// type UseWithSuspense<S extends AsyncExternalStore<any>, O extends AsyncExternalStoreUseOptions> = S extends ExternalStore<any>
//   ? O extends { suspense: true }
//     ? {
//         use(): [State<S>["data"], Actions<S, AsyncExternalStore<any>>];
//         use<U>(selector: Selector<State<S>["data"], U>): [U, Actions<S, AsyncExternalStore<any>>];
//       }
//     : {
//         use(): [State<S>, Actions<S, AsyncExternalStore<any>>];
//         use<U>(selector: Selector<State<S>, U>): [U, Actions<S, AsyncExternalStore<any>>];
//       }
//   : never;

type ProviderProps<S extends ExternalStore<any>> = {
  children: React.ReactNode;
  store: S;
};

const identity = <T,>(x: T): T => x;

export abstract class ExternalStore<T extends object> {
  static createProvider<S extends ExternalStore<any>>(displayName?: string): CreateProviderResult<S>;
  static createProvider<S extends ExternalStore<any>>(store: S): CreateProviderResult<S>;
  static createProvider(arg: ExternalStore<any> | string = "Store"): CreateProviderResult<ExternalStore<any>> {
    const isAbstract = typeof arg === "string";
    const displayName = isAbstract ? arg : arg.constructor.name;
    const defaultContextValue = isAbstract ? null : arg;

    const Context = React.createContext<ExternalStore<any> | null>(defaultContextValue);
    Context.displayName = `ExternalStoreContext(${displayName})`;

    const Provider: React.FC<ProviderProps<ExternalStore<any>>> = (props) => (
      <Context.Provider value={props.store}>{props.children}</Context.Provider>
    );
    Provider.displayName = `ExternalStoreProvider(${displayName})`;

    const use: Use<ExternalStore<any>> = (selector = identity) => {
      const context = React.useContext(Context);
      if (!context) throw new Error(`Hook must be used within a ${Provider.displayName}`);
      return context.use(selector);
    };

    return [Provider, use] as const;
  }

  subscribe: (fn: Subscriber) => Unsubscribe;
  #subscribers = new Set<Subscriber>();
  #state: T;
  #initialState: T;

  constructor(initialState: T) {
    this.#initialState = initialState;
    this.#state = initialState;

    this.subscribe = (fn: Subscriber): Unsubscribe => {
      this.#subscribers.add(fn);
      return () => this.#subscribers.delete(fn);
    };

    this.use = this.use.bind(this);
    this.setState = this.setState.bind(this);
  }

  get state(): T {
    return this.#state;
  }

  protected setState(update: Partial<T> | ((prev: T) => Partial<T>)): void {
    const prev = this.#state;

    const next = typeof update === "function" ? update(prev) : update;

    if (Object.is(prev, next)) {
      return;
    }

    this.#state = { ...prev, ...next };
    this.#notify();
  }

  use(): [T, Actions<this>];
  use<U>(selector: Selector<T, U>): [U, Actions<this>];
  use(selector: Selector<any, any> = identity) {
    const getState = React.useCallback(() => selector(this.#state), [this, selector]);
    const getInitialState = React.useCallback(() => selector(this.#initialState), [this, selector]);

    const state = React.useSyncExternalStore(this.subscribe, getState, getInitialState);

    React.useDebugValue(state);

    return [state, this];
  }

  reset(): void {
    this.setState(this.#initialState);
  }

  hydrate(state: Partial<T>): void {
    this.setState(state);
  }

  #notify(): void {
    for (const fn of this.#subscribers) fn();
  }
}

export abstract class AsyncExternalStore<T extends object> extends ExternalStore<AsyncState<T>> {
  #controller: AbortController | null = null;

  constructor(initialData?: T | null) {
    if (!!initialData) {
      super({ status: "idle", loading: false, refreshing: false, data: initialData, error: null });
    } else {
      super({ status: "uninitialized", loading: false, refreshing: false, data: null, error: null });
    }
  }

  protected async setStateAsync(update: (prev: AsyncState<T>, signal: AbortSignal) => T): Promise<void> {
    if (this.state.data === null) {
      this.setState({ status: "pending", loading: true, refreshing: false, data: null, error: null });
    } else {
      this.setState({ status: "pending", loading: true, refreshing: true, data: this.state.data, error: null });
    }

    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;

    try {
      const data = await update(this.state, controller.signal);

      if (controller.signal.aborted) return;

      this.setState({ status: "idle", loading: false, refreshing: false, data, error: null });
    } catch (cause) {
      if (controller.signal.aborted) return;

      let error: Error;

      if (cause instanceof Error) {
        error = cause;
      } else {
        error = new Error("An unknown error occurred", { cause });
      }

      this.setState({ status: "error", loading: false, refreshing: false, data: null, error });
    }
  }
}
