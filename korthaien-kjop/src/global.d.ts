// Sesjonshemmeligheten mellomlagres på globalThis når SESSION_SECRET ikke er satt.
declare global {
  // eslint-disable-next-line no-var
  var __kh_secret: string | undefined;
}
export {};
