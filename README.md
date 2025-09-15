# Rubik Mosaic — Browser GUI

Static site that converts photos into a Rubik-cube 3×3-face mosaic in the browser.  
No server needed — works entirely client-side and is deployable on GitHub Pages.

## How to deploy
1. Create a new GitHub repo (e.g. `rubik-mosaic-gui`) and push these files to `main`.
2. In the repo settings → Pages, set Source to `main` branch and `/ (root)` — Save.
3. Visit `https://<your-username>.github.io/<repo-name>/`.

## Usage
- Drag & drop or choose an image.
- Tweak settings (cubes across, sticker size, blur, luminance weight).
- Click **Process & Preview**.
- Download the mosaic PNG, CSV, and (optionally) ZIP of per-cube PNGs.

## Notes
- Palette: White, Yellow, Red, Orange, Blue, Green.
- Uses serpentine Floyd–Steinberg dithering + luminance-weighted LAB distance for better gradients.
