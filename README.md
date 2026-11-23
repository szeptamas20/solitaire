# Solitaire

Klondike solitaire for your phone. No ads, no tracking, and it works offline.

## Put it online (free, one time, about 10 minutes)

1. Sign up for a free account at https://github.com.
2. Click **+** (top right) → **New repository**. Name it `solitaire`, choose **Public**, and click **Create repository**.
3. On the new repo page, click **uploading an existing file**. Drag in **everything inside this `solitaire` folder**: `index.html`, `style.css`, `game.js`, `sw.js`, `manifest.webmanifest`, `README.md`, and the whole `icons` folder. Click **Commit changes**.
4. Go to **Settings** → **Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, Branch to **main**, folder **/ (root)**, and click **Save**.
5. Wait a minute or two. The page then shows your address, like `https://YOUR-NAME.github.io/solitaire/`.

## Install on your iPhone

1. Open that address in **Safari** (it has to be Safari).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open Solitaire from your home screen once while you're online. After that it works in airplane mode too.

## How to play

- **Tap** a card to move it to the best spot (foundation first). Tap again to try the next spot.
- **Drag** a card or a run of cards to put it exactly where you want.
- **Tap the deck** to draw. Tap the empty deck spot to turn the pile over.
- **Hint** highlights a useful move. **Undo** has no limit.
- When every card is face up and the deck is empty, the game finishes itself.
- **Menu**: Draw 1 or 3, deck on the left or right, light/dark theme, and your statistics.

Your game in progress is saved on the phone, so you can close the app at any time.

## Changing the app later

If you edit any file, open `sw.js` and change `const VERSION = 'v1'` to `'v2'` (and so on), then upload the changed files again. Otherwise phones keep the old cached copy. After an update, open the app twice for the new version to show up.
