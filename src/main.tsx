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
  (): [State<S>, Actions<S>];
  <U>(selector: Selector<State<S>, U>): [U, Actions<S>];
}

type ProviderProps<S extends ExternalStore<any>> = {
  children: React.ReactNode;
  store: S;
};

type Actions<S extends ExternalStore<any>> = Expand<OnlyMethods<Omit<S, keyof ExternalStore<any>>>>;

type CreateProviderResult<S extends ExternalStore<any>> = [React.FC<ProviderProps<S>>, Use<S>];

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

  #notify(): void {
    for (const fn of this.#subscribers) fn();
  }
}
