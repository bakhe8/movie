// vitest@5 changed Assertion<T> → Assertion<R, T> and @testing-library/jest-dom@7
// targets v3. This file lives in apps/frontend so 'vitest' resolves to the
// local v5 package and the augmentation targets the correct Package ID.
// Only the matchers actually used in __tests__ are declared here.
import 'vitest';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Assertion<R extends void | Promise<void> = void, T = unknown> {
    toBeInTheDocument(): R;
    toBeVisible(): R;
    toHaveTextContent(text: string | RegExp): R;
    toHaveAttribute(attr: string, value?: string | RegExp): R;
    toBeDisabled(): R;
    toBeEnabled(): R;
    toHaveClass(...classNames: string[]): R;
    toBeChecked(): R;
    toHaveFocus(): R;
    toBeEmpty(): R;
    toContainElement(element: Element | null): R;
  }
}
