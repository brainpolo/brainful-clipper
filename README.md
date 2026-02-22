# brainful clipper

A Chrome extension that lets you clip links, media files, and quick notes to brainful.

## Installation

Install from the [Chrome Web Store](https://chrome.google.com/webstore) (search "brainful clipper").

### Manual Installation (Developer)

1. Clone this repository and install dependencies:
   ```bash
   bun install
   ```

2. Build the extension:
   ```bash
   bun run build
   ```

3. Open Chrome and navigate to `chrome://extensions`.

4. Enable **Developer mode** (toggle in the top right).

5. Click **Load unpacked** and select the `.output/chrome-mv3/` folder.

## Pinning the Extension

1. Click the puzzle piece icon in your Chrome toolbar.
2. Find "brainful clipper" in the list.
3. Click the pin icon next to it.

## How to Use

**Notes** — Open the extension and jot down thoughts in the note tab. Your text auto-saves locally. Click "push to brainful" to save it as a block — the share link is copied to your clipboard.

**Clipping YouTube Videos** — Navigate to any YouTube video, click the extension icon, and click "clip". The video is saved to your brainful library.

**Uploading Files** — Drag and drop images, PDFs, audio, or video files into the extension popup.

**Right-Click to Clip** — Right-click any image, video, or audio element on a webpage and select "clip file" from the context menu.

**History** — Browse, search, and tag everything you've clipped from the history tab.

## Requirements

You must be logged into your account at [brainful.one](https://brainful.one). If you're not logged in, the extension will prompt you to sign in.

## Support

If you run into any issues, please reach out at hello@brainful.one.
