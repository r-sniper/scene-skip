export function notImplemented(call: string): never {
  throw Object.assign(new Error(`${call} is not implemented in the skeleton.`), {
    code: "NOT_IMPLEMENTED"
  });
}
