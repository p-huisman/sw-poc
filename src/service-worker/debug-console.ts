const DebugConsole = (debug: boolean, prefix: string) => {
  const logWithDebugCheck =
    (method: (...args: any[]) => void) =>
    (...args: any[]) => {
      if (debug) {
        method(prefix, ...args);
      }
    };
  return {
    info: logWithDebugCheck(console.log),
    error: logWithDebugCheck(console.error),
    table: (data: any) => {
      if (debug) {
        console.table(prefix, Array.from(data));
      }
    },
  };
};

export const setupDebugConsole = (debug: boolean, prefix: string) =>
  DebugConsole(debug, prefix);
