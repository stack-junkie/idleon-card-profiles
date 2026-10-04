# Attribution

## Project license

Idleon Card Profiles original code is available under the [MIT License](LICENSE). Third-party software and game assets retain their own terms.

## Node.js

The Windows installer bundles Node.js **24.14.0**. Its license, including third-party component notices, is preserved in [packaging/node-LICENSE.txt](packaging/node-LICENSE.txt) and copied into the installed `runtime/LICENSE.txt`.

Upstream source: [Node.js v24.14.0 LICENSE](https://github.com/nodejs/node/blob/v24.14.0/LICENSE). The installer build verifies the expected runtime version and license-file hash.

## Legends of Idleon

Legends of Idleon is developed by Lavaflame2. Idleon Card Profiles is an independent, unofficial project and is not affiliated with or endorsed by Lavaflame2.

The game and its assets are not included in this repository or its packages. Native fonts used in the game, and font data optionally used by the offline preview, are read at runtime from the user's supported installed copy. Those assets are not redistributed.

## Integration references

Integration research referenced Idleon-Injector's [Steam attachment approach](https://github.com/MrJoiny/Idleon-Injector/blob/master/src/modules/game/gameAttachment.js) and [response interception](https://github.com/MrJoiny/Idleon-Injector/blob/master/src/modules/game/cheatInjection.js). No source files or assets from that project are distributed here, and Idleon Card Profiles does not depend on it.
