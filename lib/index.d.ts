import type { DshChatLocalService } from "./room-store.js";

export declare const name = "dsh-chat-local";
export declare const inject: string[];
/**
 * The plugin's mount point.
 *
 * Cordis constructs this callback (`new apply(ctx, config)`) and then reads only
 * the instance's init hooks, **discarding the returned service**; the value is
 * for callers that mount the plugin directly — a test that must drive the same
 * service instance the tool registry and the HTTP routes use. Production
 * behaviour never reads it. The callback must therefore stay a constructable
 * `function` declaration: an arrow function or an `async` function is not
 * dispatched by construction, and Cordis then treats the returned service as the
 * plugin's effect and rejects it. See `test/plugin-mount.test.js`.
 */
export declare function apply(ctx: any, config?: any): DshChatLocalService;
