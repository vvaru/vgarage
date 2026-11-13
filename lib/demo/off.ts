// Stands in for ./client in normal builds (see next.config.ts), so the example data
// and the fake database never ship to the live site.
export function createDemoClient(): never {
  throw new Error('Demo mode is off in this build.')
}
