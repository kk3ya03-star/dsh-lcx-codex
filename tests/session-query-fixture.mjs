// Small unit-fixture adapter. Integration coverage uses the real query backend.
export function queryContext(session) {
  const query = {
    async observeSession() {
      return {
        events: session.snapshotEvents(),
        [Symbol.dispose]() {},
      }
    },
  }
  return {
    get(name) {
      return name === 'sessionQuery' ? query : undefined
    },
  }
}
