import { createGameAdapter } from './game-adapter.js';
import { createProfileController, createRuntimeRpc } from './controller.js';
import { mountOverlay } from './ui.js';

export function buildBrowserSource() {
  return `(() => {
    if (!window.__idleonCardProfilesGame) throw new Error('Verified game root is unavailable.');
    window.__idleonCardProfilesCleanup?.();
    const adapter = (${createGameAdapter.toString()})(window.__idleonCardProfilesGame);
    const rpc = (${createRuntimeRpc.toString()})();
    const controller = (${createProfileController.toString()})(adapter, rpc);
    const ui = (${mountOverlay.toString()})(controller);
    window.__idleonCardProfilesCleanup = () => {
      ui.destroy(); controller.destroy(); rpc.destroy();
      window.__idleonCardProfilesInputActive = false;
      delete window.__idleonCardProfilesCleanup;
    };
    return { installed: true };
  })()`;
}
