# feel

Steer your writing by meaning. Select some words, and a ring opens around the screen: each arc is a direction the passage could take, and the further you move toward it, the stronger the change. You see the text change while you move.

It is an experiment in how people could work with language models without describing what they want in a prompt first.

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer and git. There is nothing to install and no build step.

1. Get the code:

   ```bash
   git clone https://github.com/EDEN757/feel.git
   cd feel
   ```

2. Start it:

   ```bash
   npm start
   ```

3. Open http://localhost:4317 in a desktop browser.

The front page shows five short clips, one per interaction, each the real app playing itself on sample text. Below them is the same sample to try by hand. Click **paste your own text** or **try a sample letter** to start writing.

To stop it, press Ctrl+C in the terminal. For another port, run `PORT=5000 npm start`.

`npm start` only serves the files. There is no backend, so any static file server works too, for example `python3 -m http.server` in this folder. Opening `index.html` straight from disk does not work, because browsers only load JavaScript modules over http.

### Using a real model

Out of the box it runs on a **simulator** with canned rewrites, which is enough to try the interaction on the sample letter. For your own text you need a model:

1. Create an API key at [Cerebras](https://cloud.cerebras.ai).
2. In the app, click **simulator · add key** in the top bar and paste it. Pick the model in the same dialog: `gpt-oss-120b` (the default) or `qwen-3.8-27b`.

The key is stored only in your browser (localStorage) and sent only to `api.cerebras.ai`, straight from your browser. It never passes through a server of this project, because there is none. **remove key** in the same dialog deletes it. What the model is asked, word for word, is in [src/llm/prompts.js](src/llm/prompts.js).

## How it works

| You do | It does |
| --- | --- |
| Select words | Opens the ring with meanings for that passage. Move toward one; nearer the edge is stronger. |
| Click between words | Opens the ring in write mode: the arcs are moves (give an example, add a result…), and distance is how much to write. |
| Click on the ring | Pins that meaning. Up to four pins combine, joined by bonds. Click a pin to remove it. |
| Type | Asks for anything in your own words. The passage follows, and the ring's options are replaced with ones close to your request. |
| Scroll | New meanings, or back to earlier ones. |
| Push the right edge | Opens your documents. Click a passage to reference it. |
| ← ↓ / → ↑ | Shorter, or back. Tap fast to cut more. Only while nothing is typed. |
| Enter / Esc | Save, or cancel. |
| Cmd+Z / Shift+Cmd+Z | Undo or redo a saved change. |

### Why it feels fast

The interface asks ahead of need, in the way [Spaceship](https://github.com/chuanqisun/spaceship) does. When you select a passage it requests the meanings at every strength, five shorter versions, and the next set of meanings. Each time you pin something, it requests what every further move would give. By the time the cursor arrives, the answer is usually there. Replies are remembered by exact request, so asking early and asking for real share one call.

## Layout

```
index.html, styles.css   the page
src/app.js               the writing surface: the passage, aiming, pins, asking, saving
src/ring.js              the ring: its geometry, and everything drawn on the canvas
src/shorten.js           shorter with the arrow keys
src/panel.js             the documents panel
src/key.js               the key dialog and the first-time choice
src/dom.js               small page helpers
src/landing.js           the front page: dot-matrix names, the falling title, the clips
src/autopilot.js         the clips: a ghost cursor playing one interaction each
src/documents.js         your reference documents, kept in the browser
src/diff.js, sound.js    word-level diff; synthesized sounds
src/sample.js            the sample letter and placeholder documents
src/llm/index.js         one door to the model: cache, queue, key storage
src/llm/prompts.js       what the model is asked, per request kind
src/llm/cerebras.js      the Cerebras client
src/llm/simulator.js     canned replies for running without a key
scripts/serve.mjs        static server for local development
tests/                   run with `npm test`
```

## Status

A prototype. Your text and documents are kept in your browser. The prompts are still being tuned against real models, and it expects a mouse, a keyboard and a wide window.

## License

[MIT](LICENSE)

## Credits

Made by [Edoardo Schiatti](https://github.com/EDEN757).

Inspired by [Spaceship IDE](https://github.com/chuanqisun/spaceship) by Chuanqi Sun, which showed what realtime steering of text could feel like.
