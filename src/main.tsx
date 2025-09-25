import React from "react";

type Awaitable<T> = T | Promise<T>;

type Subscriber = () => void;
type Unsubscribe = () => void;

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

type OnlyMethods<T> = {
  [K in keyof T as T[K] extends Function ? K : never]: T[K];
};

type Selector<T, U> = (state: T) => U;

type FullState<S> = S extends ExternalStore<infer T, any> ? T : never;

type Actions<S extends ExternalStore<any, any>> = Expand<OnlyMethods<Omit<S, keyof ExternalStore<any, any> | "setStateAsync">>>;

type ProviderProps<S extends ExternalStore<any, any>> = {
  children: React.ReactNode;
  store: Expand<Pick<S, "use">>;
};

type CreateProviderResult<S extends ExternalStore<any, any>> = [React.FC<ProviderProps<S>>, S["use"]];

type PromiseWithResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: Error) => void;
};

type AsyncState<T> =
  | { status: "uninitialized"; loading: false; refreshing: false; data?: never; error?: never; promise: PromiseWithResolvers<T> }
  | { status: "pending"; loading: true; refreshing: false; data?: never; error?: never; promise: PromiseWithResolvers<T> }
  | { status: "pending"; loading: true; refreshing: true; data: T; error?: never; promise: PromiseWithResolvers<T> }
  | { status: "idle"; loading: false; refreshing: false; data: T; error?: never; promise?: never }
  | { status: "error"; loading: false; refreshing: false; data?: never; error: Error; promise?: never };

const promiseWithResolvers = <T,>(): PromiseWithResolvers<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const wrapSelectorForSuspense =
  <T, U>(selector: Selector<T, U>) =>
  (state: AsyncState<T>): U => {
    if (state.refreshing) {
      return selector(state.data);
    }

    switch (state.status) {
      case "uninitialized":
      case "pending":
        throw state.promise.promise;
      case "error":
        throw state.error;
      case "idle":
        return selector(state.data);
    }
  };

const abstractContext = (displayName: string): Pick<ExternalStore<any, any>, "use"> => {
  return {
    use() {
      throw new Error(`Hook must be used within a ExternalStoreProvider(${displayName})`);
    },
  };
};

const identity = <T,>(x: T): T => x;

function use<S extends ExternalStore<any, any>>(store: S): [FullState<S>, Actions<S>];
function use<S extends ExternalStore<any, any>, U>(store: S, selector: Selector<FullState<S>, U>): [U, Actions<S>];
function use(store: ExternalStore<any, any>, selector: Selector<any, any> = identity) {
  const getState = React.useCallback(() => selector(store.state), [store, selector]);
  const getInitialState = React.useCallback(() => selector(store.initialState), [store, selector]);

  const state = React.useSyncExternalStore(store.subscribe, getState, getInitialState);

  React.useDebugValue(state);

  return [state, store];
}

export abstract class ExternalStore<T extends object, U extends object> {
  static createProvider<S extends ExternalStore<any, any>>(displayName?: string): CreateProviderResult<S>;
  static createProvider<S extends ExternalStore<any, any>>(store: S): CreateProviderResult<S>;
  static createProvider<S extends ExternalStore<any, any>>(store: S | string = "Store"): CreateProviderResult<S> {
    const isAbstract = typeof store === "string";
    const displayName = isAbstract ? store : store.constructor.name;
    const defaultContextValue = isAbstract ? abstractContext(displayName) : store;

    const Context = React.createContext<Pick<S, "use">>(defaultContextValue);
    Context.displayName = `ExternalStoreContext(${displayName})`;

    const Provider: React.FC<ProviderProps<S>> = (props) => <Context.Provider value={props.store}>{props.children}</Context.Provider>;
    Provider.displayName = `ExternalStoreProvider(${displayName})`;

    const use = ((selector) => React.useContext(Context).use(selector)) as S["use"];

    return [Provider, use];
  }

  abstract use(): [U, Actions<this>];
  abstract use<V>(selector: Selector<U, V>): [V, Actions<this>];

  abstract hydrate(state: U): Awaitable<void>;

  #subscribers = new Set<Subscriber>();
  #initialState: T;
  #state: T;

  constructor(initialState: T) {
    this.#initialState = initialState;
    this.#state = initialState;

    this.use = this.use.bind(this);
    this.hydrate = this.hydrate.bind(this);
  }

  get state(): T {
    return this.#state;
  }

  get initialState(): T {
    return this.#initialState;
  }

  reset(): void {
    this.setState(this.#initialState);
  }

  subscribe = (fn: Subscriber): Unsubscribe => {
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  };

  setState = (update: Partial<T> | ((prev: T) => Partial<T>)): void => {
    const prev = this.#state;

    const next = typeof update === "function" ? update(prev) : update;

    if (Object.is(prev, next)) {
      return;
    }

    this.#state = { ...prev, ...next };
    this.#notify();
  };

  #notify(): void {
    for (const fn of this.#subscribers) fn();
  }
}

export abstract class SyncExternalStore<T extends object> extends ExternalStore<T, T> {
  use(): [T, Actions<this>];
  use<U>(selector: Selector<T, U>): [U, Actions<this>];
  use(selector: Selector<any, any> = identity) {
    return use(this, selector);
  }

  hydrate(state: Partial<T>): void {
    this.setState(state);
  }
}

export abstract class AsyncExternalStore<T extends object> extends ExternalStore<AsyncState<T>, T> {
  #controller: AbortController | null = null;

  constructor(initialData?: T) {
    if (!!initialData) {
      super({ status: "idle", loading: false, refreshing: false, data: initialData });
    } else {
      super({ status: "uninitialized", loading: false, refreshing: false, promise: promiseWithResolvers<T>() });
    }
  }

  protected setStateAsync(update: (signal: AbortSignal, prev: AsyncState<T>) => Awaitable<T>): Promise<void> {
    const prevState = this.state;

    switch (this.state.status) {
      case "uninitialized":
      case "pending":
        this.setState({ status: "pending", loading: true, refreshing: false, promise: this.state.promise });
        break;
      case "idle":
        this.setState({ status: "pending", loading: true, refreshing: true, data: this.state.data, promise: promiseWithResolvers<T>() });
        break;
      case "error":
        this.setState({ status: "pending", loading: true, refreshing: false, promise: promiseWithResolvers<T>() });
    }

    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;

    return Promise.resolve(update(controller.signal, prevState))
      .then((data) => {
        if (controller.signal.aborted) return;

        this.setState({ status: "idle", loading: false, refreshing: false, data });
        this.state.promise?.resolve(data);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;

        let error: Error;

        if (cause instanceof Error) {
          error = cause;
        } else {
          error = new Error(`${this.constructor.name}.setStateAsync threw an exception.`, { cause });
        }

        this.setState({ status: "error", loading: false, refreshing: false, error });
        this.state.promise?.reject(error);
      });
  }

  use(): [T, Actions<this>];
  use<U>(selector0: Selector<T, U>): [U, Actions<this>];
  use(selector0: Selector<any, any> = identity) {
    const selector = React.useMemo(() => wrapSelectorForSuspense(selector0), [selector0]);
    return use(this, selector);
  }

  hydrate(state: T): Promise<void> {
    return this.setStateAsync(() => state);
  }
}
