import { createPuzzmoSDK } from "@puzzmo/sdk"
import { createPico8Game } from "@puzzmo/sdk/pico8"

// Your game is in cart/game.p8. This connects it to Puzzmo: it hands the cart the
// puzzle, and passes on what the cart saves. You shouldn't need to change it.
createPico8Game(createPuzzmoSDK())
