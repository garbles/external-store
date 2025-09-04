import React from "react";

type Subscriber = () => void;
type Unsubscribe = () => void;

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

type OnlyMethods<T> = {
  [K in keyof T as T[K] extends Function ? K : never]: T[K];
};

export type ProviderProps<S extends ExternalStore<any>> = {
  children: React.ReactNode;
  store?: S;
};

type Actions<S extends ExternalStore<any>> = OnlyMethods<
  Expand<Omit<S, keyof ExternalStore<any>>>
>;

export abstract class ExternalStore<T extends object> {
  static createProvider<S extends ExternalStore<any>>(store: S) {
    type T = S extends ExternalStore<infer U> ? U : never;

    const Context = React.createContext<S | null>(null);
    Context.displayName = `StoreContext(${store.constructor.name})`;

    const Provider: React.FC<ProviderProps<S>> = (props) => {
      return (
        <Context.Provider value={props.store ?? store}>
          {props.children}
        </Context.Provider>
      );
    };
    Provider.displayName = `StoreProvider(${store.constructor.name})`;

    const use = (): [T, Actions<S>] => {
      const context = React.useContext(Context);

      if (!context) {
        throw new Error(
          `useStore must be used within a ${Provider.displayName}`
        );
      }

      return context.use();
    };

    return [Provider, use] as const;
  }

  subscribe: (fn: Subscriber) => Unsubscribe;
  #subscribers = new Set<Subscriber>();
  #state: T;

  constructor(initialState: T) {
    this.#state = initialState;

    this.subscribe = (fn: Subscriber): Unsubscribe => {
      this.#subscribers.add(fn);
      return () => this.#subscribers.delete(fn);
    };
  }

  get state(): T {
    return this.#state;
  }

  protected setState(next: T | ((prev: T) => T)): void {
    if (typeof next === "function") {
      this.#state = next(this.#state);
    } else {
      this.#state = next;
    }

    this.#notify();
  }

  use(): [T, Actions<this>] {
    const state = React.useSyncExternalStore(
      this.subscribe,
      () => this.#state,
      () => this.#state
    );

    return [state, this as any];
  }

  #notify(): void {
    for (const fn of this.#subscribers) fn();
  }
}
