import React from "react";

type Awaitable<T> = T | Promise<T>;

type Subscriber = () => void;
type Unsubscribe = () => void;

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

type OnlyMethods<T> = {
  [K in keyof T as T[K] extends Function ? K : never]: T[K];
};

type Selector<T, U> = (state: T) => U;

type State<S> = S extends BaseExternalStore<any, infer U> ? U : never;

type Use<S extends BaseExternalStore<any, any>> = {
  (): [State<S>, Actions<S>];
  <U>(selector: Selector<State<S>, U>): [U, Actions<S>];
};

type Usable<S extends BaseExternalStore<any, any>> = {
  use: Use<S>;
};

type Actions<S extends BaseExternalStore<any, any>> = Expand<OnlyMethods<Omit<S, keyof BaseExternalStore<any, any> | "setStateAsync">>>;

type CreateProviderResult<S extends BaseExternalStore<any, any>> = [React.FC<ProviderProps<S>>, Use<S>];

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

type ProviderProps<S extends BaseExternalStore<any, any>> = {
  children: React.ReactNode;
  store: Usable<S>;
};

const promiseWithResolvers = <T,>(): PromiseWithResolvers<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const createSuspenseSelector = <T, U>(selector: Selector<T, U>) => {
  return (state: AsyncState<T>): U => {
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
};

const identity = <T,>(x: T): T => x;

abstract class BaseExternalStore<T extends object, U extends object> {
  static createProvider<S extends BaseExternalStore<any, any>>(displayName?: string): CreateProviderResult<S>;
  static createProvider<S extends BaseExternalStore<any, any>>(store: S): CreateProviderResult<S>;
  static createProvider(arg: BaseExternalStore<any, any> | string = "Store"): CreateProviderResult<BaseExternalStore<any, any>> {
    const isAbstract = typeof arg === "string";
    const displayName = isAbstract ? arg : arg.constructor.name;
    const defaultContextValue = isAbstract ? null : arg;

    const Context = React.createContext<Usable<BaseExternalStore<any, any>> | null>(defaultContextValue);
    Context.displayName = `ExternalStoreContext(${displayName})`;

    const Provider: React.FC<ProviderProps<BaseExternalStore<any, any>>> = (props) => (
      <Context.Provider value={props.store}>{props.children}</Context.Provider>
    );
    Provider.displayName = `ExternalStoreProvider(${displayName})`;

    const use: Use<BaseExternalStore<any, any>> = (selector = identity) => {
      const context = React.useContext(Context);
      if (!context) throw new Error(`Hook must be used within a ${Provider.displayName}`);
      return context.use(selector);
    };

    return [Provider, use] as const;
  }

  abstract use(): [U, Actions<this>];
  abstract use<V>(selector: Selector<U, V>): [V, Actions<this>];
  abstract hydrate(state: U): Awaitable<void>;

  subscribe: (fn: Subscriber) => Unsubscribe;
  #subscribers = new Set<Subscriber>();
  #initialState: T;
  #state: T;

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

  get initialState(): T {
    return this.#initialState;
  }

  reset(): void {
    this.setState(this.#initialState);
  }

  protected useInternal(): [T, Actions<this>];
  protected useInternal<U>(selector: Selector<T, U>): [U, Actions<this>];
  protected useInternal(selector: Selector<any, any> = identity) {
    const getState = React.useCallback(() => selector(this.#state), [this, selector]);
    const getInitialState = React.useCallback(() => selector(this.#initialState), [this, selector]);

    const state = React.useSyncExternalStore(this.subscribe, getState, getInitialState);

    React.useDebugValue(state);

    return [state, this];
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

  #notify(): void {
    for (const fn of this.#subscribers) fn();
  }
}

export abstract class ExternalStore<T extends object> extends BaseExternalStore<T, T> {
  use(): [T, Actions<this>];
  use<U>(selector: Selector<T, U>): [U, Actions<this>];
  use(selector: Selector<any, any> = identity) {
    return this.useInternal(selector);
  }

  hydrate(state: Partial<T>): void {
    this.setState(state);
  }
}

export abstract class AsyncExternalStore<T extends object> extends BaseExternalStore<AsyncState<T>, T> {
  #controller: AbortController | null = null;

  constructor(initialData?: T) {
    if (!!initialData) {
      super({ status: "idle", loading: false, refreshing: false, data: initialData });
    } else {
      super({ status: "uninitialized", loading: false, refreshing: false, promise: promiseWithResolvers<T>() });
    }
  }

  protected setStateAsync(update: (prev: AsyncState<T>["data"], signal: AbortSignal) => Awaitable<T>): Promise<void> {
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

    const result = update(this.state.data, controller.signal);

    if (!(result instanceof Promise)) {
      this.setState({ status: "idle", loading: false, refreshing: false, data: result });
      this.state.promise?.resolve(result);
      return Promise.resolve();
    }

    return result
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
          error = new Error("An unknown error occurred", { cause });
        }

        this.setState({ status: "error", loading: false, refreshing: false, error });
        this.state.promise?.reject(error);
      });
  }

  use(): [T, Actions<this>];
  use<U>(selector0: Selector<T, U>): [U, Actions<this>];
  use(selector0: Selector<any, any> = identity) {
    const selector = React.useMemo(() => createSuspenseSelector(selector0), [selector0]);
    return this.useInternal(selector);
  }

  hydrate(state: T): Promise<void> {
    return this.setStateAsync(() => state);
  }
}
